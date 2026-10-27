import fs from 'fs/promises'
import path from 'path'
import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { jobToDto } from '@/lib/download/dto'
import { resolveInside, resolveDownloadRoot } from '@/lib/download/filename'
import { cancelJob } from '@/lib/download/pipeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function getId(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return id
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = await getId(ctx)
  const job = await prisma.downloadJob.findUnique({ where: { id } })
  if (!job) return NextResponse.json({ code: 404, message: '任务不存在' }, { status: 404 })
  return NextResponse.json({ code: 0, data: jobToDto(job) })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = await getId(ctx)
  const job = await prisma.downloadJob.findUnique({ where: { id } })
  if (!job) return NextResponse.json({ code: 404, message: '任务不存在' }, { status: 404 })

  const wantsFile = new URL(req.url).searchParams.get('deleteFile') === '1'
  if (wantsFile && !(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '删除文件需要管理员权限' }, { status: 401 })
  }

  if (['resolving', 'downloading'].includes(job.status)) {
    cancelJob(id)
    return NextResponse.json({ code: 0, data: { canceled: true } })
  }
  if (job.status === 'queued') {
    await prisma.downloadJob.update({
      where: { id },
      data: { status: 'canceled', finishedAt: new Date() },
    })
  }

  if (wantsFile && job.filePath) {
    try {
      const root = resolveDownloadRoot()
      const absolute = resolveInside(root, job.filePath)
      await fs.unlink(absolute)
    } catch {
      // 文件不存在时忽略
    }
  }

  await prisma.downloadJob.delete({ where: { id } })
  return NextResponse.json({ code: 0, data: { deleted: true } })
}
