import type { OnlineCard, OnlineCollection, OnlineSearchResult, OnlineTrack } from './types'

const COUNTRY = 'hk'
const SEARCH_URL = 'https://itunes.apple.com/search'
const LOOKUP_URL = 'https://itunes.apple.com/lookup'

interface ItunesResult {
  wrapperType?: string
  kind?: string
  trackId?: number
  collectionId?: number
  trackName?: string
  collectionName?: string
  artistName?: string
  artworkUrl100?: string
  trackTimeMillis?: number
  trackCount?: number
  trackViewUrl?: string
  collectionViewUrl?: string
  releaseDate?: string
  copyright?: string
}

function artwork(value?: string): string | undefined {
  return value ? value.replace('100x100', '600x600') : undefined
}

function asTrack(item: ItunesResult): OnlineTrack | null {
  if (item.wrapperType !== 'track' || !item.trackName) return null
  return {
    id: String(item.trackId || item.trackName),
    title: item.trackName,
    artist: item.artistName || '',
    album: item.collectionName,
    artwork: artwork(item.artworkUrl100),
    duration: item.trackTimeMillis ? item.trackTimeMillis / 1000 : undefined,
    appleId: item.trackId ? String(item.trackId) : undefined,
    url: item.trackViewUrl,
  }
}

function asAlbum(item: ItunesResult): OnlineCard | null {
  if (item.wrapperType !== 'collection' || !item.collectionName) return null
  return {
    id: String(item.collectionId || item.collectionName),
    kind: 'album',
    title: item.collectionName,
    subtitle: item.artistName,
    artwork: artwork(item.artworkUrl100),
    url: item.collectionViewUrl,
    appleId: item.collectionId ? String(item.collectionId) : undefined,
    trackCount: item.trackCount,
  }
}

async function fetchJson(url: string): Promise<{ results?: ItunesResult[] }> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Apple 搜索失败：HTTP ${res.status}`)
  return (await res.json()) as { results?: ItunesResult[] }
}

/** 浏览器端直接调用 iTunes Search（支持 CORS），不经过 NAS 服务端。 */
export async function searchItunes(term: string): Promise<OnlineSearchResult> {
  const query = term.trim().slice(0, 100)
  if (!query) return { songs: [], albums: [] }
  const base = `${SEARCH_URL}?term=${encodeURIComponent(query)}&country=${COUNTRY}&media=music&limit=20`
  const [songsJson, albumsJson] = await Promise.all([
    fetchJson(`${base}&entity=song`),
    fetchJson(`${base}&entity=album`),
  ])
  const songs = (songsJson.results || [])
    .map(asTrack)
    .filter((item): item is OnlineTrack => !!item)
  const albums = (albumsJson.results || [])
    .map(asAlbum)
    .filter((item): item is OnlineCard => !!item)
  return {
    songs: songs.filter(
      (song, index, list) => list.findIndex((item) => item.id === song.id) === index
    ),
    albums: albums.filter(
      (album, index, list) => list.findIndex((item) => item.id === album.id) === index
    ),
  }
}

/** 浏览器端直接读取 Apple 专辑曲目；歌单仍回退服务端 Apple 页面解析。 */
export async function getItunesAlbum(id: string): Promise<OnlineCollection | null> {
  if (!id || !/^\d+$/.test(id)) return null
  const json = await fetchJson(
    `${LOOKUP_URL}?id=${encodeURIComponent(id)}&entity=song&country=${COUNTRY}&limit=200`
  )
  const results = json.results || []
  const album = results.find((item) => item.wrapperType === 'collection')
  if (!album?.collectionName) return null
  const tracks = results
    .map(asTrack)
    .filter((item): item is OnlineTrack => !!item)
    .map((track) => ({
      ...track,
      album: track.album || album.collectionName,
      artwork: track.artwork || artwork(album.artworkUrl100),
    }))
  return {
    id: String(album.collectionId || id),
    kind: 'album',
    title: album.collectionName,
    subtitle: album.artistName,
    artwork: artwork(album.artworkUrl100),
    description: [album.releaseDate?.slice(0, 10), album.copyright]
      .filter(Boolean)
      .join(' · '),
    tracks,
    url: album.collectionViewUrl,
  }
}
