import { PLATFORMS, type Platform } from '../constants'
import { prisma, withDbRetry } from '../db'
import { createDownloadJob } from '../download/create-job'
import { cancelDownloadJobs, pauseDownloadJobs, resumeDownloadJobs } from '../download/queue'
import { searchAll } from '../search'
import { getAiConfig, getSettings } from '../settings'
import { sourceManager } from '../sources/manager'
import { selectBestSong, type PlatformInfo } from './selector'
import { checkVersionBeforeDownload } from '../ai/version-guard'

interface BatchQueueState {
  started: boolean
  ticking: boolean
  timer: NodeJS.Timeout | null
}

const globalForBatch = globalThis as unknown as { __mdBatchQueue?: BatchQueueState }
const state: BatchQueueState =
  globalForBatch.__mdBatchQueue ||
  (globalForBatch.__mdBatchQueue = { started: false, ticking: false, timer: null })

async function cancelPending(batchId: string) {
  await prisma.batchItem.updateMany({
    where: { batchId, status: { in: ['pending', 'searching'] } },
    data: { status: 'canceled' },
  })
  await prisma.batchJob.update({
    where: { id: batchId },
    data: { status: 'canceled', finishedAt: new Date() },
  })
}

async function batchStatus(batchId: string): Promise<string | null> {
  const batch = await withDbRetry(() =>
    prisma.batchJob.findUnique({
      where: { id: batchId },
      select: { status: true },
    })
  )
  return batch?.status || null
}

