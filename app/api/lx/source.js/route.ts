import { NextResponse } from 'next/server'
import { authenticateApiRequest } from '@/lib/auth'
import { generateLxScript } from '@/lib/lx/generator'
import { getLxManifest } from '@/lib/lx/manifest'
import { getPublicBaseUrl } from '@/lib/settings'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  await ensureRuntime()
  if (!(await authenticateApiRequest(req))) {
    return NextResponse.json({ code: 401, message: '无效的 API Token' }, { status: 401 })
  }

  const manifest = await getLxManifest()
  if (!Object.keys(manifest.sources).length) {
    return NextResponse.json(
      { code: 503, message: '当前没有启用的音源，请先在后台启用渠道' },
      { status: 503 }
    )
  }

  let base = getPublicBaseUrl()
  try {
    const configured = new URL(base)
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || ''
    const proto = (req.headers.get('x-forwarded-proto') || 'http').split(',')[0].trim()
    const localConfigured = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(configured.hostname)
    const localRequest = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(host)
    // 未配置 PUBLIC_BASE_URL（仍是 localhost）时，用浏览器实际访问的 Host 兜底。
    if (localConfigured && host && !localRequest) {
      base = `${proto}://${host}`
    }
  } catch {
    // ignore
  }

  const token = new URL(req.url).searchParams.get('token') || ''
  const script = generateLxScript(base, token, manifest.sources)

  return new Response(script, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
