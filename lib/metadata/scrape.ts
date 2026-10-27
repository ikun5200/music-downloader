import type { AiConfig } from '../settings'
import { pickMetadataWithAi } from './ai'
import { isLooseMatch, scoreCandidate } from './normalize'
import { getMetadataAdapter } from './sources'
import { fetchKugouLyrics } from './kugou'
import type {
  MetadataCandidate,
  MetadataQuery,
  MetadataScrapeResult,
  MetadataSourceAdapter,
  MetadataSourceId,
} from './types'

export interface MetadataScrapeOptions {
  query: MetadataQuery
  sourceOrder: MetadataSourceId[]
  /** 只有全局 AI 开启、配置了 Key，且后台打开“AI 识别”时才传入。 */
  aiConfig?: AiConfig | null
}

function withQueryDuration(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null
}

function mergeNotes(notes: Array<string | undefined>): string {
  return notes
    .filter((note): note is string => !!note)
    .filter((note, index, list) => list.indexOf(note) === index)
    .join('；')
    .slice(0, 700)
}

function sortCandidates(candidates: MetadataCandidate[]): MetadataCandidate[] {
  return [...candidates].sort((a, b) => b.score - a.score)
}

function hasCover(candidate: MetadataCandidate): boolean {
  return !!(candidate.coverUrl || candidate.coverUrls?.length)
}

function hasLyrics(candidate: MetadataCandidate): boolean {
  return !!candidate.lyrics?.trim()
}

const SOURCE_COOLDOWN_MS = 10 * 60_000
const sourceCooldown = new Map<MetadataSourceId, number>()

function attachCover(
  target: MetadataCandidate,
  source: MetadataCandidate,
  notes: string[]
): boolean {
  if (hasCover(target)) return true
  if (source.coverUrls?.length) {
    target.coverUrls = source.coverUrls
    target.coverUrl = source.coverUrl || source.coverUrls[0]
    notes.push(`封面来自 ${source.sourceLabel}`)
    return true
  }
  if (source.coverUrl) {
    target.coverUrl = source.coverUrl
    target.coverUrls = [source.coverUrl]
    notes.push(`封面来自 ${source.sourceLabel}`)
    return true
  }
  return false
}

async function attachLyrics(
  target: MetadataCandidate,
  source: MetadataCandidate,
  adapter: MetadataSourceAdapter,
  notes: string[],
  fetched: Set<string>
): Promise<boolean> {
  if (hasLyrics(target)) return true
  if (hasLyrics(source)) {
    target.lyrics = source.lyrics
    notes.push(`歌词来自 ${source.sourceLabel}`)
    return true
  }
  if (!adapter.supportsLyrics) return false
  const key = `${source.source}:${source.songId || source.title}`
  if (fetched.has(key)) return false
  fetched.add(key)
  try {
    let lyrics = ''
    if (adapter.lyrics) lyrics = await adapter.lyrics(source)
    if (!lyrics && adapter.enrich) {
      await adapter.enrich(source)
      lyrics = source.lyrics || ''
    }
    if (lyrics?.trim()) {
      target.lyrics = lyrics
      notes.push(`歌词来自 ${source.sourceLabel}`)
      return true
    }
  } catch {
    // 单个源歌词失败不影响其他源
  }
  return false
}

async function enrichCandidate(
  candidate: MetadataCandidate,
  adapter: MetadataSourceAdapter
): Promise<void> {
  if (!adapter.enrich) return
  try {
    await adapter.enrich(candidate)
  } catch {
    // 详情补全是可选的
  }
}

/**
 * 下载后元数据刮削：
 * 1. 按后台顺序逐源检索，拿到可信原版后继续找歌词/封面；
 * 2. 规则打分过滤翻唱、live、remix、伴奏、改编版等；
 * 3. 选中的来源保持最高优先级，后续来源只补缺失的歌词/封面；
 * 4. 可选 AI 复核（仅规则没有可信候选时），失败自动回退规则。
 */
