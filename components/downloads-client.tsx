'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { BatchHistory } from '@/components/batch-history'
import { PlatformBadge } from '@/components/platform-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { PLATFORM_NAMES, QUALITY_NAMES, type Platform } from '@/lib/constants'
import { cn, formatBytes } from '@/lib/utils'

interface JobDto {
  id: string
  platform: Platform
  songId: string
  title: string
  artist: string
  album?: string | null
  coverUrl?: string | null
  requestedQuality?: string | null
  actualQuality?: string | null
  qualityVerdict?: string | null
  channelId?: string | null
  channelName?: string | null
  status: string
  progress: number
  bytesDone: number
  bytesTotal?: number | null
  filePath?: string | null
  absolutePath?: string | null
  urlHost?: string | null
  attempts: Array<{ sourceName?: string; quality?: string; error?: string }>
  verified: boolean
  reviewNote?: string | null
  metadataStatus?: string | null
  metadataSource?: string | null
  metadataTitle?: string | null
  metadataArtist?: string | null
  metadataAlbum?: string | null
  metadataNote?: string | null
  metadataAt?: string | null
  error?: string | null
  createdAt: string
  startedAt?: string | null
  finishedAt?: string | null
}

const ACTIVE = new Set(['queued', 'resolving', 'downloading'])

const STATUS: Record<string, { label: string; tone: 'neutral' | 'violet' | 'cyan' | 'green' | 'red' | 'amber' }> = {
  queued: { label: '排队中', tone: 'neutral' },
  resolving: { label: '解析中', tone: 'violet' },
  downloading: { label: '下载中', tone: 'cyan' },
  paused: { label: '已暂停', tone: 'amber' },
  completed: { label: '已完成', tone: 'green' },
  failed: { label: '失败', tone: 'red' },
  canceled: { label: '已取消', tone: 'amber' },
}

const METADATA_SOURCE_SHORT: Record<string, string> = {
  itunes: 'iTunes',
  netease: '网易云',
  kugou: '酷狗',
  kuwo: '酷我',
  qqmusic: 'QQ 音乐',
  lrclib: 'LRCLIB',
  theaudiodb: 'TheAudioDB',
}

function metadataBadge(job: JobDto): {
  label: string
  tone: 'neutral' | 'violet' | 'cyan' | 'green' | 'red' | 'amber'
} | null {
  switch (job.metadataStatus) {
    case 'pending':
    case 'processing':
      return { label: '刮削中', tone: 'violet' }
    case 'success':
      return {
        label: `已刮削 · ${METADATA_SOURCE_SHORT[job.metadataSource || ''] || '元数据'}`,
        tone: 'green',
      }
    case 'partial':
      return { label: '部分刮削', tone: 'amber' }
    case 'not_found':
      return { label: '未找到元数据', tone: 'neutral' }
    case 'failed':
      return { label: '刮削失败', tone: 'red' }
    default:
      return null
  }
}

function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/')
}

const PAGE_SIZE = 100

interface DownloadCursor {
  createdAt: string
  id: string
}

function mergeJobs(prev: JobDto[], incoming: JobDto[]): JobDto[] {
  const map = new Map(prev.map((job) => [job.id, job]))
  for (const job of incoming) map.set(job.id, job)
  return [...map.values()].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
      b.id.localeCompare(a.id)
  )
}

