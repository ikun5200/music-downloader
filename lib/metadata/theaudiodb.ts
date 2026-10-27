import { fetchJson } from './http'
import { toSimplified } from './normalize'
import type { MetadataCandidate, MetadataQuery, MetadataSourceResult } from './types'

const API = 'https://www.theaudiodb.com/api/v1/json/2'
let lastRequestAt = 0

interface AudioDbTrack {
  idTrack?: string
  strTrack?: string
  strArtist?: string
  strAlbum?: string
  intYearReleased?: string
  strGenre?: string
  strLabel?: string
  strTrackThumb?: string
  strAlbumThumb?: string
  strDescriptionEN?: string
}

interface AudioDbResponse {
  track?: AudioDbTrack[]
}

async function throttle(): Promise<void> {
  const wait = Math.max(0, 1000 - (Date.now() - lastRequestAt))
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
  lastRequestAt = Date.now()
}

function buildCandidate(item: AudioDbTrack): MetadataCandidate | null {
  const rawTitle = (item.strTrack || '').trim()
  const artist = (item.strArtist || '').trim()
  if (!rawTitle) return null
  const cover = (item.strTrackThumb || item.strAlbumThumb || '').trim()
  return {
    source: 'theaudiodb',
    sourceLabel: 'TheAudioDB',
    title: toSimplified(rawTitle),
    artist: toSimplified(artist),
    artists: artist ? [toSimplified(artist)] : [],
    album: toSimplified((item.strAlbum || '').trim()),
    date: String(item.intYearReleased || '').trim(),
    genre: toSimplified((item.strGenre || '').trim()),
    publisher: (item.strLabel || '').trim() || undefined,
    songId: item.idTrack ? String(item.idTrack) : undefined,
    coverUrl: cover || undefined,
    coverUrls: cover ? [cover] : [],
    rawTitle,
    score: 0,
    acceptable: false,
    variantFlags: 0,
    reasons: [],
  }
}

export async function searchTheAudioDb(
  query: MetadataQuery,
  limit = 10
): Promise<MetadataSourceResult> {
  const title = query.title.trim()
  if (!title) return { candidates: [] }
  try {
    const params = new URLSearchParams({
      s: query.artist.trim() || title,
      t: title,
    })
    const data = await (async () => {
      await throttle()
      return fetchJson<AudioDbResponse>(`${API}/searchtrack.php?${params.toString()}`, {
        timeoutMs: 15_000,
        retries: 0,
      })
    })()
    const seen = new Set<string>()
    const candidates: MetadataCandidate[] = []
    for (const item of data.track || []) {
      const candidate = buildCandidate(item)
      if (!candidate) continue
      const key = candidate.songId || `${candidate.title}|${candidate.artist}`
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push(candidate)
      if (candidates.length >= limit) break
    }
    return {
      candidates,
      note: candidates.length ? 'TheAudioDB 命中' : 'TheAudioDB 没有返回候选',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      candidates: [],
      note: message.includes('HTTP 404')
        ? 'TheAudioDB 未收录'
        : `TheAudioDB 搜索失败：${message}`,
    }
  }
}

export async function enrichTheAudioDb(candidate: MetadataCandidate): Promise<void> {
  if (!candidate.songId) return
  try {
    await throttle()
    const params = new URLSearchParams({ i: candidate.songId })
    const data = await fetchJson<AudioDbResponse>(`${API}/track.php?${params.toString()}`, {
      timeoutMs: 15_000,
      retries: 0,
    })
    const item = data.track?.[0]
    if (!item) return
    candidate.genre = candidate.genre || toSimplified(item.strGenre || '')
    candidate.publisher = candidate.publisher || item.strLabel || undefined
    candidate.date = candidate.date || String(item.intYearReleased || '')
    if (!candidate.coverUrl) {
      const cover = (item.strTrackThumb || item.strAlbumThumb || '').trim()
      if (cover) {
        candidate.coverUrl = cover
        candidate.coverUrls = [cover]
      }
    }
  } catch {
    // 详情失败不影响搜索候选
  }
}
