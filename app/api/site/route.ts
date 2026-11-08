import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/auth'
import { getSettings } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 公开给前端判断游客态；不包含任何敏感设置。 */
export async function GET() {
  const [settings, admin] = await Promise.all([
    getSettings().catch(() => null),
    isAdmin().catch(() => false),
  ])
  return NextResponse.json({
    code: 0,
    data: {
      guestDownloadDisabled: !!settings?.guestDownloadDisabled,
      isAdmin: admin,
    },
  })
}
