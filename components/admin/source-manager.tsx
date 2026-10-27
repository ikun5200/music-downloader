'use client'

import { useCallback, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { PlatformBadge } from '@/components/platform-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { PLATFORM_NAMES, QUALITY_NAMES, type Platform } from '@/lib/constants'
import { cn } from '@/lib/utils'

interface StatDto {
  platform: string
  attempts: number
  successes: number
  consecutiveFailures: number
  cooldownUntil: string | null
  avgLatencyMs: number
  lastError: string | null
}

interface SourceDto {
  id: string
  name: string
  version: string | null
  fileName: string
  filePath: string
  enabled: boolean
  priority: number
  platforms: string[]
  qualities: Record<string, string[]>
  lastInitAt: string | null
  lastError: string | null
  createdAt: string
  stats: StatDto[]
  loaded: { platforms: string[]; qualities: Record<string, string[]> } | null
  logs: string[]
}

export function SourceManager({ initialSources }: { initialSources: SourceDto[] }) {
  const [sources, setSources] = useState<SourceDto[]>(initialSources)
  const [busy, setBusy] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/admin/sources', { cache: 'no-store' })
    const json = await res.json()
    if (res.ok && json.code === 0) setSources(json.data as SourceDto[])
  }, [])

  async function upload(file: File) {
    if (uploading) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/admin/sources', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '上传失败')
      await refresh()
      if (json.initError) {
        toast.warning('已导入，但初始化失败', { description: json.initError })
      } else {
        toast.success('音源已导入并启用')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function patch(source: SourceDto, data: Partial<Pick<SourceDto, 'enabled' | 'priority' | 'name'>>) {
    setBusy(`patch:${source.id}`)
    try {
      const res = await fetch(`/api/admin/sources/${source.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '更新失败')
      setSources((prev) => prev.map((s) => (s.id === source.id ? (json.data as SourceDto) : s)))
      toast.success(data.enabled === false ? '已禁用' : data.enabled === true ? '已启用' : '已更新')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function test(source: SourceDto) {
    setBusy(`test:${source.id}`)
    try {
      const res = await fetch(`/api/admin/sources/${source.id}/test`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '测试失败')
      await refresh()
      const platforms = (json.data.platforms as string[]) || []
      toast.success('初始化成功', {
        description: platforms.length
          ? `支持 ${platforms.map((p) => PLATFORM_NAMES[p as Platform] || p).join(' / ')}`
          : '未声明可用平台',
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= sources.length) return
    const next = [...sources]
    ;[next[index], next[target]] = [next[target], next[index]]
    setSources(next)
    setBusy('reorder')
    try {
      const res = await fetch('/api/admin/sources/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: next.map((s) => s.id) }),
      })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '排序失败')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  async function remove(source: SourceDto) {
    if (!window.confirm(`删除音源「${source.name}」？脚本文件也会一起删除。`)) return
    setBusy(`delete:${source.id}`)
    try {
      const res = await fetch(`/api/admin/sources/${source.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '删除失败')
      setSources((prev) => prev.filter((s) => s.id !== source.id))
      toast.success('已删除')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">音源渠道</h1>
          <p className="mt-1 text-[12px] text-white/35">
            这里的全局排序会覆盖各平台顺序；按平台单独排序请到「设置 → 平台与音源优先级」。关闭的渠道不会参与搜索可用性和下载。
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" size="sm" onClick={() => void refresh()} className="whitespace-nowrap">
            <RefreshCw className="h-3.5 w-3.5" /> 刷新
          </Button>
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} className="whitespace-nowrap">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            上传音源
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".js,application/javascript"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void upload(file)
            }}
          />
        </div>
      </div>

      <div className="mt-5 space-y-2.5">
        {sources.map((source, index) => {
          const isBusy = busy?.endsWith(source.id) || busy === 'reorder'
          const totalAttempts = source.stats.reduce((n, s) => n + s.attempts, 0)
          const totalSuccess = source.stats.reduce((n, s) => n + s.successes, 0)
          const rate = totalAttempts ? Math.round((totalSuccess / totalAttempts) * 100) : null
          const cooling = source.stats.filter(
            (s) => s.cooldownUntil && new Date(s.cooldownUntil).getTime() > Date.now()
          )
          return (
            <div
              key={source.id}
              className={cn(
                'lift rounded-2xl border border-white/[0.06] bg-white/[0.022] p-4 transition-colors hover:border-white/[0.1]',
                !source.enabled && 'opacity-65'
              )}
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-400/10">
                  <Zap className="h-5 w-5 text-violet-200/80" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-all text-[13.5px] font-medium text-white/90">{source.name}</span>
                    {source.version ? <Badge tone="neutral" className="max-w-[220px]"><span className="truncate">{source.version}</span></Badge> : null}
                    {source.enabled ? (
                      <Badge tone="green">已启用</Badge>
                    ) : (
                      <Badge tone="amber">已禁用</Badge>
                    )}
                    {rate != null ? <Badge tone={rate >= 70 ? 'green' : rate >= 40 ? 'amber' : 'red'}>成功率 {rate}%</Badge> : null}
                    {cooling.length ? <Badge tone="red">冷却中</Badge> : null}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10.5px] text-white/25">
                    <span className="break-all">{source.fileName}</span>
                    <span>·</span>
                    <span>优先级 {source.priority}</span>
                    {source.lastInitAt ? (
                      <>
                        <span>·</span>
                        <span>上次初始化 {new Date(source.lastInitAt).toLocaleString('zh-CN', { hour12: false })}</span>
                      </>
                    ) : null}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {source.platforms.length ? (
                      source.platforms.map((p) => (
                        <span key={p} className="inline-flex items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.03] px-1.5 py-1">
                          <PlatformBadge platform={p as Platform} showName={false} className="border-0 bg-transparent px-0" />
                          <span className="text-[10.5px] text-white/45">{PLATFORM_NAMES[p as Platform] || p}</span>
                          <span className="text-[9.5px] text-white/25">
                            {(source.qualities[p] || []).length} 档
                          </span>
                        </span>
                      ))
                    ) : (
                      <span className="text-[10.5px] text-white/30">
                        {source.lastError ? `初始化失败：${source.lastError}` : '尚未初始化，点击「测试」加载平台与音质'}
                      </span>
                    )}
                  </div>

                  {source.loaded ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[9.5px] text-white/20">
                      <BadgeCheck className="h-3 w-3" />
                      {Object.entries(source.loaded.qualities).map(([p, qs]) => (
                        <span key={p}>
                          {PLATFORM_NAMES[p as Platform] || p}: {qs.map((q) => QUALITY_NAMES[q] || q).join('/')}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {source.logs.length ? (
                    <details className="mt-2 text-[10px] text-white/25">
                      <summary className="cursor-pointer select-none">查看最近日志</summary>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-2 text-[9.5px] leading-4 text-white/35">
                        {source.logs.join('\n')}
                      </pre>
                    </details>
                  ) : null}
                </div>

                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={source.enabled}
                      disabled={isBusy}
                      onChange={(next) => void patch(source, { enabled: next })}
                      label={source.enabled ? '禁用' : '启用'}
                    />
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => void move(index, -1)}
                        disabled={index === 0 || isBusy}
                        className="rounded p-0.5 text-white/25 hover:text-white/70 disabled:opacity-20"
                        title="上移"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void move(index, 1)}
                        disabled={index === sources.length - 1 || isBusy}
                        className="rounded p-0.5 text-white/25 hover:text-white/70 disabled:opacity-20"
                        title="下移"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isBusy}
                      onClick={() => void test(source)}
                      className="shrink-0 whitespace-nowrap"
                    >
                      {busy === `test:${source.id}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Zap className="h-3.5 w-3.5" />
                      )}
                      测试
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isBusy}
                      onClick={() => void remove(source)}
                      title={`删除音源「${source.name}」`}
                      className="shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {!sources.length ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] py-14 text-center">
            <Plus className="h-7 w-7 text-white/15" />
            <div className="text-sm text-white/50">还没有音源</div>
            <div className="text-[11px] text-white/25">上传一个洛雪自定义源 .js 脚本开始</div>
          </div>
        ) : null}
      </div>

      <p className="mt-4 text-[10.5px] leading-5 text-white/20">
        只上传你信任的脚本。音源脚本会在受限沙箱中执行，但沙箱不是硬隔离；不要给不可信来源管理员权限。
      </p>
    </div>
  )
}
