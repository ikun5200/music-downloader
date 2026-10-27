import { createHmac, timingSafeEqual } from 'crypto'
import { PLATFORMS, type Platform } from './constants'

const TTL_MS = 60 * 60 * 1000

function secret(): string {
  return process.env.AUTH_SECRET || 'dev-secret-please-change-this-to-a-long-random-string'
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function signPreviewToken(url: string, platform: Platform): string {
  const payload = Buffer.from(
    JSON.stringify({ u: url, p: platform, e: Date.now() + TTL_MS })
  ).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export interface PreviewTokenPayload {
  url: string
  platform: Platform
}

export function verifyPreviewToken(token: string): PreviewTokenPayload | null {
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const payload = token.slice(0, dot)
  const signature = token.slice(dot + 1)
  const expected = sign(payload)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      u?: unknown
      p?: unknown
      e?: unknown
    }
    if (typeof parsed.u !== 'string' || typeof parsed.e !== 'number') return null
    if (parsed.e < Date.now()) return null
    if (typeof parsed.p !== 'string' || !(PLATFORMS as readonly string[]).includes(parsed.p)) {
      return null
    }
    const url = new URL(parsed.u)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return { url: parsed.u, platform: parsed.p as Platform }
  } catch {
    return null
  }
}
