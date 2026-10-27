import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sourceManager } from '@/lib/sources/manager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 })
  }
  const { id } = await ctx.params
  const source = await prisma.source.findUnique({ where: { id } })
  if (!source) return NextResponse.json({ code: 404, message: '音源不存在' }, { status: 404 })

  try {
    const loaded = await sourceManager.reload(id)
    return NextResponse.json({ code: 0, data: loaded })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await prisma.source
      .update({ where: { id }, data: { lastError: message, lastInitAt: new Date() } })
      .catch(() => {})
    return NextResponse.json({ code: 400, message }, { status: 400 })
  }
}
