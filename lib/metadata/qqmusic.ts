import { fetchJson, fetchText } from './http'
import { toSimplified } from './normalize'
import type { MetadataCandidate, MetadataQuery } from './types'

const QQ_HOSTS = ['https://c.y.qq.com', 'https://c6.y.qq.com', 'https://i.y.qq.com']
const QQ_REFERER = 'https://y.qq.com/'

interface QqSinger {
  name?: string
}

interface QqSong {
  type?: number
  songname?: string
  name?: string
  singer?: QqSinger[]
  albumname?: string
  albummid?: string
  songmid?: string
  songid?: number
  interval?: number
  pubtime?: number
  sizeflac?: number
  size320?: number
}

interface QqSearchResponse {
  code?: number
  data?: {
    song?: {
      list?: QqSong[]
    }
  }
}

interface QqAlbumInfo {
  aDate?: string
  genre?: string
  singername?: string
  company?: string
  lan?: string
  list?: Array<{ songmid?: string; cdIdx?: number }>
}

interface QqAlbumResponse {
  code?: number
  data?: QqAlbumInfo
}

interface QqLyricResponse {
  lyric?: string
}

const QQ_VERSION_SUFFIX_RE =
  /\s*[-—–]\s*(?:铃声|伴奏|remix|mix|live|现场|演唱会|纯音乐|翻唱|cover|instrumental|acoustic|dj|慢摇|加快|变调|串烧|伴奏版|纯音乐版|独白版|mv版|片段|剪辑|女声版|男声版|童声|钢琴版|吉他版|demo|试听|抢听|预告)[版曲]?\s*$/i

function cleanSongName(value: string): string {
  const raw = (value || '').trim()
  if (!raw) return ''
  return raw.replace(QQ_VERSION_SUFFIX_RE, '').trim() || raw
}

function pubtimeToDate(value?: number): string {
  const ts = Number(value || 0)
  if (!Number.isFinite(ts) || ts <= 0) return ''
  try {
    const date = new Date(ts * 1000)
    if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1900) return ''
    return date.toISOString().slice(0, 10)
  } catch {
    return ''
  }
}

function qqCoverUrl(albumMid: string, size = 800): string {
  return `https://y.gtimg.cn/music/photo_new/T002R${size}x${size}M000${albumMid}.jpg`
}

function parseArtists(song: QqSong): string[] {
  const artists: string[] = []
  for (const singer of song.singer || []) {
    const name = (singer.name || '').trim()
    if (!name) continue
    for (const part of name.split(/\s*(?:\/|&|,|，|、|;|；)\s*/)) {
      const trimmed = part.trim()
      if (trimmed && !artists.includes(trimmed)) artists.push(trimmed)
    }
  }
  return artists
}

function buildCandidate(song: QqSong): MetadataCandidate | null {
  if (song.type !== undefined && song.type !== 0) return null
  const rawTitle = (song.songname || song.name || '').trim()
  const artists = parseArtists(song)
  const albumId = (song.albummid || '').trim()
  if (!rawTitle || !artists.length) return null
  return {
    source: 'qqmusic',
    sourceLabel: 'QQ 音乐',
    title: toSimplified(cleanSongName(rawTitle)),
    artist: toSimplified(artists.join(' / ')),
    artists: artists.map(toSimplified),
    album: toSimplified((song.albumname || '').trim()),
    date: pubtimeToDate(song.pubtime),
    genre: '',
    duration: song.interval ? Number(song.interval) : undefined,
    songId: String(song.songmid || song.songid || ''),
    albumId,
    coverUrl: albumId ? qqCoverUrl(albumId) : undefined,
    coverUrls: albumId ? qqCoverCandidates(albumId) : [],
    rawTitle,
    score: 0,
    acceptable: false,
    variantFlags: 0,
    reasons: [],
  }
}

