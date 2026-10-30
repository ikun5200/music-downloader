import { prisma } from '../db'

export interface AiUsageAggregate {
  calls: number
  success: number
  failed: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  avgLatencyMs: number
  successRate: number
}

export interface AiUsageFeature extends AiUsageAggregate {
  feature: string
}

export interface AiUsageDay extends AiUsageAggregate {
  day: string
}

export interface AiUsageError {
  feature: string
  model: string | null
  error: string
  createdAt: string
}

export interface AiUsageSummary {
  days: number
  since: string
  truncated: boolean
  totals: AiUsageAggregate
  today: AiUsageAggregate
  byFeature: AiUsageFeature[]
  byDay: AiUsageDay[]
  recentErrors: AiUsageError[]
}

interface UsageRow {
  feature: string
  model: string | null
  promptTokens: number
  completionTokens: number
  totalTokens: number
  latencyMs: number
  success: boolean
  error: string | null
  createdAt: Date
}

function emptyAggregate(): AiUsageAggregate {
  return {
    calls: 0,
    success: 0,
    failed: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    avgLatencyMs: 0,
    successRate: 0,
  }
}

function addRow(target: AiUsageAggregate, row: UsageRow): void {
  target.calls++
  if (row.success) target.success++
  else target.failed++
  target.promptTokens += row.promptTokens
  target.completionTokens += row.completionTokens
  target.totalTokens += row.totalTokens
  target.avgLatencyMs += row.latencyMs
}

function finish(target: AiUsageAggregate): AiUsageAggregate {
  target.avgLatencyMs = target.calls ? Math.round(target.avgLatencyMs / target.calls) : 0
  target.successRate = target.calls
    ? Math.round((target.success / target.calls) * 1000) / 10
    : 0
  return target
}

function dayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export async function getAiUsageSummary(days = 7): Promise<AiUsageSummary> {
  const windowDays = Math.max(1, Math.min(30, Math.round(days) || 7))
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  since.setDate(since.getDate() - (windowDays - 1))

  // 统计日志保留 90 天，避免 SQLite 无限增长。
  const retention = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  await prisma.aiUsageLog
    .deleteMany({ where: { createdAt: { lt: retention } } })
    .catch(() => {})

  const rows = await prisma.aiUsageLog.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 20_001,
    select: {
      feature: true,
      model: true,
      promptTokens: true,
      completionTokens: true,
      totalTokens: true,
      latencyMs: true,
      success: true,
      error: true,
      createdAt: true,
    },
  })
  const truncated = rows.length > 20_000
  const logs: UsageRow[] = truncated ? rows.slice(0, 20_000) : rows

  const totals = emptyAggregate()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const today = emptyAggregate()
  const features = new Map<string, AiUsageAggregate>()
  const daysMap = new Map<string, AiUsageAggregate>()
  const recentErrors: AiUsageError[] = []

  for (const row of logs) {
    addRow(totals, row)
    if (row.createdAt >= todayStart) addRow(today, row)

    const feature = features.get(row.feature) || emptyAggregate()
    addRow(feature, row)
    features.set(row.feature, feature)

    const key = dayKey(row.createdAt)
    const day = daysMap.get(key) || emptyAggregate()
    addRow(day, row)
    daysMap.set(key, day)

    if (!row.success && recentErrors.length < 8) {
      recentErrors.push({
        feature: row.feature,
        model: row.model,
        error: row.error || '未知错误',
        createdAt: row.createdAt.toISOString(),
      })
    }
  }

  return {
    days: windowDays,
    since: since.toISOString(),
    truncated,
    totals: finish(totals),
    today: finish(today),
    byFeature: [...features.entries()]
      .map(([feature, value]) => ({ feature, ...finish(value) }))
      .sort((a, b) => b.calls - a.calls || b.totalTokens - a.totalTokens),
    byDay: [...daysMap.entries()]
      .map(([day, value]) => ({ day, ...finish(value) }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    recentErrors,
  }
}
