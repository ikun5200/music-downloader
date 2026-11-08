import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getClientIp } from '@/lib/auth'
import { resolveOnlinePlay } from '@/lib/online/resolve'
import { rateLimit } from '@/lib/rate-limit'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 45

const schema = z.object({
  title: z.string().min(1).max(300),
  artist: z.string().max(300).optional().default(''),
  album: z.string().max(300).optional().default(''),
  duration: z.number().min(0).max(86_400).optional().nullable(),
  quality: z.enum(['auto', '128k', '320k', 'flac']).optional().nullable(),
})

export async function POST(req: Request) {
  await ensureRuntime()
  const ip = getClientIp(req)
  const limit = rateLimit(`online-play:${ip}`, 40, 60_000)
  if (!limit.ok) {
    return NextResponse.json(
      { code: 429, message: `播放请求过于频繁，请 ${Math.ceil(limit.retryAfterMs / 1000)} 秒后再试` },
      { status: 429 }
    )
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ code: 400, message: '请求格式错误' }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ code: 400, message: '歌曲信息不完整' }, { status: 400 })
  }
  try {
    const data = await resolveOnlinePlay(parsed.data)
    return NextResponse.json({ code: 0, data })
  } catch (e) {
    return NextResponse.json(
      { code: 502, message: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    )
  }
}
