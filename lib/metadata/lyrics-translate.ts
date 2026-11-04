import type { AiConfig } from '../settings'
import { chatCompletion, extractJsonObject, type ChatMessage } from '../ai/client'
import { toSimplified } from './normalize'
import { isTtmlLyrics } from './lyrics'

const TIMESTAMP_LINE_RE = /^(\s*(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+)\s*(.*)$/
const KANA_RE = /[\u3040-\u30ff]/g
const HANGUL_RE = /[\uac00-\ud7af]/g
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/g
const LATIN_RE = /[A-Za-z]/g
const MAX_TRANSLATE_LINES = 240
const CHUNK_SIZE = 20

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) || []).length
}

function lyricTextWithoutTags(text: string): string {
  return text
    .replace(/^\s*\[(?:ti|ar|al|by|offset|re|ve|length|kuwo|kugou|qq|music):[^\]]*\]\s*$/gim, ' ')
    .replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function hasChineseLyrics(text: string): boolean {
  return countMatches(text, CJK_RE) >= 2
}

function firstTimestampKey(prefix: string): string {
  return (prefix.match(/\[[^\]]+\]/)?.[0] || prefix).replace(/\s/g, '')
}

interface LyricGroup {
  key: string
  timestamp: string
  lines: string[]
  hasChinese: boolean
  hasForeign: boolean
}

function lyricGroups(text: string): LyricGroup[] {
  const groups = new Map<string, LyricGroup>()
  for (const line of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const match = line.match(TIMESTAMP_LINE_RE)
    const value = match?.[2]?.trim()
    if (!match || !value) continue
    const key = firstTimestampKey(match[1])
    const group = groups.get(key) || {
      key,
      timestamp: match[1].trim(),
      lines: [],
      hasChinese: false,
      hasForeign: false,
    }
    group.lines.push(value)
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    for (const line of group.lines) {
      const kana = countMatches(line, KANA_RE)
      const hangul = countMatches(line, HANGUL_RE)
      const cjk = countMatches(line, CJK_RE)
      // 翻译可能只有一个字（如 Yeah → 耶），不能用“至少两个汉字”判断；
      // 只要没有假名/韩文，单个汉字也算中文翻译行。
      if (cjk >= 1 && !kana && !hangul) group.hasChinese = true
      if (
        kana > 0 ||
        hangul > 0 ||
        (countMatches(line, LATIN_RE) > 0 && cjk === 0)
      ) {
        group.hasForeign = true
      }
    }
  }
  return [...groups.values()]
}

export interface LyricsTranslationStats {
  cjk: number
  kana: number
  hangul: number
  latin: number
  /** 纯中文行数（不含假名/韩文），用来识别“中文歌里夹英文”的情况。 */
  chineseLines: number
  foreignGroups: number
  coveredGroups: number
  /** 有外语内容的时间戳分组里，已经有中文翻译的比例。 */
  coverage: number
}

export function analyzeLyricsTranslation(text: string): LyricsTranslationStats {
  const value = lyricTextWithoutTags(String(text || ''))
  const groups = lyricGroups(text)
  const foreign = groups.filter((group) => group.hasForeign)
  const covered = foreign.filter((group) => group.hasChinese)
  const chineseLines = groups.reduce(
    (total, group) =>
      total +
      group.lines.filter((line) => {
        const cjk = countMatches(line, CJK_RE)
        return cjk >= 1 && !countMatches(line, KANA_RE) && !countMatches(line, HANGUL_RE)
      }).length,
    0
  )
  return {
    cjk: countMatches(value, CJK_RE),
    kana: countMatches(value, KANA_RE),
    hangul: countMatches(value, HANGUL_RE),
    latin: countMatches(value, LATIN_RE),
    chineseLines,
    foreignGroups: foreign.length,
    coveredGroups: covered.length,
    coverage: foreign.length ? covered.length / foreign.length : 1,
  }
}

/**
 * 判断歌词是否需要翻译成中文：
 * - 有足够多纯中文行的歌视为中文歌，即使夹了英文副歌也不整首翻译；
 * - 中文占主导的歌词不翻译；
 * - 按时间戳检查真实翻译覆盖率，已完整翻译的双语歌词不重复翻译；
 * - 部分翻译的外语歌词只补译缺失行；
 * - 日文假名/韩文、拉丁字母为主且中文很少的歌词需要翻译。
 */
