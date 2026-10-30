import fs from 'fs/promises'
import type { LibraryTask } from '@prisma/client'
import { prisma } from '../db'
import { getAiConfig, getDownloadDir, getSettings } from '../settings'
import { mapLimit, scanLibrary } from './scan'
import { auditLibrary, lyricsHasHeader } from './audit'
import { findDuplicates } from './duplicates'
import { findAlbumMerges } from './albums'
import { applyLyricsToFile, lyricsIssueCodes, toLyricsItem } from './lyrics'
import { applyCoverToFile, toCoverItem } from './covers'
import type {
  AlbumResult,
  AuditResult,
  CoverResult,
  DuplicateResult,
  LibraryFile,
  LibraryJobRef,
  LibraryTaskType,
  LyricsResult,
  LyricsWorkflowItem,
} from './types'

export interface LibraryTaskOptions {
  apply?: boolean
  paths?: string[]
  checkCover?: boolean
}

interface RunningState {
  types: Set<string>
}

const globalForLibrary = globalThis as unknown as { __mdLibraryRunning?: RunningState }
const state: RunningState =
  globalForLibrary.__mdLibraryRunning ||
  (globalForLibrary.__mdLibraryRunning = { types: new Set() })

const TYPE_LABELS: Record<LibraryTaskType, string> = {
  audit: '完整性巡检',
  duplicates: '重复检测',
  albums: '专辑合并分析',
  lyrics: '歌词工作流',
  covers: '封面工作流',
}

function isInstrumental(file: LibraryFile): boolean {
  return /(伴奏|纯音乐|instrumental|karaoke|ktv|消音|钢琴版|吉他版)/i.test(
    `${file.title} ${file.album}`
  )
}

function lyricsTargets(files: LibraryFile[]): LibraryFile[] {
  return files.filter((file) => {
    if (isInstrumental(file)) return false
    if (!file.hasLyrics) return true
    const codes = lyricsIssueCodes(file)
    if (codes.length) return true
    return lyricsHasHeader(file.lyrics)
  })
}

function coverTargets(files: LibraryFile[]): LibraryFile[] {
  return files.filter(
    (file) =>
      !file.hasCover ||
      file.coverPlaceholder ||
      (file.coverWidth != null && file.coverHeight != null && Math.min(file.coverWidth, file.coverHeight) < 300)
  )
}

function lyricsTargetNote(file: LibraryFile): string {
  const notes: string[] = []
  if (!file.hasLyrics) notes.push('没有歌词')
  if (file.hasLyrics && lyricsIssueCodes(file).includes('lyrics_mojibake')) notes.push('歌词乱码')
  if (file.hasLyrics && !file.syncedLyrics) notes.push('歌词无时间轴')
  if (file.hasLyrics && lyricsIssueCodes(file).includes('lyrics_traditional')) notes.push('歌词为繁体')
  if (file.hasLyrics && lyricsHasHeader(file.lyrics)) notes.push('歌词开头有制作信息')
  return notes.join('、') || '待处理'
}

function coverTargetNote(file: LibraryFile): string {
  if (!file.hasCover) return '没有封面'
  if (file.coverPlaceholder) return '封面是占位图'
  return '封面分辨率偏低'
}

async function updateTask(
  id: string,
  data: {
    status?: string
    total?: number
    processed?: number
    progress?: number
    summary?: string | null
    result?: string | null
    error?: string | null
    startedAt?: Date | null
    finishedAt?: Date | null
  }
): Promise<void> {
  await prisma.libraryTask.update({ where: { id }, data }).catch(() => {})
}

function progressReporter(taskId: string, baseProcessed = 0) {
  let lastAt = 0
  let lastProcessed = -1
  return (done: number, total: number) => {
    const processed = baseProcessed + done
    const overall = baseProcessed + total
    const now = Date.now()
    if (done !== total && now - lastAt < 1200 && processed - lastProcessed < 8) return
    lastAt = now
    lastProcessed = processed
    void updateTask(taskId, {
      total: overall,
      processed,
      progress: overall ? Math.round((processed / overall) * 100) : 0,
    })
  }
}

async function loadJobs(): Promise<LibraryJobRef[]> {
  const jobs = await prisma.downloadJob.findMany({
    where: { filePath: { not: null } },
    select: {
      id: true,
      title: true,
      artist: true,
      album: true,
      metadataTitle: true,
      metadataArtist: true,
      metadataAlbum: true,
      filePath: true,
      status: true,
      requestedQuality: true,
      actualQuality: true,
      qualityVerdict: true,
    },
  })
  return jobs
}

