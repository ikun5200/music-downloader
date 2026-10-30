'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Disc3,
  FileText,
  Image as ImageIcon,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Wand2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { cn, formatBytes, formatDuration } from '@/lib/utils'
import type {
  AlbumMergeGroup,
  AlbumResult,
  AuditResult,
  CoverResult,
  DuplicateGroup,
  DuplicateResult,
  LibraryTaskType,
  LyricsResult,
} from '@/lib/library/types'

interface TaskDto {
  id: string
  type: LibraryTaskType
  status: string
  total: number
  processed: number
  progress: number
  summary: string | null
  error: string | null
  result?: string | null
  createdAt: string
  startedAt?: string | null
  finishedAt?: string | null
}

const TABS: Array<{
  type: LibraryTaskType
  label: string
  icon: typeof ShieldCheck
  desc: string
}> = [
  {
    type: 'audit',
    label: '完整性巡检',
    icon: ShieldCheck,
    desc: '逐文件检查可读性、标签、封面、歌词、音质和下载记录一致性。',
  },
  {
    type: 'duplicates',
    label: '重复与清理',
    icon: Copy,
    desc: '按内容指纹和“歌名+歌手+版本+时长”找重复，优先保留音质最好的文件。',
  },
  {
    type: 'albums',
    label: '专辑合并',
    icon: Disc3,
    desc: '同一张专辑因 Deluxe/特别版/未知专辑等被拆成多个专辑名时，统一专辑标签。',
  },
  {
    type: 'lyrics',
    label: '歌词工作流',
    icon: FileText,
    desc: '找缺失、乱码、无时间轴、繁体或开头带制作信息的歌词，多源抓取并清理后写回文件。',
  },
  {
    type: 'covers',
    label: '封面工作流',
    icon: ImageIcon,
    desc: '找缺失、占位图或低分辨率封面，按歌名/歌手/专辑匹配后写回文件。',
  },
]

const ISSUE_LABELS: Record<string, string> = {
  empty: '空文件',
  unreadable: '无法解析',
  no_audio: '无音频流',
  short: '时长过短',
  missing_title: '缺歌名',
  missing_artist: '缺歌手',
  missing_album: '缺专辑',
  missing_album_artist: '缺专辑歌手',
  html_entities: 'HTML 实体',
  missing_cover: '缺封面',
  placeholder_cover: '占位封面',
  low_res_cover: '封面低清',
  missing_lyrics: '缺歌词',
  lyrics_mojibake: '歌词乱码',
  lyrics_dirty: '歌词带制作信息',
  lyrics_unsynced: '歌词无时间轴',
  lyrics_traditional: '歌词繁体',
  lyrics_too_short: '歌词过短',
  low_quality: '音质偏低',
  low_bitrate: '码率偏低',
  extension_mismatch: '扩展名不符',
  filename_mismatch: '文件名不符',
  db_mismatch: '记录不一致',
  quality_downgrade: '音质降级',
  no_job_record: '无下载记录',
}

function parseResult<T>(task: TaskDto | undefined): T | null {
  if (!task?.result) return null
  try {
    return JSON.parse(task.result) as T
  } catch {
    return null
  }
}

function statusTone(status: string): 'neutral' | 'violet' | 'cyan' | 'green' | 'red' | 'amber' {
  if (status === 'completed') return 'green'
  if (status === 'failed') return 'red'
  if (status === 'running') return 'violet'
  if (status === 'queued') return 'neutral'
  return 'amber'
}

function statusLabel(status: string): string {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'running') return '运行中'
  if (status === 'queued') return '排队中'
  return status
}

function workflowTone(status: string): 'neutral' | 'violet' | 'green' | 'red' | 'amber' {
  if (status === 'fixed') return 'green'
  if (status === 'failed') return 'red'
  if (status === 'not_found') return 'amber'
  if (status === 'pending') return 'violet'
  return 'neutral'
}

function workflowLabel(status: string): string {
  if (status === 'fixed') return '已修复'
  if (status === 'failed') return '失败'
  if (status === 'not_found') return '未找到'
  if (status === 'skipped') return '跳过'
  if (status === 'pending') return '待修复'
  return status
}

