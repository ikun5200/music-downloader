import type { DownloadJob } from '@prisma/client'
import { prisma } from '../db'
import { cpuScanConcurrency, getSettings } from '../settings'
import { runPipeline, cancelJob, pauseJob } from './pipeline'

interface QueueState {
  started: boolean
  ticking: boolean
  running: Set<string>
  timer: NodeJS.Timeout | null
}

const globalForQueue = globalThis as unknown as { __mdQueue?: QueueState }
const state: QueueState =
  globalForQueue.__mdQueue ||
  (globalForQueue.__mdQueue = { started: false, ticking: false, running: new Set(), timer: null })

async function claimJob(): Promise<DownloadJob | null> {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.downloadJob.findFirst({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' },
    })
    if (!candidate) return null
    const result = await tx.downloadJob.updateMany({
      where: { id: candidate.id, status: 'queued' },
      data: { status: 'resolving', startedAt: new Date(), error: null },
    })
    if (!result.count) return null
    return candidate
  })
}

/** 暂停排队中的任务；执行中的任务会中止并回到 paused（续跑时从头下载）。 */
export async function pauseDownloadJobs(ids: string[]): Promise<string[]> {
  if (!ids.length) return []
  await prisma.downloadJob.updateMany({
    where: { id: { in: ids }, status: 'queued' },
    data: { status: 'paused' },
  })
  const active = await prisma.downloadJob.findMany({
    where: { id: { in: ids }, status: { in: ['resolving', 'downloading'] } },
    select: { id: true },
  })
  for (const job of active) pauseJob(job.id)
  return active.map((job) => job.id)
}

export async function resumeDownloadJobs(ids: string[]) {
  if (!ids.length) return 0
  const result = await prisma.downloadJob.updateMany({
    where: { id: { in: ids }, status: 'paused' },
    data: {
      status: 'queued',
      progress: 0,
      bytesDone: 0,
      bytesTotal: null,
      actualQuality: null,
      qualityVerdict: null,
      filePath: null,
      urlHost: null,
      attempts: '[]',
      error: null,
      verified: false,
      reviewNote: null,
      metadataStatus: 'none',
      metadataSource: null,
      metadataTitle: null,
      metadataArtist: null,
      metadataAlbum: null,
      metadataNote: null,
      metadataAt: null,
      startedAt: null,
      finishedAt: null,
    },
  })
  if (result.count) wakeQueue()
  return result.count
}

export async function cancelDownloadJobs(ids: string[]) {
  if (!ids.length) return { updated: 0, active: [] as string[] }
  const result = await prisma.downloadJob.updateMany({
    where: { id: { in: ids }, status: { in: ['queued', 'paused'] } },
    data: { status: 'canceled', finishedAt: new Date() },
  })
  const active = await prisma.downloadJob.findMany({
    where: { id: { in: ids }, status: { in: ['resolving', 'downloading'] } },
    select: { id: true },
  })
  for (const job of active) cancelJob(job.id)
  return { updated: result.count, active: active.map((job) => job.id) }
}

async function tick() {
  if (state.ticking) return
  state.ticking = true
  try {
    const settings = await getSettings()
    // CPU 上限较低时同时压低实际下载并发，避免下载完成后的 ffmpeg 写标签和扫描抢 CPU。
    const max = Math.max(
      1,
      Math.min(settings.maxConcurrent || 2, cpuScanConcurrency(settings.cpuLimitPercent))
    )

    while (state.running.size < max) {
      const job = await claimJob()
      if (!job) break
      state.running.add(job.id)
      void runPipeline(job)
        .catch(async (e) => {
          await prisma.downloadJob
            .update({
              where: { id: job.id },
              data: {
                status: 'failed',
                error: (e instanceof Error ? e.message : String(e)).slice(0, 1200),
                finishedAt: new Date(),
              },
            })
            .catch(() => {})
        })
        .finally(() => {
          state.running.delete(job.id)
          setTimeout(() => void tick(), 100)
        })
    }
  } catch {
    // 数据库暂时不可用等异常，下一轮继续
  } finally {
    state.ticking = false
  }
}

export async function startQueue() {
  if (state.started) return
  state.started = true

  if (state.timer) clearInterval(state.timer)
  state.timer = setInterval(() => void tick(), 1500)
  void tick()
}

export function wakeQueue() {
  setTimeout(() => void tick(), 50)
}

export function getQueueState() {
  return {
    running: [...state.running],
    started: state.started,
  }
}
