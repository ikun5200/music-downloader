import type { AiConfig } from '../settings'
import { pickMetadataWithAi } from './ai'
import { searchItunes } from './itunes'
import { isLooseMatch, scoreCandidate } from './normalize'
import { fetchQqAlbum, fetchQqLyrics, qqCoverCandidates, searchQq } from './qqmusic'
import type {
  MetadataCandidate,
  MetadataQuery,
  MetadataScrapeResult,
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
  return notes.filter((note): note is string => !!note).join('；').slice(0, 500)
}

function sortCandidates(candidates: MetadataCandidate[]): MetadataCandidate[] {
  return [...candidates].sort((a, b) => b.score - a.score)
}

async function enrichQqCandidate(candidate: MetadataCandidate): Promise<void> {
  if (candidate.source !== 'qqmusic') return
  const detail = await fetchQqAlbum(candidate.albumId || '', candidate.songId || '')
  if (detail) {
    candidate.date = candidate.date || detail.date || ''
    candidate.genre = candidate.genre || detail.genre || ''
    candidate.albumArtist = candidate.albumArtist || detail.albumArtist
    candidate.publisher = candidate.publisher || detail.publisher
    candidate.language = candidate.language || detail.language
    candidate.track = candidate.track || detail.track
    candidate.trackTotal = candidate.trackTotal || detail.trackTotal
    candidate.disc = candidate.disc || detail.disc
  }
  if (!candidate.lyrics) {
    candidate.lyrics = await fetchQqLyrics(candidate.songId || '')
  }
  if (!candidate.coverUrls?.length && candidate.albumId) {
    candidate.coverUrls = qqCoverCandidates(candidate.albumId)
  }
  if (!candidate.coverUrl && candidate.coverUrls?.length) {
    candidate.coverUrl = candidate.coverUrls[0]
  }
}

/**
 * 下载后元数据刮削：
 * 1. 按后台顺序检索 iTunes / QQ 音乐；
 * 2. 规则打分过滤翻唱、live、remix、伴奏等版本；
 * 3. 可选 AI 复核（AI 失败自动回退规则）；
 * 4. 选中的候选若是 iTunes，仍从 QQ 补歌词/封面兜底。
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
    : (['itunes', 'qqmusic'] as MetadataSourceId[])
  const notes: string[] = []
  const candidates: MetadataCandidate[] = []
  let hadError = false
  let qqSearched = false

  for (const source of order) {
    if (source === 'itunes') {
      const result = await searchItunes(query, 10)
      candidates.push(...result.candidates)
      if (result.note) notes.push(result.note)
      if (result.candidates.length === 0 && result.note?.includes('失败')) hadError = true
    } else if (source === 'qqmusic') {
      qqSearched = true
      const result = await searchQq(query, 10)
      candidates.push(...result.candidates)
      if (result.note) notes.push(result.note)
      if (result.candidates.length === 0 && result.note?.includes('失败')) hadError = true
    }
  }

  if (!candidates.length) {
    return {
      status: hadError ? 'failed' : 'not_found',
      note: mergeNotes(notes) || '没有找到候选',
    }
  }

  const scored = sortCandidates(
    candidates.map((candidate) => scoreCandidate(candidate, query, order))
  )
  const viable = scored.filter((candidate) => candidate.acceptable)
  const aiConfig =
    options.aiConfig?.enabled && options.aiConfig.apiKey ? options.aiConfig : null
  // 只有全部可信候选都在同一条线上时，才让 AI 复核。
  const closeRace =
    viable.length > 1 && viable[0].score - viable[1].score < 20
  const needAi = viable.length === 0 || closeRace

  // 来源优先级：优先选最早来源里分数接近最高分的可信候选。
  // 例如 iTunes 和 QQ 都是原版时直接选 iTunes；若 iTunes 只有翻唱/合集等低分候选，
  // 分数差距超过 8 分就继续看后面的来源。
  let preferred: MetadataCandidate | null = null
  if (viable.length) {
    for (const source of order) {
      const sourceCandidates = viable.filter((candidate) => candidate.source === source)
      if (!sourceCandidates.length) continue
      if (sourceCandidates[0].score >= viable[0].score - 8) {
        preferred = sourceCandidates[0]
        break
      }
    }
  }

  let selected: MetadataCandidate | null = preferred
  let aiUsed = false
  let aiNote = preferred
    ? `规则匹配（优先 ${preferred.sourceLabel}）：${preferred.reasons.join('，')}`
    : ''

  if (!selected && aiConfig && needAi) {
    const pool = viable.length ? viable.slice(0, 8) : scored.filter(isLooseMatch).slice(0, 8)
    if (pool.length) {
      try {
        const pick = await pickMetadataWithAi(query, pool, order, aiConfig)
        if (pick.index === -1) {
          return {
            status: 'not_found',
            note: mergeNotes([...notes, `AI 判断没有原版：${pick.reason || '无匹配'}`]),
            aiUsed: true,
          }
        }
        selected = pool[pick.index]
        aiUsed = true
        aiNote = `AI 选择：${pick.reason || '匹配原版'}`
      } catch (error) {
        notes.push(`AI 复核失败，已回退规则：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  if (!selected) {
    selected = viable[0] || null
    if (selected) aiNote = `规则匹配：${selected.reasons.join('，')}`
  }

  if (!selected) {
    return {
      status: 'not_found',
      note: mergeNotes([...notes, '没有通过原版校验的候选（已排除翻唱/live/remix/伴奏等）']),
      aiUsed,
    }
  }

  // AI 兜底时可能选中规则未通过的候选；版本标记太多仍拒绝，避免写错。
  if (selected.variantFlags > 2) {
    return {
      status: 'not_found',
      note: mergeNotes([...notes, '候选版本标记过多，未写入']),
      aiUsed,
    }
  }

  if (selected.source === 'qqmusic') {
    await enrichQqCandidate(selected)
    notes.push(aiNote || 'QQ 音乐匹配')
  } else {
    notes.push(aiNote || 'iTunes 匹配')

    // iTunes 不提供歌词：用 QQ 的同曲候选补歌词/封面兜底。
    let qqCandidates = scored.filter((candidate) => candidate.source === 'qqmusic')
    if (!qqCandidates.length && !qqSearched) {
      const fallback = await searchQq(query, 10)
      if (fallback.candidates.length) {
        qqCandidates = fallback.candidates.map((candidate) =>
          scoreCandidate(candidate, query, order)
        )
        notes.push(fallback.note || 'QQ 音乐歌词兜底')
      }
    }
    const qqExtra = sortCandidates(
      qqCandidates.filter((candidate) => candidate.acceptable)
    )[0]
    if (qqExtra) {
      const lyric = await fetchQqLyrics(qqExtra.songId || '')
      if (lyric) {
        selected.lyrics = lyric
        notes.push('歌词来自 QQ 音乐')
      }
      if (!selected.coverUrls?.length && qqExtra.coverUrls?.length) {
        selected.coverUrls = qqExtra.coverUrls
      }
      if (!selected.coverUrl && qqExtra.coverUrl) selected.coverUrl = qqExtra.coverUrl
      if (!selected.date || !selected.genre) {
        await enrichQqCandidate(qqExtra)
        selected.date = selected.date || qqExtra.date
        selected.genre = selected.genre || qqExtra.genre
      }
    } else {
      notes.push('iTunes 无歌词，QQ 也未找到同曲歌词')
    }
  }

  return {
    status: 'success',
    candidate: selected,
    note: mergeNotes(notes),
    aiUsed,
    lyricsFromQq: selected.source === 'itunes' && !!selected.lyrics,
  }
}
