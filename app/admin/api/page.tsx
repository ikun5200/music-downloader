import { prisma } from '@/lib/db'
import { getPublicBaseUrl } from '@/lib/settings'
import { LxApiPanel } from '@/components/admin/lx-api-panel'

export const dynamic = 'force-dynamic'

export default async function ApiPage() {
  const tokens = await prisma.apiToken.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, enabled: true, lastUsedAt: true, createdAt: true },
  })
  return (
    <LxApiPanel
      publicBaseUrl={getPublicBaseUrl()}
      initialTokens={tokens.map((t) => ({
        id: t.id,
        name: t.name,
        enabled: t.enabled,
        lastUsedAt: t.lastUsedAt?.toISOString() || null,
        createdAt: t.createdAt.toISOString(),
      }))}
    />
  )
}
