import type { Platform } from '../constants'
import type { PlatformSearchResult, RawSearchSong } from '../search/types'
import { normalizeText } from '../utils'
import { chatCompletion, extractJsonObject, type ChatMessage } from '../ai/client'
import { getAiConfig, type AiConfig } from '../settings'
import { isCompilationAlbum } from '../metadata/normalize'
import {
  detectLanguageTags,
  detectVersionTags,
  matchesVersionIntent,
  type LanguageTag,
  type VersionTag,
} from '../version-intent'

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
  /** 标题/专辑中识别出的版本类型，用于匹配用户明确要求的版本。 */
  versionTags: VersionTag[]
  /** 标题/专辑中识别出的语言版本。 */
  languageTags: LanguageTag[]
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

// 用户常在批量名单里附带音质/版本/语言描述，这些词不参与标题/歌手匹配。
const QUERY_STOP_RE =
  /^(原版|原唱|无损|高音质|高清|flac|mp3|320k|128k|hires|hi-res|母带|24bit|官方|live|现场|现场版|演唱会|音乐会|音乐节|伴奏|伴奏版|纯音乐|纯音乐版|钢琴|钢琴版|吉他|吉他版|remix|混音|dj|翻唱|cover|acoustic|不插电|demo|小样|粤语|粤语版|国语|国语版|普通话|英文|英文版|英语|日语|日语版|韩语|韩语版|version|重制|重录|新版)$/i

const AI_SYSTEM_PROMPT = `你是音乐下载站的选版助手。先看 query 是否明确指定了版本或语言：
- 如果 query 里写了 Live/现场/演唱会/音乐会/音乐节/伴奏/纯音乐/钢琴/吉他/Remix/DJ/翻唱/不插电/Demo/粤语/国语/英文/日语/韩语/某个 Version，就必须选择对应版本或语言。例如 query 含“Live/现场/演唱会”，要选现场版，不要选录音室原版；query 含“伴奏”，要选伴奏版。
- 只有 query 没有明确版本或语言要求时，才默认选择真正的原版录音室版本，排除翻唱、cover、伴奏、纯音乐、钢琴/吉他等器乐版、DJ、remix、live/现场/演唱会、组曲/串烧、MV首播/解说、电台节目、合集或改编对唱版。
即使指定了版本或语言，也优先原始录音室专辑；同一版本同时出现在原专辑和精选/合集里时，选原专辑，不要选精选/合集。
候选列表是各平台的完整搜索结果，没有经过规则筛选，里面可能有很多变体、合集和无关歌曲。请逐条判断；如果找不到用户要求的版本，返回 {"index": -1, "reason": "原因"}，不要为了下载而强行选择别的版本。
注意：variant/albumVariant 只是提示，不是硬性排除；当 requestedVersion/requestedLanguage 命中时，对应的变体就是正确目标。
优先：标题一致、歌手一致、版本/语言匹配、时长正常；如果多个平台都符合，优先平台顺序靠前的平台。
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
    // 不能只用“歌名+歌手”去重：同一首歌的录音室版和 Live/伴奏版
    // 归一化后歌名可能完全相同，会把用户明确要求的版本丢掉。
    // 专辑也放进 key，避免同一 id 在精选集和原专辑里只保留一条。
    const key = `${candidate.platform}:${candidate.song.id || 'no-id'}:${
      candidate.titleNorm
    }:${candidate.artistNorm}:${candidate.song.album || ''}`
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
  const requestedVersion = detectVersionTags(query)
  const requestedLanguage = detectLanguageTags(query)
  const messages: ChatMessage[] = [
    { role: 'system', content: AI_SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        query,
        platformOrder,
        requestedVersion,
        requestedLanguage,
        candidates: candidates.map((candidate, index) => ({
          index,
          platform: candidate.platform,
          title: candidate.song.title,
          artist: candidate.song.artist,
          album: candidate.song.album || null,
          duration: candidate.duration || null,
          variant: candidate.variant,
          albumVariant: candidate.albumVariant,
          versionTags: candidate.versionTags,
          languageTags: candidate.languageTags,
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
      // AI 偶尔会返回和理由不一致的 index；这里做一次硬校验，
      // 不合格就回退规则，避免下载 54 秒片段、变体或错误语言版本。
      if (chosen.duration > 0 && chosen.duration < 60) {
        return { kind: 'unavailable', error: 'AI 选择了过短的片段，已回退规则' }
      }
      if (!requestedVersion.length && !requestedLanguage.length) {
        if (chosen.variant || chosen.albumVariant) {
          return { kind: 'unavailable', error: 'AI 选择了疑似变体，已回退规则' }
        }
      } else {
        if (!matchesVersionIntent(chosen, requestedVersion, requestedLanguage)) {
          return { kind: 'unavailable', error: 'AI 选择的版本/语言与用户要求不符，已回退规则' }
        }
        // 只指定语言、没有指定版本时，优先原专辑而不是精选/合集。
        // Live/伴奏等版本本身常来自现场专辑或伴奏专辑，不能因为 albumVariant 就否掉。
        if (
          requestedVersion.length === 0 &&
          requestedLanguage.length > 0 &&
          chosen.albumVariant &&
          candidates.some(
            (candidate) =>
              candidate !== chosen &&
              !candidate.albumVariant &&
              matchesVersionIntent(candidate, requestedVersion, requestedLanguage)
          )
        ) {
          return { kind: 'unavailable', error: 'AI 选择了精选/合集，已回退规则' }
        }
      }
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
  const requestedVersion = detectVersionTags(rawQuery)
  const requestedLanguage = detectLanguageTags(rawQuery)
  const hasRequestedVersion = requestedVersion.length > 0 || requestedLanguage.length > 0

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
      // 60 秒以下基本是试听/片段，15 分钟以上基本是串烧；不作为可下载候选。
      if (duration > 0 && (duration < 60 || duration > 900)) continue
      const album = String(song.album || '')
      const haystack = `${song.title} ${album}`
      all.push({
        platform: result.platform,
        song,
        titleNorm: normalizeText(song.title),
        artistNorm: normalizeText(song.artist),
        duration,
        info,
        variant: VERSION_RE.test(String(song.title)),
        albumVariant: VERSION_RE.test(album) || isCompilationAlbum(album),
        versionTags: detectVersionTags(haystack),
        languageTags: detectLanguageTags(haystack),
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
  // 用户明确要求版本/语言时，规则也只接受匹配该版本/语言的候选；
  // 没有明确要求时，才排除标题或专辑带变体标记的候选。
  let ruleCandidates = candidates.filter(
    (candidate) => !candidate.variant && !candidate.albumVariant
  )
  if (hasRequestedVersion) {
    const matches = candidates.filter((candidate) =>
      matchesVersionIntent(candidate, requestedVersion, requestedLanguage)
    )
    if (requestedVersion.length === 0 && requestedLanguage.length > 0) {
      const preferred = matches.filter((candidate) => !candidate.albumVariant)
      ruleCandidates = preferred.length ? preferred : matches
    } else {
      ruleCandidates = matches
    }
  }
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

  if (hasRequestedVersion) {
    throw new Error(
      `规则没有找到请求的版本（${[...requestedVersion, ...requestedLanguage].join('/')}），${ai.error}，未下载`
    )
  }
  throw new Error(`规则没有可用候选（全部疑似翻唱/变体），${ai.error}，未下载`)
}
