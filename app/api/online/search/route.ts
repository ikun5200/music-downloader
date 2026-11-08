import { NextResponse } from 'next/server'
import { getClientIp } from '@/lib/auth'
import { searchAppleMusic } from '@/lib/online/apple'
import { rateLimit } from '@/lib/rate-limit'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  await ensureRuntime()
  const ip = getClientIp(req)
  const limit = rateLimit(`online-search:${ip}`, 30, 60_000)
  if (!limit.ok) {
    return NextResponse.json({ code: 429, message: '搜索过于频繁，请稍后再试' }, { status: 429 })
  }
  const query = (new URL(req.url).searchParams.get('q') || '').trim()
  if (!query) return NextResponse.json({ code: 400, message: '请输入搜索关键词' }, { status: 400 })
  try {
    const data = await searchAppleMusic(query)
    return NextResponse.json({ code: 0, data })
  } catch (e) {
    return NextResponse.json(
      { code: 502, message: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    )
  }
}
