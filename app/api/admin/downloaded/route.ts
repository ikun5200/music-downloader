import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/auth'
import { prisma } from '@/lib/db'
import {
  getDownloadedIndexStatus,
  refreshDownloadedIndex,
} from '@/lib/downloaded'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  await ensureRuntime()
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 })
  }
  const url = new URL(req.url)
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100)
  const take = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100) || 100))
  const [status, items] = await Promise.all([
    getDownloadedIndexStatus(),
    prisma.downloadedTrack.findMany({
      where: q
        ? {
            OR: [
              { title: { contains: q } },
              { artist: { contains: q } },
              { album: { contains: q } },
              { path: { contains: q } },
            ],
          }
        : undefined,
      orderBy: [{ updatedAt: 'desc' }, { path: 'asc' }],
      take,
    }),
  ])
  return NextResponse.json({
    code: 0,
    data: {
      ...status,
      items: items.map((item) => ({
        id: item.id,
        path: item.path,
        title: item.title,
        artist: item.artist,
        album: item.album,
        duration: item.duration,
        size: item.size,
        versionKey: item.versionKey,
        updatedAt: item.updatedAt.toISOString(),
      })),
    },
  })
}

export async function POST() {
  await ensureRuntime()
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 })
  }
  try {
    const result = await refreshDownloadedIndex()
    return NextResponse.json({ code: 0, data: result })
  } catch (error) {
    return NextResponse.json(
      { code: 500, message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
