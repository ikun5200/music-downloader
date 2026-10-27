import { NextResponse } from 'next/server'
import { z } from 'zod'
import { generateApiToken, isAdmin } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({ name: z.string().min(1).max(80) })

export async function GET() {
  await ensureRuntime()
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 })
  }
  const tokens = await prisma.apiToken.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, enabled: true, lastUsedAt: true, createdAt: true },
  })
  return NextResponse.json({ code: 0, data: tokens })
}

export async function POST(req: Request) {
  await ensureRuntime()
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 })
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ code: 400, message: '请求格式错误' }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ code: 400, message: '请输入 Token 名称' }, { status: 400 })
  }

  const { token, hash } = generateApiToken()
  const row = await prisma.apiToken.create({
    data: { name: parsed.data.name, tokenHash: hash },
  })
  return NextResponse.json({
    code: 0,
    data: { id: row.id, name: row.name, token, createdAt: row.createdAt.toISOString() },
  })
}