async function runBatch(batchId: string) {
  const started = await prisma.batchJob.updateMany({
    where: { id: batchId, status: 'queued' },
    data: { status: 'running', startedAt: new Date(), error: null },
  })
  if (!started.count) return

  const batch = await withDbRetry(() =>
    prisma.batchJob.findUnique({
      where: { id: batchId },
      include: { items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    })
  )
  if (!batch) return
  if (batch.status !== 'running') return

  // 续跑时把该批次下已暂停的下载任务重新排队，覆盖“暂停后立刻继续”的竞态。
  const existingJobIds = batch.items
    .map((item) => item.downloadJobId)
    .filter((jobId): jobId is string => !!jobId)
  if (existingJobIds.length) await resumeDownloadJobs(existingJobIds)

  const [manifest, aiConfig, settings] = await Promise.all([
    sourceManager.getManifest().catch(() => []),
    getAiConfig().catch(() => null),
    getSettings().catch(() => null),
  ])
  const platforms =
    settings?.platformOrder?.length ? settings.platformOrder : PLATFORMS

  const platformInfo = new Map<Platform, PlatformInfo>()
  for (const [order, platform] of platforms.entries()) {
    const channels = manifest.filter((source) => source.platforms.includes(platform))
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

  for (const item of batch.items) {
    if (item.status !== 'pending') continue

    const current = await batchStatus(batchId)
    if (current === 'paused') return
    if (current === 'canceled') {
      await cancelPending(batchId)
      return
    }

    await prisma.batchItem.update({
      where: { id: item.id },
      data: { status: 'searching', error: null },
    })

    try {
      const results = await searchAll(item.line, platforms)
      const selection = await selectBestSong(item.line, results, platformInfo, {
        quality: batch.quality,
        aiConfig,
      })

      // 选版 AI 之后再复核一次版本/语言，防止 AI 或规则把 Live/伴奏/纯音乐选成原版。
      const version = await checkVersionBeforeDownload({
        requestLine: item.line,
        title: selection.song.title,
        album: selection.song.album,
        candidate: {
          title: selection.song.title,
          album: selection.song.album,
          artist: selection.song.artist,
        },
        aiConfig,
        aiEnabled: settings?.aiVersionGuardEnabled ?? true,
      })
      if (!version.ok) {
        throw new Error(`版本校验未通过：${version.reason || '候选版本不符'}`)
      }

      const afterSearch = await batchStatus(batchId)
      if (afterSearch === 'paused') {
        await prisma.batchItem.update({ where: { id: item.id }, data: { status: 'pending' } })
        return
      }
      if (afterSearch === 'canceled') {
        await prisma.batchItem.update({ where: { id: item.id }, data: { status: 'canceled' } })
        await cancelPending(batchId)
        return
      }

      const job = await createDownloadJob({
        platform: selection.platform,
        musicInfo: selection.song.musicInfo,
        quality: batch.quality,
        title: selection.song.title,
        artist: selection.song.artist,
        album: selection.song.album,
        coverUrl: selection.song.coverUrl,
        requestLine: item.line,
      })

      await prisma.$transaction([
        prisma.batchItem.update({
          where: { id: item.id },
          data: {
            status: 'queued',
            platform: selection.platform,
            songId: String(selection.song.id),
            title: job.title,
            artist: job.artist,
            album: job.album,
            coverUrl: job.coverUrl,
            musicInfo: JSON.stringify(selection.song.musicInfo),
            downloadJobId: job.id,
            selectionReason: version.aiUsed ? `${selection.reason}；AI 版本复核通过` : selection.reason,
            aiUsed: selection.aiUsed,
            error: null,
          },
        }),
        prisma.batchJob.update({
          where: { id: batchId },
          data: { processed: { increment: 1 }, succeeded: { increment: 1 } },
        }),
      ])

      const afterCreate = await batchStatus(batchId)
      if (afterCreate === 'paused') {
        await pauseDownloadJobs([job.id])
        return
      }
      if (afterCreate === 'canceled') {
        await cancelDownloadJobs([job.id])
        await prisma.batchItem.update({ where: { id: item.id }, data: { status: 'canceled' } })
        await cancelPending(batchId)
        return
      }
    } catch (e) {
      const status = await batchStatus(batchId).catch(() => null)
      if (status === 'paused') {
        await prisma.batchItem
          .update({ where: { id: item.id }, data: { status: 'pending' } })
          .catch(() => {})
        return
      }
      if (status === 'canceled') {
        await prisma.batchItem
          .update({ where: { id: item.id }, data: { status: 'canceled' } })
          .catch(() => {})
        await cancelPending(batchId).catch(() => {})
        return
      }
      const message = e instanceof Error ? e.message : String(e)
      await prisma.$transaction([
        prisma.batchItem.update({
          where: { id: item.id },
          data: { status: 'failed', error: message.slice(0, 1000) },
        }),
        prisma.batchJob.update({
          where: { id: batchId },
          data: { processed: { increment: 1 }, failed: { increment: 1 } },
        }),
      ])
    }

    // 给免费搜索接口留一点间隔，避免连续大批量时被限流。
    await new Promise((resolve) => setTimeout(resolve, 400))
  }

  const fresh = await batchStatus(batchId)
  if (fresh === 'canceled' || fresh === 'paused') return
  await prisma.batchJob.update({
    where: { id: batchId },
    data: { status: 'completed', finishedAt: new Date() },
  })
}

async function tick() {
  if (state.ticking) return
  state.ticking = true
  try {
    while (true) {
      const batch = await withDbRetry(() =>
        prisma.batchJob.findFirst({
          where: { status: 'queued' },
          orderBy: { createdAt: 'asc' },
        })
      )
      if (!batch) break
      try {
        await runBatch(batch.id)
      } catch (e) {
        await prisma.batchJob
          .update({
            where: { id: batch.id },
            data: {
              status: 'failed',
              error: (e instanceof Error ? e.message : String(e)).slice(0, 1000),
              finishedAt: new Date(),
            },
          })
          .catch(() => {})
      }
    }
  } catch {
    // 数据库暂时不可用等异常，下一轮继续
  } finally {
    state.ticking = false
  }
}

export async function startBatchQueue() {
  if (state.started) return
  state.started = true

  if (state.timer) clearInterval(state.timer)
  state.timer = setInterval(() => void tick(), 2000)
  void tick()
}

export function wakeBatchQueue() {
  setTimeout(() => void tick(), 50)
}
