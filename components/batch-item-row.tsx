'use client'

import { AlertCircle, CheckCheck, Loader2, Pause, X } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import type { BatchItemDto } from '@/lib/batch/types'
import { cn } from '@/lib/utils'

function progressOf(item: BatchItemDto) {
  if (item.downloadStatus === 'completed') return 100
  return Math.max(0, Math.min(100, item.downloadProgress || 0))
}

export function BatchItemRow({ item }: { item: BatchItemDto }) {
  const download = item.downloadStatus
  const progress = progressOf(item)
  const showBar =
    !!item.downloadJobId &&
    ['resolving', 'downloading', 'paused', 'completed', 'failed'].includes(download || '')

  let icon = <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/25" />
  let tone: 'violet' | 'cyan' | 'green' | 'red' = 'violet'
  let progressLabel = ''
  let right = '等待'

  if (item.status === 'searching') {
    icon = <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-cyan-300" />
    right = '搜索/选版中…'
  } else if (item.status === 'failed') {
    icon = <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-300" />
    right = item.error || '失败'
  } else if (item.status === 'canceled') {
    icon = <X className="h-3.5 w-3.5 shrink-0 text-white/30" />
    right = '已取消'
  } else if (item.status === 'queued') {
    right = item.title
      ? `${item.aiUsed ? 'AI · ' : ''}${item.title}${item.artist ? ` · ${item.artist}` : ''}`
      : '已入队'

    if (download === 'completed') {
      icon = <CheckCheck className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
      tone = 'green'
      progressLabel = '已完成'
    } else if (download === 'failed') {
      icon = <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-300" />
      tone = 'red'
      progressLabel = '下载失败'
      right = '下载失败'
    } else if (download === 'canceled') {
      icon = <X className="h-3.5 w-3.5 shrink-0 text-white/30" />
      right = '已取消'
    } else if (download === 'paused') {
      icon = <Pause className="h-3.5 w-3.5 shrink-0 text-amber-300" />
      progressLabel = `已暂停 ${Math.round(progress)}%`
    } else if (download === 'downloading' || download === 'resolving') {
      icon = <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-cyan-300" />
      tone = 'cyan'
      progressLabel =
        download === 'resolving' ? '解析中' : `下载中 ${Math.round(progress)}%`
    } else {
      icon = <CheckCheck className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
      right = item.title ? `${right} · 排队中` : '排队中'
    }
  }

  return (
    <div className="rounded-lg border border-white/[0.05] bg-black/20 px-2.5 py-1.5 text-[11.5px]">
      <div className="flex items-center gap-2">
        {icon}
        <span className="min-w-0 flex-1 truncate text-white/65">{item.line}</span>
        <span
          className={cn(
            'max-w-[55%] shrink-0 truncate text-right',
            item.status === 'failed' || download === 'failed'
              ? 'text-red-300/70'
              : item.status === 'canceled' || download === 'canceled'
                ? 'text-white/25'
                : 'text-emerald-300/75'
          )}
          title={item.error || item.downloadError || item.selectionReason || undefined}
        >
          {right}
        </span>
      </div>

      {showBar ? (
        <div className="mt-1.5 flex items-center gap-2 pl-5">
          <Progress value={progress} tone={tone} className="h-1" />
          <span
            className={cn(
              'w-20 shrink-0 text-right text-[9.5px]',
              download === 'failed'
                ? 'text-red-300/60'
                : download === 'paused'
                  ? 'text-amber-300/60'
                  : download === 'completed'
                    ? 'text-emerald-300/60'
                    : 'text-white/30'
            )}
          >
            {progressLabel}
          </span>
        </div>
      ) : null}
    </div>
  )
}
