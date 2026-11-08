import { NextResponse } from 'next/server'
import { getAppleNewHome } from '@/lib/online/apple'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  await ensureRuntime()
  const data = await getAppleNewHome()
  return NextResponse.json({ code: 0, data })
}
