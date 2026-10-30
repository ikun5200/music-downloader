import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isAdmin } from '@/lib/auth'
import { ensureRuntime } from '@/lib/runtime'
import { deleteDuplicateFiles, mergeAlbums } from '@/lib/library/actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('duplicate-delete'),
    paths: z.array(z.string().min(1).max(1000)).min(1).max(10_000),
    deleteFiles: z.boolean(),
    deleteRecords: z.boolean(),
  }),
  z.object({
    action: z.literal('album-merge'),
    files: z.array(z.object({ path: z.string().min(1).max(1000) })).min(1).max(10_000),
    album: z.string().min(1).max(300),
    albumArtist: z.string().max(300).optional(),
  }),
])

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
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ code: 400, message: '参数错误' }, { status: 400 })
  }

  if (parsed.data.action === 'duplicate-delete') {
    const results = await deleteDuplicateFiles(parsed.data)
    return NextResponse.json({
      code: 0,
      data: {
        results,
        ok: results.filter((item) => item.ok).length,
        failed: results.filter((item) => !item.ok).length,
      },
    })
  }

  const results = await mergeAlbums(parsed.data)
  return NextResponse.json({
    code: 0,
    data: {
      results,
      ok: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
    },
  })
}
