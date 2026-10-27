import type { DownloadJob } from '@prisma/client'
import { PLATFORM_NAMES, type Platform } from '../constants'
import { prisma } from '../db'
import { sourceManager } from '../sources/manager'
import { wakeQueue } from './queue'

export interface CreateDownloadInput {
  platform: Platform
  musicInfo: Record<string, unknown>
  quality?: string | null
  title?: string | null
  artist?: string | null
  album?: string | null
  coverUrl?: string | null
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
  if (input.quality && input.quality !== 'auto' && !qualities.has(input.quality)) {
    throw new Error(`该平台不支持音质 ${input.quality}`)
  }

  const songId = String(
    musicInfo.songmid || musicInfo.hash || musicInfo.id || musicInfo.songId || ''
  )
  if (!songId) throw new Error('缺少歌曲 ID')

  const title = String(input.title || musicInfo.name || '未知歌曲').slice(0, 300)
  const artist = String(input.artist || musicInfo.singer || '未知歌手').slice(0, 300)
  const album = input.album
    ? String(input.album).slice(0, 300)
    : musicInfo.albumName
      ? String(musicInfo.albumName).slice(0, 300)
      : null

  const job = await prisma.downloadJob.create({
    data: {
      platform,
      songId,
      title,
      artist,
      album,
      coverUrl: input.coverUrl || null,
      musicInfo: JSON.stringify(musicInfo),
      requestedQuality:
        input.quality && input.quality !== 'auto' ? input.quality : null,
      status: 'queued',
    },
  })

  wakeQueue()
  return job
}
