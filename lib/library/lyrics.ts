import type { AiConfig, AppSettings } from '../settings'
import { getMetadataAdapter } from '../metadata/sources'
import { isSyncedLyrics, scoreCandidate, toSimplified } from '../metadata/normalize'
import { cleanLyricsWithAi } from '../metadata/lyrics-ai'
import { writeLyricsOnly } from '../metadata/tag'
import { detectCandidateVersionTags } from '../version-intent'
import type { MetadataCandidate, MetadataSourceId } from '../metadata/types'
import { inspectLibraryFile, relativeLibraryPath } from './scan'
import type { LibraryFile, LyricsWorkflowItem, WorkflowStatus } from './types'

const MOJIBAKE_RE = /(?:\uFFFD|Ã.|Â.|â€|ã€|锟斤拷)/
const TIMESTAMP_RE = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g

function unprotect(value: string): string {
  return String(value || '')
    .replace(/＆/g, '&')
    .replace(/／/g, '/')
    .replace(/＼/g, '\\')
    .replace(/｜/g, '|')
    .replace(/﹔/g, ';')
    .replace(/・/g, '、')
}

function meaningfulLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !!line && !/^\[(?:ti|ar|al|by|offset|re|ve|length|kuwo|kugou|qq|music):[^\]]*\]$/i.test(line))
}

function lastTimestamp(text: string): number | null {
  let last: number | null = null
  for (const match of text.matchAll(TIMESTAMP_RE)) {
    const seconds =
      Number(match[1]) * 60 +
      Number(match[2]) +
      (match[3] ? Number(`0.${match[3]}`) : 0)
    if (last == null || seconds > last) last = seconds
  }
  return last
}

export function lyricsLookUsable(
  raw: string,
  duration?: number | null
): { ok: boolean; note: string; synced: boolean } {
  const text = String(raw || '').trim()
  if (!text) return { ok: false, note: '歌词为空', synced: false }
  if (MOJIBAKE_RE.test(text)) return { ok: false, note: '歌词疑似乱码', synced: false }
  const lines = meaningfulLines(text)
  if (lines.length < 2) return { ok: false, note: '有效歌词行数不足', synced: false }
  const synced = isSyncedLyrics(text)
  if (synced) {
    const timestamps = [...text.matchAll(TIMESTAMP_RE)].length
    if (timestamps < 3) return { ok: false, note: '时间轴行数不足', synced }
    const last = lastTimestamp(text)
    if (duration && last != null && last > duration + 180) {
      return { ok: false, note: '歌词时间轴与歌曲时长差距过大', synced }
    }
  } else if (text.replace(/\s/g, '').length < 30) {
    return { ok: false, note: '歌词内容过短', synced }
  }
  return { ok: true, note: synced ? '带时间轴' : '纯文本', synced }
}

function candidateMatches(candidate: MetadataCandidate): boolean {
  return (
    candidate.acceptable &&
    (candidate.titleScore || 0) >= 0.75 &&
    (candidate.artistScore || 0) >= 0.5
  )
}

export interface FetchedLyrics {
  lyrics: string
  source: string
  synced: boolean
  note: string
}

/**
 * 多源歌词抓取：按后台元数据源顺序，只接受歌名/歌手匹配的候选；
 * 先拿带时间轴的版本，找不到时才接受纯文本。
 */
