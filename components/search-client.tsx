'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  CheckCheck,
  Clock3,
  Download,
  Layers,
  ListPlus,
  Loader2,
  Music2,
  Pause,
  Play,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { PlatformBadge } from '@/components/platform-badge'
import { BatchItemRow } from '@/components/batch-item-row'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { PreviewBar, usePreviewPlayer } from '@/components/preview-player'
import type { BatchDto } from '@/lib/batch/types'
import {
  PLATFORMS,
  PLATFORM_NAMES,
  QUALITY_NAMES,
  QUALITY_RANK,
  type Platform,
  type SearchResponse,
  type SearchSong,
} from '@/lib/constants'
import { cn, formatDuration } from '@/lib/utils'

const EXAMPLES = ['愿与愁 林俊杰', '孤勇者 陈奕迅', '晴天 周杰伦', 'Love Story']

function Cover({
  src,
  title,
  playing,
  loading,
}: {
  src?: string
  title: string
  playing?: boolean
  loading?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const showImage = !!src && !failed
  return (
    <div className="group/cover relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-violet-500/25 to-cyan-400/20">
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={title}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
          onLoad={(e) => {
            if (e.currentTarget.naturalWidth < 2 || e.currentTarget.naturalHeight < 2) {
              setFailed(true)
            }
          }}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-[15px] font-semibold text-violet-200">
          {title.slice(0, 1)}
        </span>
      )}
      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center bg-black/45 transition-opacity',
          playing || loading ? 'opacity-100' : 'opacity-0 group-hover/cover:opacity-100'
        )}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-white" />
        ) : playing ? (
          <Pause className="h-4 w-4 text-white" />
        ) : (
          <Play className="ml-0.5 h-4 w-4 text-white" />
        )}
      </span>
    </div>
  )
}

function QualityList({ qualities }: { qualities: string[] }) {
  const sorted = [...qualities].sort((a, b) => (QUALITY_RANK[b] || 0) - (QUALITY_RANK[a] || 0))
  if (!sorted.length) return null
  const top = sorted.slice(0, 3)
  return (
    <span className="flex flex-wrap items-center gap-1">
      {top.map((q) => (
        <Badge key={q} tone={QUALITY_RANK[q] >= 4 ? 'violet' : 'neutral'}>
          {QUALITY_NAMES[q] || q}
        </Badge>
      ))}
      {sorted.length > top.length ? (
        <span className="text-[10px] text-white/25">+{sorted.length - top.length}</span>
      ) : null}
    </span>
  )
}

