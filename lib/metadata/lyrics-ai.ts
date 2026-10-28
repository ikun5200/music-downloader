import { chatCompletion, extractJsonObject } from '../ai/client'
import type { AiConfig } from '../settings'
import { cleanLyrics, type CleanLyricsOptions } from './lyrics'
import { titleKey } from './normalize'

export interface AiLyricCleanOptions extends CleanLyricsOptions {
  aiConfig?: AiConfig | null
  aiEnabled?: boolean
}

export interface AiLyricCleanResult {
  text: string
  aiUsed: boolean
  note?: string
}

const TIMESTAMP_LINE_RE = /^\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*\S/
const TIMESTAMP_PREFIX_RE = /^\s*(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+\s*/
const TAG_ONLY_RE = /^\s*\[(?:ti|ar|al|by|offset|re|ve|length|kuwo|kugou|qq|music):[^\]]*\]\s*$/i

function timestampLineCount(text: string): number {
  return text.split('\n').filter((line) => TIMESTAMP_LINE_RE.test(line)).length
}

function stripTimestamp(line: string): string {
  return line.replace(TIMESTAMP_PREFIX_RE, '').trim()
}

/**
 * 只在开头看起来像“制作信息/标题行”时才调用 AI，避免每首歌都消耗一次请求。
 * 演唱者前缀（韩红：、林俊杰：、合：等）也算候选，AI 会判断它属于歌词并保留。
 * 第一行恰好等于歌名时也交给 AI：它可能是标题行，也可能是重复歌名的第一句歌词。
 */
function hasLikelyHeader(raw: string, title?: string): boolean {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  const first = lines.find((line) => {
    const value = line.trim()
    return !!value && !TAG_ONLY_RE.test(value)
  })
  if (!first) return false
  const value = stripTimestamp(first)
  if (!value) return false
  if (/[：:]/.test(value) || /\s[-–—]\s/.test(value)) return true
  return !!title && titleKey(value) === titleKey(title)
}

/**
 * AI 优先判断第一句歌词，规则兜底：
 * - AI 返回 firstLyricLine 后，只从该行开始保留，制作信息/标题行被丢弃；
 * - 演唱者前缀保留，因为 AI 被明确要求把“韩红：”“林俊杰：”“合：”等视为歌词；
 * - AI 未启用、超时、返回非法索引或结果明显丢歌词时，自动回退规则清理。
 */
export async function cleanLyricsWithAi(
  raw: string,
  options: AiLyricCleanOptions = {}
): Promise<AiLyricCleanResult> {
  const fallback = cleanLyrics(raw, options)
  if (!raw.trim()) return { text: '', aiUsed: false }

  // 用户关闭“清理制作信息”时，AI 也不应擅自删行。
  if (options.cleanCredits === false) return { text: fallback, aiUsed: false }

  const config = options.aiConfig
  if (
    !options.aiEnabled ||
    !config?.enabled ||
    !config.apiKey ||
    !hasLikelyHeader(raw, options.title)
  ) {
    return { text: fallback, aiUsed: false }
  }

  const lines = raw.replace(/\r\n?/g, '\n').split('\n').slice(0, 60)
  try {
    const reply = await chatCompletion(
      config,
      [
        {
          role: 'system',
          content:
            '你是 LRC 歌词清洗助手。请找出第一行真正歌词的 0-based 行号。' +
            '作词、作曲、编曲、制作人、录音、混音、母带、封面设计、公司、版权、歌名标题行都不算歌词；' +
            '演唱者前缀（如“韩红：”“林俊杰：”“合：”“LAY：”“JJ：”“男：”“女：”）属于歌词的一部分，必须保留，' +
            'firstLyricLine 应指向这些行。无法判断时返回 -1。只返回 JSON，不要解释。',
        },
        {
          role: 'user',
          content:
            '歌曲：' +
            JSON.stringify({ title: options.title || '', artist: options.artist || '' }) +
            '\n候选行：' +
            JSON.stringify(lines.map((text, i) => ({ i, text }))) +
            '\n返回 {"firstLyricLine": 数字}。',
        },
      ],
      { timeoutMs: 20_000, maxTokens: 80 }
    )
    const parsed = extractJsonObject(reply)
    const index = Number(parsed?.firstLyricLine)
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= lines.length ||
      !TIMESTAMP_LINE_RE.test(lines[index] || '')
    ) {
      return { text: fallback, aiUsed: false, note: 'AI 返回的歌词起始行无效，已回退规则' }
    }

    // AI 说第一行就是歌词时允许 index=0，但“歌名 - 歌手”这种标题行不能留。
    const chosen = stripTimestamp(lines[index] || '')
    const title = titleKey(options.title || '')
    if (index === 0 && title && /\s[-–—]\s/.test(chosen) && titleKey(chosen).includes(title)) {
      return { text: fallback, aiUsed: false, note: 'AI 把标题行当成歌词，已回退规则' }
    }

    const cleaned = cleanLyrics(raw, { ...options, startLineIndex: index })
    if (!cleaned.trim()) {
      return { text: fallback, aiUsed: false, note: 'AI 清理结果为空，已回退规则' }
    }
    // 以规则清理结果为基线：AI 可以多删掉规则没认出的制作信息，
    // 但不能把大半歌词一起删掉。
    const baselineLines = timestampLineCount(fallback)
    const outputLines = timestampLineCount(cleaned)
    if (baselineLines > 4 && outputLines < Math.ceil(baselineLines * 0.5)) {
      return { text: fallback, aiUsed: false, note: 'AI 清理结果丢失过多歌词，已回退规则' }
    }
    return {
      text: cleaned,
      aiUsed: true,
      note: `AI 识别歌词起始行：${index + 1}`,
    }
  } catch (error) {
    return {
      text: fallback,
      aiUsed: false,
      note: `AI 歌词识别失败，已回退规则：${
        error instanceof Error ? error.message : String(error)
      }`,
    }
  }
}
