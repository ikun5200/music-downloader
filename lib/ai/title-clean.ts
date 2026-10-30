import type { AiConfig } from '../settings'
import { chatCompletion, extractJsonObject, type ChatMessage } from './client'

const CACHE_TTL = 24 * 60 * 60 * 1000
const CACHE_MAX = 500
const cache = new Map<string, { at: number; title: string }>()

// 只有标题里出现这些推广/上下文词时才调用 AI，普通歌名不会产生额外请求。
const TITLE_HINT_RE =
  /(主题曲|片头曲|片尾曲|插曲|推广曲|宣传曲|印象曲|概念曲|人物曲|角色曲|主题歌|ost|电影|电视剧|动画|游戏|网剧|纪录片|综艺|官方|mv)/i

const SYSTEM_PROMPT = `你是音乐库文件名整理助手。用户会给你歌曲标题和歌手。
请删除标题里与歌曲本身无关的影视/游戏/活动说明，例如“电视剧《X》主题曲”“电影《X》推广曲”“动画《X》片尾曲”“游戏《X》OST”“活动宣传曲”等。
保留真正的歌名、feat./合作歌手，以及 Live/Remix/伴奏等版本信息，不要改写歌名本身。
只输出 JSON，不要输出解释或 markdown：{"title":"清理后的歌名"}。如果不需要修改，返回原标题。`

function cacheGet(key: string): string | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(key)
    return null
  }
  return hit.title
}

function cacheSet(key: string, title: string) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, { at: Date.now(), title })
}

/**
 * 用 AI 去掉歌名里的“主题曲/推广曲/片尾曲/OST”等说明。
 * AI 未启用、失败、超时或返回结果异常时，保留原歌名。
 */
export async function cleanSongTitle(
  title: string,
  artist: string,
  config: AiConfig | null,
  chat: typeof chatCompletion = chatCompletion
): Promise<string> {
  const original = String(title || '').trim()
  if (!original) return original
  if (!config?.enabled || !config.apiKey || config.titleClean === false) return original
  if (!TITLE_HINT_RE.test(original)) return original

  const key = `${artist}::${original}`
  const cached = cacheGet(key)
  if (cached) return cached

  try {
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({ title: original, artist: artist || '' }),
      },
    ]
    const content = await chat(config, messages, {
      timeoutMs: 15_000,
      maxTokens: 120,
      feature: '歌名清理',
    })
    const parsed = extractJsonObject(content)
    const cleaned = String(parsed?.title || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)

    if (!cleaned) return original
    // 安全校验：清理结果应当来自原标题，避免 AI 改写歌名或返回无关内容。
    const compactOriginal = original.replace(/\s+/g, '')
    const compactCleaned = cleaned.replace(/\s+/g, '')
    if (!compactOriginal.includes(compactCleaned)) {
      console.warn('[ai] 歌名清理结果与原标题差异过大，保留原名:', cleaned)
      return original
    }

    cacheSet(key, cleaned)
    return cleaned
  } catch (e) {
    console.warn('[ai] 歌名清理失败，保留原名:', e)
    return original
  }
}