async function runTask(
  taskId: string,
  type: LibraryTaskType,
  options: LibraryTaskOptions
): Promise<void> {
  const startedAt = Date.now()
  try {
    await updateTask(taskId, { status: 'running', startedAt: new Date(), progress: 0 })
    const root = getDownloadDir()
    await fs.access(root)
    const settings = await getSettings()
    const jobs = await loadJobs()
    const checkCover =
      options.checkCover ?? (type === 'audit' || type === 'covers')

    const scanProgress = progressReporter(taskId)
    const files = await scanLibrary(root, {
      checkCover,
      concurrency: 4,
      onProgress: scanProgress,
    })

    if (type === 'audit') {
      const result: AuditResult = auditLibrary(files, jobs)
      const summary = `巡检 ${result.summary.totalFiles} 个文件：${result.summary.errorCount} 个错误、${result.summary.warnCount} 个警告、${result.summary.infoCount} 个提示；${result.missingFiles.length} 条下载记录找不到文件`
      await updateTask(taskId, {
        status: 'completed',
        total: files.length,
        processed: files.length,
        progress: 100,
        summary,
        result: JSON.stringify(result),
        finishedAt: new Date(),
      })
      return
    }

    if (type === 'duplicates') {
      const result: DuplicateResult = findDuplicates(files)
      const summary = `扫描 ${result.summary.totalFiles} 个文件：${result.summary.groups} 组重复，可清理 ${result.summary.removableFiles} 个文件（${Math.round(
        result.summary.removableBytes / 1024 / 1024
      )} MB）`
      await updateTask(taskId, {
        status: 'completed',
        total: files.length,
        processed: files.length,
        progress: 100,
        summary,
        result: JSON.stringify(result),
        finishedAt: new Date(),
      })
      return
    }

    if (type === 'albums') {
      const result: AlbumResult = findAlbumMerges(files)
      const summary = `扫描 ${result.summary.totalFiles} 个文件：${result.summary.groups} 组专辑可合并，涉及 ${result.summary.mergeableFiles} 个文件`
      await updateTask(taskId, {
        status: 'completed',
        total: files.length,
        processed: files.length,
        progress: 100,
        summary,
        result: JSON.stringify(result),
        finishedAt: new Date(),
      })
      return
    }

    const pathFilter = options.paths?.length ? new Set(options.paths) : null
    const targets = (type === 'lyrics' ? lyricsTargets(files) : coverTargets(files)).filter(
      (file) => !pathFilter || pathFilter.has(file.path)
    )
    const total = files.length + (options.apply ? targets.length : 0)

    if (!options.apply) {
      const items: Array<LyricsWorkflowItem | ReturnType<typeof toCoverItem>> = targets.map(
        (file) =>
          type === 'lyrics'
            ? {
                path: file.path,
                title: file.title,
                artist: file.artist,
                album: file.album,
                status: 'skipped',
                note: `待修复：${lyricsTargetNote(file)}`,
              }
            : {
                path: file.path,
                title: file.title,
                artist: file.artist,
                album: file.album,
                status: 'skipped',
                note: `待修复：${coverTargetNote(file)}`,
              }
      )
      const label = type === 'lyrics' ? '歌词' : '封面'
      const summary = `扫描 ${files.length} 个文件：${targets.length} 个文件需要修复${label}（仅扫描，未写入）`
      const result =
        type === 'lyrics'
          ? ({
              summary: {
                totalFiles: files.length,
                totalBytes: files.reduce((sum, file) => sum + file.size, 0),
                elapsedMs: Date.now() - startedAt,
                errorCount: 0,
                warnCount: 0,
                infoCount: targets.length,
                byCode: {},
                checkedAt: new Date().toISOString(),
                targets: targets.length,
                fixed: 0,
                notFound: 0,
                failed: 0,
              },
              items,
            } satisfies LyricsResult)
          : ({
              summary: {
                totalFiles: files.length,
                totalBytes: files.reduce((sum, file) => sum + file.size, 0),
                elapsedMs: Date.now() - startedAt,
                errorCount: 0,
                warnCount: 0,
                infoCount: targets.length,
                byCode: {},
                checkedAt: new Date().toISOString(),
                targets: targets.length,
                fixed: 0,
                notFound: 0,
                failed: 0,
              },
              items,
            } satisfies CoverResult)
      await updateTask(taskId, {
        status: 'completed',
        total: files.length,
        processed: files.length,
        progress: 100,
        summary,
        result: JSON.stringify(result),
        finishedAt: new Date(),
      })
      return
    }

    await updateTask(taskId, {
      total,
      processed: files.length,
      progress: total ? Math.round((files.length / total) * 100) : 0,
    })

    const aiConfig = await getAiConfig().catch(() => null)
    const applyProgress = progressReporter(taskId, files.length)
    const results =
      type === 'lyrics'
        ? await mapLimit(
            targets,
            2,
            async (file) => {
              const applied = await applyLyricsToFile(root, file, settings, aiConfig)
              return toLyricsItem(file, applied)
            },
            applyProgress
          )
        : await mapLimit(
            targets,
            2,
            async (file) => {
              const applied = await applyCoverToFile(root, file, settings)
              return toCoverItem(file, applied)
            },
            applyProgress
          )

    const fixed = results.filter((item) => item.status === 'fixed').length
    const notFound = results.filter((item) => item.status === 'not_found').length
    const failed = results.filter((item) => item.status === 'failed').length
    const skipped = results.filter((item) => item.status === 'skipped').length
    const label = type === 'lyrics' ? '歌词' : '封面'
    const summary = `处理 ${targets.length} 个文件：${fixed} 个已修复、${notFound} 个未找到、${failed} 个失败、${skipped} 个跳过（${label}）`
    const result =
      type === 'lyrics'
        ? ({
            summary: {
              totalFiles: files.length,
              totalBytes: files.reduce((sum, file) => sum + file.size, 0),
              elapsedMs: Date.now() - startedAt,
              errorCount: failed,
              warnCount: notFound,
              infoCount: skipped,
              byCode: {},
              checkedAt: new Date().toISOString(),
              targets: targets.length,
              fixed,
              notFound,
              failed,
            },
            items: results,
          } satisfies LyricsResult)
        : ({
            summary: {
              totalFiles: files.length,
              totalBytes: files.reduce((sum, file) => sum + file.size, 0),
              elapsedMs: Date.now() - startedAt,
              errorCount: failed,
              warnCount: notFound,
              infoCount: skipped,
              byCode: {},
              checkedAt: new Date().toISOString(),
              targets: targets.length,
              fixed,
              notFound,
              failed,
            },
            items: results,
          } satisfies CoverResult)

    await updateTask(taskId, {
      status: 'completed',
      total,
      processed: total,
      progress: 100,
      summary,
      result: JSON.stringify(result),
      finishedAt: new Date(),
    })
  } catch (error) {
    await updateTask(taskId, {
      status: 'failed',
      error: (error instanceof Error ? error.message : String(error)).slice(0, 1200),
      finishedAt: new Date(),
    })
  } finally {
    state.types.delete(type)
  }
}

