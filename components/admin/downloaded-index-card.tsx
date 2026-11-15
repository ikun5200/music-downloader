'use client'

import { useCallback, useEffect, useState } from 'react'
import { Database, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface IndexStatus {
  count: number
  lastScanAt: string | null
  summary: {
    total: number
    added: number
    updated: number
    removed: number
    errors: number
    elapsedMs: number
  } | null
  refreshing: boolean
}

function when(value: string | null): string {
  if (!value) return '尚未扫描'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '尚未扫描'
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function DownloadedIndexCard() {
  const [status, setStatus] = useState<IndexStatus | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/downloaded?limit=1', { cache: 'no-store' })
      const json = await res.json()
      if (res.ok && json.code === 0) setStatus(json.data as IndexStatus)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function refresh() {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/downloaded', { method: 'POST' })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '刷新失败')
      toast.success('下载目录索引已刷新', {
        description: `共 ${json.data.total} 个文件，新增 ${json.data.added}，更新 ${json.data.updated}，删除 ${json.data.removed}`,
      })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.022] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[12px] font-medium text-white/70">
          <Database className="h-4 w-4 text-cyan-300/70" />
          下载目录索引
          <Badge tone="cyan">{status?.count ?? '—'} 首</Badge>
        </div>
        <Button size="sm" variant="secondary" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
          立即刷新
        </Button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-white/35">
        每天自动扫描下载目录，以实际文件为准判断是否已下载。同名、同歌手、同版本的文件会被跳过。
      </p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-white/30">
        <span>上次扫描：{when(status?.lastScanAt || null)}</span>
        {status?.summary ? (
          <>
            <span>新增 {status.summary.added}</span>
            <span>更新 {status.summary.updated}</span>
            <span>删除 {status.summary.removed}</span>
            <span>用时 {(status.summary.elapsedMs / 1000).toFixed(1)} 秒</span>
          </>
        ) : null}
      </div>
    </div>
  )
}
