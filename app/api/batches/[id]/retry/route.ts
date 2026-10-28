import { NextResponse } from 'next/server'
import { retryFailedBatchItems } from '@/lib/batch/retry'
import { wakeBatchQueue } from '@/lib/batch/queue'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  await ensureRuntime()
  const { id } = await ctx.params
  const result = await retryFailedBatchItems(id)

  if (result.status === 'not_found') {
    return NextResponse.json({ code: 404, message: '批量任务不存在' }, { status: 404 })
  }
  if (result.status === 'busy') {
    return NextResponse.json(
      { code: 409, message: '批量任务正在运行或已暂停，请先等待或继续当前任务' },
      { status: 409 }
    )
  }
  if (result.status === 'not_retryable') {
    return NextResponse.json(
      { code: 409, message: '当前批量任务状态不支持重试失败项' },
      { status: 409 }
    )
  }
  if (result.status === 'none') {
    return NextResponse.json({
      code: 0,
      data: { ...result, note: '没有可重试的失败项' },
    })
  }

  wakeBatchQueue()
  return NextResponse.json({ code: 0, data: result })
}
