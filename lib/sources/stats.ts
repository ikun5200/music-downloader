import type { Platform } from '../constants'
import { prisma } from '../db'

export async function recordStat(
  sourceId: string,
  platform: Platform,
  ok: boolean,
  elapsedMs: number,
  error?: string
) {
  const existing = await prisma.sourceStat.findUnique({
    where: { sourceId_platform: { sourceId, platform } },
  })
  const attempts = (existing?.attempts || 0) + 1
  const successes = (existing?.successes || 0) + (ok ? 1 : 0)
  const consecutiveFailures = ok ? 0 : (existing?.consecutiveFailures || 0) + 1
  const avgLatencyMs = ok
    ? Math.round(((existing?.avgLatencyMs || 0) * (attempts - 1) + elapsedMs) / attempts)
    : existing?.avgLatencyMs || 0
  const cooldownUntil = consecutiveFailures >= 3 ? new Date(Date.now() + 5 * 60 * 1000) : null

  await prisma.sourceStat.upsert({
    where: { sourceId_platform: { sourceId, platform } },
    create: {
      sourceId,
      platform,
      attempts,
      successes,
      consecutiveFailures,
      avgLatencyMs,
      cooldownUntil,
      lastSuccessAt: ok ? new Date() : null,
      lastError: ok ? null : (error || '未知错误').slice(0, 500),
    },
    update: {
      attempts,
      successes,
      consecutiveFailures,
      avgLatencyMs,
      cooldownUntil,
      lastSuccessAt: ok ? new Date() : existing?.lastSuccessAt,
      lastError: ok ? null : (error || '未知错误').slice(0, 500),
    },
  })
}
