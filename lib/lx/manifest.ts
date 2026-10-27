import { PLATFORMS, PLATFORM_NAMES, QUALITY_RANK, type Platform } from '../constants'
import { sourceManager } from '../sources/manager'

export interface LxSourceConfig {
  name: string
  type: 'music'
  actions: string[]
  qualitys: string[]
}

export type LxSources = Record<string, LxSourceConfig>

export interface LxManifest {
  sources: LxSources
  channels: Array<{
    id: string
    name: string
    version: string
    priority: number
    platforms: Platform[]
    qualities: Record<string, string[]>
  }>
  updatedAt: string
}

export async function getLxManifest(): Promise<LxManifest> {
  const loaded = await sourceManager.getManifest()
  const sources: LxSources = {}

  for (const platform of PLATFORMS) {
    const channels = loaded.filter((s) => s.platforms.includes(platform))
    if (!channels.length) continue

    const set = new Set<string>()
    for (const channel of channels) {
      for (const q of channel.qualities[platform] || []) set.add(q)
    }
    const qualitys = [...set].sort((a, b) => (QUALITY_RANK[b] || 0) - (QUALITY_RANK[a] || 0))
    if (!qualitys.length) continue

    sources[platform] = {
      name: PLATFORM_NAMES[platform],
      type: 'music',
      actions: ['musicUrl'],
      qualitys,
    }
  }

  return {
    sources,
    channels: loaded.map((s) => ({
      id: s.id,
      name: s.name,
      version: s.version,
      priority: s.priority,
      platforms: s.platforms,
      qualities: s.qualities,
    })),
    updatedAt: new Date().toISOString(),
  }
}
