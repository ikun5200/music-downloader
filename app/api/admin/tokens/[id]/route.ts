import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isAdmin } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({ enabled: z.boolean() })

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 })
  }
  const { id } = await ctx.params
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ code: 400, message: '请求格式错误' }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ code: 400, message: '参数错误' }, { status: 400 })
  }
  const row = await prisma.apiToken.update({
    where: { id },
    data: { enabled: parsed.data.enabled },
    select: { id: true, name: true, enabled: true, lastUsedAt: true, createdAt: true },
  })
  return NextResponse.json({ code: 0, data: row })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 })
  }
  const { id } = await ctx.params
  await prisma.apiToken.delete({ where: { id } })
  return NextResponse.json({ code: 0, data: { deleted: true } })
}
