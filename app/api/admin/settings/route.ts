import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isAdmin } from '@/lib/auth'
import { getQueueState } from '@/lib/download/queue'
import { getDisplayDownloadDir, getPublicBaseUrl, getSettings, setSettings } from '@/lib/settings'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({
  qualityStrategy: z.enum(['highest', 'strict', 'flacFirst']).optional(),
  maxConcurrent: z.number().int().min(1).max(8).optional(),
  filenameTemplate: z.string().min(1).max(200).optional(),
  maxFileSizeMb: z.number().int().min(64).max(4096).optional(),
  verifyWrongSong: z.boolean().optional(),
  platformOrder: z.array(z.enum(['kw', 'kg', 'tx', 'wy', 'mg'])).min(1).max(5).optional(),
  platformPriority: z.record(z.array(z.string())).nullable().optional(),
  aiEnabled: z.boolean().optional(),
  aiBaseUrl: z.string().url().max(500).optional(),
  aiModel: z.string().min(1).max(200).optional(),
  aiApiKey: z.string().max(1000).optional(),
})

export async function GET() {
  await ensureRuntime()
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 })
  }
  return NextResponse.json({
    code: 0,
    data: {
      settings: await getSettings(),
      downloadDir: getDisplayDownloadDir(),
      publicBaseUrl: getPublicBaseUrl(),
      queue: getQueueState(),
    },
  })
}

export async function PATCH(req: Request) {
  await ensureRuntime()
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 })
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ code: 400, message: '请求格式错误' }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ code: 400, message: '参数错误' }, { status: 400 })
  }
  await setSettings(parsed.data)
  return NextResponse.json({ code: 0, data: await getSettings() })
}