function TaskHeader({
  tab,
  task,
  onRun,
  running,
  extra,
}: {
  tab: (typeof TABS)[number]
  task: TaskDto | undefined
  onRun: () => void
  running: boolean
  extra?: ReactNode
}) {
  const Icon = tab.icon
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[13px] font-medium text-white/80">
          <Icon className="h-4 w-4 text-violet-300/70" />
          {tab.label}
          {task ? <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge> : null}
        </div>
        <p className="mt-1 max-w-2xl text-[11px] leading-5 text-white/30">{tab.desc}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {extra}
        <Button size="sm" onClick={onRun} disabled={running}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {running ? '运行中' : '开始扫描'}
        </Button>
      </div>
    </div>
  )
}

function TaskProgress({ task }: { task: TaskDto | undefined }) {
  if (!task) return null
  return (
    <div className="mt-4 rounded-xl border border-white/[0.05] bg-black/15 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 text-[10.5px] text-white/35">
        <span className="truncate">{task.summary || (task.status === 'running' ? '正在处理…' : '—')}</span>
        <span className="shrink-0 font-mono">
          {task.processed}/{task.total || '?'}
        </span>
      </div>
      <Progress value={task.progress} className="mt-2" tone={task.status === 'failed' ? 'red' : 'violet'} />
      {task.error ? <p className="mt-1.5 text-[10px] leading-4 text-red-300/70">{task.error}</p> : null}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center text-[11px] text-white/25">
      {text}
    </div>
  )
}

