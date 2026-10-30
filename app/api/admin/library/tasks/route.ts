import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isAdmin } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { ensureRuntime } from '@/lib/runtime'
import { recoverInterruptedTasks, startLibraryTask } from '@/lib/library/runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const typeSchema = z.enum(['audit', 'duplicates', 'albums', 'lyrics', 'covers'])

const startSchema = z.object({
  type: typeSchema,
  apply: z.boolean().optional(),
  paths: z.array(z.string().min(1).max(1000)).max(10_000).optional(),
  checkCover: z.boolean().optional(),
})

const TYPES = ['audit', 'duplicates', 'albums', 'lyrics', 'covers'] as const

export async function GET(req: Request) {
  await ensureRuntime()
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 })
  }
  await recoverInterruptedTasks()
  const latest = new URL(req.url).searchParams.get('latest') === '1'
  if (latest) {
    const tasks = await Promise.all(
      TYPES.map((type) =>
        prisma.libraryTask.findFirst({
          where: { type },
          orderBy: { createdAt: 'desc' },
        })
      )
    )
    return NextResponse.json({ code: 0, data: tasks.filter(Boolean) })
  }

  const tasks = await prisma.libraryTask.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      id: true,
      type: true,
      status: true,
      total: true,
      processed: true,
      progress: true,
      summary: true,
      error: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
    },
  })
  return NextResponse.json({ code: 0, data: tasks })
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
  const parsed = startSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ code: 400, message: '参数错误' }, { status: 400 })
  }
  const { task, existing } = await startLibraryTask(parsed.data.type, {
    apply: parsed.data.apply,
    paths: parsed.data.paths,
    checkCover: parsed.data.checkCover,
  })
  return NextResponse.json({
    code: 0,
    data: task,
    message: existing ? '已有同类型任务在运行，已返回该任务' : '任务已开始',
  })
}
