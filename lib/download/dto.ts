import type { DownloadJob } from '@prisma/client'
import path from 'path'
import { safeJson } from '../utils'
import { resolveDownloadRoot } from './filename'

export function jobToDto(job: DownloadJob & { channel?: { name: string } | null }) {
  const hostRoot = process.env.HOST_DOWNLOAD_DIR || resolveDownloadRoot()
  return {
    id: job.id,
    platform: job.platform,
    songId: job.songId,
    title: job.title,
    artist: job.artist,
    album: job.album,
    coverUrl: job.coverUrl,
    requestedQuality: job.requestedQuality,
    actualQuality: job.actualQuality,
    qualityVerdict: job.qualityVerdict,
    channelId: job.channelId,
    channelName: job.channel?.name || null,
    status: job.status,
    progress: job.progress,
    bytesDone: job.bytesDone,
    bytesTotal: job.bytesTotal,
    filePath: job.filePath,
    absolutePath: job.filePath ? path.join(hostRoot, job.filePath) : null,
    urlHost: job.urlHost,
    attempts: safeJson(job.attempts, []),
    verified: job.verified,
    reviewNote: job.reviewNote,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() || null,
    finishedAt: job.finishedAt?.toISOString() || null,
  }
}
