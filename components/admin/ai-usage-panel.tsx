'use client'

import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Aggregate {
  calls: number
  success: number
  failed: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  avgLatencyMs: number
  successRate: number
}

interface FeatureUsage extends Aggregate {
  feature: string
}

interface UsageError {
  feature: string
  model: string | null
  error: string
  createdAt: string
}

interface UsageSummary {
  days: number
  since: string
  truncated: boolean
  totals: Aggregate
  today: Aggregate
  byFeature: FeatureUsage[]
  byDay: Array<Aggregate & { day: string }>
  recentErrors: UsageError[]
}

function formatNumber(value: number): string {
  return Math.max(0, Math.round(value || 0)).toLocaleString('zh-CN')
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <div className="text-[10px] text-white/30">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-white">{value}</div>
      <div className="mt-0.5 text-[9.5px] text-white/20">{hint}</div>
    </div>
  )
}

export function AiUsagePanel() {
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/ai/usage?days=7', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '读取统计失败')
      setSummary(json.data as UsageSummary)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="mt-3 lift rounded-2xl border border-white/[0.06] bg-white/[0.022] p-5 hover:border-white/[0.1]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px] font-medium text-white/70">
          <Activity className="h-4 w-4 text-violet-300/60" /> AI 调用统计
        </div>
        <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> 刷新
        </Button>
      </div>
      <p className="mt-1.5 text-[10.5px] leading-4 text-white/25">
        记录每次 AI 请求的功能、Token、延迟和成功率；日志保留 90 天。统计从本版本部署后开始累积。
      </p>

      {error ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-400/15 bg-red-500/[0.04] px-3 py-2 text-[10.5px] text-red-300/75">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </div>
      ) : null}

      {loading && !summary ? (
        <div className="mt-4 flex items-center gap-2 text-[11px] text-white/30">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" /> 正在读取 AI 用量…
        </div>
      ) : null}

      {summary ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-4">
            <StatCard label="今日调用" value={formatNumber(summary.today.calls)} hint={`失败 ${formatNumber(summary.today.failed)}`} />
            <StatCard label="今日 Token" value={formatNumber(summary.today.totalTokens)} hint={`输入 ${formatNumber(summary.today.promptTokens)} / 输出 ${formatNumber(summary.today.completionTokens)}`} />
            <StatCard label={`近 ${summary.days} 天调用`} value={formatNumber(summary.totals.calls)} hint={`Token ${formatNumber(summary.totals.totalTokens)}`} />
            <StatCard label="成功率" value={`${summary.totals.successRate}%`} hint={`平均延迟 ${formatNumber(summary.totals.avgLatencyMs)} ms`} />
          </div>

          {summary.byFeature.length ? (
            <div className="overflow-hidden rounded-xl border border-white/[0.06]">
              <div className="grid grid-cols-[1.3fr_repeat(3,1fr)] gap-2 border-b border-white/[0.05] bg-white/[0.02] px-3 py-2 text-[9.5px] text-white/30">
                <span>功能</span>
                <span className="text-right">调用</span>
                <span className="text-right">Token</span>
                <span className="text-right">成功率</span>
              </div>
              {summary.byFeature.map((item) => (
                <div
                  key={item.feature}
                  className="grid grid-cols-[1.3fr_repeat(3,1fr)] gap-2 border-b border-white/[0.035] px-3 py-1.5 text-[10.5px] last:border-b-0"
                >
                  <span className="truncate text-white/55">{item.feature}</span>
                  <span className="text-right tabular-nums text-white/45">{formatNumber(item.calls)}</span>
                  <span className="text-right tabular-nums text-white/45">{formatNumber(item.totalTokens)}</span>
                  <span className="text-right tabular-nums text-white/45">{item.successRate}%</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-6 text-center text-[10.5px] text-white/25">
              还没有 AI 调用记录。启用 AI 并执行选版、刮削或歌词清理后会显示在这里。
            </div>
          )}

          {summary.recentErrors.length ? (
            <details className="rounded-xl border border-amber-400/12 bg-amber-500/[0.03] px-3 py-2">
              <summary className="cursor-pointer list-none text-[10.5px] text-amber-200/70">
                最近失败记录（{summary.recentErrors.length}）
              </summary>
              <div className="mt-1.5 space-y-1">
                {summary.recentErrors.map((item) => (
                  <div key={`${item.createdAt}-${item.feature}`} className="text-[9.5px] leading-4 text-white/30">
                    <Badge tone="amber">{item.feature}</Badge>{' '}
                    <span className="text-white/25">{item.error}</span>
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          {summary.truncated ? (
            <p className="text-[9.5px] text-white/20">统计只展示最近 20000 条记录。</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
