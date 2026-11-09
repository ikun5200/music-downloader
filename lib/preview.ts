import { QUALITY_RANK, PLATFORM_NAMES, type Platform } from './constants'
import { probeAudio } from './download/probe'
import { isDurationMismatch } from './playback/duration'
import { getRankedChannels } from './sources/selection'
import { sourceManager } from './sources/manager'
import { recordStat } from './sources/stats'

export interface PreviewOptions {
  /** 指定音质；auto/空表示自动选择最快可用档位。 */
  quality?: string | null
  /** 原曲时长（秒），用于排除慢放、加速、剪辑等非原版音源。 */
  expectedDuration?: number | null
}

export interface PreviewResult {
  url: string
  quality: string
  channel: { id: string; name: string }
  elapsedMs: number
  duration?: number
}

// 试听优先低码率：起播快、占用小；没有时再退到更高档位。
const PREFERRED_QUALITIES = ['128k', '320k', '192k', 'flac', 'flac24bit', 'hires']
const CACHE_TTL = 3 * 60 * 1000
const CACHE_MAX = 100
const TOTAL_TIMEOUT = 22_000

const cache = new Map<string, { at: number; result: PreviewResult }>()

class DurationMismatchError extends Error {}

function cacheKey(
  platform: Platform,
  musicInfo: Record<string, unknown>,
  preferredQuality: string
): string {
  const id =
    musicInfo.songmid ||
    musicInfo.hash ||
    musicInfo.id ||
    musicInfo.songId ||
    musicInfo.rid ||
    musicInfo.musicrid ||
    ''
  return `${platform}:${String(id)}:${preferredQuality || 'auto'}`
}

function cacheSet(key: string, result: PreviewResult) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, { at: Date.now(), result })
}

/**
 * 解析一个可试听的地址。返回的 URL 交给签名代理去拉流，
 * 浏览器不直接访问音源 CDN，避免 Referer/防盗链/混合内容问题。
 */
export async function resolvePreview(
  platform: Platform,
  musicInfo: Record<string, unknown>,
  options: PreviewOptions = {}
): Promise<PreviewResult> {
  const preferredQuality =
    options.quality && options.quality !== 'auto' ? options.quality : ''
  const key = cacheKey(platform, musicInfo, preferredQuality)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    if (!isDurationMismatch(options.expectedDuration, hit.result.duration)) {
      return hit.result
    }
    cache.delete(key)
  }

  const channels = await getRankedChannels(platform)
  if (!channels.length) {
    throw new Error(`${PLATFORM_NAMES[platform]} 没有可用渠道`)
  }

  const available = new Set<string>()
  for (const channel of channels) for (const q of channel.qualities) available.add(q)
  let qualities = preferredQuality
    ? [preferredQuality, ...PREFERRED_QUALITIES.filter((q) => q !== preferredQuality)]
    : PREFERRED_QUALITIES
  qualities = qualities.filter((q) => available.has(q))
  if (!qualities.length) {
    qualities = [...available].sort((a, b) => (QUALITY_RANK[a] || 0) - (QUALITY_RANK[b] || 0))
  }

  const started = Date.now()
  const errors: string[] = []

  for (const quality of qualities) {
    for (const channel of channels) {
      if (!channel.qualities.includes(quality)) continue
      if (Date.now() - started > TOTAL_TIMEOUT) {
        throw new Error('试听解析超时，请稍后重试')
      }

      const attemptStarted = Date.now()
      try {
        const resolved = await sourceManager.resolve(channel.id, platform, quality, musicInfo)
        const probe = await probeAudio(resolved.url, 12_000)
        if (!probe.isAudio) {
          throw new Error(probe.error || probe.note || '返回的不是有效音频')
        }
        if (isDurationMismatch(options.expectedDuration, probe.duration)) {
          throw new DurationMismatchError(
            `音源时长 ${Math.round(probe.duration || 0)} 秒与原曲 ${Math.round(
              options.expectedDuration || 0
            )} 秒不符，疑似慢放/剪辑版本`
          )
        }

        const result: PreviewResult = {
          url: resolved.url,
          quality,
          channel: { id: channel.id, name: channel.name },
          elapsedMs: Date.now() - attemptStarted,
          duration: probe.duration,
        }
        await recordStat(channel.id, platform, true, result.elapsedMs)
        cacheSet(key, result)
        return result
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        errors.push(`${channel.name}/${quality}: ${message}`)
        // 时长不符说明这个音源是别的版本，不是渠道故障，不能拉低渠道成功率。
        if (!(e instanceof DurationMismatchError)) {
          await recordStat(channel.id, platform, false, Date.now() - attemptStarted, message)
        }
      }
    }
  }

  throw new Error(`试听解析失败：${errors.slice(-4).join(' | ')}`)
}
