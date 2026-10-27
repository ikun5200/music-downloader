import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getClientIp } from '@/lib/auth'
import { batchesToDto } from '@/lib/batch/service'
import { wakeBatchQueue } from '@/lib/batch/queue'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const createSchema = z.object({
  lines: z.array(z.string().trim().min(1).max(500)).min(1),
  quality: z.string().max(30).optional().nullable(),
})

export async function GET(req: Request) {
  await ensureRuntime()
  const url = new URL(req.url)
  const limit = Math.min(30, Math.max(1, Number(url.searchParams.get('limit') || 10) || 10))
  const batches = await prisma.batchJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  })
  return NextResponse.json({ code: 0, data: await batchesToDto(batches) })
}

export async function POST(req: Request) {
  await ensureRuntime()

  const ip = getClientIp(req)
  const limit = rateLimit(`batch:create:${ip}`, 10, 60_000)
  if (!limit.ok) {
    return NextResponse.json(
      { code: 429, message: `提交过于频繁，请 ${Math.ceil(limit.retryAfterMs / 1000)} 秒后再试` },
      { status: 429 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ code: 400, message: '请求体不是有效 JSON' }, { status: 400 })
  }
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { code: 400, message: '批量名单格式错误（每行 1–500 字）' },
      { status: 400 }
    )
  }

  const lines = parsed.data.lines.map((line) => line.trim()).filter(Boolean)
  if (!lines.length) {
    return NextResponse.json({ code: 400, message: '名单为空' }, { status: 400 })
  }

  const quality =
    parsed.data.quality && parsed.data.quality !== 'auto' ? parsed.data.quality : null

  const batch = await prisma.batchJob.create({
    data: {
      status: 'queued',
      quality,
      total: lines.length,
    },
  })

  try {
    // 名单不设上限；分块写入，避免一次性绑定过多 SQLite 参数。
    const CHUNK = 400
    for (let offset = 0; offset < lines.length; offset += CHUNK) {
      await prisma.batchItem.createMany({
        data: lines.slice(offset, offset + CHUNK).map((line) => ({ batchId: batch.id, line })),
      })
    }
  } catch (e) {
    await prisma.batchJob.delete({ where: { id: batch.id } }).catch(() => {})
    throw e
  }

  const full = await prisma.batchJob.findUnique({
    where: { id: batch.id },
    include: { items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  })
  if (!full) {
    return NextResponse.json({ code: 500, message: '批量任务创建失败' }, { status: 500 })
  }

  wakeBatchQueue()
  const [dto] = await batchesToDto([full])
  return NextResponse.json({ code: 0, data: dto }, { status: 201 })
}
