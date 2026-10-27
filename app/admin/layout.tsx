import { requireAdminPage } from '@/lib/auth'
import { ensureRuntime } from '@/lib/runtime'
import { AdminNav } from '@/components/admin/admin-nav'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await ensureRuntime()
  await requireAdminPage()
  return (
    <div className="grid gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
      <AdminNav />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
