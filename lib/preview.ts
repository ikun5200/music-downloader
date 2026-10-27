import { QUALITY_RANK, PLATFORM_NAMES, type Platform } from './constants'
import { probeAudio } from './download/probe'
import { getRankedChannels } from './sources/selection'
import { sourceManager } from './sources/manager'
import { recordStat } from './sources/stats'

export interface PreviewResult {
  url: string
  quality: string
  channel: { id: string; name: string }
  elapsedMs: number
}

// 试听优先低码率：起播快、占用小；没有时再退到更高档位。
const PREFERRED_QUALITIES = ['128k', '320k', '192k', 'flac', 'flac24bit', 'hires']
const CACHE_TTL = 3 * 60 * 1000
const CACHE_MAX = 100
const TOTAL_TIMEOUT = 22_000

const cache = new Map<string, { at: number; result: PreviewResult }>()

function cacheKey(platform: Platform, musicInfo: Record<string, unknown>): string {
  const id =
    musicInfo.songmid ||
    musicInfo.hash ||
    musicInfo.id ||
    musicInfo.songId ||
    musicInfo.rid ||
    musicInfo.musicrid ||
    ''
  return `${platform}:${String(id)}`
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
  musicInfo: Record<string, unknown>
): Promise<PreviewResult> {
  const key = cacheKey(platform, musicInfo)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.result

  const channels = await getRankedChannels(platform)
  if (!channels.length) {
    throw new Error(`${PLATFORM_NAMES[platform]} 没有可用渠道`)
  }

  const available = new Set<string>()
  for (const channel of channels) for (const q of channel.qualities) available.add(q)
  let qualities = PREFERRED_QUALITIES.filter((q) => available.has(q))
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

        const result: PreviewResult = {
          url: resolved.url,
          quality,
          channel: { id: channel.id, name: channel.name },
          elapsedMs: Date.now() - attemptStarted,
        }
        await recordStat(channel.id, platform, true, result.elapsedMs)
        cacheSet(key, result)
        return result
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        errors.push(`${channel.name}/${quality}: ${message}`)
        await recordStat(channel.id, platform, false, Date.now() - attemptStarted, message)
      }
    }
  }

  throw new Error(`试听解析失败：${errors.slice(-4).join(' | ')}`)
}
