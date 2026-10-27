import type { AiConfig } from '../settings'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  timeoutMs?: number
  maxTokens?: number
}

/**
 * 调用 OpenAI 兼容的 /chat/completions 接口。
 * 不依赖官方 SDK，兼容 OpenAI、DeepSeek、通义、Ollama 等提供方。
 */
export async function chatCompletion(
  config: AiConfig,
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<string> {
  if (!config.apiKey) throw new Error('未配置 AI API Key')
  if (!config.baseUrl) throw new Error('未配置 AI Base URL')
  if (!config.model) throw new Error('未配置 AI 模型')

  const base = config.baseUrl.replace(/\/+$/, '')
  const endpoint = /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('AI 请求超时')), options.timeoutMs || 25_000)

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0,
        max_tokens: options.maxTokens || 300,
      }),
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`AI HTTP ${res.status}${text ? `：${text.slice(0, 300)}` : ''}`)
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = json?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('AI 返回内容为空或格式异常')
    }
    return content
  } finally {
    clearTimeout(timer)
  }
}

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}