async function cleanupStaleTasks(): Promise<void> {
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000)
  await prisma.libraryTask
    .updateMany({
      where: { status: { in: ['queued', 'running'] }, createdAt: { lt: cutoff } },
      data: { status: 'failed', error: '任务超时或服务重启，已标记失败', finishedAt: new Date() },
    })
    .catch(() => {})
}

export async function startLibraryTask(
  type: LibraryTaskType,
  options: LibraryTaskOptions = {}
): Promise<{ task: LibraryTask; existing: boolean }> {
  await cleanupStaleTasks()
  const existing = await prisma.libraryTask.findFirst({
    where: { type, status: { in: ['queued', 'running'] } },
    orderBy: { createdAt: 'desc' },
  })
  if (existing) return { task: existing, existing: true }
  if (state.types.has(type)) {
    // 内存里标记为运行但数据库没有对应任务，通常是上一次任务收尾的瞬间。
    // 清掉残留标记后继续创建，避免返回一个永远不会执行的幽灵任务。
    state.types.delete(type)
  }

  const task = await prisma.libraryTask.create({
    data: {
      type,
      status: 'queued',
      options: JSON.stringify(options),
      summary: `${TYPE_LABELS[type]}已排队`,
    },
  })
  state.types.add(type)
  void runTask(task.id, type, options)
  return { task, existing: false }
}

export function getTaskTypeLabel(type: string): string {
  return TYPE_LABELS[type as LibraryTaskType] || type
}
