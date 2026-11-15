import { prisma } from '../db'
import { refreshDownloadedIndex } from './index'

const DAY_MS = 24 * 60 * 60 * 1000
const CHECK_INTERVAL_MS = 60 * 60 * 1000

interface SchedulerState {
  started: boolean
  timer: NodeJS.Timeout | null
}

const globalForScheduler = globalThis as unknown as {
  __mdDownloadedIndexScheduler?: SchedulerState
}

const state: SchedulerState =
  globalForScheduler.__mdDownloadedIndexScheduler ||
  (globalForScheduler.__mdDownloadedIndexScheduler = { started: false, timer: null })

async function lastScanAt(): Promise<number> {
  const row = await prisma.setting.findUnique({
    where: { key: 'downloadedIndexLastScanAt' },
  })
  const value = row ? Date.parse(row.value) : 0
  return Number.isFinite(value) ? value : 0
}

async function maybeRefresh() {
  try {
    const last = await lastScanAt()
    if (last && Date.now() - last < DAY_MS) return
    const result = await refreshDownloadedIndex()
    console.log(
      `[downloaded] 目录索引已更新：${result.total} 个文件，新增 ${result.added}，更新 ${result.updated}，删除 ${result.removed}，用时 ${result.elapsedMs}ms`
    )
  } catch (error) {
    console.warn('[downloaded] 自动更新目录索引失败:', error)
  }
}

/**
 * 启动后检查一次，之后每小时检查是否已满 24 小时。
 * 用持久化的 downloadedIndexLastScanAt 去重，进程重启不会重复全量扫描。
 */
export function startDownloadedIndexScheduler() {
  if (state.started) return
  state.started = true

  // 等下载/批量队列先恢复，避免启动瞬间和任务恢复抢 SQLite。
  setTimeout(() => void maybeRefresh(), 8_000).unref?.()
  if (state.timer) clearInterval(state.timer)
  state.timer = setInterval(() => void maybeRefresh(), CHECK_INTERVAL_MS)
  state.timer.unref?.()
}