export async function fetchBestLyrics(
  file: Pick<LibraryFile, 'title' | 'artist' | 'album' | 'duration'>,
  settings: AppSettings
): Promise<FetchedLyrics | null> {
  const title = unprotect(file.title).trim()
  const artist = unprotect(file.artist).trim()
  if (!title) return null
  const all = settings.metadataSourceOrder?.length
    ? settings.metadataSourceOrder
    : (['lrclib', 'netease', 'qqmusic', 'kugou'] as MetadataSourceId[])
  const order = all.filter((source) => getMetadataAdapter(source).supportsLyrics)
  if (!order.length) order.push('lrclib', 'netease', 'qqmusic', 'kugou')

  const query = {
    title,
    artist,
    album: file.album || '',
    duration: file.duration,
    versionTags: detectCandidateVersionTags(file.title, file.album),
    languageTags: [],
  }
  let plainFallback: FetchedLyrics | null = null

  for (const source of order) {
    const adapter = getMetadataAdapter(source)
    let candidates: MetadataCandidate[] = []
    try {
      const result = await adapter.search(query, 6)
      candidates = result.candidates
        .map((candidate) => scoreCandidate(candidate, query, order))
        .filter(candidateMatches)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
    } catch {
      continue
    }

    for (const candidate of candidates) {
      let lyrics = String(candidate.lyrics || '').trim()
      if (!lyrics && adapter.lyrics) {
        lyrics = String(await adapter.lyrics(candidate).catch(() => '')).trim()
      }
      if (!lyrics && adapter.enrich) {
        await adapter.enrich(candidate).catch(() => {})
        lyrics = String(candidate.lyrics || '').trim()
      }
      if (!lyrics) continue
      const usable = lyricsLookUsable(lyrics, file.duration)
      if (!usable.ok) continue
      const fetched: FetchedLyrics = {
        lyrics,
        source: adapter.label,
        synced: usable.synced,
        note: usable.note,
      }
      if (usable.synced) return fetched
      plainFallback = plainFallback || fetched
    }
  }
  return plainFallback
}

export interface ApplyLyricsResult {
  status: WorkflowStatus
  source?: string
  note: string
  preview?: string
}

export async function applyLyricsToFile(
  root: string,
  file: LibraryFile,
  settings: AppSettings,
  aiConfig: AiConfig | null
): Promise<ApplyLyricsResult> {
  if (!file.title || !file.artist) {
    return { status: 'skipped', note: '缺少歌名或歌手，无法搜索歌词' }
  }
  const fetched = await fetchBestLyrics(file, settings).catch(() => null)
  if (!fetched) return { status: 'not_found', note: '所有歌词源都没有找到可信匹配' }

  const cleaned = await cleanLyricsWithAi(fetched.lyrics, {
    title: file.title,
    artist: file.artist,
    cleanCredits: settings.lyricsCleanCredits,
    simplify: settings.lyricsSimplify,
    aiConfig,
    aiEnabled: settings.lyricsAiCleanEnabled,
  })
  const usable = lyricsLookUsable(cleaned.text, file.duration)
  if (!usable.ok) return { status: 'failed', source: fetched.source, note: usable.note }

  const write = await writeLyricsOnly(file.absolute, cleaned.text)
  if (!write.ok) {
    return { status: 'failed', source: fetched.source, note: write.note || '写入歌词失败' }
  }

  const verified = await inspectLibraryFile(root, file.absolute, false)
  if (!verified.hasLyrics) {
    return { status: 'failed', source: fetched.source, note: '写入后校验不到歌词标签' }
  }

  const preview = meaningfulLines(cleaned.text)
    .slice(0, 2)
    .join(' / ')
    .slice(0, 160)
  return {
    status: 'fixed',
    source: fetched.source,
    note: [fetched.note, cleaned.aiUsed ? 'AI 清理前缀' : '', `写入 ${write.wrote.join('、')}`]
      .filter(Boolean)
      .join('；'),
    preview,
  }
}

export function lyricsIssueCodes(file: LibraryFile): string[] {
  const codes: string[] = []
  if (!file.hasLyrics) codes.push('missing_lyrics')
  if (file.hasLyrics && MOJIBAKE_RE.test(file.lyrics)) codes.push('lyrics_mojibake')
  if (file.hasLyrics && !file.syncedLyrics) codes.push('lyrics_unsynced')
  if (file.hasLyrics && toSimplified(file.lyrics) !== file.lyrics) {
    codes.push('lyrics_traditional')
  }
  if (file.hasLyrics && meaningfulLines(file.lyrics).length < 2) {
    codes.push('lyrics_too_short')
  }
  return codes
}

export function toLyricsItem(
  file: LibraryFile,
  result: ApplyLyricsResult
): LyricsWorkflowItem {
  return {
    path: file.path,
    title: file.title,
    artist: file.artist,
    album: file.album,
    status: result.status,
    source: result.source,
    note: result.note,
    preview: result.preview,
  }
}

export function rootRelative(root: string, absolute: string): string {
  return relativeLibraryPath(root, absolute)
}
