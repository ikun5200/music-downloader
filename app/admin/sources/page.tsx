import { prisma } from '@/lib/db'
import { sourceManager } from '@/lib/sources/manager'
import { safeJson } from '@/lib/utils'
import { SourceManager } from '@/components/admin/source-manager'

export const dynamic = 'force-dynamic'

export default async function SourcesPage() {
  const sources = await prisma.source.findMany({
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    include: { stats: true },
  })

  const initial = sources.map((source) => ({
    id: source.id,
    name: source.name,
    version: source.version,
    fileName: source.fileName,
    filePath: source.filePath,
    enabled: source.enabled,
    priority: source.priority,
    platforms: safeJson<string[]>(source.platforms, []),
    qualities: safeJson<Record<string, string[]>>(source.qualities, {}),
    lastInitAt: source.lastInitAt?.toISOString() || null,
    lastError: source.lastError,
    createdAt: source.createdAt.toISOString(),
    stats: source.stats.map((stat) => ({
      platform: stat.platform,
      attempts: stat.attempts,
      successes: stat.successes,
      consecutiveFailures: stat.consecutiveFailures,
      cooldownUntil: stat.cooldownUntil?.toISOString() || null,
      avgLatencyMs: stat.avgLatencyMs,
      lastError: stat.lastError,
    })),
    loaded: sourceManager.getStatus(source.id).loaded,
    logs: sourceManager.getStatus(source.id).logs.slice(-30),
  }))

  return <SourceManager initialSources={initial} />
}
