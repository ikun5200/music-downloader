import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/auth'
import { ensureRuntime } from '@/lib/runtime'
import { getAiUsageSummary } from '@/lib/ai/usage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  await ensureRuntime()
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 })
  }
  const days = Number(new URL(req.url).searchParams.get('days') || '7')
  try {
    const data = await getAiUsageSummary(Number.isFinite(days) ? days : 7)
    return NextResponse.json({ code: 0, data })
  } catch (error) {
    return NextResponse.json(
      { code: 500, message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