export function shouldTranslateLyricsToChinese(text: string): boolean {
  if (isTtmlLyrics(text)) return false
  if (!lyricTextWithoutTags(text)) return false
  const stats = analyzeLyricsTranslation(text)
  if (!stats.foreignGroups) return false
  // 中文歌里夹英文副歌通常没有翻译行（coverage 接近 0），不整首翻译；
  // 但已经有较多中文翻译行的外语歌要继续补译剩余部分。
  if (
    stats.chineseLines >= 5 &&
    stats.cjk >= 30 &&
    stats.coverage < 0.2
  ) {
    return false
  }
  const foreign = stats.kana + stats.hangul + stats.latin
  if (stats.cjk >= 10 && stats.cjk >= foreign * 0.6) return false
  return stats.coverage < 0.9
}

interface LyricLine {
  index: number
  raw: string
  timestamp: string
  key: string
  text: string
}

function lyricLines(text: string): LyricLine[] {
  const lines: LyricLine[] = []
  let index = 0
  for (const line of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const match = line.match(TIMESTAMP_LINE_RE)
    if (!match || !match[2].trim()) continue
    lines.push({
      index,
      raw: line,
      timestamp: match[1],
      key: firstTimestampKey(match[1]),
      text: match[2].trim(),
    })
    index++
  }
  return lines
}

function shouldTranslateLine(line: LyricLine): boolean {
  const cjk = countMatches(line.text, CJK_RE)
  const latin = countMatches(line.text, LATIN_RE)
  const kana = countMatches(line.text, KANA_RE)
  const hangul = countMatches(line.text, HANGUL_RE)
  if (kana || hangul) return true
  if (latin > 0 && cjk === 0) return true
  if (latin >= 8 && cjk < latin * 0.2) return true
  return false
}

export interface TranslateLyricsOptions {
  title?: string
  artist?: string
  aiConfig?: AiConfig | null
  aiEnabled?: boolean
  chat?: typeof chatCompletion
}

export interface TranslateLyricsResult {
  text: string
  translatedLines: number
  aiUsed: boolean
  note: string
}

interface TranslationItem {
  i?: unknown
  text?: unknown
}

async function translateChunk(
  lines: Array<{ i: number; text: string }>,
  title: string,
  artist: string,
  config: AiConfig,
  chat: typeof chatCompletion
): Promise<Map<number, string>> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        '你是歌词翻译助手。把用户给出的每一行歌词翻译成简体中文。' +
        '保持原意和语气，不要合并或拆分行，不要添加时间轴，不要解释。' +
        '已经是中文的行返回空字符串。只输出 JSON：' +
        '{"translations":[{"i":0,"text":"中文翻译"}]}。',
    },
    {
      role: 'user',
      content: JSON.stringify({
        song: title,
        artist,
        lines: lines.map((line) => ({ i: line.i, text: line.text })),
      }),
    },
  ]
  const reply = await chat(config, messages, {
    timeoutMs: 45_000,
    // 推理型模型会先消耗几百个 thinking token，预算必须留足；
    // 否则短歌词块会返回 finish_reason=length，JSON 直接截断。
    maxTokens: Math.min(8000, Math.max(2500, lines.length * 200 + 800)),
    feature: '歌词翻译',
  })
  const parsed = extractJsonObject(reply)
  const items = Array.isArray(parsed?.translations)
    ? (parsed.translations as TranslationItem[])
    : []

  const allowed = new Set(lines.map((line) => line.i))
  const out = new Map<number, string>()
  for (const item of items) {
    const index = Number(item?.i)
    if (!Number.isInteger(index) || !allowed.has(index)) continue
    const text = String(item?.text || '')
      .replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue
    // 只接受真正包含中文的翻译，避免 AI 原样返回英文或只做改写。
    if (!/[\u3400-\u9fff]/.test(text)) continue
    out.set(index, toSimplified(text).slice(0, 500))
  }
  return out
}

/**
 * 单块失败（JSON 截断、返回不全）时拆成两半重试。
 * 保留已经拿到的部分翻译，再递归补齐，避免整首歌因为一个长块直接放弃。
 */
async function translateChunkWithFallback(
  lines: Array<{ i: number; text: string }>,
  title: string,
  artist: string,
  config: AiConfig,
  chat: typeof chatCompletion
): Promise<Map<number, string>> {
  const translations = new Map<number, string>()
  try {
    const result = await translateChunk(lines, title, artist, config, chat)
    for (const [index, text] of result) translations.set(index, text)
  } catch {
    // 网络/超时错误也走拆块重试。
  }
  const threshold = Math.max(1, Math.ceil(lines.length * 0.8))
  if (translations.size >= threshold || lines.length <= 1) return translations

  const middle = Math.ceil(lines.length / 2)
  const left = await translateChunkWithFallback(
    lines.slice(0, middle),
    title,
    artist,
    config,
    chat
  )
  const right = await translateChunkWithFallback(
    lines.slice(middle),
    title,
    artist,
    config,
    chat
  )
  for (const [index, text] of left) translations.set(index, text)
  for (const [index, text] of right) translations.set(index, text)
  return translations
}

