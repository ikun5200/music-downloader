import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { wakeMetadataQueue } from '@/lib/metadata/queue'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 把历史已完成但未刮削（或被跳过/失败）的下载任务重新放回刮削队列。
 * 默认不重复处理已经成功的任务，避免无谓的接口请求。
 */
export async function POST(req: Request) {
  await ensureRuntime()
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 })
  }

  let force = false
  try {
    const body = (await req.json()) as { force?: unknown }
    force = body?.force === true
  } catch {
    // 允许空请求体
  }

  const statuses = force
    ? ['none', 'disabled', 'not_found', 'failed', 'partial', 'success']
    : ['none', 'disabled', 'not_found', 'failed', 'partial']

  const result = await prisma.downloadJob.updateMany({
    where: {
      status: 'completed',
      filePath: { not: null },
      metadataStatus: { in: statuses },
    },
    data: {
      metadataStatus: 'pending',
      metadataSource: null,
      metadataTitle: null,
      metadataArtist: null,
      metadataAlbum: null,
      metadataNote: '等待重新刮削',
      metadataAt: null,
    },
  })

  if (result.count) wakeMetadataQueue()
  return NextResponse.json({ code: 0, data: { queued: result.count } })
}
