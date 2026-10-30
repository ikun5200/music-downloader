import type { DownloadJob } from '@prisma/client'
import { PLATFORMS, PLATFORM_NAMES, type Platform } from '../constants'
import { getAiConfig, getSettings } from '../settings'
import { searchAll } from '../search'
import { sourceManager } from '../sources/manager'
import { selectBestSong, type PlatformInfo, type SongSelection } from '../batch/selector'
import { checkVersionBeforeDownload } from '../ai/version-guard'

export interface CrossPlatformFallbackResult {
  selection: SongSelection
  reason: string
}

/**
 * 当前平台没有渠道/全部渠道失败时，重新搜索其他平台，并强制让 AI 重新识别。
 * 如果 AI 不可用、AI 没有真正参与、或候选版本校验不通过，就不兜底。
 */
export async function findCrossPlatformFallback(
  job: DownloadJob,
  failedPlatform: Platform
): Promise<CrossPlatformFallbackResult | null> {
  if (job.fallbackCount >= 1) return null

  const [settings, aiConfig, manifest] = await Promise.all([
    getSettings().catch(() => null),
    getAiConfig().catch(() => null),
    sourceManager.getManifest().catch(() => []),
  ])
  if (!settings?.aiCrossPlatformFallbackEnabled) return null
  if (!aiConfig?.enabled || !aiConfig.apiKey) return null

  const platforms = (settings.platformOrder?.length ? settings.platformOrder : PLATFORMS)
    .filter((p): p is Platform => p !== failedPlatform)
  if (!platforms.length) return null

  const platformInfo = new Map<Platform, PlatformInfo>()
  for (const [order, platform] of platforms.entries()) {
    const channels = manifest.filter((source) => source.platforms.includes(platform))
    if (!channels.length) continue
    const qualities = new Set<string>()
    for (const channel of channels) {
      for (const quality of channel.qualities[platform] || []) qualities.add(quality)
    }
    platformInfo.set(platform, {
      channels: channels.length,
      qualities: [...qualities],
      order,
    })
  }
  const available = platforms.filter((p) => platformInfo.has(p))
  if (!available.length) return null

  const query = (job.requestLine || `${job.title} ${job.artist}`).trim()
  if (!query) return null
  const results = await searchAll(query, available)
  if (!results.some((r) => r.results.length)) return null

  // 兜底时不要在选版阶段按原平台的音质过滤；换平台后可能只有其他档位，
  // 具体音质由下载流水线按后台策略重新选择。
  const selection = await selectBestSong(query, results, platformInfo, { aiConfig })
  // 需求明确：跨平台兜底必须由 AI 重新识别，规则排序不算。
  if (!selection.aiUsed) return null
  if (selection.platform === failedPlatform) return null

  const version = await checkVersionBeforeDownload({
    requestLine: job.requestLine || query,
    title: selection.song.title,
    album: selection.song.album,
    candidate: {
      title: selection.song.title,
      album: selection.song.album,
      artist: selection.song.artist,
    },
    aiConfig,
    aiEnabled: settings.aiVersionGuardEnabled,
  })
  if (!version.ok) return null

  return {
    selection,
    reason: `AI 跨平台兜底：${PLATFORM_NAMES[failedPlatform]} → ${PLATFORM_NAMES[selection.platform]}；${selection.reason}`,
  }
}
