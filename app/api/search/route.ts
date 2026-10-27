import { NextResponse } from 'next/server'
import { PLATFORMS, PLATFORM_NAMES, type Platform, type SearchResponse } from '@/lib/constants'
import { getClientIp } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { searchAll } from '@/lib/search'
import { getSettings } from '@/lib/settings'
import { sourceManager } from '@/lib/sources/manager'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  await ensureRuntime()
  const ip = getClientIp(req)
  const limit = rateLimit(`search:${ip}`, 30, 60_000)
  if (!limit.ok) {
    return NextResponse.json(
      { code: 429, message: `搜索过于频繁，请 ${Math.ceil(limit.retryAfterMs / 1000)} 秒后再试` },
      { status: 429 }
    )
  }

  const url = new URL(req.url)
  const query = (url.searchParams.get('q') || '').trim()
  if (!query) return NextResponse.json({ code: 400, message: '请输入搜索关键词' }, { status: 400 })
  if (query.length > 100) {
    return NextResponse.json({ code: 400, message: '关键词过长' }, { status: 400 })
  }

  const requested = (url.searchParams.get('platforms') || '')
    .split(',')
    .map((p) => p.trim())
    .filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p))
  const settings = await getSettings()
  const platforms = requested.length ? requested : settings.platformOrder

  const started = Date.now()
  const [results, manifest] = await Promise.all([
    searchAll(query, platforms),
    sourceManager.getManifest().catch(() => []),
  ])

  const payload: SearchResponse = {
    query,
    tookMs: Date.now() - started,
    platforms: results.map((r) => {
      const channels = manifest.filter((s) => s.platforms.includes(r.platform))
      const qualities = new Set<string>()
      for (const channel of channels) {
        for (const q of channel.qualities[r.platform] || []) qualities.add(q)
      }
      return {
        id: r.platform,
        name: PLATFORM_NAMES[r.platform],
        available: channels.length > 0,
        channels: channels.length,
        qualities: [...qualities],
        results: r.results.map((song) => ({
          ...song,
          qualities: [...qualities],
          channels: channels.length,
        })),
        error: r.error,
      }
    }),
  }

  return NextResponse.json({ code: 0, data: payload })
}
