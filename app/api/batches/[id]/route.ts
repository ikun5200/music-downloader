import { NextResponse } from 'next/server'
import { z } from 'zod'
import { wakeBatchQueue } from '@/lib/batch/queue'
import { getBatchDto } from '@/lib/batch/service'
import { prisma } from '@/lib/db'
import {
  cancelDownloadJobs,
  pauseDownloadJobs,
  resumeDownloadJobs,
} from '@/lib/download/queue'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const actionSchema = z.object({
  action: z.enum(['pause', 'resume', 'cancel']),
})

async function getId(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return id
}

async function waitForJobs(ids: string[], doneStatuses: string[], timeoutMs = 8000) {
  if (!ids.length) return
  const pending = new Set(ids)
  const deadline = Date.now() + timeoutMs
  while (pending.size && Date.now() < deadline) {
    const jobs = await prisma.downloadJob.findMany({
      where: { id: { in: [...pending] } },
      select: { id: true, status: true },
    })
    const found = new Set(jobs.map((job) => job.id))
    for (const job of jobs) {
      if (doneStatuses.includes(job.status)) pending.delete(job.id)
    }
    for (const id of [...pending]) if (!found.has(id)) pending.delete(id)
    if (pending.size) await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

async function currentJobIds(batchId: string) {
  const items = await prisma.batchItem.findMany({
    where: { batchId, downloadJobId: { not: null } },
    select: { downloadJobId: true },
  })
  return items
    .map((item) => item.downloadJobId)
    .filter((jobId): jobId is string => !!jobId)
}

async function cancelBatch(batchId: string, jobIds: string[]) {
  await prisma.$transaction([
    prisma.batchJob.updateMany({
      where: { id: batchId, status: { in: ['queued', 'running', 'paused', 'completed'] } },
      data: { status: 'canceled', finishedAt: new Date() },
    }),
    prisma.batchItem.updateMany({
      where: { batchId, status: { in: ['pending', 'searching'] } },
      data: { status: 'canceled' },
    }),
  ])
  const { active } = await cancelDownloadJobs(jobIds)
  await waitForJobs(active, ['completed', 'failed', 'canceled'])
  // 取消瞬间可能刚好新建了下载任务，补一次。
  await new Promise((resolve) => setTimeout(resolve, 200))
  const { active: lateActive } = await cancelDownloadJobs(await currentJobIds(batchId))
  await waitForJobs(lateActive, ['completed', 'failed', 'canceled'])
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await ensureRuntime()
  const id = await getId(ctx)
  const dto = await getBatchDto(id)
  if (!dto) return NextResponse.json({ code: 404, message: '批量任务不存在' }, { status: 404 })
  return NextResponse.json({ code: 0, data: dto })
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await ensureRuntime()
  const id = await getId(ctx)
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ code: 400, message: '请求格式错误' }, { status: 400 })
  }
  const parsed = actionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ code: 400, message: '未知操作' }, { status: 400 })
  }

  const batch = await prisma.batchJob.findUnique({
    where: { id },
    include: { items: { select: { downloadJobId: true } } },
  })
  if (!batch) return NextResponse.json({ code: 404, message: '批量任务不存在' }, { status: 404 })
  const jobIds = batch.items
    .map((item) => item.downloadJobId)
    .filter((jobId): jobId is string => !!jobId)
  const jobs = jobIds.length
    ? await prisma.downloadJob.findMany({
        where: { id: { in: jobIds } },
        select: { status: true },
      })
    : []
  const activeDownloads = jobs.some((job) =>
    ['queued', 'resolving', 'downloading'].includes(job.status)
  )
  const unfinishedDownloads = jobs.some((job) =>
    ['queued', 'resolving', 'downloading', 'paused'].includes(job.status)
  )

  if (parsed.data.action === 'pause') {
    const canPause =
      ['queued', 'running'].includes(batch.status) ||
      (batch.status === 'completed' && activeDownloads)
    if (!canPause) {
      return NextResponse.json({ code: 409, message: '当前状态不能暂停' }, { status: 409 })
    }
    const updated = await prisma.batchJob.updateMany({
      where: { id, status: { in: ['queued', 'running', 'completed'] } },
      data: { status: 'paused' },
    })
    if (!updated.count) {
      return NextResponse.json({ code: 409, message: '当前状态不能暂停' }, { status: 409 })
    }
    await prisma.batchItem.updateMany({
      where: { batchId: id, status: 'searching' },
      data: { status: 'pending' },
    })
    const active = await pauseDownloadJobs(jobIds)
    await waitForJobs(active, ['paused', 'completed', 'failed', 'canceled'])
    // 暂停瞬间可能刚好新建了下载任务，补一次。
    await new Promise((resolve) => setTimeout(resolve, 200))
    const lateActive = await pauseDownloadJobs(await currentJobIds(id))
    await waitForJobs(lateActive, ['paused', 'completed', 'failed', 'canceled'])
  } else if (parsed.data.action === 'resume') {
    if (batch.status !== 'paused') {
      return NextResponse.json({ code: 409, message: '当前状态不能继续' }, { status: 409 })
    }
    const updated = await prisma.batchJob.updateMany({
      where: { id, status: 'paused' },
      data: { status: 'queued', finishedAt: null },
    })
    if (!updated.count) {
      return NextResponse.json({ code: 409, message: '当前状态不能继续' }, { status: 409 })
    }
    await resumeDownloadJobs(jobIds)
    wakeBatchQueue()
  } else {
    const canCancel =
      ['queued', 'running', 'paused'].includes(batch.status) ||
      (batch.status === 'completed' && unfinishedDownloads)
    if (!canCancel) {
      return NextResponse.json({ code: 409, message: '任务已经结束' }, { status: 409 })
    }
    await cancelBatch(id, jobIds)
  }

  return NextResponse.json({ code: 0, data: await getBatchDto(id) })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await ensureRuntime()
  const id = await getId(ctx)
  const batch = await prisma.batchJob.findUnique({
    where: { id },
    include: { items: { select: { downloadJobId: true } } },
  })
  if (!batch) return NextResponse.json({ code: 404, message: '批量任务不存在' }, { status: 404 })

  const jobIds = batch.items
    .map((item) => item.downloadJobId)
    .filter((jobId): jobId is string => !!jobId)
  const jobs = jobIds.length
    ? await prisma.downloadJob.findMany({
        where: { id: { in: jobIds } },
        select: { status: true },
      })
    : []
  const unfinished = jobs.some((job) =>
    ['queued', 'resolving', 'downloading', 'paused'].includes(job.status)
  )

  if (['queued', 'running', 'paused'].includes(batch.status) || (batch.status === 'completed' && unfinished)) {
    await cancelBatch(id, jobIds)
    return NextResponse.json({ code: 0, data: { canceled: true } })
  }

  await prisma.batchJob.delete({ where: { id } })
  return NextResponse.json({ code: 0, data: { deleted: true } })
}
