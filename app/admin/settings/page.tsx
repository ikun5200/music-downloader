import { getDisplayDownloadDir, getPublicBaseUrl, getSettings } from '@/lib/settings'
import { SettingsForm } from '@/components/admin/settings-form'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const settings = await getSettings()
  return (
    <SettingsForm
      initial={settings}
      downloadDir={getDisplayDownloadDir()}
      publicBaseUrl={getPublicBaseUrl()}
    />
  )
}
