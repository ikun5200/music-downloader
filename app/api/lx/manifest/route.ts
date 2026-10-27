import { NextResponse } from 'next/server'
import { authenticateApiRequest } from '@/lib/auth'
import { getLxManifest } from '@/lib/lx/manifest'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  await ensureRuntime()
  if (!(await authenticateApiRequest(req))) {
    return NextResponse.json({ code: 401, message: '无效的 API Token' }, { status: 401 })
  }
  const manifest = await getLxManifest()
  return NextResponse.json({ code: 0, data: manifest }, {
    headers: { 'Access-Control-Allow-Origin': '*' },
  })
}
