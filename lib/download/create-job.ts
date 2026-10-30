import type { DownloadJob } from '@prisma/client'
import { PLATFORM_NAMES, type Platform } from '../constants'
import { prisma } from '../db'
import { sourceManager } from '../sources/manager'
import { getAiConfig, getSettings } from '../settings'
import { cleanSongTitle } from '../ai/title-clean'
import { capQuality } from './quality-cap'
import { wakeQueue } from './queue'

export interface CreateDownloadInput {
  platform: Platform
  musicInfo: Record<string, unknown>
  quality?: string | null
  title?: string | null
  artist?: string | null
  album?: string | null
  coverUrl?: string | null
  /** 用户原始点歌行，保留版本/语言意图供下载前后校验。 */
  requestLine?: string | null
}

/** 供站内下载 API 和服务端批量任务共用，保证两边的校验/入队逻辑一致。 */
export async function createDownloadJob(input: CreateDownloadInput): Promise<DownloadJob> {
  const { platform, musicInfo } = input

  const channels = await sourceManager.getChannelsForPlatform(platform).catch(() => [])
  if (!channels.length) {
    throw new Error(`${PLATFORM_NAMES[platform]} 没有启用的音源渠道`)
  }

  const qualities = new Set<string>()
  for (const channel of channels) {
    for (const quality of channel.qualities[platform] || []) qualities.add(quality)
  }

  const settings = await getSettings()
  const requestedQuality = capQuality(input.quality, settings.maxQuality)
  if (input.quality && input.quality !== 'auto' && !qualities.has(input.quality)) {
    // 后台上限把请求截断时允许降级；没有截断则说明用户明确选了一个平台不支持的档位。
    if (requestedQuality === input.quality) {
      throw new Error(`该平台不支持音质 ${input.quality}`)
    }
  }

  const songId = String(
    musicInfo.songmid || musicInfo.hash || musicInfo.id || musicInfo.songId || ''
  )
  if (!songId) throw new Error('缺少歌曲 ID')

  const artist = String(input.artist || musicInfo.singer || '未知歌手').slice(0, 300)
  const originalTitle = String(input.title || musicInfo.name || '未知歌曲').slice(0, 300)
  // AI 清理是可选的，失败时 cleanSongTitle 会原样返回。
  const aiConfig = await getAiConfig().catch(() => null)
  const title = await cleanSongTitle(originalTitle, artist, aiConfig)
  const album = input.album
    ? String(input.album).slice(0, 300)
    : musicInfo.albumName
      ? String(musicInfo.albumName).slice(0, 300)
      : null

  const job = await prisma.downloadJob.create({
    data: {
      platform,
      songId,
      requestLine: input.requestLine ? String(input.requestLine).slice(0, 500) : null,
      title,
      artist,
      album,
      coverUrl: input.coverUrl || null,
      musicInfo: JSON.stringify(musicInfo),
      requestedQuality,
      status: 'queued',
    },
  })

  wakeQueue()
  return job
}
