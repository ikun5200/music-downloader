import { chatCompletion, extractJsonObject, type ChatMessage } from './ai/client'
import type { AiConfig } from './settings'

/**
 * 飞牛音乐原生按固定分隔符拆艺术家：
 * `； ; / \ | 、 & ， feat. featuring ft.`
 * 它不会区分“合作分隔符”和“乐队名里的符号”，也不先解码 HTML 实体。
 *
 * 这里统一做两件事：
 * 1. 先解码 HTML 实体，避免 `Guns N&apos; Roses` 被 `&`/`;` 拆成三个人；
 * 2. 判断多歌手后，用飞牛能识别、且不会和名字冲突的分隔符写回。
 */

export interface ArtistResolution {
  artists: string[]
  /** 写进文件 artist 标签的字符串。 */
  artistTag: string
  /** 写进文件 album_artist 标签的主歌手，避免专辑页显示一整串。 */
  albumArtist: string
  aiUsed: boolean
  note: string
}

export interface ResolveArtistsOptions {
  title?: string | null
  album?: string | null
  aiConfig?: AiConfig | null
  /** 后台“AI 识别歌手/乐队名”开关；还需 aiConfig.enabled + apiKey。 */
  aiEnabled?: boolean
  /** 便于测试注入。 */
  chat?: typeof chatCompletion
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  quot: '"',
  lt: '<',
  gt: '>',
  nbsp: ' ',
}

const HTML_ENTITY_RE = /&(#x?[0-9a-f]+|[a-z][a-z0-9]+);?/gi
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/
const FEAT_RE = /\s*(?:feat\.?|ft\.?|featuring)\s+/i
const HARD_SEPARATOR_RE = /\s*[、；;|\\]\s*/
const SLASH_RE = /\s*\/\s*/
const AMP_RE = /\s*&\s*/
const COMMA_RE = /\s*[,，]\s*/
const AMBIGUOUS_RE = /[&/,，、;；|\\]|\b(?:feat\.?|ft\.?|featuring)\b/i

const CACHE_TTL = 24 * 60 * 60 * 1000
const CACHE_MAX = 800
const cache = new Map<string, { at: number; resolution: ArtistResolution }>()

export function decodeHtmlEntities(value: string): string {
  let text = String(value || '').replace(/\\&/g, '&')
  // 最多两轮，兼容 `&amp;apos;` 这种二次编码。
  for (let pass = 0; pass < 2; pass++) {
    const next = text.replace(HTML_ENTITY_RE, (match, entity: string) => {
      if (entity.startsWith('#')) {
        const hex = entity[1]?.toLowerCase() === 'x'
        const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)
        if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
          try {
            return String.fromCodePoint(code)
          } catch {
            return match
          }
        }
        return match
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match
    })
    if (next === text) break
    text = next
  }
  return text.replace(/\u00a0/g, ' ')
}

function cleanArtistPart(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/\s+/g, ' ')
    .replace(/^[\s,，、;；/&|\\]+/, '')
    .replace(/[\s,，、;；/&|\\]+$/, '')
    .trim()
}

