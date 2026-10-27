import { fetchJson } from './http'
import { toSimplified } from './normalize'
import type { MetadataCandidate, MetadataQuery, MetadataSourceResult } from './types'

const API = 'https://lrclib.net/api'
const UA =
  'MusicMetaScraper/1.0 (local NAS music tag tool; contact: local@nas.local) +https://lrclib.net'

let lastRequestAt = 0

async function throttle(): Promise<void> {
  const wait = Math.max(0, 1000 - (Date.now() - lastRequestAt))
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
  lastRequestAt = Date.now()
}

interface LrclibItem {
  id?: number
  trackName?: string
  artistName?: string
  albumName?: string
  duration?: number
  syncedLyrics?: string
  plainLyrics?: string
}

function buildCandidate(item: LrclibItem): MetadataCandidate | null {
  const rawTitle = (item.trackName || '').trim()
  const artist = (item.artistName || '').trim()
  if (!rawTitle) return null
  const lyrics = (item.syncedLyrics || '').trim() || (item.plainLyrics || '').trim()
  return {
    source: 'lrclib',
    sourceLabel: 'LRCLIB',
    title: toSimplified(rawTitle),
    artist: toSimplified(artist),
    artists: artist.split(/[,，、/&]/).map((part) => toSimplified(part.trim())).filter(Boolean),
    album: toSimplified((item.albumName || '').trim()),
    date: '',
    genre: '',
    duration: item.duration ? Math.round(item.duration) : undefined,
    songId: item.id ? String(item.id) : undefined,
    lyrics: lyrics || undefined,
    score: 0,
    acceptable: false,
    variantFlags: 0,
    reasons: [],
  }
}

async function request(path: string, params: Record<string, string>): Promise<unknown> {
  await throttle()
  const query = new URLSearchParams(params).toString()
  return fetchJson(`${API}${path}?${query}`, {
    headers: { 'User-Agent': UA },
    timeoutMs: 15_000,
    retries: 1,
  })
}

export async function searchLrclib(
  query: MetadataQuery,
  limit = 10
): Promise<MetadataSourceResult> {
  const title = query.title.trim()
  if (!title) return { candidates: [] }
  const params: Record<string, string> = {
    track_name: title,
    // 每条结果都带完整歌词，请求 10 条会返回很大的 JSON；5 条足够选最佳匹配。
    limit: String(Math.max(3, Math.min(5, limit))),
  }
  if (query.artist.trim()) params.artist_name = query.artist.trim()

  try {
    const data = (await request('/search', params)) as LrclibItem[]
    const seen = new Set<string>()
    const candidates: MetadataCandidate[] = []
    for (const item of Array.isArray(data) ? data : []) {
      const candidate = buildCandidate(item)
      if (!candidate) continue
      const key = candidate.songId || `${candidate.title}|${candidate.artist}`
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push(candidate)
    }
    if (!candidates.length && query.artist.trim()) {
      const exact = (await request('/get', {
        track_name: title,
        artist_name: query.artist.trim(),
      }).catch(() => null)) as LrclibItem | null
      if (exact) {
        const candidate = buildCandidate(exact)
        if (candidate) candidates.push(candidate)
      }
    }
    return {
      candidates,
      note: candidates.length ? 'LRCLIB 命中歌词' : 'LRCLIB 没有返回候选',
    }
  } catch (error) {
    return {
      candidates: [],
      note: `LRCLIB 搜索失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export async function enrichLrclib(candidate: MetadataCandidate): Promise<void> {
  if (candidate.lyrics || !candidate.title) return
  try {
    const exact = (await request('/get', {
      track_name: candidate.rawTitle || candidate.title,
      ...(candidate.artist ? { artist_name: candidate.artist.split(' / ')[0] } : {}),
    })) as LrclibItem
    const lyrics = (exact?.syncedLyrics || '').trim() || (exact?.plainLyrics || '').trim()
    if (lyrics) candidate.lyrics = lyrics
  } catch {
    // 无歌词
  }
}
