import fs from 'fs/promises'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isAdmin } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getSourcesDir, resolveSourcePath, sourceManager } from '@/lib/sources/manager'
import { safeJson } from '@/lib/utils'
import path from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(100000).optional(),
  name: z.string().min(1).max(120).optional(),
})

function serialize(source: any) {
  return {
    id: source.id,
    name: source.name,
    version: source.version,
    fileName: source.fileName,
    filePath: source.filePath,
    enabled: source.enabled,
    priority: source.priority,
    platforms: safeJson(source.platforms, []),
    qualities: safeJson(source.qualities, {}),
    lastInitAt: source.lastInitAt?.toISOString() || null,
    lastError: source.lastError,
    createdAt: source.createdAt.toISOString(),
    stats: source.stats || [],
    loaded: sourceManager.getStatus(source.id).loaded,
    logs: sourceManager.getStatus(source.id).logs.slice(-30),
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 })
  }
  const { id } = await ctx.params
  const existing = await prisma.source.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ code: 404, message: '音源不存在' }, { status: 404 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ code: 400, message: '请求格式错误' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ code: 400, message: '参数错误' }, { status: 400 })
  }

  const source = await prisma.source.update({
    where: { id },
    data: parsed.data,
    include: { stats: true },
  })
  sourceManager.invalidate()

  if (parsed.data.enabled === false) {
    await sourceManager.dispose(id)
  } else if (parsed.data.enabled === true) {
    try {
      await sourceManager.ensureLoaded(id)
    } catch {
      // 错误已写入 lastError
    }
  }

  const fresh = await prisma.source.findUnique({ where: { id }, include: { stats: true } })
  return NextResponse.json({ code: 0, data: serialize(fresh || source) })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 })
  }
  const { id } = await ctx.params
  const source = await prisma.source.findUnique({ where: { id } })
  if (!source) return NextResponse.json({ code: 404, message: '音源不存在' }, { status: 404 })

  await sourceManager.dispose(id)
  try {
    const absolute = resolveSourcePath(source.filePath)
    const root = getSourcesDir()
    const resolved = path.resolve(absolute)
    if (resolved.startsWith(path.resolve(root))) await fs.unlink(resolved)
  } catch {
    // 文件不存在时忽略
  }
  await prisma.source.delete({ where: { id } })
  sourceManager.invalidate()
  return NextResponse.json({ code: 0, data: { deleted: true } })
}
