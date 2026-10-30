import path from 'path'
import type { DownloadJob } from '@prisma/client'
import { prisma, withDbRetry } from '../db'
import { resolveDownloadRoot } from '../download/filename'
import { cpuScanConcurrency, getSettings } from '../settings'
import { processMetadataForJob } from './process'

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
  if (!job.filePath) {
    await updateJob(job.id, {
      metadataStatus: 'failed',
      metadataNote: '缺少文件路径',
      metadataAt: new Date(),
    })
    return
  }

  const settings = await getSettings()
  const absolutePath = path.join(resolveDownloadRoot(), job.filePath)
  const result = await processMetadataForJob(job, absolutePath, settings)
  await updateJob(job.id, {
    metadataStatus: result.status,
    metadataSource: result.source || null,
    metadataTitle: result.title || null,
    metadataArtist: result.artist || null,
    metadataAlbum: result.album || null,
    metadataNote: result.note,
    metadataAt: new Date(),
  })
}

async function tick() {
  if (state.ticking) return
  state.ticking = true
  try {
    const settings = await getSettings()
    const concurrency = Math.min(CONCURRENCY, cpuScanConcurrency(settings.cpuLimitPercent))
    while (state.running.size < concurrency) {
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
