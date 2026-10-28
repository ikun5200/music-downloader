'use client'

import { useCallback, useEffect, useState } from 'react'
import { Clock3, Layers, Loader2, Pause, Play, RotateCcw, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { BatchItemRow } from '@/components/batch-item-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { BatchDto } from '@/lib/batch/types'

const BUSY = new Set(['queued', 'running', 'paused'])
const RUNNING = new Set(['queued', 'running'])

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '服务器处理中',
  paused: '已暂停',
  completed: '选版完成',
  failed: '失败',
  canceled: '已取消',
}

function statusTone(status: string): 'neutral' | 'violet' | 'green' | 'red' | 'amber' {
  if (status === 'completed') return 'green'
  if (status === 'failed') return 'red'
  if (status === 'canceled' || status === 'paused') return 'amber'
  if (status === 'running') return 'violet'
  return 'neutral'
}

function isDownloading(batch: BatchDto) {
  return (
    batch.downloadTotal > 0 &&
    batch.downloadCompleted + batch.downloadFailed < batch.downloadTotal
  )
}

export function BatchHistory() {
  const [batches, setBatches] = useState<BatchDto[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/batches?limit=8', { cache: 'no-store' })
      const json = await res.json()
      if (res.ok && json.code === 0) setBatches(json.data as BatchDto[])
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const hasLive = batches.some(
    (batch) => BUSY.has(batch.status) || (batch.status === 'completed' && isDownloading(batch))
  )
  useEffect(() => {
    if (!hasLive) return
    const timer = setInterval(() => void load(), 2500)
    return () => clearInterval(timer)
  }, [hasLive, load])

  async function control(batch: BatchDto, action: 'pause' | 'resume') {
    if (busy) return
    setBusy(batch.id)
    try {
      const res = await fetch(`/api/batches/${batch.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '操作失败')
      toast.success(action === 'pause' ? '已暂停批量任务' : '已继续批量任务')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function remove(batch: BatchDto) {
    if (busy) return
    const active =
      BUSY.has(batch.status) || (batch.status === 'completed' && isDownloading(batch))
    if (
      !window.confirm(
        active
          ? '取消这个批量任务？排队中和正在下载的任务都会被取消。'
          : '删除这条批量任务记录？已下载的文件不会删除。'
      )
    ) {
      return
    }
    setBusy(batch.id)
    try {
      const res = await fetch(`/api/batches/${batch.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '操作失败')
      toast.success(active ? '已取消批量任务' : '已删除批量记录')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function retryFailed(batch: BatchDto) {
    if (busy) return
    const selectionFailed = batch.items.filter((item) => item.status === 'failed').length
    const downloadFailed = batch.items.filter(
      (item) => item.status === 'queued' && item.downloadStatus === 'failed'
    ).length
    if (
      !window.confirm(
        `重新跑完整流程？会重新搜索、AI 选版并下载：选版失败 ${selectionFailed} 首，下载失败 ${downloadFailed} 首。`
      )
    ) {
      return
    }
    setBusy(batch.id)
    try {
      const res = await fetch(`/api/batches/${batch.id}/retry`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '操作失败')
      const data = json.data as { retried?: number; note?: string }
      if (!data.retried) {
        toast.info(data.note || '没有可重试的失败项')
      } else {
        toast.success(`已重新排队 ${data.retried} 首`, {
          description: '会重新搜索、选版并下载，旧失败记录保留在下载历史里。',
        })
      }
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (!batches.length) return null

  return (
    <section className="mt-6">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] font-medium text-white/70">
        <Layers className="h-4 w-4 text-violet-300/70" /> 批量任务
        <Badge tone={hasLive ? 'violet' : 'neutral'}>{batches.length}</Badge>
        <span className="text-[10.5px] font-normal text-white/25">
          服务器后台执行，关闭浏览器也会继续
        </span>
      </div>

      <div className="space-y-2">
        {batches.map((batch) => {
          const downloading = isDownloading(batch)
          const active = BUSY.has(batch.status) || (batch.status === 'completed' && downloading)
          const percent = batch.total
            ? Math.min(100, (batch.processed / batch.total) * 100)
            : 0
          const isBusy = busy === batch.id
          const retryable = batch.items.filter(
            (item) =>
              item.status === 'failed' ||
              (item.status === 'queued' && item.downloadStatus === 'failed')
          ).length
          const canRetry =
            retryable > 0 &&
            !downloading &&
            ['completed', 'failed'].includes(batch.status)
          return (
            <div
              key={batch.id}
              className="rounded-xl border border-white/[0.06] bg-white/[0.022] p-3.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(batch.status)}>
                  {STATUS_LABEL[batch.status] || batch.status}
                </Badge>
                <span className="text-[11.5px] text-white/55">
                  选版 {batch.processed}/{batch.total}
                </span>
                <span className="text-[11.5px] text-white/55">
                  下载 {batch.downloadCompleted}/{batch.total}
                </span>
                {downloading && batch.status !== 'paused' ? (
                  <span className="text-[11px] text-cyan-300/70">下载中</span>
                ) : null}
                {batch.failed ? (
                  <span className="text-[11px] text-red-300/70">选版失败 {batch.failed}</span>
                ) : null}
                {batch.downloadFailed ? (
                  <span className="text-[11px] text-red-300/70">
                    下载失败 {batch.downloadFailed}
                  </span>
                ) : null}
                {batch.quality ? (
                  <span className="text-[11px] text-white/25">音质 {batch.quality}</span>
                ) : null}
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-white/20">
                  <Clock3 className="h-3 w-3" />
                  {new Date(batch.createdAt).toLocaleString('zh-CN', { hour12: false })}
                </span>
                <div className="flex items-center gap-1.5">
                  {RUNNING.has(batch.status) || (batch.status === 'completed' && downloading) ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isBusy}
                      onClick={() => void control(batch, 'pause')}
                      className="shrink-0 whitespace-nowrap"
                    >
                      {isBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Pause className="h-3.5 w-3.5" />
                      )}
                      暂停
                    </Button>
                  ) : null}
                  {batch.status === 'paused' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isBusy}
                      onClick={() => void control(batch, 'resume')}
                      className="shrink-0 whitespace-nowrap"
                    >
                      {isBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      继续
                    </Button>
                  ) : null}
                  {canRetry ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isBusy}
                      onClick={() => void retryFailed(batch)}
                      className="shrink-0 whitespace-nowrap"
                      title="重新搜索、选版并下载选版失败和下载失败的条目"
                    >
                      {isBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      重试失败项 {retryable}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isBusy}
                    onClick={() => void remove(batch)}
                    className="shrink-0 whitespace-nowrap"
                    title={active ? '取消批量任务' : '删除批量记录'}
                  >
                    {isBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : active ? (
                      <X className="h-3.5 w-3.5" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    {active ? '取消' : '删除记录'}
                  </Button>
                </div>
              </div>

              <div className="mt-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-7 shrink-0 text-[9.5px] text-white/25">选版</span>
                  <Progress value={percent} className="h-1" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-7 shrink-0 text-[9.5px] text-white/25">下载</span>
                  <Progress
                    value={batch.downloadProgress}
                    className="h-1"
                    tone={
                      batch.status === 'failed' ||
                      (batch.downloadFailed > 0 && !downloading)
                        ? 'red'
                        : 'cyan'
                    }
                  />
                </div>
              </div>

              {batch.error ? (
                <div className="mt-2 truncate text-[10.5px] text-red-300/60" title={batch.error}>
                  {batch.error}
                </div>
              ) : null}

              <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">
                {batch.items.map((item) => (
                  <BatchItemRow key={item.id} item={item} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
