import fs from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { parseSourceHeader } from '@/lib/sources/parser'
import { getSourcesDir, sourceManager } from '@/lib/sources/manager'
import { safeJson } from '@/lib/utils'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function serializeSource(source: any) {
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

export async function GET() {
  await ensureRuntime()
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 })
  }
  const sources = await prisma.source.findMany({
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    include: { stats: true },
  })
  return NextResponse.json({ code: 0, data: sources.map(serializeSource) })
}

export async function POST(req: Request) {
  await ensureRuntime()
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ code: 400, message: '上传格式错误' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ code: 400, message: '请选择 .js 音源文件' }, { status: 400 })
  }
  if (!file.name.toLowerCase().endsWith('.js')) {
    return NextResponse.json({ code: 400, message: '只支持 .js 文件' }, { status: 400 })
  }
  if (file.size > 2 * 1024 * 1024) {
    return NextResponse.json({ code: 400, message: '文件不能超过 2MB' }, { status: 400 })
  }

  const code = await file.text()
  if (!code.includes('globalThis.lx') && !code.includes('globalThis[\'lx\']')) {
    return NextResponse.json(
      { code: 400, message: '这看起来不是洛雪自定义源脚本' },
      { status: 400 }
    )
  }

  const header = parseSourceHeader(code)
  const existing = await prisma.source.findFirst({ where: { fileName: file.name } })
  if (existing) {
    return NextResponse.json({ code: 409, message: '同名音源已存在' }, { status: 409 })
  }

  const id = randomUUID()
  const dir = getSourcesDir()
  await fs.mkdir(dir, { recursive: true })
  const fileName = path.basename(file.name)
  const diskName = `${id}.js`
  const diskPath = path.join(dir, diskName)
  await fs.writeFile(diskPath, code, 'utf8')

  const max = await prisma.source.aggregate({ _max: { priority: true } })
  const source = await prisma.source.create({
    data: {
      id,
      name: header.name,
      version: header.version || null,
      fileName,
      filePath: path.join('data', 'sources', diskName),
      enabled: true,
      priority: (max._max.priority || 0) + 10,
      platforms: '[]',
      qualities: '{}',
    },
    include: { stats: true },
  })

  sourceManager.invalidate()
  let initError: string | null = null
  try {
    await sourceManager.ensureLoaded(id)
  } catch (e) {
    initError = e instanceof Error ? e.message : String(e)
  }

  const fresh = await prisma.source.findUnique({
    where: { id },
    include: { stats: true },
  })
  return NextResponse.json(
    { code: 0, data: serializeSource(fresh || source), initError },
    { status: 201 }
  )
}
