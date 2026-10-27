import { fetchJson } from './http'
import { cleanPromoSuffix, matchArtist, matchTitle, toSimplified } from './normalize'
import type { MetadataCandidate, MetadataQuery, MetadataSourceResult } from './types'

const SEARCH_URL = 'https://songsearch.kugou.com/song_search_v2'
const LYRIC_SEARCH_URL = 'https://lyrics.kugou.com/search'
const LYRIC_DOWN_URL = 'https://lyrics.kugou.com/download'

const FAKE_SINGERS = ['歌单', '热门', 'DJ', '网友', '翻唱', '伴奏', '抖音', '快手', '群星']

interface KugouSong {
  SongName?: string
  SingerName?: string
  AlbumName?: string
  AlbumID?: number | string
  Duration?: number
  FileHash?: string
}

interface KugouSearchResponse {
  data?: { lists?: KugouSong[] }
}

interface KugouLyricCandidate {
  id?: string
  accesskey?: string
  song?: string
  singer?: string
  duration?: number
  score?: number
  product_from?: string
}

interface KugouLyricSearchResponse {
  candidates?: KugouLyricCandidate[]
}

interface KugouLyricDownloadResponse {
  content?: string
}

function isFakeSinger(value: string): boolean {
  const lower = value.toLowerCase()
  return FAKE_SINGERS.some((fake) => lower.includes(fake.toLowerCase()))
}

function buildCandidate(song: KugouSong): MetadataCandidate | null {
  const rawTitle = (song.SongName || '').trim()
  const artist = (song.SingerName || '').trim()
  const hash = (song.FileHash || '').trim()
  if (!rawTitle || !artist || !hash || isFakeSinger(artist)) return null
  const cover = `https://imgessl.kugou.com/stdmusic/400/${hash}.jpg`
  return {
    source: 'kugou',
    sourceLabel: '酷狗音乐',
    title: cleanPromoSuffix(toSimplified(rawTitle)),
    artist: toSimplified(artist),
    artists: artist.split(/[、/&,，;；]/).map((part) => toSimplified(part.trim())).filter(Boolean),
    album: toSimplified((song.AlbumName || '').trim()),
    date: '',
    genre: '',
    duration: song.Duration ? Number(song.Duration) : undefined,
    songId: hash,
    albumId: song.AlbumID ? String(song.AlbumID) : undefined,
    coverUrl: cover,
    coverUrls: [cover],
    rawTitle,
    score: 0,
    acceptable: false,
    variantFlags: 0,
    reasons: [],
  }
}

export async function searchKugou(
  query: MetadataQuery,
  limit = 10
): Promise<MetadataSourceResult> {
  const term = [query.title.trim(), query.artist.trim()].filter(Boolean).join(' ')
  if (!term) return { candidates: [] }
  try {
    const params = new URLSearchParams({
      keyword: term,
      page: '1',
      pagesize: String(Math.max(5, Math.min(20, limit))),
    })
    const data = await fetchJson<KugouSearchResponse>(`${SEARCH_URL}?${params.toString()}`, {
      timeoutMs: 15_000,
      retries: 1,
    })
    const seen = new Set<string>()
    const candidates: MetadataCandidate[] = []
    for (const song of data.data?.lists || []) {
      const candidate = buildCandidate(song)
      if (!candidate || !candidate.songId || seen.has(candidate.songId)) continue
      seen.add(candidate.songId)
      candidates.push(candidate)
    }
    return {
      candidates,
      note: candidates.length ? '酷狗音乐命中' : '酷狗音乐没有返回候选',
    }
  } catch (error) {
    return {
      candidates: [],
      note: `酷狗音乐搜索失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function pickLyricCandidate(
  candidates: KugouLyricCandidate[],
  title: string,
  artist: string,
  duration?: number
): KugouLyricCandidate | null {
  let best: { candidate: KugouLyricCandidate; score: number } | null = null
  for (const candidate of candidates) {
    if (!candidate.id || !candidate.accesskey) continue
    const song = candidate.song || ''
    const singer = candidate.singer || ''
    const titleScore = matchTitle(title, song)
    const artistScore = matchArtist(artist, singer)
    if (titleScore < 0.7 || artistScore < 0.5) continue
    let score = titleScore * 50 + artistScore * 30 + (candidate.score || 0) / 10
    if ((candidate.product_from || '').includes('官方')) score += 10
    if (duration && candidate.duration) {
      const diff = Math.abs(duration * 1000 - candidate.duration) / 1000
      if (diff <= 5) score += 15
      else if (diff <= 15) score += 5
      else if (diff > 45) score -= 15
    }
    if (!best || score > best.score) best = { candidate, score }
  }
  return best?.candidate || null
}

export async function fetchKugouLyrics(
  title: string,
  artist: string,
  duration?: number
): Promise<string> {
  if (!title) return ''
  const keywords = [artist ? `${title} ${artist}` : title, title]
  for (const keyword of [...new Set(keywords)]) {
    try {
      const params = new URLSearchParams({
        ver: '1',
        man: 'yes',
        client: 'pc',
        keyword,
      })
      const data = await fetchJson<KugouLyricSearchResponse>(
        `${LYRIC_SEARCH_URL}?${params.toString()}`,
        { timeoutMs: 15_000, retries: 0 }
      )
      const picked = pickLyricCandidate(data.candidates || [], title, artist, duration)
      if (!picked) continue
      const downloadParams = new URLSearchParams({
        ver: '1',
        client: 'pc',
        id: picked.id || '',
        accesskey: picked.accesskey || '',
        fmt: 'lrc',
      })
      const downloaded = await fetchJson<KugouLyricDownloadResponse>(
        `${LYRIC_DOWN_URL}?${downloadParams.toString()}`,
        { timeoutMs: 15_000, retries: 0 }
      )
      const content = (downloaded.content || '').trim()
      if (!content) continue
      const decoded = Buffer.from(content, 'base64').toString('utf8').trim()
      if (decoded.includes('[') || decoded.includes(']')) return decoded
      if (content.includes('[')) return content
    } catch {
      // 尝试下一个关键词
    }
  }
  return ''
}

export async function enrichKugou(candidate: MetadataCandidate): Promise<void> {
  if (candidate.lyrics) return
  candidate.lyrics = await fetchKugouLyrics(
    candidate.rawTitle || candidate.title,
    candidate.artist,
    candidate.duration
  )
}
