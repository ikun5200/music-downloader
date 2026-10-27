import fs from 'fs/promises'
import path from 'path'
import type { DownloadJob } from '@prisma/client'
import { prisma, withDbRetry } from '../db'
import { resolveDownloadRoot } from '../download/filename'
import { getAiConfig, getSettings } from '../settings'
import { safeJson } from '../utils'
import { scrapeMetadata } from './scrape'
import { writeMetadataTags } from './tag'

interface MetadataQueueState {
  started: boolean
  ticking: boolean
  running: Set<string>
  timer: NodeJS.Timeout | null
}

const globalForMetadata = globalThis as unknown as {
  __mdMetadataQueue?: MetadataQueueState
}
const state: MetadataQueueState =
  globalForMetadata.__mdMetadataQueue ||
  (globalForMetadata.__mdMetadataQueue = {
    started: false,
    ticking: false,
    running: new Set(),
    timer: null,
  })

const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.METADATA_CONCURRENCY || 1) || 1))

async function updateJob(id: string, data: Record<string, unknown>) {
  await withDbRetry(() => prisma.downloadJob.update({ where: { id }, data }))
}

async function claimJob(): Promise<DownloadJob | null> {
  const candidate = await prisma.downloadJob.findFirst({
    where: {
      status: 'completed',
      metadataStatus: 'pending',
      filePath: { not: null },
    },
    orderBy: [{ finishedAt: 'asc' }, { createdAt: 'asc' }],
  })
  if (!candidate) return null
  const claimed = await prisma.downloadJob.updateMany({
    where: { id: candidate.id, metadataStatus: 'pending' },
    data: { metadataStatus: 'processing' },
  })
  if (!claimed.count) return null
  return candidate
}

async function processJob(job: DownloadJob): Promise<void> {
  const settings = await getSettings()
  if (!settings.metadataScrapeEnabled) {
    await updateJob(job.id, {
      metadataStatus: 'disabled',
      metadataNote: '下载后自动刮削已关闭',
      metadataAt: new Date(),
    })
    return
  }

  if (!job.filePath) {
    await updateJob(job.id, {
      metadataStatus: 'failed',
      metadataNote: '缺少文件路径',
      metadataAt: new Date(),
    })
    return
  }

  const absolutePath = path.join(resolveDownloadRoot(), job.filePath)
  try {
    await fs.access(absolutePath)
  } catch {
    await updateJob(job.id, {
      metadataStatus: 'failed',
      metadataNote: '文件不存在，无法写入元数据',
      metadataAt: new Date(),
    })
    return
  }

  const musicInfo = safeJson<Record<string, unknown>>(job.musicInfo, {})
  const duration = Number(musicInfo.interval)

  try {
    const aiConfig = await getAiConfig().catch(() => null)
    const aiEnabled = !!(
      settings.metadataAiEnabled &&
      aiConfig?.enabled &&
      aiConfig.apiKey
    )

    const result = await scrapeMetadata({
      query: {
        title: job.title,
        artist: job.artist,
        album: job.album,
        duration: Number.isFinite(duration) && duration > 0 ? duration : null,
      },
      sourceOrder: settings.metadataSourceOrder,
      aiConfig: aiEnabled ? aiConfig : null,
    })

    if (result.status !== 'success' || !result.candidate) {
      await updateJob(job.id, {
        metadataStatus: result.status === 'not_found' ? 'not_found' : 'failed',
        metadataNote: (result.note || '没有找到可信的原版元数据').slice(0, 1000),
        metadataAt: new Date(),
      })
      return
    }

    const candidate = result.candidate
    const written = await writeMetadataTags(absolutePath, candidate, {
      writeInfo: settings.metadataWriteInfo,
      writeCover: settings.metadataWriteCover,
      writeLyrics: settings.metadataWriteLyrics,
      lyricsCleanCredits: settings.lyricsCleanCredits,
      lyricsSimplify: settings.lyricsSimplify,
    })

    const note = [result.note, written.note].filter(Boolean).join('；').slice(0, 1000)
    await updateJob(job.id, {
      metadataStatus: written.ok ? 'success' : written.partial ? 'partial' : 'failed',
      metadataSource: candidate.source,
      metadataTitle: candidate.title || null,
      metadataArtist: candidate.artist || null,
      metadataAlbum: candidate.album || null,
      metadataNote: note,
      metadataAt: new Date(),
    })
  } catch (error) {
    await updateJob(job.id, {
      metadataStatus: 'failed',
      metadataNote: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      metadataAt: new Date(),
    })
  }
}

async function tick() {
  if (state.ticking) return
  state.ticking = true
  try {
    while (state.running.size < CONCURRENCY) {
      const job = await claimJob()
      if (!job) break
      state.running.add(job.id)
      void processJob(job)
        .catch(async (error) => {
          await updateJob(job.id, {
            metadataStatus: 'failed',
            metadataNote: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
            metadataAt: new Date(),
          }).catch(() => {})
        })
        .finally(() => {
          state.running.delete(job.id)
          setTimeout(() => void tick(), 200)
        })
    }
  } catch {
    // 数据库暂时不可用时下一轮继续
  } finally {
    state.ticking = false
  }
}

export async function startMetadataQueue(): Promise<void> {
  if (state.started) return
  state.started = true

  // 上次进程退出时正在处理的任务，恢复到 pending 后重新刮削。
  await prisma.downloadJob
    .updateMany({
      where: { metadataStatus: 'processing' },
      data: { metadataStatus: 'pending' },
    })
    .catch(() => {})

  if (state.timer) clearInterval(state.timer)
  state.timer = setInterval(() => void tick(), 4000)
  void tick()
}

export function wakeMetadataQueue(): void {
  setTimeout(() => void tick(), 100)
}

export function getMetadataQueueState() {
  return { running: [...state.running], started: state.started }
}
