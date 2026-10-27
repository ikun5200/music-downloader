import { fetchJson } from './http'
import type { RawSearchSong } from './types'

const SEARCH_SWITCH = encodeURIComponent(
  JSON.stringify({ song: 1, album: 0, singer: 0, playlist: 0, mv: 0, lyric: 0 })
)

async function fetchPage(query: string, pageNo: number): Promise<any[]> {
  const url =
    'https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do?text=' +
    encodeURIComponent(query) +
    '&pageNo=' +
    pageNo +
    '&pageSize=20&searchSwitch=' +
    SEARCH_SWITCH

  const json = await fetchJson<any>(url, {
    headers: { Referer: 'https://music.migu.cn/' },
  })
  const list = json?.songResultData?.result
  return Array.isArray(list) ? list : []
}

export async function searchMg(query: string, limit = 30): Promise<RawSearchSong[]> {
  const pages = limit > 20 ? 2 : 1
  const all: any[] = []
  for (let p = 1; p <= pages; p++) {
    const list = await fetchPage(query, p)
    all.push(...list)
    if (list.length < 20) break
  }

  return all.map((s: any): RawSearchSong => {
    const singers = Array.isArray(s.singers) ? s.singers : []
    const singer = singers.map((a: any) => a?.name).filter(Boolean).join('/')
    const album = Array.isArray(s.albums) ? s.albums[0] : undefined
    const imgs = Array.isArray(s.imgItems) ? s.imgItems : []
    const cover =
      imgs.find((i: any) => i?.imgSizeType === '03') ||
      imgs.find((i: any) => i?.imgSizeType === '02') ||
      imgs[0]
    const songId = String(s.id || s.contentId || s.copyrightId || '')

    return {
      platform: 'mg',
      id: songId,
      title: String(s.name || ''),
      artist: singer,
      album: album?.name ? String(album.name) : undefined,
      coverUrl: cover?.img ? String(cover.img) : undefined,
      musicInfo: {
        source: 'mg',
        songmid: songId,
        songId: s.id != null ? String(s.id) : undefined,
        copyrightId: s.copyrightId ? String(s.copyrightId) : undefined,
        contentId: s.contentId ? String(s.contentId) : undefined,
        name: String(s.name || ''),
        singer,
        albumName: album?.name ? String(album.name) : undefined,
        albumId: album?.id ? String(album.id) : undefined,
      },
    }
  })
}
