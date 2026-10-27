import JSON5 from 'json5'
import { fetchText } from './http'
import { cleanPromoSuffix, toSimplified } from './normalize'
import type { MetadataCandidate, MetadataQuery, MetadataSourceResult } from './types'

const SEARCH_URL = 'http://search.kuwo.cn/r.s'
const COVER_BASE = 'https://img2.kuwo.cn/star/albumcover/'

interface KuwoSong {
  SONGNAME?: string
  ARTIST?: string
  ALBUM?: string
  ALBUMID?: string | number
  DURATION?: string | number
  MUSICRID?: string
  web_albumpic_short?: string
}

interface KuwoResponse {
  abslist?: KuwoSong[]
}

function cleanText(value: string | undefined): string {
  return toSimplified(
    String(value || '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\\u([0-9a-f]{4})/gi, (_, code: string) =>
        String.fromCharCode(parseInt(code, 16))
      )
      .trim()
  )
}

export async function searchKuwo(
  query: MetadataQuery,
  limit = 10
): Promise<MetadataSourceResult> {
  const term = [query.title.trim(), query.artist.trim()].filter(Boolean).join(' ')
  if (!term) return { candidates: [] }
  try {
    const params = new URLSearchParams({
      client: 'kt',
      all: term,
      pn: '0',
      rn: String(Math.max(5, Math.min(20, limit))),
      uid: '0',
      ver: 'kwplayer_ar_9.2.2.1',
      vipver: '1',
      show_copyright_off: '1',
      new_format: '1',
      ft: 'music',
      encoding: 'utf8',
      rformat: 'json',
    })
    const raw = await fetchText(`${SEARCH_URL}?${params.toString()}`, {
      timeoutMs: 15_000,
      retries: 1,
    })
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) {
      return { candidates: [], note: '酷我音乐返回格式异常' }
    }
    const data = JSON5.parse(raw.slice(start, end + 1)) as KuwoResponse
    const seen = new Set<string>()
    const candidates: MetadataCandidate[] = []
    for (const song of data.abslist || []) {
      const rawTitle = cleanText(song.SONGNAME)
      const artist = cleanText(song.ARTIST)
      const songId = String(song.MUSICRID || '').trim()
      if (!rawTitle || !artist || !songId || seen.has(songId)) continue
      seen.add(songId)
      const pic = String(song.web_albumpic_short || '').trim()
      const cover = pic ? `${COVER_BASE}${pic}` : undefined
      candidates.push({
        source: 'kuwo',
        sourceLabel: '酷我音乐',
        title: cleanPromoSuffix(rawTitle),
        artist,
        artists: artist.split(/[、/&,，;；]/).map((part) => part.trim()).filter(Boolean),
        album: cleanText(song.ALBUM),
        date: '',
        genre: '',
        duration: song.DURATION ? Number(song.DURATION) : undefined,
        songId,
        albumId: song.ALBUMID ? String(song.ALBUMID) : undefined,
        coverUrl: cover,
        coverUrls: cover ? [cover] : [],
        rawTitle,
        score: 0,
        acceptable: false,
        variantFlags: 0,
        reasons: [],
      })
    }
    return {
      candidates,
      note: candidates.length ? '酷我音乐命中' : '酷我音乐没有返回候选',
    }
  } catch (error) {
    return {
      candidates: [],
      note: `酷我音乐搜索失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