/**
 * 用 AI 把外语歌词翻译成中文，并合并为双语 LRC。
 * - 原文时间轴完全保留；
 * - 翻译按行索引回填，避免 AI 改时间轴；
 * - AI 未配置、超时或返回异常时原样返回，不破坏原歌词。
 */
export async function translateLyricsToChinese(
  lyrics: string,
  options: TranslateLyricsOptions = {}
): Promise<TranslateLyricsResult> {
  const original = String(lyrics || '').replace(/\r\n?/g, '\n').trim()
  if (!original) return { text: original, translatedLines: 0, aiUsed: false, note: '歌词为空' }
  if (isTtmlLyrics(original)) {
    return { text: original, translatedLines: 0, aiUsed: false, note: '歌词已含飞牛翻译格式' }
  }
  if (!options.aiEnabled || !options.aiConfig?.enabled || !options.aiConfig.apiKey) {
    return { text: original, translatedLines: 0, aiUsed: false, note: 'AI 未启用或未配置' }
  }
  if (!shouldTranslateLyricsToChinese(original)) {
    return { text: original, translatedLines: 0, aiUsed: false, note: '歌词已是中文或已含翻译' }
  }

  const allLines = lyricLines(original)
  // 已有中文翻译的时间戳分组直接跳过，只补译缺失的外语行。
  const covered = new Set(
    lyricGroups(original)
      .filter((group) => group.hasForeign && group.hasChinese)
      .map((group) => group.key)
  )
  const lines = allLines.filter(
    (line) => shouldTranslateLine(line) && !covered.has(line.key)
  )
  if (!lines.length) {
    return { text: original, translatedLines: 0, aiUsed: false, note: '没有需要翻译的外语歌词行' }
  }
  if (lines.length > MAX_TRANSLATE_LINES) {
    return {
      text: original,
      translatedLines: 0,
      aiUsed: false,
      note: `歌词行数超过 ${MAX_TRANSLATE_LINES}，为避免超时未翻译`,
    }
  }

  const chat = options.chat || chatCompletion
  const translations = new Map<number, string>()
  const chunks: Array<Array<{ i: number; text: string }>> = []
  for (let index = 0; index < lines.length; index += CHUNK_SIZE) {
    chunks.push(
      lines.slice(index, index + CHUNK_SIZE).map((line) => ({ i: line.index, text: line.text }))
    )
  }

  let failedChunks = 0
  for (const chunk of chunks) {
    const result = await translateChunkWithFallback(
      chunk,
      options.title || '',
      options.artist || '',
      options.aiConfig,
      chat
    )
    if (result.size < Math.ceil(chunk.length * 0.8)) failedChunks++
    for (const [index, text] of result) translations.set(index, text)
  }

  if (!translations.size) {
    return {
      text: original,
      translatedLines: 0,
      aiUsed: false,
      note: failedChunks ? 'AI 翻译失败，保留原文' : 'AI 没有返回有效翻译',
    }
  }

  const byIndex = new Map<number, LyricLine>()
  for (const line of lines) byIndex.set(line.index, line)
  const translatedText = new Map<number, string>()
  let translatedLines = 0
  for (const [index, text] of translations) {
    const line = byIndex.get(index)
    if (!line || text === line.text) continue
    translatedText.set(index, `${line.timestamp}${text}`)
    translatedLines++
  }
  if (!translatedLines) {
    return { text: original, translatedLines: 0, aiUsed: false, note: 'AI 没有返回有效翻译' }
  }

  const output: string[] = []
  let lineIndex = 0
  for (const line of original.split('\n')) {
    output.push(line)
    const match = line.match(TIMESTAMP_LINE_RE)
    if (!match || !match[2].trim()) continue
    const translated = translatedText.get(lineIndex)
    lineIndex++
    if (translated) output.push(translated)
  }

  return {
    text: output.join('\n'),
    translatedLines,
    aiUsed: true,
    note: `AI 翻译 ${translatedLines} 行${failedChunks ? `（${failedChunks} 段失败）` : ''}`,
  }
}
