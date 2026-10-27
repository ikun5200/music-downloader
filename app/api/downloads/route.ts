import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getClientIp } from '@/lib/auth'
import { type Platform } from '@/lib/constants'
import { rateLimit } from '@/lib/rate-limit'
import { prisma } from '@/lib/db'
import { createDownloadJob } from '@/lib/download/create-job'
import { jobToDto } from '@/lib/download/dto'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const createSchema = z.object({
  platform: z.enum(['kw', 'kg', 'tx', 'wy', 'mg']),
  musicInfo: z.record(z.unknown()),
  quality: z.string().max(30).optional().nullable(),
  title: z.string().max(300).optional(),
  artist: z.string().max(300).optional(),
  album: z.string().max(300).optional().nullable(),
  coverUrl: z.string().max(2000).optional().nullable(),
})

const PAGE_SIZE = 100

export async function GET(req: Request) {
  await ensureRuntime()
  const url = new URL(req.url)
  const rawLimit = Number(url.searchParams.get('limit') || PAGE_SIZE)
  const limit = Math.min(
    200,
    Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : PAGE_SIZE)
  )
  const beforeRaw = url.searchParams.get('before')
  const beforeId = url.searchParams.get('beforeId') || ''
  const parsedBefore = beforeRaw ? new Date(beforeRaw) : null
  const before = parsedBefore && !Number.isNaN(parsedBefore.getTime()) ? parsedBefore : null
  const where = before
    ? beforeId
      ? {
          OR: [
            { createdAt: { lt: before } },
            { createdAt: before, id: { lt: beforeId } },
          ],
        }
      : { createdAt: { lt: before } }
    : undefined

  const [jobs, total] = await Promise.all([
    prisma.downloadJob.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { channel: { select: { name: true } } },
    }),
    prisma.downloadJob.count(),
  ])

  const hasMore = jobs.length > limit
  const page = hasMore ? jobs.slice(0, limit) : jobs
  const last = page[page.length - 1]
  return NextResponse.json({
    code: 0,
    data: page.map(jobToDto),
    total,
    hasMore,
    nextCursor: last
      ? { createdAt: last.createdAt.toISOString(), id: last.id }
      : null,
  })
}

export async function POST(req: Request) {
  await ensureRuntime()
  const ip = getClientIp(req)
  const limit = rateLimit(`downloads:create:${ip}`, 20, 60_000)
  if (!limit.ok) {
    return NextResponse.json(
      { code: 429, message: `创建任务过于频繁，请 ${Math.ceil(limit.retryAfterMs / 1000)} 秒后再试` },
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
    return NextResponse.json({ code: 400, message: '参数不完整' }, { status: 400 })
  }

  const input = parsed.data
  try {
    const job = await createDownloadJob({
      platform: input.platform as Platform,
      musicInfo: input.musicInfo,
      quality: input.quality,
      title: input.title,
      artist: input.artist,
      album: input.album,
      coverUrl: input.coverUrl,
    })
    return NextResponse.json({ code: 0, data: jobToDto(job) }, { status: 201 })
  } catch (e) {
    return NextResponse.json(
      { code: 400, message: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    )
  }
}
