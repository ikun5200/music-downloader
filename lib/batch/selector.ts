import type { Platform } from '../constants'
import type { PlatformSearchResult, RawSearchSong } from '../search/types'
import { normalizeText } from '../utils'
import { chatCompletion, extractJsonObject, type ChatMessage } from '../ai/client'
import { getAiConfig, type AiConfig } from '../settings'
import { isCompilationAlbum } from '../metadata/normalize'

export interface PlatformInfo {
  channels: number
  qualities: string[]
  /** 平台优先级，0 最优先。 */
  order?: number
}

export interface SelectionOptions {
  quality?: string | null
  /** 不传则从数据库读取；测试时可显式传 null 关闭 AI。 */
  aiConfig?: AiConfig | null
  /** 便于测试注入。 */
  aiChat?: typeof chatCompletion
}

export interface SongSelection {
  platform: Platform
  song: RawSearchSong
  reason: string
  aiUsed: boolean
  score: number
}

interface CandidateBase {
  platform: Platform
  song: RawSearchSong
  titleNorm: string
  artistNorm: string
  duration: number
  info: PlatformInfo
  /** 标题本身命中翻唱/伴奏/现场等版本标记。 */
  variant: boolean
  /** 专辑名命中现场/精选/钢琴等标记；只作为 AI 参考，不直接丢弃候选。 */
  albumVariant: boolean
}

interface PreparedCandidate extends CandidateBase {
  score: number
  reasons: string[]
}

interface ScoredCandidate extends CandidateBase {
  score?: number
}

// 这些是“版本变体”标记；用户没明确要这个版本时，规则路径会排除。
const VERSION_RE =
  /(翻唱|cover|伴奏|纯音乐|钢琴|吉他|古筝|笛子|口琴|翻弹|演奏|铃声|片段|试听|组曲|串烧|联唱|medley|mv首播|首播|预告|采访|电台|节目|改编|对唱|remix|\bdj\b|\blive\b|现场|演唱会|音乐会|音乐节|晚会|毕业歌会|春晚|重制|重录|新版|\bversion\b|0\.8x|加速版|慢速版|降调|升调|混音)/i

const GENERIC_ARTIST_RE =
  /(音乐调频|歌单|电台|音乐台|音乐信箱|宝藏|推荐|精选|合集|频道|fm|radio|翻唱集|播放器)/i

// 用户常在批量名单里附带音质/版本描述，这些词不参与标题/歌手匹配。
const QUERY_STOP_RE =
  /^(原版|原唱|无损|高音质|高清|flac|mp3|320k|128k|hires|hi-res|母带|24bit|官方)$/i

const AI_SYSTEM_PROMPT = `你是音乐下载站的选版助手。用户想下载的是原版录音室歌曲，不是翻唱、cover、伴奏、纯音乐、钢琴/吉他等器乐版、DJ、remix、live/现场/演唱会、组曲/串烧、MV首播/解说、电台节目、合集或改编对唱版。
候选列表是各平台的完整搜索结果，没有经过规则筛选，里面可能有很多变体、合集和无关歌曲。请逐条判断，只选择真正的原版录音室版本；如果没有原版，返回 {"index": -1, "reason": "原因"}，不要为了下载而强行选择变体。
注意：variant 字段只根据标题判断；专辑名里的“演唱会/Live/精选/合集/钢琴/伴奏/AIR/新版本”等也可能是变体，要结合 album 和 albumVariant 判断。
优先：标题一致、歌手一致、原始录音室专辑、时长正常；如果多个平台都是原版，优先平台顺序靠前的平台。
只输出 JSON，不要输出解释或 markdown：{"index": 0, "reason": "一句话原因"}。`

function aiRejectionMessage(reason: string): string {
  const detail = reason ? `（${reason.slice(0, 160)}）` : ''
  return `AI 判断没有原版${detail}，未下载`
}

type AiOutcome =
  | { kind: 'picked'; candidate: CandidateBase; score: number; reason: string }
  | { kind: 'rejected'; reason: string }
  | { kind: 'unavailable'; error: string }

