import { fetchJson } from './http'
import type { RawSearchSong } from './types'

export async function searchKg(query: string, limit = 30): Promise<RawSearchSong[]> {
  const url =
    'http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=' +
    encodeURIComponent(query) +
    '&page=1&pagesize=' +
    limit

  const json = await fetchJson<any>(url, {
    headers: { Referer: 'http://m.kugou.com/' },
  })
  const list = json?.data?.info
  if (!Array.isArray(list)) throw new Error('酷狗搜索返回格式异常')

  return list.map((s: any): RawSearchSong => {
    const parts = String(s.filename || '').split(' - ')
    const title = String(s.songname || (parts.length > 1 ? parts.slice(1).join(' - ') : s.filename || ''))
    const artist = String(s.singername || parts[0] || '')
    const hash = s.hash ? String(s.hash) : ''
    const audioid = s.audioid ? String(s.audioid) : undefined
    const albumId = s.album_id != null ? String(s.album_id) : undefined

    const types: Record<string, { hash: string; size: number }> = {}
    if (s.hash && s.filesize) types['128k'] = { hash: String(s.hash), size: Number(s.filesize) }
    if (s['320hash'] && s['320filesize']) {
      types['320k'] = { hash: String(s['320hash']), size: Number(s['320filesize']) }
    }
    if (s.sqhash && s.sqfilesize) {
      types.flac = { hash: String(s.sqhash), size: Number(s.sqfilesize) }
      types.flac24bit = { hash: String(s.sqhash), size: Number(s.sqfilesize) }
    }

    return {
      platform: 'kg',
      id: hash || audioid || '',
      title,
      artist,
      album: s.album_name ? String(s.album_name) : undefined,
      duration: s.duration ? Number(s.duration) : undefined,
      musicInfo: {
        source: 'kg',
        songmid: String(audioid || albumId || hash || ''),
        hash,
        audioid,
        name: title,
        singer: artist,
        albumName: s.album_name ? String(s.album_name) : undefined,
        albumId,
        interval: s.duration ? Number(s.duration) : undefined,
        _types: types,
      },
    }
  })
}
