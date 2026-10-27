import Link from 'next/link'
import { ArrowUpRight, CheckCircle2, Clock3, Database, Layers, XCircle } from 'lucide-react'
import { prisma } from '@/lib/db'
import { jobToDto } from '@/lib/download/dto'
import { getDisplayDownloadDir, getSettings } from '@/lib/settings'
import { PLATFORM_NAMES, type Platform } from '@/lib/constants'
import { Badge } from '@/components/ui/badge'
import { PlatformBadge } from '@/components/platform-badge'
import { formatBytes } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const statusTone: Record<string, 'neutral' | 'violet' | 'cyan' | 'green' | 'red' | 'amber'> = {
  queued: 'neutral',
  resolving: 'violet',
  downloading: 'cyan',
  completed: 'green',
  failed: 'red',
  canceled: 'amber',
}

export default async function AdminDashboard() {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const [
    total,
    today,
    completed,
    failed,
    active,
    sources,
    enabledSources,
    bytes,
    recent,
    settings,
  ] = await Promise.all([
    prisma.downloadJob.count(),
    prisma.downloadJob.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.downloadJob.count({ where: { status: 'completed' } }),
    prisma.downloadJob.count({ where: { status: 'failed' } }),
    prisma.downloadJob.count({
      where: { status: { in: ['queued', 'resolving', 'downloading'] } },
    }),
    prisma.source.count(),
    prisma.source.count({ where: { enabled: true } }),
    prisma.downloadJob.aggregate({ _sum: { bytesDone: true } }),
    prisma.downloadJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { channel: { select: { name: true } } },
    }),
    getSettings(),
  ])

  const successRate = completed + failed > 0 ? Math.round((completed / (completed + failed)) * 100) : 0
  const cards = [
    { label: '总任务', value: String(total), hint: `今日 ${today}`, icon: Database },
    { label: '进行中', value: String(active), hint: '队列 + 下载', icon: Clock3 },
    {
      label: '成功率',
      value: `${successRate}%`,
      hint: `${completed} 成功 / ${failed} 失败`,
      icon: CheckCircle2,
    },
    {
      label: '已下载',
      value: formatBytes(bytes._sum.bytesDone || 0),
      hint: '累计写入磁盘',
      icon: Layers,
    },
  ]

  return (
    <div className="animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">概览</h1>
          <p className="mt-1 text-[12px] text-white/35">
            当前音源 {enabledSources}/{sources} 个启用 · 下载目录 {getDisplayDownloadDir()}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/sources"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-[12px] text-white/65 hover:border-white/20 hover:text-white"
          >
            管理渠道 <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            href="/admin/api"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-violet-400/25 bg-violet-500/10 px-3 text-[12px] text-violet-200 hover:bg-violet-500/20"
          >
            洛雪 API <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <div key={card.label} className="rounded-2xl border border-white/[0.07] bg-white/[0.022] p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-white/35">
                  {card.label}
                </span>
                <Icon className="h-4 w-4 text-violet-300/60" />
              </div>
              <div className="mt-2 text-[26px] font-semibold tracking-tight text-white">
                {card.value}
              </div>
              <div className="mt-0.5 text-[10.5px] text-white/25">{card.hint}</div>
            </div>
          )
        })}
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.022]">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <span className="text-[12px] font-medium text-white/70">最近任务</span>
            <Link href="/downloads" className="text-[11px] text-violet-300/70 hover:text-violet-200">
              查看全部
            </Link>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {recent.length ? (
              recent.map((job) => {
                const dto = jobToDto(job)
                return (
                  <div key={job.id} className="flex items-center gap-2.5 px-4 py-2.5">
                    <PlatformBadge platform={job.platform as Platform} showName={false} className="border-0 bg-transparent px-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] text-white/80">
                        {job.title}
                        <span className="text-white/30"> · {job.artist}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-white/25">
                        <span>{PLATFORM_NAMES[job.platform as Platform]}</span>
                        <span>·</span>
                        <span>{job.channel?.name || '未分配渠道'}</span>
                        {dto.actualQuality ? <span>· {dto.actualQuality}</span> : null}
                      </div>
                    </div>
                    <Badge tone={statusTone[job.status] || 'neutral'}>
                      {job.status === 'completed'
                        ? '完成'
                        : job.status === 'failed'
                          ? '失败'
                          : job.status === 'downloading'
                            ? '下载中'
                            : job.status === 'resolving'
                              ? '解析中'
                              : job.status === 'canceled'
                                ? '已取消'
                                : '排队'}
                    </Badge>
                  </div>
                )
              })
            ) : (
              <div className="px-4 py-10 text-center text-[11px] text-white/25">还没有任务</div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.022] p-4">
          <div className="text-[12px] font-medium text-white/70">当前策略</div>
          <div className="mt-3 space-y-2.5 text-[11.5px]">
            <div className="flex items-center justify-between">
              <span className="text-white/35">音质策略</span>
              <span className="text-white/75">
                {settings.qualityStrategy === 'strict'
                  ? '严格最高'
                  : settings.qualityStrategy === 'flacFirst'
                    ? 'FLAC 优先'
                    : '最高可用 + 回退'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/35">并发下载</span>
              <span className="text-white/75">{settings.maxConcurrent}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/35">错歌校验</span>
              <span className="text-white/75">{settings.verifyWrongSong ? '开启' : '关闭'}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="shrink-0 text-white/35">命名模板</span>
              <code className="truncate text-[10.5px] text-white/55">{settings.filenameTemplate}</code>
            </div>
          </div>
          <Link
            href="/admin/settings"
            className="mt-4 inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 px-2.5 text-[11px] text-white/55 hover:text-white"
          >
            调整设置 <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  )
}
