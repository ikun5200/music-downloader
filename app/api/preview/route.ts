import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getClientIp } from '@/lib/auth'
import { PLATFORM_NAMES, type Platform } from '@/lib/constants'
import { resolvePreview } from '@/lib/preview'
import { signPreviewToken } from '@/lib/preview-token'
import { rateLimit } from '@/lib/rate-limit'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({
  platform: z.enum(['kw', 'kg', 'tx', 'wy', 'mg']),
  musicInfo: z.record(z.unknown()),
  title: z.string().max(300).optional(),
  artist: z.string().max(300).optional(),
  coverUrl: z.string().max(2000).optional().nullable(),
})

export async function POST(req: Request) {
  await ensureRuntime()

  const ip = getClientIp(req)
  const limit = rateLimit(`preview:${ip}`, 30, 60_000)
  if (!limit.ok) {
    return NextResponse.json(
      { code: 429, message: `试听请求过于频繁，请 ${Math.ceil(limit.retryAfterMs / 1000)} 秒后再试` },
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
    return NextResponse.json({ code: 400, message: '试听参数不完整' }, { status: 400 })
  }

  const platform = parsed.data.platform as Platform
  const musicInfo = parsed.data.musicInfo
  try {
    const result = await resolvePreview(platform, musicInfo)
    const token = signPreviewToken(result.url, platform)
    const duration = Number(musicInfo.interval)

    return NextResponse.json({
      code: 0,
      data: {
        streamUrl: `/api/preview/stream?t=${encodeURIComponent(token)}`,
        quality: result.quality,
        channel: result.channel,
        title: parsed.data.title || String(musicInfo.name || '未知歌曲'),
        artist: parsed.data.artist || String(musicInfo.singer || '未知歌手'),
        coverUrl: parsed.data.coverUrl || null,
        duration: Number.isFinite(duration) && duration > 0 ? duration : null,
        elapsedMs: result.elapsedMs,
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      {
        code: 502,
        message: `${PLATFORM_NAMES[platform]} 试听解析失败：${message}`.slice(0, 800),
      },
      { status: 502 }
    )
  }
}
