import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createSessionToken, getClientIp, setSessionCookie, verifyAdminCredentials } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1).max(200),
})

export async function POST(req: Request) {
  const ip = getClientIp(req)
  const limit = rateLimit(`login:${ip}`, 8, 15 * 60 * 1000)
  if (!limit.ok) {
    return NextResponse.json(
      { code: 429, message: `尝试次数过多，请 ${Math.ceil(limit.retryAfterMs / 60000)} 分钟后再试` },
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
    return NextResponse.json({ code: 400, message: '请输入用户名和密码' }, { status: 400 })
  }

  if (!(await verifyAdminCredentials(parsed.data.username, parsed.data.password))) {
    return NextResponse.json({ code: 401, message: '用户名或密码错误' }, { status: 401 })
  }

  const token = await createSessionToken()
  await setSessionCookie(token)
  return NextResponse.json({ code: 0, data: { ok: true } })
}
