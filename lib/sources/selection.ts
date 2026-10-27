import type { Platform } from '../constants'
import { prisma } from '../db'
import { getSettings } from '../settings'
import { sourceManager } from './manager'
import { defaultPlatformRank } from './priority'

export interface RankedChannel {
  id: string
  name: string
  version: string
  priority: number
  qualities: string[]
  successRate: number
  avgLatencyMs: number
  coolingDown: boolean
}

export interface RankOptions {
  includeCooling?: boolean
}

/**
 * 统一渠道选择：后台自定义顺序 > 实测每平台推荐顺序 > 全局优先级 > 成功率 > 延迟。
 * 冷却中的渠道默认过滤，includeCooling 时排到最后。
 */
export async function getRankedChannels(
  platform: Platform,
  options: RankOptions = {}
): Promise<RankedChannel[]> {
  const manifest = await sourceManager.getManifest()
  const supported = manifest.filter((s) => s.platforms.includes(platform))
  if (!supported.length) return []

  const [stats, settings] = await Promise.all([
    prisma.sourceStat.findMany({ where: { platform } }),
    getSettings(),
  ])
  const statMap = new Map(stats.map((s) => [s.sourceId, s]))
  const override = settings.platformPriority?.[platform]
  const now = Date.now()

  const ranked = supported.map((source) => {
    const stat = statMap.get(source.id)
    const cooldownAt = stat?.cooldownUntil ? new Date(stat.cooldownUntil).getTime() : 0
    return {
      id: source.id,
      name: source.name,
      version: source.version,
      priority: source.priority,
      qualities: source.qualities[platform] || [],
      successRate: stat && stat.attempts > 0 ? stat.successes / stat.attempts : 1,
      avgLatencyMs: stat?.avgLatencyMs || 0,
      coolingDown: cooldownAt > now,
      overrideIndex: override ? override.indexOf(source.id) : -1,
    }
  })

  ranked.sort((a, b) => {
    if (a.coolingDown !== b.coolingDown) return a.coolingDown ? 1 : -1
    if (a.overrideIndex >= 0 || b.overrideIndex >= 0) {
      if (a.overrideIndex < 0) return 1
      if (b.overrideIndex < 0) return -1
      if (a.overrideIndex !== b.overrideIndex) return a.overrideIndex - b.overrideIndex
    } else {
      const rankA = defaultPlatformRank(platform, a.name)
      const rankB = defaultPlatformRank(platform, b.name)
      if (rankA !== rankB) return rankA - rankB
    }
    if (a.priority !== b.priority) return a.priority - b.priority
    if (b.successRate !== a.successRate) return b.successRate - a.successRate
    return a.avgLatencyMs - b.avgLatencyMs
  })

  const filtered = options.includeCooling
    ? ranked
    : ranked.filter((channel) => !channel.coolingDown)

  return filtered.map(({ overrideIndex: _overrideIndex, ...channel }) => channel)
}
