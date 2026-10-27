import { sleep } from '../utils'
import { fetchJson } from './http'
import type { RawSearchSong } from './types'

export async function searchWy(query: string, limit = 30): Promise<RawSearchSong[]> {
  const endpoints = [
    `https://music.163.com/api/search/get?s=${encodeURIComponent(query)}&type=1&offset=0&limit=${limit}`,
    `https://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(query)}&type=1&offset=0&limit=${limit}`,
  ]

  let lastErr: unknown = new Error('网易云搜索失败')
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const url of endpoints) {
      try {
        const json = await fetchJson<any>(url, {
          headers: { Referer: 'https://music.163.com/' },
        })
        if (json?.code === 405 || /频繁/.test(json?.msg || '')) {
          lastErr = new Error('网易云搜索被限流')
          continue
        }
        const songs = json?.result?.songs
        if (!Array.isArray(songs)) {
          lastErr = new Error('网易云搜索返回格式异常')
          continue
        }
        return songs.map((s: any): RawSearchSong => {
          const artists = s.artists || s.ar || []
          const album = s.album || s.al || {}
          const durationMs = s.duration ?? s.dt
          const singer = artists.map((a: any) => a?.name).filter(Boolean).join('/')
          return {
            platform: 'wy',
            id: String(s.id),
            title: String(s.name || ''),
            artist: singer,
            album: album?.name ? String(album.name) : undefined,
            duration: durationMs ? Math.round(Number(durationMs) / 1000) : undefined,
            coverUrl: album?.picUrl ? String(album.picUrl) : undefined,
            musicInfo: {
              source: 'wy',
              songmid: String(s.id),
              id: String(s.id),
              copyrightId: s.copyrightId ? String(s.copyrightId) : undefined,
              name: String(s.name || ''),
              singer,
              albumName: album?.name ? String(album.name) : undefined,
              albumId: album?.id ? String(album.id) : undefined,
              interval: durationMs ? Math.round(Number(durationMs) / 1000) : undefined,
            },
          }
        })
      } catch (e) {
        lastErr = e
      }
    }
    await sleep(800 * (attempt + 1))
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}
