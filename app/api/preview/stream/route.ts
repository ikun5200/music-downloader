import { Readable } from 'stream'
import { getClientIp } from '@/lib/auth'
import { DESKTOP_UA } from '@/lib/search/http'
import { verifyPreviewToken } from '@/lib/preview-token'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REFERERS: Record<string, string> = {
  kw: 'https://www.kuwo.cn/',
  kg: 'https://www.kugou.com/',
  tx: 'https://y.qq.com/',
  wy: 'https://music.163.com/',
  mg: 'https://music.migu.cn/',
}

function contentTypeFor(url: string, upstream: string | null): string {
  if (upstream && !/octet-stream/i.test(upstream) && !/text\/html|application\/json/i.test(upstream)) {
    return upstream
  }
  let path = ''
  try {
    path = new URL(url).pathname.toLowerCase()
  } catch {
    // ignore
  }
  if (path.endsWith('.flac')) return 'audio/flac'
  if (path.endsWith('.m4a') || path.endsWith('.mp4')) return 'audio/mp4'
  if (path.endsWith('.ogg') || path.endsWith('.opus')) return 'audio/ogg'
  if (path.endsWith('.wav')) return 'audio/wav'
  if (path.endsWith('.aac')) return 'audio/aac'
  return 'audio/mpeg'
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('t') || ''
  const payload = verifyPreviewToken(token)
  if (!payload) {
    return new Response('试听链接无效或已过期', { status: 403 })
  }

  const ip = getClientIp(req)
  const limit = rateLimit(`preview-stream:${ip}`, 300, 60_000)
  if (!limit.ok) {
    return new Response('试听请求过于频繁', { status: 429 })
  }

  const headers: Record<string, string> = {
    'User-Agent': DESKTOP_UA,
    Accept: '*/*',
    Referer: REFERERS[payload.platform] || 'https://www.kuwo.cn/',
  }
  const range = req.headers.get('range')
  if (range) headers.Range = range

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  req.signal.addEventListener('abort', onAbort)
  const timer = setTimeout(() => controller.abort(), 20_000)

  let upstream: Response
  try {
    upstream = await fetch(payload.url, {
      headers,
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
    })
  } catch (e) {
    return new Response(`试听源不可用：${e instanceof Error ? e.message : String(e)}`, {
      status: 502,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response(`试听源返回 HTTP ${upstream.status}`, { status: 502 })
  }
  if (!upstream.body) {
    return new Response('试听源没有返回内容', { status: 502 })
  }

  const contentType = contentTypeFor(payload.url, upstream.headers.get('content-type'))
  if (/text\/html|application\/json/i.test(contentType)) {
    return new Response('试听源返回的不是音频', { status: 502 })
  }

  const out = new Headers()
  out.set('Content-Type', contentType)
  out.set('Cache-Control', 'no-store')
  out.set('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes')
  for (const name of ['content-length', 'content-range', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name)
    if (value) out.set(name, value)
  }

  return new Response(Readable.fromWeb(upstream.body as any) as unknown as ReadableStream, {
    status: upstream.status,
    headers: out,
  })
}