function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .split(/[\s,，、/]+/)
        .map((term) => normalizeText(term))
        .filter((term) => term && !QUERY_STOP_RE.test(term))
    ),
  ]
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function dedupe<T extends CandidateBase>(candidates: T[]): T[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = `${candidate.platform}:${candidate.titleNorm}:${candidate.artistNorm}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function scoreCandidates(candidates: CandidateBase[], terms: string[]) {
  const artistTerms = terms.filter((term) =>
    candidates.some((candidate) => candidate.artistNorm.includes(term))
  )
  // 歌手词不应该再被当成标题词，否则“手心的蔷薇-林俊杰”这类合集标题会误伤原版。
  const titleTerms = terms.filter(
    (term) =>
      !artistTerms.includes(term) &&
      candidates.some((candidate) => candidate.titleNorm.includes(term))
  )

  const prepared: PreparedCandidate[] = candidates.map((candidate) => {
    let score = 0
    const reasons: string[] = []

    if (titleTerms.length) {
      const matched = titleTerms.filter((term) => candidate.titleNorm.includes(term)).length
      if (matched === titleTerms.length) {
        score += 90
        reasons.push('标题匹配')
      } else if (matched > 0) {
        score += (45 * matched) / titleTerms.length
        reasons.push('标题部分匹配')
      } else {
        score -= 80
        reasons.push('标题不匹配')
      }
    }

    if (artistTerms.length) {
      const matched = artistTerms.filter((term) => candidate.artistNorm.includes(term)).length
      if (matched === artistTerms.length) {
        score += 80
        reasons.push('歌手匹配')
      } else if (matched > 0) {
        score += (40 * matched) / artistTerms.length
        reasons.push('歌手部分匹配')
      } else {
        score -= 80
        reasons.push('歌手不匹配')
      }
    }

    if (candidate.titleNorm === terms.join('')) score += 30

    if (titleTerms.length) {
      const extra = Math.max(0, candidate.titleNorm.length - titleTerms.join('').length)
      score -= Math.min(30, extra * 0.7)
    }

    if (
      GENERIC_ARTIST_RE.test(candidate.artistNorm) &&
      !terms.some((term) => candidate.artistNorm.includes(term))
    ) {
      score -= 50
      reasons.push('疑似合集/电台账号')
    }

    if (candidate.duration > 0 && candidate.duration < 60) score -= 35
    if (candidate.duration > 600) score -= 20

    // 渠道多、音质全的平台在同等匹配度下略优先。
    score += Math.min(6, candidate.info.channels) + Math.min(4, candidate.info.qualities.length)
    // 后台设置的平台优先级：越靠前加分越多，但不会压过标题/歌手匹配。
    score += Math.max(0, 5 - (candidate.info.order ?? 5))

    return { ...candidate, score, reasons }
  })

  // 用“强匹配候选”的时长中位数校正，排除同名但明显不同长度的版本。
  const strongDurations = prepared
    .filter((candidate) => candidate.score > 100 && candidate.duration > 0)
    .map((candidate) => candidate.duration)
  const referenceDuration = median(strongDurations)
  if (referenceDuration) {
    for (const candidate of prepared) {
      if (!candidate.duration) continue
      const delta = Math.abs(candidate.duration - referenceDuration)
      if (delta > 60) candidate.score -= 50
      else if (delta > Math.max(25, referenceDuration * 0.12)) candidate.score -= 25
    }
  }

  return {
    artistTerms,
    titleTerms,
    ranked: dedupe(prepared).sort(
      (a, b) =>
        b.score - a.score ||
        (a.info.order ?? 999) - (b.info.order ?? 999) ||
        b.info.channels - a.info.channels
    ),
  }
}

async function chooseWithAi(
  query: string,
  candidates: ScoredCandidate[],
  aiConfig: AiConfig | null,
  chat: typeof chatCompletion
): Promise<AiOutcome> {
  if (!aiConfig?.enabled) {
    return { kind: 'unavailable', error: '未启用 AI 选版' }
  }
  if (!aiConfig.apiKey) {
    return { kind: 'unavailable', error: '未配置 AI API Key' }
  }
  if (!candidates.length) {
    return { kind: 'unavailable', error: '没有可发给 AI 的候选' }
  }

  const platformOrder = [...new Set(candidates.map((candidate) => candidate.platform))]
  const messages: ChatMessage[] = [
    { role: 'system', content: AI_SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        query,
        platformOrder,
        candidates: candidates.map((candidate, index) => ({
          index,
          platform: candidate.platform,
          title: candidate.song.title,
          artist: candidate.song.artist,
          album: candidate.song.album || null,
          duration: candidate.duration || null,
          variant: candidate.variant,
          albumVariant: candidate.albumVariant,
        })),
      }),
    },
  ]

  try {
    const content = await chat(aiConfig, messages, { timeoutMs: 25_000, maxTokens: 300 })
    const parsed = extractJsonObject(content)
    const index = Number(parsed?.index)
    const reason = String(parsed?.reason || '').slice(0, 240)

    if (Number.isInteger(index) && index === -1) {
      return { kind: 'rejected', reason: reason || 'AI 判断没有原版' }
    }
    if (Number.isInteger(index) && index >= 0 && index < candidates.length) {
      const chosen = candidates[index]
      return {
        kind: 'picked',
        candidate: chosen,
        score: chosen.score || 0,
        reason: reason || '选择原版',
      }
    }
    return { kind: 'unavailable', error: 'AI 返回结果无法识别' }
  } catch (e) {
    console.warn('[batch] AI 选版请求失败:', e)
    return {
      kind: 'unavailable',
      error: 'AI 接口请求失败',
    }
  }
}

/**
 * AI 优先：把各平台的完整搜索结果交给 AI 判断原版；AI 不可用或返回异常时，
 * 才回退到规则排序。AI 明确返回 -1 时宁可不下载，也不强行匹配变体。
 */
export async function selectBestSong(
  query: string,
  results: PlatformSearchResult[],
  platformInfo: Map<Platform, PlatformInfo>,
  options: SelectionOptions = {}
): Promise<SongSelection> {
  const rawQuery = query.trim()
  const terms = queryTerms(rawQuery)
  const queryHasVersion = VERSION_RE.test(rawQuery)

  const all: CandidateBase[] = []
  for (const result of results) {
    const info = platformInfo.get(result.platform) || { channels: 0, qualities: [] }
    if (info.channels <= 0) continue
    if (options.quality && options.quality !== 'auto' && !info.qualities.includes(options.quality)) {
      continue
    }

    for (const song of result.results) {
      if (!song.id || !song.title || !song.artist) continue
      const duration = Number(song.duration) || 0
      const album = String(song.album || '')
      all.push({
        platform: result.platform,
        song,
        titleNorm: normalizeText(song.title),
        artistNorm: normalizeText(song.artist),
        duration,
        info,
        variant: VERSION_RE.test(String(song.title)),
        albumVariant: VERSION_RE.test(album) || isCompilationAlbum(album),
      })
    }
  }

  const candidates = dedupe(all)
  if (!candidates.length) {
    throw new Error('没有找到任何可用候选（渠道或音质不满足）')
  }

  const aiConfig = options.aiConfig === undefined ? await getAiConfig() : options.aiConfig
  const chat = options.aiChat || chatCompletion

  // AI 优先：把各平台的完整搜索结果全部交给 AI，不再先做变体过滤或只发前 12 条。
  // 这样像《K歌之王》这种原版排在规则结果后面的情况，AI 也能看到。
  const ai = await chooseWithAi(rawQuery, all, aiConfig, chat)
  if (ai.kind === 'picked') {
    return {
      platform: ai.candidate.platform,
      song: ai.candidate.song,
      reason: `AI：${ai.reason}`.slice(0, 300),
      aiUsed: true,
      score: ai.score,
    }
  }
  if (ai.kind === 'rejected') {
    throw new Error(aiRejectionMessage(ai.reason))
  }

  // AI 不可用或返回异常时才回退规则；规则仍然只用于兜底。
  const ruleCandidates = candidates.filter(
    (candidate) => !candidate.variant || queryHasVersion
  )
  if (ruleCandidates.length) {
    const { artistTerms, titleTerms, ranked } = scoreCandidates(ruleCandidates, terms)
    const top = ranked[0]
    const unmatchedTerms = terms.filter(
      (term) =>
        !ruleCandidates.some(
          (candidate) =>
            candidate.titleNorm.includes(term) || candidate.artistNorm.includes(term)
        )
    )
    const titleOk =
      !!top && (titleTerms.length === 0 || titleTerms.every((term) => top.titleNorm.includes(term)))
    const artistOk =
      !!top && (artistTerms.length === 0 || artistTerms.some((term) => top.artistNorm.includes(term)))
    const genericTop =
      !!top &&
      GENERIC_ARTIST_RE.test(top.artistNorm) &&
      !terms.some((term) => top.artistNorm.includes(term))
    const ruleOk =
      !!top && unmatchedTerms.length === 0 && titleOk && artistOk && !genericTop

    if (ruleOk) {
      return {
        platform: top.platform,
        song: top.song,
        reason: top.reasons.length ? top.reasons.join('，') : '规则排序',
        aiUsed: false,
        score: top.score,
      }
    }

    const detail = unmatchedTerms.length
      ? `（无法确认「${unmatchedTerms.join('、')}」）`
      : top
        ? `（最佳候选「${top.song.title} / ${top.song.artist}」）`
        : ''
    throw new Error(`规则未匹配到原版${detail}，${ai.error}，未下载`)
  }

  throw new Error(`规则没有可用候选（全部疑似翻唱/变体），${ai.error}，未下载`)
}
