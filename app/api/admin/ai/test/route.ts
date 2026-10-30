import { NextResponse } from 'next/server'
import { chatCompletion } from '@/lib/ai/client'
import { isAdmin } from '@/lib/auth'
import { getAiConfig } from '@/lib/settings'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  await ensureRuntime()
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 })
  }

  const config = await getAiConfig()
  if (!config.apiKey) {
    return NextResponse.json({ code: 400, message: '请先填写 AI API Key' }, { status: 400 })
  }
  if (!config.model || !config.baseUrl) {
    return NextResponse.json({ code: 400, message: '请先填写 AI Base URL 和模型名' }, { status: 400 })
  }

  try {
    const reply = await chatCompletion(
      config,
      [
        { role: 'system', content: '你是一个连通性测试助手，只返回 JSON。' },
        { role: 'user', content: '请只返回 {"ok":true}' },
      ],
      { timeoutMs: 15_000, maxTokens: 40, feature: '连接测试' }
    )
    return NextResponse.json({
      code: 0,
      data: { model: config.model, reply: reply.slice(0, 300) },
    })
  } catch (e) {
    return NextResponse.json(
      { code: 502, message: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    )
  }
}