export function SearchClient() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const batchInputRef = useRef<HTMLTextAreaElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const player = usePreviewPlayer(audioRef)
  const [query, setQuery] = useState('')
  const [data, setData] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quality, setQuality] = useState('auto')
  const [platformFilter, setPlatformFilter] = useState<'all' | Platform>('all')
  const [downloading, setDownloading] = useState<Set<string>>(new Set())
  const [batchMode, setBatchMode] = useState(false)
  const [batchText, setBatchText] = useState('')
  const [batch, setBatch] = useState<BatchDto | null>(null)
  const [batchSubmitting, setBatchSubmitting] = useState(false)
  const [batchActing, setBatchActing] = useState(false)

  const allQualities = useMemo(() => {
    if (!data) return []
    const set = new Set<string>()
    for (const platform of data.platforms) for (const q of platform.qualities) set.add(q)
    return [...set].sort((a, b) => (QUALITY_RANK[b] || 0) - (QUALITY_RANK[a] || 0))
  }, [data])

  const search = useCallback(
    async (raw?: string) => {
      const q = (raw ?? query).trim()
      if (!q) {
        inputRef.current?.focus()
        return
      }
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
        const json = await res.json()
        if (!res.ok || json.code !== 0) throw new Error(json.message || '搜索失败')
        setData(json.data as SearchResponse)
        setQuery(q)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setData(null)
      } finally {
        setLoading(false)
      }
    },
    [query]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      if (e.key === '/' && !typing) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const batchRunning = !!batch && ['queued', 'running'].includes(batch.status)
  const batchPaused = batch?.status === 'paused'
  const batchDownloading =
    !!batch &&
    batch.downloadTotal > 0 &&
    batch.downloadCompleted + batch.downloadFailed < batch.downloadTotal
  const batchLive = batchRunning || batchPaused || batchDownloading
  const batchCanPause = batchRunning || (batch?.status === 'completed' && batchDownloading)

  // 页面重新打开时，恢复最近一个还在服务器上执行的批量任务。
  useEffect(() => {
    let canceled = false
    fetch('/api/batches?limit=5', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (canceled || json.code !== 0) return
        const active = (json.data as BatchDto[]).find(
          (item) =>
            ['queued', 'running', 'paused'].includes(item.status) ||
            (item.status === 'completed' &&
              item.downloadTotal > 0 &&
              item.downloadCompleted + item.downloadFailed < item.downloadTotal)
        )
        if (active) {
          setBatch(active)
          setBatchMode(true)
        }
      })
      .catch(() => {})
    return () => {
      canceled = true
    }
  }, [])

  // 批量任务在服务端执行；这里只轮询进度，关掉页面不会中断。
  useEffect(() => {
    if (!batch?.id || !batchLive) return
    let canceled = false
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/batches/${batch.id}`, { cache: 'no-store' })
        const json = await res.json()
        if (!canceled && res.ok && json.code === 0) setBatch(json.data as BatchDto)
      } catch {
        // 下一轮重试
      }
    }, 2000)
    return () => {
      canceled = true
      clearInterval(timer)
    }
  }, [batch?.id, batchLive])

  async function runBatch() {
    if (batchSubmitting || batchLive) return
    const lines = batchText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (!lines.length) {
      batchInputRef.current?.focus()
      return
    }

    setBatchSubmitting(true)
    try {
      const res = await fetch('/api/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines,
          quality: quality === 'auto' ? null : quality,
        }),
      })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '提交批量任务失败')
      setBatch(json.data as BatchDto)
      toast.success(`已提交 ${lines.length} 首到服务器后台`, {
        description: '可以关闭页面，服务器会继续搜索原版并加入下载队列',
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBatchSubmitting(false)
    }
  }

  async function batchAction(action: 'pause' | 'resume' | 'cancel') {
    if (!batch || batchActing) return
    if (
      action === 'cancel' &&
      !window.confirm('取消这个批量任务？排队中和正在下载的任务都会被取消。')
    ) {
      return
    }
    setBatchActing(true)
    try {
      const res =
        action === 'cancel'
          ? await fetch(`/api/batches/${batch.id}`, { method: 'DELETE' })
          : await fetch(`/api/batches/${batch.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action }),
            })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '操作失败')

      const detail = await fetch(`/api/batches/${batch.id}`, { cache: 'no-store' })
      const detailJson = await detail.json()
      if (detail.ok && detailJson.code === 0) setBatch(detailJson.data as BatchDto)

      toast.success(
        action === 'pause'
          ? '已暂停批量任务'
          : action === 'resume'
            ? '已继续批量任务'
            : '已取消批量任务'
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBatchActing(false)
    }
  }

  function clearBatch() {
    setBatch(null)
  }

  const batchLines = batchText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const batchDone = batch?.succeeded ?? 0
  const batchFailed = batch?.failed ?? 0
  const batchTotal = batch?.total ?? 0
  const batchProcessed = batch?.processed ?? 0
  const batchDownloadCompleted = batch?.downloadCompleted ?? 0
  const batchDownloadFailed = batch?.downloadFailed ?? 0
  const batchDownloadProgress = batch?.downloadProgress ?? 0
  const batchSelectProgress = batchTotal
    ? Math.min(100, (batchProcessed / batchTotal) * 100)
    : 0

  async function download(song: SearchSong) {
    const key = `${song.platform}:${song.id}`
    if (downloading.has(key)) return
    setDownloading((prev) => new Set(prev).add(key))
    try {
      const res = await fetch('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: song.platform,
          musicInfo: song.musicInfo,
          quality: quality === 'auto' ? null : quality,
          title: song.title,
          artist: song.artist,
          album: song.album,
          coverUrl: song.coverUrl,
        }),
      })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '创建任务失败')
      toast.success('已加入下载队列', {
        description: `${song.title} · ${song.artist}`,
        action: { label: '查看', onClick: () => router.push('/downloads') },
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setDownloading((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  const visiblePlatforms = (data?.platforms || []).filter(
    (p) => platformFilter === 'all' || p.id === platformFilter
  )

  return (
    <div className={cn('animate-fade-in', player.track && 'pb-28')}>
      <audio ref={audioRef} preload="metadata" className="hidden" />
      <section className="noise relative overflow-hidden rounded-3xl border border-white/[0.07] bg-gradient-to-b from-white/[0.035] to-white/[0.015] px-5 py-10 shadow-soft sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="relative">
          <Badge tone="violet" className="mb-4 border-violet-400/20 bg-violet-500/[0.09]">
            <Sparkles className="h-3 w-3" /> 自动选择最优渠道 · 最高可用音质
          </Badge>
          <h1 className="max-w-2xl text-[28px] font-semibold leading-[1.15] tracking-tight text-white sm:text-[40px]">
            把想听的歌，
            <span className="gradient-text">留在自己的硬盘里。</span>
          </h1>
          <p className="mt-3 max-w-xl text-[13px] leading-6 text-white/45 sm:text-sm">
            搜索酷我、酷狗、QQ、网易云、咪咕，自动挑选可用渠道，按最高音质下载到 NAS。
            文件直接保存到下载目录，不再创建歌手/专辑子文件夹。
          </p>

          <form
            className="mt-7 flex max-w-3xl flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault()
              void search()
            }}
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-white/30" />
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索歌曲、歌手或专辑，例如：愿与愁 林俊杰"
                className="h-12 pl-10 pr-14 text-[14px]"
                autoComplete="off"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/25">
                /
              </span>
            </div>
            <Button
              type="button"
              size="lg"
              variant={batchMode ? 'secondary' : 'outline'}
              onClick={() => {
                setBatchMode((v) => !v)
                setError(null)
                setTimeout(() => batchInputRef.current?.focus(), 50)
              }}
              title="批量下载：一行一首歌，自动搜索并选择最优版本入队"
              className={cn('sm:w-12 sm:px-0', batchMode && 'border-violet-400/40 text-violet-200')}
            >
              <ListPlus className="h-[18px] w-[18px]" />
              <span className="sm:hidden">批量下载</span>
            </Button>
            <Button type="submit" size="lg" disabled={loading} className="sm:w-28">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {loading ? '搜索中' : '搜索'}
            </Button>
          </form>

          {batchMode ? (
            <div className="animate-slide-up mt-4 max-w-3xl rounded-2xl border border-violet-400/20 bg-violet-500/[0.05] p-4 shadow-soft">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[12px] font-medium text-violet-200">
                  <Layers className="h-3.5 w-3.5" /> 批量下载
                  <span className="ml-1 font-normal text-white/35">
                    一行一首歌（歌名 歌手），提交后由服务器后台搜索、选原版并入队
                  </span>
                </div>
                {batch ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {batchCanPause ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={batchActing}
                        onClick={() => void batchAction('pause')}
                      >
                        {batchActing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Pause className="h-3.5 w-3.5" />
                        )}
                        暂停
                      </Button>
                    ) : null}
                    {batchPaused ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={batchActing}
                        onClick={() => void batchAction('resume')}
                      >
                        {batchActing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                        继续
                      </Button>
                    ) : null}
                    {batchLive ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={batchActing}
                        onClick={() => void batchAction('cancel')}
                      >
                        <X className="h-3.5 w-3.5" /> 取消
                      </Button>
                    ) : (
                      <button
                        type="button"
                        onClick={clearBatch}
                        className="inline-flex items-center gap-1 px-1.5 text-[11px] text-white/35 hover:text-white/70"
                      >
                        <X className="h-3 w-3" /> 清空
                      </button>
                    )}
                  </div>
                ) : null}
              </div>

              <Textarea
                ref={batchInputRef}
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
                placeholder={'愿与愁 林俊杰\n孤勇者 陈奕迅\n晴天 周杰伦'}
                className="mt-3 min-h-[120px] font-mono text-[12px] leading-6"
                spellCheck={false}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    void runBatch()
                  }
                }}
              />

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  onClick={() => void runBatch()}
                  disabled={batchSubmitting || batchActing || batchLive || !batchLines.length}
                >
                  {batchSubmitting || batchActing || batchRunning ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCheck className="h-3.5 w-3.5" />
                  )}
                  {batchSubmitting
                    ? '提交中…'
                    : batchRunning
                      ? `服务器处理中 ${batchProcessed}/${batchTotal}`
                      : batchPaused
                        ? '任务已暂停'
                        : batchLive
                          ? '下载进行中'
                          : `开始批量下载（${batchLines.length} 首）`}
                </Button>
                {batch ? (
                  <span className="text-[10.5px] text-white/30">
                    已选版 {batchDone}
                    {batchFailed ? ` · 选版失败 ${batchFailed}` : ''}
                    {' · '}下载完成 {batchDownloadCompleted}/{batchTotal}
                    {batchDownloadFailed ? ` · 下载失败 ${batchDownloadFailed}` : ''}
                  </span>
                ) : null}
                <span className="ml-auto hidden text-[10.5px] text-white/25 sm:inline">
                  提交后可以关闭页面 · ⌘/Ctrl + Enter
                </span>
              </div>

              {batch ? (
                <div className="mt-3">
                  <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-white/30">
                    <Badge
                      tone={
                        batch.status === 'completed'
                          ? 'green'
                          : batch.status === 'failed'
                            ? 'red'
                            : batch.status === 'canceled' || batch.status === 'paused'
                              ? 'amber'
                              : 'violet'
                      }
                    >
                      {batch.status === 'queued'
                        ? '排队中'
                        : batch.status === 'running'
                          ? '服务器处理中'
                          : batch.status === 'paused'
                            ? '已暂停'
                            : batch.status === 'completed'
                              ? '选版完成'
                              : batch.status === 'canceled'
                                ? '已取消'
                                : '失败'}
                    </Badge>
                    <span>
                      选版 {batchProcessed}/{batchTotal}
                    </span>
                    <span>
                      下载 {batchDownloadCompleted}/{batchTotal}
                    </span>
                    {batchDownloading && batch.status !== 'paused' ? (
                      <span className="text-cyan-300/60">下载中</span>
                    ) : null}
                    {batchDownloadFailed ? (
                      <span className="text-red-300/60">下载失败 {batchDownloadFailed}</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => router.push('/downloads')}
                      className="text-violet-300/70 hover:text-violet-200"
                    >
                      在下载页查看
                    </button>
                  </div>

                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-7 shrink-0 text-[9.5px] text-white/25">选版</span>
                      <Progress value={batchSelectProgress} className="h-1" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-7 shrink-0 text-[9.5px] text-white/25">下载</span>
                      <Progress
                        value={batchDownloadProgress}
                        className="h-1"
                        tone={
                          batch.status === 'failed' ||
                          (batchDownloadFailed > 0 && !batchDownloading)
                            ? 'red'
                            : 'cyan'
                        }
                      />
                    </div>
                  </div>

                  <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                    {batch.items.map((item) => (
                      <BatchItemRow key={item.id} item={item} />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-white/30">
            <span>试试：</span>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setQuery(example)
                  void search(example)
                }}
                className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-white/45 transition-colors hover:border-violet-400/30 hover:bg-violet-500/10 hover:text-violet-200"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error ? (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-red-400/20 bg-red-500/[0.06] px-4 py-3 text-sm text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">搜索失败</div>
            <div className="mt-0.5 text-red-200/70">{error}</div>
          </div>
        </div>
      ) : null}

      {data ? (
        <section className="mt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPlatformFilter('all')}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] transition-colors',
                  platformFilter === 'all'
                    ? 'border-violet-400/30 bg-violet-500/15 text-violet-200'
                    : 'border-white/[0.08] bg-white/[0.03] text-white/50 hover:text-white/80'
                )}
              >
                全部
                <span className="text-[10px] opacity-60">
                  {data.platforms.reduce((n, p) => n + p.results.length, 0)}
                </span>
              </button>
              {data.platforms.map((platform) => (
                <button
                  key={platform.id}
                  type="button"
                  onClick={() => setPlatformFilter(platform.id)}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] transition-colors',
                    platformFilter === platform.id
                      ? 'border-violet-400/30 bg-violet-500/15 text-violet-200'
                      : 'border-white/[0.08] bg-white/[0.03] text-white/50 hover:text-white/80',
                    !platform.available && 'opacity-55'
                  )}
                >
                  <PlatformBadge platform={platform.id} showName={false} className="border-0 bg-transparent px-0" />
                  {PLATFORM_NAMES[platform.id]}
                  <span className="text-[10px] opacity-60">{platform.results.length}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="whitespace-nowrap text-[11px] text-white/30">
                搜索耗时 {data.tookMs}ms
              </span>
              <Select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                aria-label="下载音质"
                className="h-9 text-[12px]"
              >
                <option value="auto">自动（最高可用）</option>
                {allQualities.map((q) => (
                  <option key={q} value={q}>
                    {QUALITY_NAMES[q] || q}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {loading ? (
            <div className="mt-4 space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-[68px] animate-pulse-soft rounded-xl border border-white/[0.05] bg-white/[0.025]" />
              ))}
            </div>
          ) : null}

          <div className="mt-5 space-y-6">
            {visiblePlatforms.map((platform) => (
              <div key={platform.id}>
                <div className="mb-2 flex items-center gap-2">
                  <PlatformBadge platform={platform.id} />
                  <span className="text-[11px] text-white/30">
                    {platform.available
                      ? `${platform.channels} 个可用渠道 · ${platform.results.length} 条结果`
                      : '暂无可用渠道'}
                  </span>
                  {platform.error ? (
                    <span className="truncate text-[11px] text-amber-300/60">{platform.error}</span>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  {platform.results.map((song) => {
                    const key = `${song.platform}:${song.id}`
                    const supported =
                      quality === 'auto' || song.qualities.includes(quality)
                    const canDownload = platform.available && supported && song.channels > 0
                    const isPlaying = player.track?.key === key && player.playing
                    const isLoading = player.loadingKey === key
                    const canPreview = platform.available && song.channels > 0
                    return (
                      <div
                        key={key}
                        onClick={(e) => {
                          if (!canPreview) return
                          if ((e.target as HTMLElement).closest('button,a,input,select,textarea')) return
                          void player.toggle(song)
                        }}
                        className={cn(
                          'lift group flex items-center gap-3 rounded-xl border px-3 py-2.5',
                          canPreview ? 'cursor-pointer' : 'cursor-default opacity-70',
                          isPlaying
                            ? 'border-violet-400/30 bg-violet-500/[0.06]'
                            : 'border-white/[0.05] bg-white/[0.022] hover:border-white/[0.1] hover:bg-white/[0.04]'
                        )}
                      >
                        <Cover
                          src={song.coverUrl}
                          title={song.title}
                          playing={isPlaying}
                          loading={isLoading}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[13.5px] font-medium text-white/90">
                              {song.title}
                            </span>
                            {isPlaying ? (
                              <span className="flex h-3 shrink-0 items-end gap-[2px]" aria-label="正在试听">
                                <span className="eq-bar h-2 w-[2px] rounded-full bg-violet-300" />
                                <span className="eq-bar h-3 w-[2px] rounded-full bg-violet-300" />
                                <span className="eq-bar h-1.5 w-[2px] rounded-full bg-violet-300" />
                              </span>
                            ) : null}
                            {song.duration ? (
                              <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-white/25">
                                <Clock3 className="h-3 w-3" />
                                {formatDuration(song.duration)}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 truncate text-[11.5px] text-white/40">
                            {song.artist}
                            {song.album ? <span className="text-white/25"> · {song.album}</span> : null}
                          </div>
                          <div className="mt-1.5">
                            <QualityList qualities={song.qualities} />
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!canPreview || isLoading}
                          onClick={(e) => {
                            e.stopPropagation()
                            void player.toggle(song)
                          }}
                          title={canPreview ? (isPlaying ? '暂停试听' : '试听') : '该平台没有启用的渠道'}
                          className="shrink-0"
                          aria-label={isPlaying ? '暂停试听' : '试听'}
                        >
                          {isLoading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : isPlaying ? (
                            <Pause className="h-3.5 w-3.5" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                          <span className="hidden sm:inline">{isPlaying ? '暂停' : '试听'}</span>
                        </Button>
                        <Button
                          size="sm"
                          variant={canDownload ? 'secondary' : 'ghost'}
                          disabled={!canDownload || downloading.has(key)}
                          onClick={(e) => {
                            e.stopPropagation()
                            void download(song)
                          }}
                          title={
                            !platform.available
                              ? '该平台没有启用的渠道'
                              : !supported
                                ? '该平台不支持所选音质'
                                : '下载'
                          }
                          className="shrink-0"
                        >
                          {downloading.has(key) ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                          <span className="hidden sm:inline">下载</span>
                        </Button>
                      </div>
                    )
                  })}
                  {platform.results.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/[0.07] bg-white/[0.015] px-4 py-6 text-center text-[12px] text-white/30">
                      没有搜索结果
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {visiblePlatforms.every((p) => !p.results.length) ? (
            <div className="noise relative mt-10 flex flex-col items-center gap-2.5 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] py-16 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.04]">
                <Music2 className="h-5 w-5 text-white/25" />
              </span>
              <div className="text-[13px] font-medium text-white/60">没有找到匹配的歌曲</div>
              <div className="text-[11px] text-white/25">换个关键词，或去掉歌手名再试一次</div>
            </div>
          ) : null}
        </section>
      ) : !loading ? (
        <section className="mt-8 grid gap-3 sm:grid-cols-3">
          {[
            { title: '自动回退', desc: '高音质失败会自动尝试下一个渠道，直到拿到可用链接。', icon: Sparkles },
            { title: '真实验证', desc: '下载完成后用 ffprobe 校验编码、位深和时长，拦截错歌。', icon: Music2 },
            { title: '直接保存', desc: '按“歌曲名.格式”命名，直接落在 NAS 下载目录，不创建子文件夹。', icon: Download },
          ].map((item) => {
            const Icon = item.icon
            return (
              <div key={item.title} className="lift rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 hover:border-white/[0.1]">
                <Icon className="h-5 w-5 text-violet-300/70" />
                <div className="mt-3 text-[13px] font-medium text-white/80">{item.title}</div>
                <div className="mt-1 text-[11.5px] leading-5 text-white/35">{item.desc}</div>
              </div>
            )
          })}
        </section>
      ) : null}
      <PreviewBar player={player} />
    </div>
  )
}