async function qqSearchRaw(query: string, limit: number): Promise<QqSearchResponse> {
  const params = new URLSearchParams({
    ct: '24',
    qqmusic_uin: '0',
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: '0',
    platform: 'yqq.json',
    needNewCode: '0',
    p: '1',
    n: String(Math.max(10, Math.min(30, limit))),
    w: query,
  })
  const path = `/soso/fcgi-bin/client_search_cp?${params.toString()}`
  let lastError: unknown
  for (const host of QQ_HOSTS) {
    try {
      const data = await fetchJson<QqSearchResponse>(host + path, {
        headers: { Referer: QQ_REFERER },
        timeoutMs: 15_000,
        retries: 0,
      })
      if (data.code === 0) return data
      lastError = new Error(`QQ 音乐返回 code=${data.code}`)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export interface QqSearchResult {
  candidates: MetadataCandidate[]
  note?: string
}

export async function searchQq(query: MetadataQuery, limit = 10): Promise<QqSearchResult> {
  const term = [query.title.trim(), query.artist.trim()].filter(Boolean).join(' ').trim()
  if (!term) return { candidates: [] }
  try {
    const data = await qqSearchRaw(term, limit)
    const items = data.data?.song?.list || []
    const seen = new Set<string>()
    const candidates: MetadataCandidate[] = []
    for (const item of items) {
      const candidate = buildCandidate(item)
      if (!candidate || !candidate.songId || seen.has(candidate.songId)) continue
      seen.add(candidate.songId)
      candidates.push(candidate)
    }
    return {
      candidates,
      note: candidates.length ? 'QQ 音乐命中' : 'QQ 音乐没有返回候选',
    }
  } catch (error) {
    return {
      candidates: [],
      note: `QQ 音乐搜索失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export interface QqAlbumDetail {
  date?: string
  genre?: string
  albumArtist?: string
  publisher?: string
  language?: string
  track?: string
  trackTotal?: string
  disc?: string
}

export async function fetchQqAlbum(
  albumId: string,
  songId: string
): Promise<QqAlbumDetail | null> {
  if (!albumId) return null
  const params = new URLSearchParams({ albummid: albumId, format: 'json' })
  const path = `/v8/fcg-bin/fcg_v8_album_info_cp.fcg?${params.toString()}`
  for (const host of QQ_HOSTS) {
    try {
      const data = await fetchJson<QqAlbumResponse>(host + path, {
        headers: { Referer: QQ_REFERER },
        timeoutMs: 15_000,
        retries: 0,
      })
      if (data.code !== 0 || !data.data) continue
      const info = data.data
      const detail: QqAlbumDetail = {
        date: info.aDate || undefined,
        genre: toSimplified(info.genre || '') || undefined,
        albumArtist: toSimplified(info.singername || '') || undefined,
        publisher: (info.company || '').trim() || undefined,
        language: (info.lan || '').trim() || undefined,
      }
      const list = info.list || []
      if (list.length) {
        detail.trackTotal = String(list.length)
        const index = list.findIndex((item) => String(item.songmid || '') === songId)
        if (index >= 0) {
          detail.track = String(index + 1)
          const disc = list[index].cdIdx
          if (typeof disc === 'number' && disc >= 0) detail.disc = String(disc + 1)
        }
      }
      return detail
    } catch {
      // 换下一个域名
    }
  }
  return null
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
}

/**
 * QQ 歌词：主接口返回纯 JSON；失败时回退旧 JSONP 接口。
 * 无歌词返回空串，不抛异常，避免影响封面/歌曲信息写入。
 */
export async function fetchQqLyrics(songId: string): Promise<string> {
  if (!songId) return ''
  const params = new URLSearchParams({
    songmid: songId,
    format: 'json',
    nobase64: '1',
  })
  try {
    const data = await fetchJson<QqLyricResponse>(
      `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${params.toString()}`,
      { headers: { Referer: QQ_REFERER }, timeoutMs: 15_000, retries: 0 }
    )
    const lyric = (data.lyric || '').trim()
    if (lyric) return decodeHtmlEntities(lyric)
  } catch {
    // 尝试旧接口
  }

  try {
    const raw = await fetchText(
      `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric.fcg?${params.toString()}`,
      { headers: { Referer: QQ_REFERER }, timeoutMs: 15_000, retries: 0 }
    )
    const start = raw.indexOf('(')
    const end = raw.lastIndexOf(')')
    if (start >= 0 && end > start) {
      const data = JSON.parse(raw.slice(start + 1, end)) as QqLyricResponse
      const lyric = (data.lyric || '').trim()
      if (lyric) return decodeHtmlEntities(lyric)
    }
  } catch {
    // 无歌词
  }
  return ''
}

export function qqCoverCandidates(albumId: string): string[] {
  if (!albumId) return []
  return [800, 500, 300].map((size) => qqCoverUrl(albumId, size))
}
