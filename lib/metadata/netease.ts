import { fetchJson } from './http'
import { toSimplified } from './normalize'
import type { MetadataCandidate, MetadataQuery, MetadataSourceResult } from './types'

const SEARCH_URL = 'https://music.163.com/api/search/get/web'
const DETAIL_URL = 'https://music.163.com/api/song/detail'
const LYRIC_URL = 'https://music.163.com/api/song/lyric'
const HEADERS = {
  Referer: 'https://music.163.com/',
  'Content-Type': 'application/x-www-form-urlencoded',
}

interface NeteaseSong {
  id?: number
  name?: string
  duration?: number
  artists?: Array<{ name?: string }>
  album?: {
    id?: number
    name?: string
    picUrl?: string
    publishTime?: number
  }
}

interface NeteaseSearchResponse {
  result?: { songs?: NeteaseSong[] }
}

interface NeteaseDetailResponse {
  songs?: NeteaseSong[]
}

interface NeteaseLyricResponse {
  lrc?: { lyric?: string }
}

function timestampToDate(value?: number): string {
  if (!value || !Number.isFinite(value)) return ''
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1900) return ''
    return date.toISOString().slice(0, 10)
  } catch {
    return ''
  }
}

function buildCandidate(song: NeteaseSong): MetadataCandidate | null {
  const rawTitle = (song.name || '').replace(/\ufeff/g, '').trim()
  const artists = (song.artists || [])
    .map((artist) => (artist.name || '').trim())
    .filter(Boolean)
  if (!rawTitle || !artists.length) return null
  const album = song.album || {}
  const cover = (album.picUrl || '').trim()
  return {
    source: 'netease',
    sourceLabel: '网易云音乐',
    title: toSimplified(rawTitle),
    artist: toSimplified(artists.join(' / ')),
    artists: artists.map(toSimplified),
    album: toSimplified((album.name || '').replace(/\ufeff/g, '').trim()),
    date: timestampToDate(album.publishTime),
    genre: '',
    duration: song.duration ? Math.round(song.duration / 1000) : undefined,
    songId: song.id ? String(song.id) : undefined,
    albumId: album.id ? String(album.id) : undefined,
    coverUrl: cover || undefined,
    coverUrls: cover ? [cover] : [],
    rawTitle,
    score: 0,
    acceptable: false,
    variantFlags: 0,
    reasons: [],
  }
}

export async function searchNetease(
  query: MetadataQuery,
  limit = 10
): Promise<MetadataSourceResult> {
  const term = [query.title.trim(), query.artist.trim()].filter(Boolean).join(' ')
  if (!term) return { candidates: [] }
  try {
    const body = new URLSearchParams({
      s: term,
      type: '1',
      limit: String(Math.max(5, Math.min(20, limit))),
      offset: '0',
    }).toString()
    const data = await fetchJson<NeteaseSearchResponse>(SEARCH_URL, {
      method: 'POST',
      body,
      headers: HEADERS,
      timeoutMs: 15_000,
      retries: 1,
    })
    const seen = new Set<string>()
    const candidates: MetadataCandidate[] = []
    for (const song of data.result?.songs || []) {
      const candidate = buildCandidate(song)
      if (!candidate || !candidate.songId || seen.has(candidate.songId)) continue
      seen.add(candidate.songId)
      candidates.push(candidate)
    }
    return {
      candidates,
      note: candidates.length ? '网易云音乐命中' : '网易云音乐没有返回候选',
    }
  } catch (error) {
    return {
      candidates: [],
      note: `网易云音乐搜索失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export async function fetchNeteaseLyrics(songId: string): Promise<string> {
  if (!songId) return ''
  try {
    const data = await fetchJson<NeteaseLyricResponse>(
      `${LYRIC_URL}?id=${encodeURIComponent(songId)}&lv=-1&kv=-1&tv=-1`,
      { headers: { Referer: 'https://music.163.com/' }, timeoutMs: 15_000, retries: 0 }
    )
    return String(data.lrc?.lyric || '').trim()
  } catch {
    return ''
  }
}

export async function enrichNetease(candidate: MetadataCandidate): Promise<void> {
  if (!candidate.songId) return
  try {
    const ids = encodeURIComponent(`[${candidate.songId}]`)
    const data = await fetchJson<NeteaseDetailResponse>(`${DETAIL_URL}?ids=${ids}`, {
      headers: { Referer: 'https://music.163.com/' },
      timeoutMs: 15_000,
      retries: 0,
    })
    const song = data.songs?.[0]
    if (song) {
      const album = song.album || {}
      const cover = (album.picUrl || '').trim()
      if (cover) {
        candidate.coverUrl = cover
        candidate.coverUrls = [cover]
      }
      candidate.album = candidate.album || toSimplified((album.name || '').trim())
      candidate.date = candidate.date || timestampToDate(album.publishTime)
      if (song.duration) candidate.duration = Math.round(song.duration / 1000)
      const trackNo = (song as NeteaseSong & { no?: number }).no
      if (!candidate.track && trackNo) candidate.track = String(trackNo)
    }
  } catch {
    // 详情失败不影响搜索候选
  }
  if (!candidate.lyrics) {
    candidate.lyrics = await fetchNeteaseLyrics(candidate.songId)
  }
}
