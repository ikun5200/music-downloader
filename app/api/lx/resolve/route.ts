import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateApiRequest, getClientIp, getTokenFromRequest } from '@/lib/auth'
import { PLATFORM_NAMES, type Platform } from '@/lib/constants'
import { rateLimit } from '@/lib/rate-limit'
import { getRankedChannels } from '@/lib/sources/selection'
import { sourceManager } from '@/lib/sources/manager'
import { recordStat } from '@/lib/sources/stats'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({
  source: z.enum(['kw', 'kg', 'tx', 'wy', 'mg']),
  quality: z.string().min(1).max(30),
  musicInfo: z.record(z.unknown()),
  channel: z.string().max(200).optional(),
  action: z.string().optional(),
})

export async function POST(req: Request) {
  await ensureRuntime()
  if (!(await authenticateApiRequest(req))) {
    return NextResponse.json({ code: 401, message: '无效的 API Token' }, { status: 401 })
  }

  const token = getTokenFromRequest(req) || getClientIp(req)
  const limit = rateLimit(`lx:${token.slice(-16)}`, 60, 60_000)
  if (!limit.ok) {
    return NextResponse.json(
      { code: 429, message: `请求过于频繁，请 ${Math.ceil(limit.retryAfterMs / 1000)} 秒后再试` },
      { status: 429 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ code: 400, message: '请求体不是有效 JSON' }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { code: 400, message: '参数不完整（需要 source/quality/musicInfo）' },
      { status: 400 }
    )
  }
  if (parsed.data.action && parsed.data.action !== 'musicUrl') {
    return NextResponse.json(
      { code: 501, message: `暂不支持 action: ${parsed.data.action}` },
      { status: 501 }
    )
  }

  const platform = parsed.data.source as Platform
  const quality = parsed.data.quality
  const channels = await getRankedChannels(platform)
  if (!channels.length) {
    return NextResponse.json(
      { code: 404, message: `${PLATFORM_NAMES[platform]} 没有启用的渠道` },
      { status: 404 }
    )
  }

  let candidates = channels
  if (parsed.data.channel && parsed.data.channel !== 'auto') {
    const wanted = parsed.data.channel
    candidates = channels.filter((c) => c.id === wanted || c.name === wanted)
    if (!candidates.length) {
      return NextResponse.json(
        { code: 404, message: `渠道 ${wanted} 不可用` },
        { status: 404 }
      )
    }
  }

  const attempts: Array<{ channel: string; channelId: string; error: string }> = []
  for (const channel of candidates) {
    if (!channel.qualities.includes(quality)) {
      attempts.push({
        channel: channel.name,
        channelId: channel.id,
        error: `不支持音质 ${quality}`,
      })
      continue
    }
    const started = Date.now()
    try {
      const resolved = await sourceManager.resolve(
        channel.id,
        platform,
        quality,
        parsed.data.musicInfo
      )
      await recordStat(channel.id, platform, true, Date.now() - started)
      return NextResponse.json({
        code: 0,
        data: {
          url: resolved.url,
          channel: { id: channel.id, name: channel.name },
          requestedQuality: quality,
          elapsedMs: Date.now() - started,
        },
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      attempts.push({ channel: channel.name, channelId: channel.id, error: message })
      await recordStat(channel.id, platform, false, Date.now() - started, message)
    }
  }

  return NextResponse.json(
    {
      code: 1,
      message: `所有渠道均失败：${attempts.map((a) => `${a.channel}: ${a.error}`).join(' | ')}`.slice(0, 1000),
      attempts,
    },
    { status: 502 }
  )
}
