import { prisma } from '@/lib/db'
import { jobToDto } from '@/lib/download/dto'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  await ensureRuntime()
  const encoder = new TextEncoder()
  let timer: NodeJS.Timeout | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false

      const push = async () => {
        if (closed) return
        try {
          const [active, recent, total] = await Promise.all([
            prisma.downloadJob.findMany({
              where: { status: { in: ['queued', 'resolving', 'downloading'] } },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              include: { channel: { select: { name: true } } },
            }),
            prisma.downloadJob.findMany({
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 100,
              include: { channel: { select: { name: true } } },
            }),
            prisma.downloadJob.count(),
          ])
          // 客户端只做增量合并，不能再用最近 60 条覆盖已加载的历史。
          const map = new Map(recent.map((job) => [job.id, job]))
          for (const job of active) map.set(job.id, job)
          const jobs = [...map.values()].sort(
            (a, b) =>
              b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id)
          )
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ jobs: jobs.map(jobToDto), total })}\n\n`
            )
          )
        } catch {
          // 下一轮重试
        }
      }

      const close = () => {
        if (closed) return
        closed = true
        if (timer) clearInterval(timer)
        try {
          controller.close()
        } catch {
          // ignore
        }
      }

      req.signal.addEventListener('abort', close)
      void push()
      timer = setInterval(() => void push(), 1500)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
