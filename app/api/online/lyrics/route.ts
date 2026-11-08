import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getClientIp } from '@/lib/auth'
import { cleanLyrics } from '@/lib/metadata/lyrics'
import { fetchBestLyrics } from '@/lib/library/lyrics'
import { isSyncedLyrics } from '@/lib/metadata/normalize'
import { getSettings } from '@/lib/settings'
import { rateLimit } from '@/lib/rate-limit'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const schema = z.object({
  title: z.string().min(1).max(300),
  artist: z.string().max(300).optional().default(''),
  album: z.string().max(300).optional().default(''),
  duration: z.number().min(0).max(86_400).optional().nullable(),
})

const cache = new Map<string, { at: number; value: unknown }>()
const TTL = 60 * 60 * 1000

export async function POST(req: Request) {
  await ensureRuntime()
  const ip = getClientIp(req)
  const limit = rateLimit(`online-lyrics:${ip}`, 30, 60_000)
  if (!limit.ok) {
    return NextResponse.json({ code: 429, message: '歌词请求过于频繁，请稍后再试' }, { status: 429 })
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ code: 400, message: '请求格式错误' }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ code: 400, message: '歌曲信息不完整' }, { status: 400 })
  }
  const key = `${parsed.data.title}|${parsed.data.artist}|${parsed.data.album}|${parsed.data.duration || ''}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json({ code: 0, data: hit.value })
  }

  try {
    const settings = await getSettings()
    const fetched = await fetchBestLyrics(
      {
        title: parsed.data.title,
        artist: parsed.data.artist,
        album: parsed.data.album,
        duration: parsed.data.duration || null,
      },
      settings
    )
    if (!fetched?.lyrics) {
      const data = { lyrics: '', source: '', synced: false }
      cache.set(key, { at: Date.now(), value: data })
      return NextResponse.json({ code: 0, data })
    }
    const cleaned =
      cleanLyrics(fetched.lyrics, {
        cleanCredits: settings.lyricsCleanCredits,
        simplify: settings.lyricsSimplify,
      }) || fetched.lyrics
    const data = {
      lyrics: cleaned,
      source: fetched.source,
      synced: isSyncedLyrics(cleaned),
    }
    cache.set(key, { at: Date.now(), value: data })
    return NextResponse.json({ code: 0, data })
  } catch (e) {
    return NextResponse.json(
      { code: 502, message: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    )
  }
}
