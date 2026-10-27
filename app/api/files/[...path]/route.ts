import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/auth'
import { resolveDownloadRoot, resolveInside } from '@/lib/download/filename'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.ape': 'audio/x-ape',
}

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 })
  }
  const { path: parts } = await ctx.params
  // Next.js 已对动态段做过 URL 解码，这里不要再 decode，避免文件名中的 % 触发异常。
  const relative = parts.join('/')

  let absolute: string
  try {
    absolute = resolveInside(resolveDownloadRoot(), relative)
  } catch {
    return NextResponse.json({ code: 400, message: '非法路径' }, { status: 400 })
  }

  try {
    const stat = await fsp.stat(absolute)
    if (!stat.isFile()) throw new Error('not file')
    const ext = path.extname(absolute).toLowerCase()
    const filename = path.basename(absolute)
    const stream = Readable.toWeb(fs.createReadStream(absolute)) as ReadableStream
    return new Response(stream, {
      headers: {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': String(stat.size),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return NextResponse.json({ code: 404, message: '文件不存在' }, { status: 404 })
  }
}
