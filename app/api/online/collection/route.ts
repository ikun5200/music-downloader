import { NextResponse } from 'next/server'
import { getClientIp } from '@/lib/auth'
import { getAppleCollection } from '@/lib/online/apple'
import { rateLimit } from '@/lib/rate-limit'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  await ensureRuntime()
  const ip = getClientIp(req)
  const limit = rateLimit(`online-collection:${ip}`, 60, 60_000)
  if (!limit.ok) {
    return NextResponse.json({ code: 429, message: '请求过于频繁，请稍后再试' }, { status: 429 })
  }
  const url = new URL(req.url).searchParams.get('url') || ''
  if (!url) return NextResponse.json({ code: 400, message: '缺少 Apple Music 链接' }, { status: 400 })
  try {
    const data = await getAppleCollection(url)
    return NextResponse.json({ code: 0, data })
  } catch (e) {
    return NextResponse.json(
      { code: 502, message: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    )
  }
}