function AuditPanel({
  task,
  onCleanupMissing,
}: {
  task: TaskDto | undefined
  onCleanupMissing: (taskId: string, paths: string[]) => Promise<void>
}) {
  const result = parseResult<AuditResult>(task)
  const [filter, setFilter] = useState<'all' | 'error' | 'warn' | 'info'>('all')
  const [showAll, setShowAll] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  if (!result) return <EmptyState text="还没有巡检结果。点击「开始扫描」逐文件检查音乐库。" />

  const rows = result.issues.filter((row) =>
    filter === 'all' ? true : row.issues.some((item) => item.severity === filter)
  )
  const visible = showAll ? rows : rows.slice(0, 120)
  const { summary } = result
  return (
    <div className="mt-4 space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        {[
          ['文件', summary.totalFiles, 'neutral'],
          ['错误', summary.errorCount, 'red'],
          ['警告', summary.warnCount, 'amber'],
          ['提示', summary.infoCount, 'cyan'],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
            <div className="text-[10px] text-white/30">{label}</div>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="text-lg font-semibold text-white">{value as number}</span>
              <Badge tone={tone as 'neutral' | 'red' | 'amber' | 'cyan'}>{String(label)}</Badge>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {(['all', 'error', 'warn', 'info'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={cn(
              'h-7 rounded-lg border px-2.5 text-[10.5px] transition-colors',
              filter === value
                ? 'border-violet-400/30 bg-violet-500/15 text-violet-200'
                : 'border-white/[0.07] text-white/40 hover:bg-white/[0.05]'
            )}
          >
            {value === 'all' ? '全部' : value === 'error' ? '只看错误' : value === 'warn' ? '只看警告' : '只看提示'}
            {value === 'all' ? ` ${rows.length}` : ''}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-white/25">
          共 {rows.length} 个文件有问题
        </span>
      </div>

      <div className="space-y-1.5">
        {visible.map((row) => (
          <details
            key={row.path}
            className="group rounded-xl border border-white/[0.06] bg-white/[0.018] px-3 py-2 open:bg-white/[0.03]"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-white/25 group-open:hidden" />
              <ChevronDown className="hidden h-3.5 w-3.5 shrink-0 text-white/25 group-open:block" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11.5px] text-white/70">
                  {row.title || '（无歌名）'}
                  <span className="ml-1.5 text-white/30">{row.artist}</span>
                </div>
                <div className="truncate font-mono text-[9.5px] text-white/20">{row.path}</div>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {row.issues.slice(0, 4).map((item) => (
                  <Badge
                    key={`${row.path}-${item.code}`}
                    tone={item.severity === 'error' ? 'red' : item.severity === 'warn' ? 'amber' : 'cyan'}
                  >
                    {ISSUE_LABELS[item.code] || item.code}
                  </Badge>
                ))}
                {row.issues.length > 4 ? <Badge>+{row.issues.length - 4}</Badge> : null}
              </div>
            </summary>
            <div className="mt-2 space-y-1 border-t border-white/[0.05] pt-2 pl-5">
              {row.issues.map((item) => (
                <div key={`${item.code}-${item.message}`} className="text-[10.5px] leading-5 text-white/40">
                  <span className="text-white/25">[{ISSUE_LABELS[item.code] || item.code}]</span>{' '}
                  {item.message}
                </div>
              ))}
              <div className="text-[9.5px] text-white/20">
                {formatDuration(row.duration)} · {row.quality} · {formatBytes(row.size)}
              </div>
            </div>
          </details>
        ))}
      </div>
      {rows.length > 120 ? (
        <Button size="sm" variant="secondary" onClick={() => setShowAll((value) => !value)}>
          {showAll ? '收起' : `显示全部 ${rows.length} 条`}
        </Button>
      ) : null}

      {result.missingFiles.length ? (
        <div className="rounded-xl border border-amber-400/15 bg-amber-500/[0.04] px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] font-medium text-amber-200/80">
              下载记录指向的文件不存在（{result.missingFiles.length}）
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={cleaning || !task}
              onClick={() => {
                if (!task) return
                const paths = result.missingFiles.map((item) => item.path).filter(Boolean)
                if (!paths.length) return
                if (
                  !window.confirm(
                    `确认删除 ${paths.length} 条失效下载记录？\n只会删除数据库记录，不会删除任何音乐文件。`
                  )
                ) {
                  return
                }
                setCleaning(true)
                void onCleanupMissing(task.id, paths).finally(() => setCleaning(false))
              }}
            >
              {cleaning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              一键清理失效记录
            </Button>
          </div>
          <div className="mt-1 max-h-48 space-y-1 overflow-auto">
            {result.missingFiles.slice(0, 100).map((item) => (
              <div key={`${item.path}-${item.title}`} className="truncate font-mono text-[9.5px] text-white/30">
                {item.path || '（无路径）'} · {item.title} · {item.artist}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function DuplicatePanel({
  task,
  onDelete,
}: {
  task: TaskDto | undefined
  onDelete: (paths: string[], deleteFiles: boolean, deleteRecords: boolean) => Promise<string[]>
}) {
  const result = parseResult<DuplicateResult>(task)
  const [busy, setBusy] = useState(false)
  if (!result) return <EmptyState text="还没有重复检测结果。扫描会同时比对文件内容指纹和歌曲信息。" />
  if (!result.groups.length) {
    const sameNameCopies = result.summary.sameNameCopies || 0
    return (
      <div className="mt-4 space-y-2">
        <EmptyState text="没有发现重复文件。" />
        {sameNameCopies ? (
          <div className="rounded-xl border border-amber-400/15 bg-amber-500/[0.04] px-3 py-2.5 text-[10.5px] leading-5 text-white/40">
            检测到 {sameNameCopies} 个带 (2)/(3) 的文件名，但歌手、版本或时长不同，未判定为重复（同名不同歌曲）。
            {result.summary.sameNameExamples?.length ? (
              <div className="mt-1 space-y-0.5 font-mono text-[9.5px] text-white/25">
                {result.summary.sameNameExamples.map((path) => (
                  <div key={path} className="truncate">
                    {path}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }
  const allPaths = result.groups.flatMap((group) => group.remove.map((file) => file.path))
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
        <span className="text-[11px] text-white/45">
          {result.summary.groups} 组重复 · 可清理 {result.summary.removableFiles} 个文件 · 约{' '}
          {formatBytes(result.summary.removableBytes)}
        </span>
        {allPaths.length ? (
          <Button
            size="sm"
            variant="danger"
            className="ml-auto"
            disabled={busy}
            onClick={() => {
              if (
                !window.confirm(
                  `确认一键清理 ${allPaths.length} 个重复文件？\n\n${allPaths.slice(0, 5).join('\n')}${allPaths.length > 5 ? '\n…' : ''}`
                )
              ) {
                return
              }
              setBusy(true)
              void onDelete(allPaths, true, true).finally(() => setBusy(false))
            }}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            一键清理全部 {allPaths.length}
          </Button>
        ) : null}
      </div>
      {result.groups.map((group) => (
        <DuplicateGroupCard key={group.id} group={group} onDelete={onDelete} />
      ))}
    </div>
  )
}

function DuplicateGroupCard({
  group,
  onDelete,
}: {
  group: DuplicateGroup
  onDelete: (paths: string[], deleteFiles: boolean, deleteRecords: boolean) => Promise<string[]>
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(group.remove.map((file) => file.path))
  )
  const [busy, setBusy] = useState(false)
  const paths = [...selected]

  async function run(deleteFiles: boolean, deleteRecords: boolean) {
    if (!paths.length) return
    const text = deleteFiles
      ? `确认永久删除 ${paths.length} 个文件？\n\n${paths.slice(0, 5).join('\n')}${paths.length > 5 ? '\n…' : ''}`
      : `确认删除 ${paths.length} 条下载记录？文件会保留。`
    if (!window.confirm(text)) return
    setBusy(true)
    try {
      await onDelete(paths, deleteFiles, deleteRecords)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.018] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={group.kind === 'exact' ? 'green' : 'amber'}>
              {group.kind === 'exact' ? '内容完全相同' : '同歌不同版本'}
            </Badge>
            <Badge tone={group.confidence === 'high' ? 'cyan' : 'neutral'}>
              {group.confidence === 'high' ? '高置信' : '中置信'}
            </Badge>
            <span className="truncate text-[12px] text-white/70">{group.title || '（无歌名）'}</span>
            <span className="text-[11px] text-white/30">{group.artist}</span>
          </div>
          <p className="mt-1 text-[10px] leading-4 text-white/25">{group.reason}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !paths.length}
            onClick={() => void run(false, true)}
          >
            仅删记录
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy || !paths.length}
            onClick={() => void run(true, true)}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            删文件+记录
          </Button>
        </div>
      </div>

      <div className="mt-2.5 space-y-1">
        <div className="rounded-lg border border-emerald-400/15 bg-emerald-500/[0.04] px-2.5 py-1.5">
          <div className="flex items-center gap-2 text-[10.5px] text-emerald-200/80">
            <CheckCircle2 className="h-3.5 w-3.5" /> 保留 · {group.keep.quality} ·{' '}
            {formatBytes(group.keep.size)}
          </div>
          <div className="truncate font-mono text-[9.5px] text-white/30">{group.keep.path}</div>
        </div>
        {group.remove.map((file) => {
          const checked = selected.has(file.path)
          return (
            <label
              key={file.path}
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-white/[0.05] px-2.5 py-1.5 hover:bg-white/[0.03]"
            >
              <input
                type="checkbox"
                className="mt-0.5 h-3.5 w-3.5 accent-violet-500"
                checked={checked}
                onChange={(event) => {
                  setSelected((current) => {
                    const next = new Set(current)
                    if (event.target.checked) next.add(file.path)
                    else next.delete(file.path)
                    return next
                  })
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[10.5px] text-white/45">
                  <span className="text-white/25">删除候选</span>
                  <span>{file.quality}</span>
                  <span>{formatBytes(file.size)}</span>
                  {file.hasCover ? <span>有封面</span> : null}
                  {file.hasLyrics ? <span>有歌词</span> : null}
                </div>
                <div className="truncate font-mono text-[9.5px] text-white/25">{file.path}</div>
              </div>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function AlbumPanel({
  task,
  onMerge,
  onMergeAll,
}: {
  task: TaskDto | undefined
  onMerge: (group: AlbumMergeGroup, album: string, albumArtist: string, paths: string[]) => Promise<void>
  onMergeAll: (groups: AlbumMergeGroup[]) => Promise<void>
}) {
  const result = parseResult<AlbumResult>(task)
  const [busy, setBusy] = useState(false)
  if (!result) return <EmptyState text="还没有专辑分析结果。扫描会找出同一专辑的多种写法。" />
  if (!result.groups.length) return <EmptyState text="没有发现需要合并的专辑。" />
  const fileCount = result.groups.reduce((sum, group) => sum + group.files.length, 0)
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
        <span className="text-[11px] text-white/45">
          {result.summary.groups} 组可合并 · 涉及 {result.summary.mergeableFiles} 个文件
        </span>
        <Button
          size="sm"
          className="ml-auto"
          disabled={busy}
          onClick={() => {
            if (
              !window.confirm(
                `确认一键合并 ${result.groups.length} 组专辑、共 ${fileCount} 个文件？\n只修改专辑标签，不会删除文件。`
              )
            ) {
              return
            }
            setBusy(true)
            void onMergeAll(result.groups).finally(() => setBusy(false))
          }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          一键全部合并
        </Button>
      </div>
      {result.groups.map((group) => (
        <AlbumGroupCard key={group.id} group={group} onMerge={onMerge} />
      ))}
    </div>
  )
}

function AlbumGroupCard({
  group,
  onMerge,
}: {
  group: AlbumMergeGroup
  onMerge: (group: AlbumMergeGroup, album: string, albumArtist: string, paths: string[]) => Promise<void>
}) {
  const [album, setAlbum] = useState(group.canonicalAlbum)
  const [albumArtist, setAlbumArtist] = useState(group.canonicalAlbumArtist)
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(group.files.map((file) => file.path))
  )
  const [busy, setBusy] = useState(false)
  const paths = [...selected]

  async function apply() {
    if (!paths.length || !album.trim()) return
    setBusy(true)
    try {
      await onMerge(group, album.trim(), albumArtist.trim(), paths)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.018] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={group.confidence === 'high' ? 'cyan' : 'amber'}>
              {group.confidence === 'high' ? '高置信' : '中置信'}
            </Badge>
            <span className="truncate text-[12px] text-white/70">{group.canonicalAlbum}</span>
          </div>
          <p className="mt-1 text-[10px] leading-4 text-white/25">{group.reason}</p>
        </div>
        <Button size="sm" disabled={busy || !paths.length || !album.trim()} onClick={() => void apply()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          合并选中
        </Button>
      </div>

      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
        <label className="text-[10px] text-white/30">
          统一后的专辑名
          <Input className="mt-1 h-8 text-[11px]" value={album} onChange={(e) => setAlbum(e.target.value)} />
        </label>
        <label className="text-[10px] text-white/30">
          专辑歌手
          <Input
            className="mt-1 h-8 text-[11px]"
            value={albumArtist}
            onChange={(e) => setAlbumArtist(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-2 max-h-56 space-y-1 overflow-auto">
        {group.files.map((file) => {
          const checked = selected.has(file.path)
          return (
            <label
              key={file.path}
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-white/[0.05] px-2.5 py-1.5 hover:bg-white/[0.03]"
            >
              <input
                type="checkbox"
                className="mt-0.5 h-3.5 w-3.5 accent-violet-500"
                checked={checked}
                onChange={(event) => {
                  setSelected((current) => {
                    const next = new Set(current)
                    if (event.target.checked) next.add(file.path)
                    else next.delete(file.path)
                    return next
                  })
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10.5px] text-white/55">
                  {file.track ? `${file.track}. ` : ''}
                  {file.title || '（无歌名）'}
                  <span className="ml-1.5 text-white/25">{file.artist}</span>
                </div>
                <div className="truncate text-[9.5px] text-white/25">
                  当前专辑：{file.album || '（空）'} · {file.path}
                </div>
              </div>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function WorkflowPanel({
  type,
  task,
  onApply,
}: {
  type: 'lyrics' | 'covers'
  task: TaskDto | undefined
  onApply: (paths?: string[]) => Promise<void>
}) {
  const result = parseResult<LyricsResult | CoverResult>(task)
  const [busy, setBusy] = useState(false)
  if (!result) {
    return (
      <EmptyState
        text={
          type === 'lyrics'
            ? '还没有歌词扫描结果。先扫描，确认问题清单后再自动修复。'
            : '还没有封面扫描结果。先扫描，确认问题清单后再自动补全。'
        }
      />
    )
  }
  const retryable = result.items
    .filter((item) => item.status === 'not_found' || item.status === 'failed')
    .map((item) => item.path)
  // 兼容旧结果：旧版本把“扫描后待修复”也记成 skipped。
  const pending = result.items
    .filter(
      (item) =>
        item.status === 'pending' ||
        (item.status === 'skipped' && item.note.startsWith('待修复'))
    )
    .map((item) => item.path)
  const allPending = [...new Set([...pending, ...retryable])]

  async function apply(paths?: string[]) {
    setBusy(true)
    try {
      await onApply(paths)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
        <span className="text-[11px] text-white/45">
          目标 {result.summary.targets} 个 · 已修复 {result.summary.fixed} · 未找到{' '}
          {result.summary.notFound} · 失败 {result.summary.failed}
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {allPending.length ? (
            <Button size="sm" disabled={busy} onClick={() => void apply(allPending)}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              一键修复全部 {allPending.length}
            </Button>
          ) : null}
          {retryable.length ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void apply(retryable)}>
              <RefreshCw className="h-3.5 w-3.5" /> 仅重试未找到/失败 {retryable.length}
            </Button>
          ) : null}
        </div>
      </div>

      {!result.items.length ? <EmptyState text="没有需要处理的文件。" /> : null}
      <div className="max-h-[520px] space-y-1 overflow-auto pr-1">
        {result.items.map((item) => (
          <div
            key={`${item.path}-${item.status}`}
            className="rounded-xl border border-white/[0.05] bg-white/[0.015] px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={workflowTone(item.status)}>{workflowLabel(item.status)}</Badge>
              <span className="min-w-0 flex-1 truncate text-[11px] text-white/65">
                {item.title || '（无歌名）'}
                <span className="ml-1.5 text-white/30">{item.artist}</span>
              </span>
              {item.source ? <span className="text-[9.5px] text-white/25">{item.source}</span> : null}
            </div>
            <div className="mt-0.5 truncate font-mono text-[9px] text-white/20">{item.path}</div>
            <div className="mt-0.5 text-[10px] leading-4 text-white/35">{item.note}</div>
            {'preview' in item && item.preview ? (
              <div className="mt-0.5 truncate text-[10px] text-white/25">{item.preview}</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

export function LibraryTools() {
  const [tab, setTab] = useState<LibraryTaskType>('audit')
  const [tasks, setTasks] = useState<Partial<Record<LibraryTaskType, TaskDto>>>({})
  const tasksRef = useRef(tasks)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  async function loadLatest() {
    try {
      const res = await fetch('/api/admin/library/tasks?latest=1', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '加载失败')
      const next: Partial<Record<LibraryTaskType, TaskDto>> = {}
      for (const task of json.data as TaskDto[]) next[task.type] = task
      setTasks(next)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  async function refreshRunning() {
    try {
      const res = await fetch('/api/admin/library/tasks', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || json.code !== 0) return
      const list = json.data as TaskDto[]
      setTasks((current) => {
        const next = { ...current }
        for (const task of list) {
          const previous = next[task.type as LibraryTaskType]
          if (!previous || previous.id !== task.id) continue
          next[task.type as LibraryTaskType] = { ...previous, ...task, result: previous.result }
        }
        return next
      })
      const current = tasksRef.current
      const needDetail = list.filter((task) => {
        const previous = current[task.type as LibraryTaskType]
        return (
          task.status === 'running' ||
          task.status === 'queued' ||
          (previous?.id === task.id && previous.status !== task.status)
        )
      })
      if (!needDetail.length) return
      const details = await Promise.all(
        needDetail.map(async (task) => {
          const detailRes = await fetch(`/api/admin/library/tasks/${task.id}`, { cache: 'no-store' })
          const detailJson = await detailRes.json()
          return detailRes.ok && detailJson.code === 0 ? (detailJson.data as TaskDto) : task
        })
      )
      setTasks((currentTasks) => {
        const next = { ...currentTasks }
        for (const task of details) next[task.type] = task
        return next
      })
    } catch {
      // 下一轮继续
    }
  }

  useEffect(() => {
    void loadLatest()
    const timer = setInterval(() => void refreshRunning(), 2500)
    return () => clearInterval(timer)
  }, [])

  function updateTaskResult<T>(
    type: LibraryTaskType,
    mutate: (result: T) => T
  ) {
    setTasks((current) => {
      const task = current[type]
      if (!task?.result) return current
      try {
        const parsed = JSON.parse(task.result) as T
        const next = mutate(parsed)
        return { ...current, [type]: { ...task, result: JSON.stringify(next) } }
      } catch {
        return current
      }
    })
  }

  async function start(type: LibraryTaskType, extra: Record<string, unknown> = {}) {
    try {
      const res = await fetch('/api/admin/library/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, ...extra }),
      })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '启动失败')
      const task = json.data as TaskDto
      setTasks((current) => ({ ...current, [type]: task }))
      toast.success(json.message || '任务已开始')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  async function deleteDuplicates(
    paths: string[],
    deleteFiles: boolean,
    deleteRecords: boolean
  ): Promise<string[]> {
    try {
      const res = await fetch('/api/admin/library/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'duplicate-delete', paths, deleteFiles, deleteRecords }),
      })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '清理失败')
      const { ok, failed, results } = json.data as {
        ok: number
        failed: number
        results: Array<{ path: string; ok: boolean; note: string }>
      }
      const okPaths = results.filter((item) => item.ok).map((item) => item.path)
      if (okPaths.length) {
        const okSet = new Set(okPaths)
        updateTaskResult<DuplicateResult>('duplicates', (result) => {
          const groups = result.groups
            .map((group) => ({
              ...group,
              remove: group.remove.filter((file) => !okSet.has(file.path)),
            }))
            .filter((group) => group.remove.length > 0)
          const remaining = groups.flatMap((group) => group.remove)
          return {
            ...result,
            groups,
            summary: {
              ...result.summary,
              groups: groups.length,
              removableFiles: remaining.length,
              removableBytes: remaining.reduce((sum, file) => sum + file.size, 0),
            },
          }
        })
      }
      if (failed) {
        toast.warning(`完成 ${ok} 个，失败 ${failed} 个`, {
          description: results.find((item) => !item.ok)?.note,
        })
      } else {
        toast.success(`已处理 ${ok} 个文件，列表已局部更新`)
      }
      return okPaths
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      return []
    }
  }

  async function mergeAlbums(
    group: AlbumMergeGroup,
    album: string,
    albumArtist: string,
    paths: string[]
  ) {
    const selected = paths
    if (!selected.length) return
    try {
      const res = await fetch('/api/admin/library/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'album-merge',
          files: selected.map((path) => ({ path })),
          album,
          albumArtist,
        }),
      })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '合并失败')
      const { ok, failed, results } = json.data as {
        ok: number
        failed: number
        results: Array<{ path: string; ok: boolean; note: string }>
      }
      if (failed) {
        toast.warning(`已合并 ${ok} 个，失败 ${failed} 个`, {
          description: results.find((item) => !item.ok)?.note,
        })
      } else {
        updateTaskResult<AlbumResult>('albums', (result) => {
          const groups = result.groups.filter((item) => item.id !== group.id)
          return {
            ...result,
            groups,
            summary: {
              ...result.summary,
              groups: groups.length,
              mergeableFiles: groups.reduce(
                (sum, item) =>
                  sum +
                  item.files.filter((file) => file.album !== item.canonicalAlbum).length,
                0
              ),
            },
          }
        })
        toast.success(`已合并 ${ok} 个文件到「${album}」，列表已局部更新`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  async function mergeAllAlbums(groups: AlbumMergeGroup[]) {
    if (!groups.length) return
    try {
      const res = await fetch('/api/admin/library/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'album-merge-all',
          groups: groups.map((group) => ({
            files: group.files.map((file) => ({ path: file.path })),
            album: group.canonicalAlbum,
            albumArtist: group.canonicalAlbumArtist,
          })),
        }),
      })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '批量合并失败')
      const { ok, failed, results } = json.data as {
        ok: number
        failed: number
        results: Array<{ path: string; ok: boolean; note: string }>
      }
      const okSet = new Set(results.filter((item) => item.ok).map((item) => item.path))
      if (okSet.size) {
        updateTaskResult<AlbumResult>('albums', (result) => {
          const nextGroups = result.groups.filter(
            (group) => !group.files.every((file) => okSet.has(file.path))
          )
          return {
            ...result,
            groups: nextGroups,
            summary: {
              ...result.summary,
              groups: nextGroups.length,
              mergeableFiles: nextGroups.reduce(
                (sum, item) =>
                  sum +
                  item.files.filter((file) => file.album !== item.canonicalAlbum).length,
                0
              ),
            },
          }
        })
      }
      if (failed) {
        toast.warning(`已合并 ${ok} 个，失败 ${failed} 个，失败项保留在列表中`, {
          description: results.find((item) => !item.ok)?.note,
        })
      } else {
        toast.success(`已一键合并 ${ok} 个文件，列表已局部更新`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  async function cleanupMissing(taskId: string, paths: string[]) {
    try {
      const res = await fetch('/api/admin/library/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'audit-cleanup', taskId, paths }),
      })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '清理失败')
      const data = json.data as { deleted: number; result: AuditResult | null }
      if (data.result) {
        const result = data.result
        const summary = `巡检 ${result.summary.totalFiles} 个文件：${result.summary.errorCount} 个错误、${result.summary.warnCount} 个警告、${result.summary.infoCount} 个提示；${result.missingFiles.length} 条下载记录找不到文件`
        setTasks((current) => {
          const task = current.audit
          if (!task) return current
          return {
            ...current,
            audit: { ...task, result: JSON.stringify(result), summary },
          }
        })
      }
      toast.success(`已删除 ${data.deleted} 条失效下载记录，未删除任何音乐文件`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  async function applyWorkflow(type: 'lyrics' | 'covers', paths?: string[]) {
    await start(type, { apply: true, ...(paths?.length ? { paths } : {}) })
  }

  const activeTask = tasks[tab]
  const running = activeTask?.status === 'running' || activeTask?.status === 'queued'
  const tabDef = useMemo(() => TABS.find((item) => item.type === tab) || TABS[0], [tab])

  return (
    <div className="animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">音乐库工具</h1>
          <p className="mt-1 text-[12px] text-white/35">
            直接扫描 NAS 下载目录，巡检、去重、合并专辑、补歌词和封面；所有写操作都需要你手动确认。
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void loadLatest()} disabled={loading}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> 刷新
        </Button>
      </div>

      <div className="mt-4 flex gap-1 overflow-x-auto rounded-2xl border border-white/[0.07] bg-white/[0.02] p-1.5">
        {TABS.map((item) => {
          const Icon = item.icon
          const task = tasks[item.type]
          return (
            <button
              key={item.type}
              type="button"
              onClick={() => setTab(item.type)}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[11.5px] font-medium transition-colors',
                tab === item.type
                  ? 'bg-white/[0.09] text-white'
                  : 'text-white/40 hover:bg-white/[0.05] hover:text-white/80'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
              {task?.status === 'running' ? (
                <Loader2 className="h-3 w-3 animate-spin text-violet-300" />
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="mt-3 rounded-2xl border border-white/[0.07] bg-white/[0.022] p-4">
        <TaskHeader
          tab={tabDef}
          task={activeTask}
          running={running}
          onRun={() => void start(tab)}
          extra={
            tab === 'lyrics' || tab === 'covers' ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={running}
                onClick={() => void applyWorkflow(tab)}
              >
                <Wand2 className="h-3.5 w-3.5" /> 扫描并自动修复
              </Button>
            ) : null
          }
        />
        <TaskProgress task={activeTask} />
        {tab === 'audit' ? <AuditPanel task={activeTask} onCleanupMissing={cleanupMissing} /> : null}
        {tab === 'duplicates' ? <DuplicatePanel task={activeTask} onDelete={deleteDuplicates} /> : null}
        {tab === 'albums' ? <AlbumPanel task={activeTask} onMerge={mergeAlbums} onMergeAll={mergeAllAlbums} /> : null}
        {tab === 'lyrics' ? (
          <WorkflowPanel type="lyrics" task={activeTask} onApply={(paths) => applyWorkflow('lyrics', paths)} />
        ) : null}
        {tab === 'covers' ? (
          <WorkflowPanel type="covers" task={activeTask} onApply={(paths) => applyWorkflow('covers', paths)} />
        ) : null}
      </div>

      <p className="mt-3 text-[10px] leading-4 text-white/20">
        说明：工具只修改下载目录内的音频文件；删除操作会二次确认。飞牛音乐的封面/歌词缓存和数据库不会自动刷新，
        文件写入后需要在飞牛音乐里重新扫描媒体库。
      </p>
    </div>
  )
}