export function DownloadsClient() {
  const [jobs, setJobs] = useState<JobDto[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<DownloadCursor | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/downloads?limit=${PAGE_SIZE}`, { cache: 'no-store' })
      const json = await res.json()
      if (res.ok && json.code === 0) {
        const data = json.data as JobDto[]
        setJobs(data)
        setTotal(typeof json.total === 'number' ? json.total : data.length)
        setHasMore(!!json.hasMore)
        setNextCursor((json.nextCursor as DownloadCursor | null) || null)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !nextCursor) return
    setLoadingMore(true)
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        before: nextCursor.createdAt,
        beforeId: nextCursor.id,
      })
      const res = await fetch(`/api/downloads?${params.toString()}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '加载失败')
      const data = json.data as JobDto[]
      setJobs((prev) => mergeJobs(prev, data))
      if (typeof json.total === 'number') setTotal(json.total)
      setHasMore(!!json.hasMore)
      setNextCursor((json.nextCursor as DownloadCursor | null) || null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingMore(false)
    }
  }, [hasMore, loadingMore, nextCursor])

  useEffect(() => {
    void load()
    const es = new EventSource('/api/downloads/events')
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (Array.isArray(data.jobs)) {
          setJobs((prev) => mergeJobs(prev, data.jobs as JobDto[]))
        }
        if (typeof data.total === 'number') setTotal(data.total)
      } catch {
        // ignore
      }
    }
    es.onerror = () => {
      // EventSource 会自动重连；这里不关闭
    }
    return () => es.close()
  }, [load])

  const active = useMemo(() => jobs.filter((j) => ACTIVE.has(j.status)), [jobs])
  const history = useMemo(() => jobs.filter((j) => !ACTIVE.has(j.status)), [jobs])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const selectableIds = useMemo(() => history.map((j) => j.id), [history])
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))
  const selectedWithFile = useMemo(
    () => history.filter((j) => selected.has(j.id) && j.filePath).length,
    [history, selected]
  )

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleSelectAll = () =>
    setSelected((prev) => (allSelected ? new Set() : new Set(selectableIds)))

  async function action(id: string, kind: 'cancel' | 'retry' | 'delete') {
    if (busy) return
    setBusy(`${kind}:${id}`)
    try {
      const url =
        kind === 'retry' ? `/api/downloads/${id}/retry` : `/api/downloads/${id}`
      const res = await fetch(url, {
        method: kind === 'retry' ? 'POST' : 'DELETE',
      })
      const json = await res.json()
      if (!res.ok || (json.code !== 0 && json.code !== undefined)) {
        throw new Error(json.message || '操作失败')
      }
      if (kind === 'delete') {
        setJobs((prev) => prev.filter((j) => j.id !== id))
        setSelected((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
      if (kind === 'retry') {
        setJobs((prev) =>
          prev.map((j) => (j.id === id ? { ...j, status: 'queued', progress: 0, error: null } : j))
        )
      }
      toast.success(kind === 'retry' ? '已重新排队' : kind === 'cancel' ? '已请求取消' : '已删除记录')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  /** 批量删除：withFile 为 true 时连同已下载文件一起删除（需要管理员会话）。 */
  async function deleteSelected(withFile: boolean) {
    if (busy || !selected.size) return
    const label = withFile
      ? selectedWithFile === selected.size
        ? `删除选中的 ${selected.size} 条记录和对应的 ${selectedWithFile} 个文件？`
        : `删除选中的 ${selected.size} 条记录和其中 ${selectedWithFile} 个已下载文件（其余记录没有文件）？`
      : `删除选中的 ${selected.size} 条记录？已下载的文件会保留。`
    if (!window.confirm(label)) return

    setBusy('batch-delete')
    const ids = [...selected]
    const errors: string[] = []
    let deleted = 0
    try {
      for (const id of ids) {
        try {
          const res = await fetch(`/api/downloads/${id}${withFile ? '?deleteFile=1' : ''}`, {
            method: 'DELETE',
          })
          const json = await res.json()
          if (!res.ok || (json.code !== 0 && json.code !== undefined)) {
            throw new Error(json.message || '删除失败')
          }
          deleted += 1
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e))
        }
      }
      setJobs((prev) => prev.filter((j) => !ids.includes(j.id)))
      setSelected(new Set())
      if (errors.length) {
        toast.warning(`已删除 ${deleted} 条，${errors.length} 条失败`, { description: errors[0] })
      } else {
        toast.success(withFile ? `已删除 ${deleted} 条记录和文件` : `已删除 ${deleted} 条记录`)
      }
    } finally {
      setBusy(null)
    }
  }

  /** 单条删除记录并带文件。 */
  async function deleteOneWithFile(id: string) {
    if (busy) return
    setBusy(`delete:${id}`)
    try {
      const res = await fetch(`/api/downloads/${id}?deleteFile=1`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok || (json.code !== 0 && json.code !== undefined)) {
        throw new Error(json.message || '删除失败')
      }
      setJobs((prev) => prev.filter((j) => j.id !== id))
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      toast.success('已删除记录和文件')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  function JobCard({ job, selectable = false }: { job: JobDto; selectable?: boolean }) {
    const status = STATUS[job.status] || STATUS.queued
    const metaBadge = metadataBadge(job)
    const activeJob = ACTIVE.has(job.status)
    const isBusy = busy?.endsWith(job.id) || busy === 'batch-delete'
    const isSelected = selected.has(job.id)
    return (
      <div
        className={cn(
          'lift rounded-xl border bg-white/[0.022] p-4 transition-colors',
          isSelected
            ? 'border-violet-400/35 bg-violet-500/[0.05]'
            : 'border-white/[0.05] hover:border-white/[0.1] hover:bg-white/[0.035]'
        )}
      >
        <div className="flex items-start gap-3">
          {selectable ? (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggleSelect(job.id)}
              aria-label={`选择 ${job.title}`}
              className="mt-2 h-4 w-4 shrink-0 cursor-pointer accent-violet-500"
            />
          ) : null}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/20 to-cyan-400/15">
            {job.status === 'completed' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-300" />
            ) : job.status === 'failed' ? (
              <XCircle className="h-5 w-5 text-red-300" />
            ) : (
              <Download className="h-5 w-5 text-violet-200" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[13.5px] font-medium text-white/90">{job.title}</span>
              <Badge tone={status.tone}>{status.label}</Badge>
              {job.actualQuality ? (
                <Badge tone="violet">{QUALITY_NAMES[job.actualQuality] || job.actualQuality}</Badge>
              ) : job.requestedQuality ? (
                <Badge tone="neutral">请求 {QUALITY_NAMES[job.requestedQuality] || job.requestedQuality}</Badge>
              ) : (
                <Badge tone="neutral">自动最高</Badge>
              )}
              {job.qualityVerdict === 'downgraded' ? (
                <Badge tone="amber">已降级</Badge>
              ) : null}
              {job.verified ? <Badge tone="green">已校验</Badge> : null}
              {metaBadge ? <Badge tone={metaBadge.tone}>{metaBadge.label}</Badge> : null}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-white/35">
              <PlatformBadge platform={job.platform} showName={false} className="border-0 bg-transparent px-0" />
              <span>{PLATFORM_NAMES[job.platform]}</span>
              <span>·</span>
              <span className="truncate">{job.artist}</span>
              {job.channelName ? (
                <>
                  <span>·</span>
                  <span>渠道 {job.channelName}</span>
                </>
              ) : null}
            </div>

            {activeJob ? (
              <div className="mt-3">
                <Progress
                  value={job.progress}
                  tone={job.status === 'downloading' ? 'cyan' : 'violet'}
                />
                <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-white/30">
                  <span>
                    {job.status === 'queued'
                      ? '等待调度…'
                      : job.status === 'resolving'
                        ? '正在选择渠道并解析链接…'
                        : `${job.progress.toFixed(1)}% · ${formatBytes(job.bytesDone)}${
                            job.bytesTotal ? ` / ${formatBytes(job.bytesTotal)}` : ''
                          }`}
                  </span>
                  <button
                    type="button"
                    onClick={() => void action(job.id, 'cancel')}
                    disabled={isBusy}
                    className="inline-flex items-center gap-1 text-white/35 hover:text-white/70"
                  >
                    <X className="h-3 w-3" /> 取消
                  </button>
                </div>
              </div>
            ) : null}

            {job.status === 'paused' ? (
              <div className="mt-2">
                <Progress value={job.progress} tone="violet" />
                <div className="mt-1.5 text-[10.5px] text-amber-300/60">
                  已暂停 · {job.progress.toFixed(1)}% · {formatBytes(job.bytesDone)}
                  {job.bytesTotal ? ` / ${formatBytes(job.bytesTotal)}` : ''}
                </div>
              </div>
            ) : null}

            {job.error ? (
              <details className="mt-2 text-[11px] text-red-300/70">
                <summary className="inline-block cursor-pointer select-none rounded-md px-1.5 py-0.5 transition-colors hover:bg-red-500/10">错误详情</summary>
                <pre className="mt-1 whitespace-pre-wrap break-words text-[10.5px] leading-5 text-red-200/60">
                  {job.error}
                </pre>
              </details>
            ) : null}

            {job.filePath ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-white/30">
                <span className="min-w-0 break-all">保存到 {job.absolutePath || job.filePath}</span>
                <a
                  href={`/api/files/${encodePath(job.filePath)}`}
                  className="inline-flex items-center gap-1 text-violet-300/70 hover:text-violet-200"
                >
                  <ExternalLink className="h-3 w-3" /> 浏览器下载
                </a>
              </div>
            ) : null}

            {job.reviewNote ? (
              <div className="mt-1 text-[10.5px] text-amber-300/50">备注：{job.reviewNote}</div>
            ) : null}

            {job.metadataNote &&
            job.metadataStatus &&
            !['none', 'disabled'].includes(job.metadataStatus) ? (
              <div
                className={cn(
                  'mt-1 text-[10.5px]',
                  job.metadataStatus === 'failed'
                    ? 'text-red-300/55'
                    : job.metadataStatus === 'not_found'
                      ? 'text-white/25'
                      : 'text-emerald-300/45'
                )}
              >
                元数据：{job.metadataNote}
              </div>
            ) : null}

            {!activeJob ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {(job.status === 'failed' || job.status === 'canceled' || job.status === 'paused') && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void action(job.id, 'retry')}
                    disabled={isBusy}
                  >
                    {job.status === 'paused' ? (
                      <Play className="h-3.5 w-3.5" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    {job.status === 'paused' ? '继续' : '重试'}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void action(job.id, 'delete')}
                  disabled={isBusy}
                  title="只删除这条任务记录，文件保留在音乐目录"
                >
                  <Trash2 className="h-3.5 w-3.5" /> 删除记录
                </Button>
                {job.filePath ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (busy) return
                      if (window.confirm(`删除记录并删除文件「${job.absolutePath || job.filePath}」？（需要管理员登录）`)) {
                        void deleteOneWithFile(job.id)
                      }
                    }}
                    disabled={isBusy}
                    title="删除记录并连同已下载文件一起删除（需要管理员登录）"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-300/80" /> 记录和文件
                  </Button>
                ) : null}
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] whitespace-nowrap text-white/20">
                  <Clock3 className="h-3 w-3" />
                  {new Date(job.createdAt).toLocaleString('zh-CN', { hour12: false })}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">下载队列</h1>
          <p className="mt-1 text-[12px] text-white/35">
            实时查看解析、下载与校验进度。文件会保存到 NAS 的音乐目录。
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> 刷新
        </Button>
      </div>

      <BatchHistory />

      {active.length ? (
        <section className="mt-6">
          <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-white/70">
            进行中
            <Badge tone="violet">{active.length}</Badge>
          </div>
          <div className="space-y-2">
            {active.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] font-medium text-white/70">
          历史记录
          <Badge>{history.length}</Badge>
          {total ? (
            <span className="text-[10.5px] font-normal text-white/25">
              已加载 {jobs.length} / 共 {total} 条
            </span>
          ) : null}
          {history.length ? (
            <>
              <label className="ml-2 inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-normal text-white/45 hover:text-white/75">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="h-3.5 w-3.5 cursor-pointer accent-violet-500"
                />
                全选已加载
              </label>
              {selected.size ? (
                <span className="ml-auto inline-flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-normal text-violet-200/80">
                    已选 {selected.size}
                    {selectedWithFile ? `（含 ${selectedWithFile} 个文件）` : ''}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void deleteSelected(false)}
                    disabled={busy === 'batch-delete'}
                    title="只删除选中的任务记录，文件保留"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> 删除记录
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void deleteSelected(true)}
                    disabled={busy === 'batch-delete'}
                    title="删除选中的任务记录，并连同已下载文件一起删除（需要管理员登录）"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> 记录和文件
                  </Button>
                </span>
              ) : null}
            </>
          ) : null}
        </div>
        {loading && !jobs.length ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse-soft rounded-xl border border-white/[0.05] bg-white/[0.02]" />
            ))}
          </div>
        ) : history.length ? (
          <>
            <div className="space-y-2">
              {history.map((job) => (
                <JobCard key={job.id} job={job} selectable />
              ))}
            </div>
            {hasMore ? (
              <div className="mt-3 flex justify-center">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                  {loadingMore ? '加载中…' : '加载更多'}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="noise relative flex flex-col items-center gap-2.5 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] py-16 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.04]">
              {active.length ? (
                <Loader2 className="h-5 w-5 animate-spin text-white/25" />
              ) : (
                <Download className="h-5 w-5 text-white/25" />
              )}
            </span>
            <div className="text-[13px] font-medium text-white/60">
              {active.length ? '下载完成后会出现在这里' : '还没有下载记录'}
            </div>
            <div className="text-[11px] text-white/25">去搜索页找一首歌试试</div>
          </div>
        )}
      </section>
    </div>
  )
}
