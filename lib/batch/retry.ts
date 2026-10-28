import type { PrismaClient } from '@prisma/client'
import { prisma } from '../db'
import { isVersionMismatch } from '../version-intent'

export interface RetryBatchResult {
  status: 'ok' | 'not_found' | 'busy' | 'not_retryable' | 'none'
  retried: number
  selectionFailed: number
  downloadFailed: number
  versionMismatch: number
}

export interface RetryItem {
  id: string
  status: string
  downloadJobId: string | null
  line: string
  title: string | null
  album: string | null
}

export function isRetryableBatchItem(
  item: RetryItem,
  jobStatus: Map<string, string>
): boolean {
  // 选版失败，或批次异常中断后卡在 searching 的条目。
  if (item.status === 'failed' || item.status === 'searching') return true
  // 选版成功但下载任务失败；任务记录丢失也视为可重试。
  if (item.status === 'queued' && item.downloadJobId) {
    const status = jobStatus.get(item.downloadJobId)
    return !status || status === 'failed'
  }
  return false
}

export function recountBatchItems(items: Array<{ status: string }>) {
  const succeeded = items.filter((item) => item.status === 'queued').length
  const failed = items.filter((item) => item.status === 'failed').length
  return { processed: succeeded + failed, succeeded, failed }
}

/**
 * 把选版失败、下载失败的批量条目重置为 pending，并重新排队整个批次。
 * 旧下载任务保留在下载历史里，不删除；重新跑的是搜索/选版/下载完整流程。
 */
export async function retryFailedBatchItems(
  batchId: string,
  db: PrismaClient = prisma
): Promise<RetryBatchResult> {
  const batch = await db.batchJob.findUnique({
    where: { id: batchId },
    include: {
      items: {
        select: {
          id: true,
          status: true,
          downloadJobId: true,
          line: true,
          title: true,
          album: true,
        },
      },
    },
  })
  if (!batch) {
    return { status: 'not_found', retried: 0, selectionFailed: 0, downloadFailed: 0, versionMismatch: 0 }
  }
  if (['queued', 'running', 'paused'].includes(batch.status)) {
    return { status: 'busy', retried: 0, selectionFailed: 0, downloadFailed: 0, versionMismatch: 0 }
  }
  if (!['completed', 'failed'].includes(batch.status)) {
    return { status: 'not_retryable', retried: 0, selectionFailed: 0, downloadFailed: 0, versionMismatch: 0 }
  }

  const jobIds = [
    ...new Set(
      batch.items
        .map((item) => item.downloadJobId)
        .filter((jobId): jobId is string => !!jobId)
    ),
  ]
  const jobs = jobIds.length
    ? await db.downloadJob.findMany({
        where: { id: { in: jobIds } },
        select: { id: true, status: true },
      })
    : []
  const jobStatus = new Map(jobs.map((job) => [job.id, job.status]))
  const statusRetry = batch.items.filter((item) => isRetryableBatchItem(item, jobStatus))
  const statusRetryIds = new Set(statusRetry.map((item) => item.id))
  // 成功下载但版本选错的条目（例如点名单曲要 Live，却下了录音室版）。
  const versionRetry = batch.items.filter(
    (item) =>
      !statusRetryIds.has(item.id) &&
      isVersionMismatch(item.line, item.title, item.album)
  )
  const retryItems = [
    ...new Map([...statusRetry, ...versionRetry].map((item) => [item.id, item])).values(),
  ]
  if (!retryItems.length) {
    return { status: 'none', retried: 0, selectionFailed: 0, downloadFailed: 0, versionMismatch: 0 }
  }

  const selectionFailed = statusRetry.filter(
    (item) => item.status === 'failed' || item.status === 'searching'
  ).length
  const downloadFailed = statusRetry.length - selectionFailed
  const versionMismatch = versionRetry.length

  await db.$transaction(async (tx) => {
    await tx.batchItem.updateMany({
      where: { id: { in: retryItems.map((item) => item.id) } },
      data: {
        status: 'pending',
        platform: null,
        songId: null,
        title: null,
        artist: null,
        album: null,
        coverUrl: null,
        musicInfo: null,
        downloadJobId: null,
        selectionReason: null,
        aiUsed: false,
        error: null,
      },
    })
    const remaining = await tx.batchItem.findMany({
      where: { batchId },
      select: { status: true },
    })
    const counts = recountBatchItems(remaining)
    await tx.batchJob.update({
      where: { id: batchId },
      data: {
        status: 'queued',
        processed: counts.processed,
        succeeded: counts.succeeded,
        failed: counts.failed,
        finishedAt: null,
        error: null,
      },
    })
  })

  return {
    status: 'ok',
    retried: retryItems.length,
    selectionFailed,
    downloadFailed,
    versionMismatch,
  }
}
