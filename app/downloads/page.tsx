import { redirect } from 'next/navigation'
import { DownloadsClient } from '@/components/downloads-client'
import { isAdmin } from '@/lib/auth'
import { getSettings } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export default async function DownloadsPage() {
  const settings = await getSettings().catch(() => null)
  if (settings?.guestDownloadDisabled && !(await isAdmin())) {
    redirect('/login?next=/downloads')
  }
  return <DownloadsClient />
}
