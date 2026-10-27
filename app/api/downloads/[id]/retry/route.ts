import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { wakeQueue } from '@/lib/download/queue'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await ensureRuntime()
  const { id } = await ctx.params
  const job = await prisma.downloadJob.findUnique({ where: { id } })
  if (!job) return NextResponse.json({ code: 404, message: '任务不存在' }, { status: 404 })
  if (job.status === 'completed') {
    return NextResponse.json({ code: 400, message: '已完成的任务不能重试' }, { status: 400 })
  }
  if (['resolving', 'downloading'].includes(job.status)) {
    return NextResponse.json({ code: 409, message: '任务正在执行' }, { status: 409 })
  }

  const updated = await prisma.downloadJob.update({
    where: { id },
    data: {
      status: 'queued',
      progress: 0,
      bytesDone: 0,
      bytesTotal: null,
      actualQuality: null,
      qualityVerdict: null,
      filePath: null,
      urlHost: null,
      attempts: '[]',
      error: null,
      verified: false,
      reviewNote: null,
      startedAt: null,
      finishedAt: null,
    },
  })
  wakeQueue()
  return NextResponse.json({ code: 0, data: { id: updated.id, status: updated.status } })
}
