import { fetchJson } from './http'
import type { RawSearchSong } from './types'

export async function searchTx(query: string, limit = 30): Promise<RawSearchSong[]> {
  // client_search_cp 目前经常直接返回 500；search_for_qq_cp 仍可用，字段更旧，下面做兼容。
  const url =
    'https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp' +
    '?g_tk=5381&uin=0&format=json&inCharset=utf-8&outCharset=utf-8&notice=0' +
    '&platform=yqq&needNewCode=0&zhidaqu=1&catZhida=1&t=0&flag=1&ie=utf-8&sem=1&aggr=0' +
    `&perpage=${limit}&n=${limit}&p=1&remoteplace=txt.yqq.song&_=0&w=${encodeURIComponent(query)}`

  const json = await fetchJson<any>(url, {
    headers: {
      Referer: 'https://y.qq.com/',
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
    },
  })
  const list = json?.data?.song?.list
  if (!Array.isArray(list)) throw new Error('QQ 音乐搜索返回格式异常')

  return list.map((s: any): RawSearchSong => {
    const singers = Array.isArray(s.singer) ? s.singer : []
    const singer = singers.map((a: any) => a?.name).filter(Boolean).join('/')
    const albumMid = s.albummid ? String(s.albummid) : s.album?.mid ? String(s.album.mid) : undefined
    const albumName = s.albumname
      ? String(s.albumname)
      : s.album?.name
        ? String(s.album.name)
        : undefined
    const songmid = String(s.songmid || s.mid || '')
    const mediaMid = String(s.file?.media_mid || s.strMediaMid || songmid)
    const title = String(s.songname || s.name || s.title || '')
    const duration = s.interval ? Number(s.interval) : undefined

    return {
      platform: 'tx',
      id: songmid,
      title,
      artist: singer,
      album: albumName,
      duration,
      coverUrl: albumMid
        ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
        : undefined,
      musicInfo: {
        source: 'tx',
        songmid,
        songId: s.songid != null ? String(s.songid) : s.id != null ? String(s.id) : undefined,
        strMediaMid: mediaMid,
        mediaMid,
        name: title,
        singer,
        albumName,
        albumId:
          s.albumid != null ? String(s.albumid) : s.album?.id != null ? String(s.album.id) : undefined,
        albumMid,
        interval: duration,
      },
    }
  })
}
