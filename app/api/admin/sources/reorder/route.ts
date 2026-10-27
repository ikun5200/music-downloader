import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isAdmin } from '@/lib/auth'
import { PLATFORMS } from '@/lib/constants'
import { prisma } from '@/lib/db'
import { sourceManager } from '@/lib/sources/manager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({ ids: z.array(z.string().min(1)).min(1).max(200) })

export async function POST(req: Request) {
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
    return NextResponse.json({ code: 400, message: '参数错误' }, { status: 400 })
  }

  await prisma.$transaction(
    parsed.data.ids.map((id, index) =>
      prisma.source.update({ where: { id }, data: { priority: (index + 1) * 10 } })
    )
  )

  // 全局排序同步到每个平台的渠道顺序，使后台「上移/下移」立即影响自动选源。
  const priorityMap = Object.fromEntries(PLATFORMS.map((platform) => [platform, parsed.data.ids]))
  await prisma.setting.upsert({
    where: { key: 'platformPriority' },
    create: { key: 'platformPriority', value: JSON.stringify(priorityMap) },
    update: { value: JSON.stringify(priorityMap) },
  })

  sourceManager.invalidate()
  return NextResponse.json({ code: 0, data: { ok: true } })
}
