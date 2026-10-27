import { fetchText } from './http'
import { decodeHtml } from './normalize'
import { parseKuwoResponse } from './parse-kuwo'
import type { RawSearchSong } from './types'

export async function searchKw(query: string, limit = 30): Promise<RawSearchSong[]> {
  const url =
    'http://search.kuwo.cn/r.s?all=' +
    encodeURIComponent(query) +
    '&ft=music&itemset=web_2013&client=kt&pn=0&rn=' +
    limit +
    '&rformat=json&encoding=utf8&vipver=1'

  const text = await fetchText(url, {
    headers: { Referer: 'http://www.kuwo.cn/' },
  })
  const json = parseKuwoResponse(text) as any
  const list = json?.abslist
  if (!Array.isArray(list)) throw new Error('酷我搜索返回格式异常')

  return list.map((s: any): RawSearchSong => {
    const id = String(s.DC_TARGETID || String(s.MUSICRID || '').replace(/^MUSIC_/, '') || '')
    const title = decodeHtml(s.SONGNAME)
    const artist = decodeHtml(s.ARTIST)
    const album = decodeHtml(s.ALBUM)
    const albumId = s.ALBUMID ? String(s.ALBUMID) : undefined
    return {
      platform: 'kw',
      id,
      title,
      artist,
      album: album || undefined,
      duration: s.DURATION ? Number(s.DURATION) : undefined,
      coverUrl: albumId ? `https://img1.kuwo.cn/star/albumcover/${albumId}.jpg` : undefined,
      musicInfo: {
        source: 'kw',
        songmid: id,
        rid: id,
        musicrid: s.MUSICRID ? String(s.MUSICRID) : undefined,
        name: title,
        singer: artist,
        albumName: album || undefined,
        albumId,
        interval: s.DURATION ? Number(s.DURATION) : undefined,
      },
    }
  })
}
