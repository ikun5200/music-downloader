import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  await ensureRuntime()
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 })
  }
  const { id } = await ctx.params
  const task = await prisma.libraryTask.findUnique({ where: { id } })
  if (!task) return NextResponse.json({ code: 404, message: '任务不存在' }, { status: 404 })
  return NextResponse.json({ code: 0, data: task })
}
