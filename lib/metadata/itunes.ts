import { fetchJson } from './http'
import { scoreCandidate, toSimplified } from './normalize'
import type { MetadataCandidate, MetadataQuery } from './types'

interface ItunesResult {
  trackId?: number
  trackName?: string
  artistName?: string
  collectionName?: string
  collectionId?: number
  releaseDate?: string
  primaryGenreName?: string
  trackTimeMillis?: number
  trackNumber?: number
  discNumber?: number
  artworkUrl100?: string
}

interface ItunesResponse {
  resultCount?: number
  results?: ItunesResult[]
}

const ITUNES_SEARCH = 'https://itunes.apple.com/search'

function coverUrl(artworkUrl100?: string): string | undefined {
  if (!artworkUrl100) return undefined
  return artworkUrl100.replace(/100x100/g, '800x800')
}

function coverUrls(artworkUrl100?: string): string[] {
  if (!artworkUrl100) return []
  return [800, 600, 300].map((size) => artworkUrl100.replace(/100x100/g, `${size}x${size}`))
}

function buildCandidate(item: ItunesResult): MetadataCandidate | null {
  const rawTitle = (item.trackName || '').trim()
  const artist = (item.artistName || '').trim()
  if (!rawTitle || !artist) return null
  return {
    source: 'itunes',
    sourceLabel: 'iTunes',
    title: toSimplified(rawTitle),
    artist: toSimplified(artist),
    album: toSimplified((item.collectionName || '').trim()),
    date: (item.releaseDate || '').slice(0, 10),
    genre: toSimplified((item.primaryGenreName || '').trim()),
    track: item.trackNumber ? String(item.trackNumber) : undefined,
    disc: item.discNumber ? String(item.discNumber) : undefined,
    duration: item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : undefined,
    songId: item.trackId ? String(item.trackId) : undefined,
    albumId: item.collectionId ? String(item.collectionId) : undefined,
    coverUrl: coverUrl(item.artworkUrl100),
    coverUrls: coverUrls(item.artworkUrl100),
    rawTitle,
    score: 0,
    acceptable: false,
    variantFlags: 0,
    reasons: [],
  }
}

async function searchRegion(
  country: 'CN' | 'TW',
  query: string,
  limit: number
): Promise<MetadataCandidate[]> {
  const params = new URLSearchParams({
    term: query,
    media: 'music',
    entity: 'song',
    limit: String(Math.max(5, Math.min(20, limit))),
    country,
  })
  const data = await fetchJson<ItunesResponse>(`${ITUNES_SEARCH}?${params.toString()}`, {
    timeoutMs: 15_000,
    retries: 1,
  })
  return (data.results || [])
    .map(buildCandidate)
    .filter((candidate): candidate is MetadataCandidate => !!candidate)
}

function hasAcceptable(candidates: MetadataCandidate[], query: MetadataQuery): boolean {
  return candidates
    .map((candidate) => scoreCandidate(candidate, query, ['itunes']))
    .some(
      (candidate) =>
        candidate.acceptable &&
        (!query.album ||
          !candidate.album ||
          candidate.reasons.includes('专辑一致'))
    )
}

export interface ItunesSearchResult {
  candidates: MetadataCandidate[]
  regionsTried: Array<'CN' | 'TW'>
  note?: string
}

/**
 * iTunes：先查中国区，中国区没有可接受的录音室原版时再查台湾区。
 * 台湾区返回繁体元数据，写标签前会统一转成简体。
 */
export async function searchItunes(
  query: MetadataQuery,
  limit = 10
): Promise<ItunesSearchResult> {
  const term = [query.title.trim(), query.artist.trim()].filter(Boolean).join(' ').trim()
  if (!term) return { candidates: [], regionsTried: [] }

  const regionsTried: Array<'CN' | 'TW'> = []
  try {
    regionsTried.push('CN')
    const cn = await searchRegion('CN', term, limit)
    if (cn.length && hasAcceptable(cn, query)) {
      return { candidates: cn, regionsTried, note: 'iTunes 中国区命中' }
    }

    regionsTried.push('TW')
    const tw = await searchRegion('TW', term, limit)
    const seen = new Set(cn.map((candidate) => candidate.songId).filter(Boolean))
    const merged = [...cn]
    for (const candidate of tw) {
      if (candidate.songId && seen.has(candidate.songId)) continue
      if (candidate.songId) seen.add(candidate.songId)
      merged.push(candidate)
    }
    return {
      candidates: merged,
      regionsTried,
      note: tw.length
        ? 'iTunes 中国区未命中，已回退台湾区'
        : 'iTunes 中国区和台湾区均未返回结果',
    }
  } catch (error) {
    return {
      candidates: [],
      regionsTried,
      note: `iTunes 搜索失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
