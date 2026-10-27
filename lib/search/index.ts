import { PLATFORMS, type Platform } from '../constants'
import { withRetry } from './http'
import { searchKg } from './kg'
import { searchKw } from './kw'
import { searchMg } from './mg'
import { sortResults } from './normalize'
import { searchTx } from './tx'
import type { PlatformSearchResult, RawSearchSong } from './types'
import { searchWy } from './wy'

const adapters: Record<Platform, (query: string, limit?: number) => Promise<RawSearchSong[]>> = {
  kw: searchKw,
  kg: searchKg,
  tx: searchTx,
  wy: searchWy,
  mg: searchMg,
}

const cache = new Map<string, { at: number; results: RawSearchSong[] }>()
const CACHE_TTL = 5 * 60 * 1000
const CACHE_MAX = 200

function cacheGet(platform: Platform, query: string): RawSearchSong[] | null {
  const key = `${platform}:${query.toLowerCase()}`
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(key)
    return null
  }
  return hit.results
}

function cacheSet(platform: Platform, query: string, results: RawSearchSong[]) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(`${platform}:${query.toLowerCase()}`, { at: Date.now(), results })
}

export async function searchAll(
  query: string,
  platforms: readonly Platform[] = PLATFORMS
): Promise<PlatformSearchResult[]> {
  const tasks = platforms.map(async (platform): Promise<PlatformSearchResult> => {
    const cached = cacheGet(platform, query)
    if (cached) return { platform, results: cached }

    try {
      const results = await withRetry(() => adapters[platform](query, 30), 2, [600, 1400])
      const sorted = sortResults(results, query)
      cacheSet(platform, query, sorted)
      return { platform, results: sorted }
    } catch (e) {
      return { platform, results: [], error: String(e instanceof Error ? e.message : e) }
    }
  })

  return Promise.all(tasks)
}