export async function scrapeMetadata(
  options: MetadataScrapeOptions
): Promise<MetadataScrapeResult> {
  const query: MetadataQuery = {
    title: String(options.query.title || '').trim(),
    artist: String(options.query.artist || '').trim(),
    album: options.query.album || '',
    duration: withQueryDuration(options.query.duration),
  }
  if (!query.title) return { status: 'not_found', note: '缺少歌名，无法刮削' }

  const order = options.sourceOrder.length
    ? options.sourceOrder
    : (['itunes', 'netease', 'kugou', 'kuwo', 'qqmusic', 'lrclib', 'theaudiodb'] as MetadataSourceId[])
  const notes: string[] = []
  const all: MetadataCandidate[] = []
  const fetchedLyrics = new Set<string>()
  let hadError = false
  let preferred: MetadataCandidate | null = null
  let preferredEnriched = false

  for (const source of order) {
    const adapter = getMetadataAdapter(source)
    if ((sourceCooldown.get(source) || 0) > Date.now()) {
      notes.push(`${adapter.label} 接口异常，暂时跳过`)
      continue
    }
    let result
    try {
      result = await adapter.search(query, 10)
    } catch (error) {
      result = {
        candidates: [],
        note: `${adapter.label} 搜索失败：${error instanceof Error ? error.message : String(error)}`,
      }
    }
    if (result.note) notes.push(result.note)
    if (!result.candidates.length && result.note?.includes('失败')) {
      hadError = true
      sourceCooldown.set(source, Date.now() + SOURCE_COOLDOWN_MS)
    }
    if (!result.candidates.length) continue

    const scored = result.candidates.map((candidate) =>
      scoreCandidate(candidate, query, order)
    )
    all.push(...scored)
    const viable = sortCandidates(scored.filter((candidate) => candidate.acceptable))
    if (!viable.length) continue

    if (!preferred) {
      preferred = viable[0]
      await enrichCandidate(preferred, adapter)
      preferredEnriched = true
    }

    // 当前来源只负责补 preferred 缺失的封面/歌词，不改变已确定的来源优先级。
    if (!hasCover(preferred)) {
      const withCover = viable.find((candidate) => hasCover(candidate))
      if (withCover) {
        attachCover(preferred, withCover, notes)
      } else if (adapter.supportsCover) {
        const candidate = viable[0]
        await enrichCandidate(candidate, adapter)
        attachCover(preferred, candidate, notes)
      }
    }

    if (!hasLyrics(preferred)) {
      const candidate = viable.find((item) => hasLyrics(item)) || viable[0]
      await attachLyrics(preferred, candidate, adapter, notes, fetchedLyrics)
    }

    if (hasCover(preferred) && hasLyrics(preferred)) break
  }

  let aiUsed = false
  if (!preferred) {
    const loose = sortCandidates(all.filter(isLooseMatch)).slice(0, 8)
    if (options.aiConfig?.enabled && options.aiConfig.apiKey && loose.length) {
      try {
        const pick = await pickMetadataWithAi(query, loose, order, options.aiConfig)
        if (pick.index === -1) {
          return {
            status: 'not_found',
            note: mergeNotes([...notes, `AI 判断没有原版：${pick.reason || '无匹配'}`]),
            aiUsed: true,
          }
        }
        preferred = loose[pick.index]
        aiUsed = true
        notes.push(`AI 选择：${pick.reason || '匹配原版'}`)
        const adapter = getMetadataAdapter(preferred.source)
        await enrichCandidate(preferred, adapter)
        preferredEnriched = true
      } catch (error) {
        notes.push(
          `AI 复核失败，已回退规则：${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }

  if (!preferred) {
    return {
      status: hadError ? 'failed' : 'not_found',
      note: mergeNotes([
        ...notes,
        '没有通过原版校验的候选（已排除翻唱/live/remix/伴奏等）',
      ]),
    }
  }

  // AI 兜底时可能选中规则未通过的候选；版本标记太多仍拒绝，避免写错。
  if (preferred.variantFlags > 2) {
    return {
      status: 'not_found',
      note: mergeNotes([...notes, '候选版本标记过多，未写入']),
      aiUsed,
    }
  }

  const preferredAdapter = getMetadataAdapter(preferred.source)
  if (!preferredEnriched) {
    await enrichCandidate(preferred, preferredAdapter)
  }

  // 用其余已检索到的可信候选补歌词/封面；仍然没有就用酷狗/LRCLIB 直接兜底。
  if (!hasLyrics(preferred)) {
    for (const candidate of sortCandidates(all)) {
      if (!candidate.acceptable || hasLyrics(preferred)) continue
      const adapter = getMetadataAdapter(candidate.source)
      await attachLyrics(preferred, candidate, adapter, notes, fetchedLyrics)
    }
  }
  if (!hasLyrics(preferred)) {
    const lyrics = await fetchKugouLyrics(
      query.title,
      query.artist,
      query.duration || undefined
    ).catch(() => '')
    if (lyrics) {
      preferred.lyrics = lyrics
      notes.push('歌词来自 酷狗音乐（兜底）')
    }
  }
  if (!hasCover(preferred)) {
    for (const candidate of sortCandidates(all)) {
      if (!candidate.acceptable || hasCover(preferred)) continue
      attachCover(preferred, candidate, notes)
    }
  }

  notes.push(`匹配来源：${preferred.sourceLabel}`)
  return {
    status: 'success',
    candidate: preferred,
    note: mergeNotes(notes),
    aiUsed,
    lyricsFromQq: hasLyrics(preferred) && preferred.source === 'qqmusic',
  }
}
