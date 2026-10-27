import type { BatchItem, BatchJob } from '@prisma/client'

export type BatchWithItems = BatchJob & { items: BatchItem[] }

export interface BatchDownloadInfo {
  status: string
  progress: number
  bytesDone: number
  bytesTotal: number | null
  error: string | null
}

export function batchToDto(
  batch: BatchWithItems,
  downloads: Map<string, BatchDownloadInfo> = new Map()
) {
  const items = [...batch.items]
    .sort(
      (a, b) =>
        b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id)
    )
    .map((item) => {
      const download = item.downloadJobId ? downloads.get(item.downloadJobId) : undefined
      return {
      id: item.id,
      line: item.line,
      status: item.status,
      platform: item.platform,
      songId: item.songId,
      title: item.title,
      artist: item.artist,
      album: item.album,
      coverUrl: item.coverUrl,
      downloadJobId: item.downloadJobId,
      downloadStatus: download?.status || null,
      downloadProgress:
        download?.status === 'completed' ? 100 : Math.max(0, download?.progress || 0),
      downloadBytesDone: download?.bytesDone || 0,
      downloadBytesTotal: download?.bytesTotal ?? null,
      downloadError: download?.error || null,
      selectionReason: item.selectionReason,
      aiUsed: item.aiUsed,
      error: item.error,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    }
  })

  const downloadable = items.filter((item) => item.downloadJobId)
  const downloadCompleted = downloadable.filter(
    (item) => item.downloadStatus === 'completed'
  ).length
  const downloadFailed = downloadable.filter(
    (item) => item.downloadStatus === 'failed' || item.downloadStatus === 'canceled'
  ).length
  const units = downloadable.reduce((sum, item) => {
    if (item.downloadStatus === 'completed') return sum + 1
    if (
      item.downloadStatus &&
      ['queued', 'resolving', 'downloading', 'paused'].includes(item.downloadStatus)
    ) {
      return sum + Math.max(0, Math.min(100, item.downloadProgress)) / 100
    }
    // 失败/取消不计入下载进度，避免“下载数量少但进度条先满”。
    return sum
  }, 0)
  const downloadProgress = batch.total
    ? Math.round((units / batch.total) * 100)
    : 0

  return {
    id: batch.id,
    status: batch.status,
    quality: batch.quality,
    total: batch.total,
    processed: batch.processed,
    succeeded: batch.succeeded,
    failed: batch.failed,
    downloadCompleted,
    downloadFailed,
    downloadTotal: downloadable.length,
    downloadProgress,
    error: batch.error,
    createdAt: batch.createdAt.toISOString(),
    startedAt: batch.startedAt?.toISOString() || null,
    finishedAt: batch.finishedAt?.toISOString() || null,
    items,
  }
}