function comparisonKey(value: string): string {
  return decodeHtmlEntities(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s'’`.,，、;；:：\-–—_/\\&|]+/g, '')
}

function hasCjk(value: string): boolean {
  return CJK_RE.test(value)
}

function shouldSplitSlash(part: string, cjk: boolean): boolean {
  if (!part.includes('/')) return false
  if (cjk) return true
  // AC/DC 这种没有空格的斜杠是名字的一部分；A / B、Maroon 5/Wiz Khalifa 才是合作。
  return part.split('/').some((side) => /\s/.test(side))
}

function dedupeArtists(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const name = cleanArtistPart(value)
    if (!name) continue
    const key = comparisonKey(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/**
 * 规则兜底。保守策略：
 * - 明确的 feat./ft./featuring、顿号、分号、竖线、反斜杠一定拆；
 * - 斜杠只有在带空格、或包含中文时才拆，保护 AC/DC；
 * - `&` 和逗号只有在包含中文时才拆，保护 Simon & Garfunkel、Earth, Wind & Fire。
 * 英文的 `A & B`、`A, B` 这类歧义交给 AI；AI 不可用时宁可保持完整，也不拆错乐队名。
 */
export function splitArtistsByRules(raw: string): string[] {
  const decoded = decodeHtmlEntities(raw).trim()
  if (!decoded) return []

  const out: string[] = []
  for (const featPart of decoded.split(FEAT_RE)) {
    for (const hardPart of featPart.split(HARD_SEPARATOR_RE)) {
      let parts = [hardPart]
      const cjk = hasCjk(hardPart)
      parts = parts.flatMap((part) => (shouldSplitSlash(part, cjk) ? part.split(SLASH_RE) : [part]))
      if (cjk) {
        parts = parts.flatMap((part) => part.split(AMP_RE))
        parts = parts.flatMap((part) => part.split(COMMA_RE))
      }
      out.push(...parts)
    }
  }
  return dedupeArtists(out)
}

function chooseSeparator(artists: string[]): string {
  if (artists.length <= 1) return ''
  // 飞牛会拆这些字符；选一个没有出现在任何艺人名字里的。
  for (const separator of ['、', '；', '|', ';', '/', '&']) {
    if (!artists.some((artist) => artist.includes(separator))) return separator
  }
  // 所有分隔符都冲突时，用 ASCII 逗号+空格；飞牛不会拆它，至少不会把名字拆坏。
  return ', '
}

/**
 * 单个艺人/乐队名内部如果含有飞牛的 separators，直接写进去仍会被拆开。
 * 用视觉相近、但不在飞牛分隔符表里的字符替换，保证 AI 判定“这是一个名字”能生效。
 */
export function protectArtistName(value: string): string {
  return String(value || '')
    .replace(/\s*&\s*/g, ' ＆ ')
    .replace(/\//g, '／')
    .replace(/\\/g, '＼')
    .replace(/\|/g, '｜')
    .replace(/[;；]/g, '﹔')
    .replace(/、/g, '・')
    .replace(/，/g, ', ')
    .replace(/\bfeat\./gi, 'feat．')
    .replace(/\bft\./gi, 'ft．')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildResolution(
  artists: string[],
  aiUsed: boolean,
  note: string
): ArtistResolution {
  const list = dedupeArtists(artists)
  const separator = chooseSeparator(list)
  const safeNames = list.map(protectArtistName)
  return {
    artists: list,
    artistTag: safeNames.join(separator),
    albumArtist: safeNames[0] || '',
    aiUsed,
    note,
  }
}

/** 纯规则规范化，不调用 AI。 */
export function normalizeArtists(raw: string): ArtistResolution {
  const artists = splitArtistsByRules(raw)
  if (!artists.length) {
    const single = cleanArtistPart(raw)
    return buildResolution(single ? [single] : [], false, '')
  }
  const artistTag = buildResolution(artists, false, '').artistTag
  const note =
    artists.length > 1 && artistTag !== decodeHtmlEntities(raw).trim()
      ? `艺术家已规范化：${artistTag}`
      : ''
  return buildResolution(artists, false, note)
}

/**
 * 校验 AI 返回的艺术家列表，防止 AI 改写名字或把乐队名拆错。
 * 每个结果必须是解码后 raw 的连续子串（忽略空格/标点差异）。
 */
export function validateAiArtists(raw: string, proposed: unknown): string[] | null {
  if (!Array.isArray(proposed) || !proposed.length || proposed.length > 30) return null
  const decoded = decodeHtmlEntities(raw)
  const rawKey = comparisonKey(decoded)
  if (!rawKey) return null

  const out: string[] = []
  for (const item of proposed) {
    if (typeof item !== 'string') return null
    const name = cleanArtistPart(item)
    if (!name || name.length > 120) return null
    const key = comparisonKey(name)
    if (!key || !rawKey.includes(key)) return null
    out.push(name)
  }
  const deduped = dedupeArtists(out)
  if (!deduped.length) return null

  // 原文没有任何合作分隔符时，不允许 AI 把它拆成多个名字。
  if (deduped.length > 1 && !AMBIGUOUS_RE.test(decoded)) return null
  return deduped
}

function shouldAskAi(raw: string): boolean {
  const decoded = decodeHtmlEntities(raw)
  return AMBIGUOUS_RE.test(decoded)
}

function cacheGet(key: string): ArtistResolution | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(key)
    return null
  }
  return hit.resolution
}

function cacheSet(key: string, resolution: ArtistResolution) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, { at: Date.now(), resolution })
}

const SYSTEM_PROMPT = `你是音乐元数据里的艺术家字段识别助手。输入 rawArtist 可能包含 HTML 实体、多个歌手、feat. 合作，也可能是乐队名。

任务：先解码 HTML 实体，再判断分隔符是“多个艺人”还是“名字的一部分”。

必须保持完整的乐队/组合名，例如：
- AC/DC
- Simon & Garfunkel
- Earth, Wind & Fire
- Guns N' Roses
- Selena Gomez & The Scene
- The Peter Malick Group

只有明确是合作/合唱时才拆，例如：
- A & B（两位不同歌手）
- A feat. B / A ft. B / A featuring B
- A / B（两边是不同艺人）
- 中文顿号、分号、竖线分隔的歌手列表

不要创造新名字；每个结果必须是解码后 rawArtist 的连续子串（允许 trim 和大小写差异）。最多 30 个。无法确定时，返回整个解码后的 rawArtist 作为一个艺人。

只输出 JSON，不要解释或 markdown：{"artists":["..."],"reason":"一句话原因"}。`

/**
 * 解析艺术家字段。AI 开启且遇到歧义分隔符时先让 AI 判断，失败/非法时回退规则。
 */
export async function resolveArtists(
  rawArtist: string,
  options: ResolveArtistsOptions = {}
): Promise<ArtistResolution> {
  const raw = String(rawArtist || '').trim()
  const fallback = normalizeArtists(raw)
  if (!raw) return fallback

  const aiReady = !!(
    options.aiEnabled &&
    options.aiConfig?.enabled &&
    options.aiConfig.apiKey
  )
  if (!aiReady || !shouldAskAi(raw)) return fallback

  const cacheKey = `${options.title || ''}\u0000${options.album || ''}\u0000${raw}`
  const cached = cacheGet(cacheKey)
  if (cached) return cached

  try {
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          rawArtist: raw,
          title: options.title || '',
          album: options.album || '',
        }),
      },
    ]
    const chat = options.chat || chatCompletion
    const reply = await chat(options.aiConfig!, messages, {
      timeoutMs: 15_000,
      maxTokens: 400,
    })
    const parsed = extractJsonObject(reply)
    const artists = validateAiArtists(raw, parsed?.artists)
    if (!artists) {
      return {
        ...fallback,
        note: fallback.note || 'AI 返回的艺术家不合法，已回退规则',
      }
    }
    const resolution = buildResolution(
      artists,
      true,
      `AI 识别艺术家：${artists.join(' / ')}`
    )
    cacheSet(cacheKey, resolution)
    return resolution
  } catch (error) {
    console.warn('[ai] 艺术家识别失败，已回退规则:', error)
    return {
      ...fallback,
      note: fallback.note || 'AI 识别艺术家失败，已回退规则',
    }
  }
}
