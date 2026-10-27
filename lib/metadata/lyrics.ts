import { titleKey, toSimplified } from './normalize'

export interface CleanLyricsOptions {
  title?: string
  artist?: string
  /** 去掉开头连续的制作人/公司/编曲/演唱等说明。 */
  cleanCredits?: boolean
  /** 把中文歌词统一转成简体。 */
  simplify?: boolean
}

interface ParsedLine {
  raw: string
  kind: 'lyric' | 'tag' | 'text'
  text: string
  offsetTag?: boolean
}

const TIMESTAMP_PREFIX_RE =
  /^\s*((?:\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+)\s*(.*)$/
const TIMESTAMP_TOKEN_RE = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g
const TAG_ONLY_RE = /^\s*\[([a-z][a-z0-9_-]*):[^\]]*\]\s*$/i

const CN_CREDIT_LABELS = [
  '后期母带处理制作人',
  '后期母带处理录音师',
  '后期母带处理录音室',
  '母带后期处理制作人',
  '母带后期处理录音师',
  '母带后期处理录音室',
  '弦乐编写',
  '鼓组音频编辑',
  '低音吉他',
  '人声录音',
  '人声编辑',
  '封面设计',
  '视觉设计',
  '平面设计',
  '字体设计',
  '录音助理',
  '混音助理',
  '母带助理',
  '制作行政',
  '出品监制',
  '视觉设计',
  '平面设计',
  '技术支持',
  '词曲作者',
  '制作统筹',
  '制作协力',
  '制作助理',
  '配唱制作人',
  '配唱制作',
  '配唱编写',
  '和声编写',
  '录音工程师',
  '混音工程师',
  '母带工程师',
  '音乐总监',
  '艺术总监',
  '出品公司',
  '发行公司',
  '唱片公司',
  '版权公司',
  '制作公司',
  '音乐制作',
  '词作者',
  '曲作者',
  '特别鸣谢',
  '特别感谢',
  '出品发行',
  '混音室',
  '录音室',
  '录音棚',
  '母带处理',
  '制作人',
  '监制',
  '出品人',
  '出品',
  '发行',
  '演唱',
  '歌手',
  '原唱',
  '作词',
  '作曲',
  '编曲',
  '制作',
  '录音',
  '录音师',
  '混音',
  '混音师',
  '母带',
  '后期',
  '吉他',
  '贝斯',
  '鼓',
  '和声',
  '合声',
  '弦乐',
  '统筹',
  '企划',
  '导演',
  '制片',
  '版权',
  '宣传',
  '文案',
  '设计',
  '插画',
  '摄影',
  '化妆',
  '造型',
  '发型',
  '经纪人',
  '感谢',
  '致谢',
  '词曲',
  '词',
  '曲',
  'rap',
  'op',
  'sp',
  'mv',
  '人声',
  '乐器',
  '小提琴',
  '中提琴',
  '大提琴',
  '钢琴',
  '合成器',
  '编程',
  '打击乐',
  '口琴',
  '萨克斯',
  '长笛',
].sort((a, b) => b.length - a.length)

// 中文 credit 后面常跟英文大写标签，如“词 LYRICS：”“曲 COMPOSER :”。
const CN_CREDIT_RE = new RegExp(
  `^\\s*(?:${CN_CREDIT_LABELS.join('|')})\\s*(?:[A-Za-z][A-Za-z0-9 /&.()\\-]*)?\\s*[:：]`,
  'i'
)

const EN_CREDIT_RE =
  /^\s*(?:producer|produced\s+by|composer|composed\s+by|lyricist|lyrics?(?:\s+by)?|words?(?:\s+by)?|music(?:\s+by)?|arranger|arranged\s+by|mixing|mixed\s+by|mix|mastering|mastered\s+by|recording|recorded\s+by|recording\s+engineer|guitar|bass|drums|vocals?|backing\s+vocals?|strings|piano|keyboard|programming|a&r|publisher|label|copyright|op|sp)\s*[:：]/i

const EN_CREDIT_BY_RE =
  /^\s*(?:produced|composed|written|arranged|mixed|mastered|recorded)\s+by\s+/i

const COPYRIGHT_RE = /^(?:[℗©]|\(p\)|\(c\)|copyright\b|未经许可|未经授权|本歌曲|版权方|禁止翻唱|不得翻唱)/i
const SEPARATOR_RE = /^[\s\-_=*~—–]{3,}$/

const PERFORMER_LABEL_RE = /^[\p{L}·.\s]{1,16}\s*[:：]$/u
const PERFORMER_PREFIX_RE = /^([\p{L}·.\s]{1,16})\s*[:：]\s*(.+)$/u

function performerNames(artist?: string): Set<string> {
  const names = new Set([
    '合',
    '合唱',
    '全体',
    '群星',
    '男',
    '女',
    '男声',
    '女声',
    'chorus',
    'rap',
    'hook',
    'lay',
    'jj',
    '韩红',
    '林俊杰',
    '张艺兴',
    '周杰伦',
    '邓紫棋',
    '金莎',
    '杨瑞代',
    '费玉清',
  ])
  for (const part of String(artist || '').split(/\s*(?:\/|&|,|，|、|;|；|\+)\s*/)) {
    const name = part.trim().toLowerCase()
    if (name) names.add(name)
  }
  return names
}

function stripPerformerPrefix(text: string, artist?: string): string {
  const match = text.match(PERFORMER_PREFIX_RE)
  if (!match) return text
  const prefix = match[1].trim().toLowerCase()
  if (!performerNames(artist).has(prefix)) return text
  return match[2].trim()
}

function rewriteLyricLine(raw: string, artist?: string): string {
  const normalized = normalizeTimestampPrefix(raw) || raw
  const match = normalized.match(TIMESTAMP_PREFIX_RE)
  if (match) {
    return `${match[1]}${stripPerformerPrefix(match[2].trim(), artist)}`
  }
  return stripPerformerPrefix(normalized, artist)
}

function parseLine(raw: string): ParsedLine {
  const match = raw.match(TIMESTAMP_PREFIX_RE)
  if (match) {
    return { raw, kind: 'lyric', text: match[2].trim() }
  }
  const tag = raw.match(TAG_ONLY_RE)
  if (tag) {
    return {
      raw,
      kind: 'tag',
      text: '',
      offsetTag: tag[1].toLowerCase() === 'offset',
    }
  }
  return { raw, kind: 'text', text: raw.trim() }
}

function isCreditText(text: string): boolean {
  const value = text.trim()
  if (!value) return false
  return (
    CN_CREDIT_RE.test(value) ||
    EN_CREDIT_RE.test(value) ||
    EN_CREDIT_BY_RE.test(value) ||
    COPYRIGHT_RE.test(value) ||
    SEPARATOR_RE.test(value) ||
    /^制作\s*[：:]/.test(value)
  )
}

function isTitleLine(text: string, title?: string, artist?: string): boolean {
  const titleKeyValue = titleKey(title || '')
  if (!titleKeyValue) return false
  const value = text.trim()
  if (!value) return false
  if (titleKey(value) === titleKeyValue) return true

  const parts = value.split(/\s*[-–—]\s*/)
  if (parts.length >= 2) {
    const keys = parts.map((part) => titleKey(part)).filter(Boolean)
    const maxLength =
      (title || '').length + (artist || '').length + 16
    if (keys.includes(titleKeyValue) && value.length <= maxLength) return true
  }
  return false
}

function isHeaderNoise(text: string, title?: string, artist?: string): boolean {
  const value = text.trim()
  if (!value) return true
  return (
    isCreditText(value) ||
    PERFORMER_LABEL_RE.test(value) ||
    isTitleLine(value, title, artist)
  )
}

function stampToMs(stamp: string): number {
  const match = stamp.match(/^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]$/)
  if (!match) return 0
  const fraction = match[3] ? Number(match[3].padEnd(3, '0').slice(0, 3)) : 0
  return Number(match[1]) * 60_000 + Number(match[2]) * 1000 + fraction
}

/** 同一行有多个时间戳时按时间升序排列，避免播放器只取到较晚的那个。 */
function normalizeTimestampPrefix(raw: string): string | null {
  const match = raw.match(TIMESTAMP_PREFIX_RE)
  if (!match) return null
  const stamps = [...match[1].matchAll(TIMESTAMP_TOKEN_RE)].map((item) => item[0])
  if (!stamps.length) return null
  stamps.sort((a, b) => stampToMs(a) - stampToMs(b))
  return `${stamps.join('')}${match[2]}`
}

/**
 * 把来源 LRC 清理成 Apple Music 那种“直接进入歌词”的形式：
 * - 去掉开头连续的制作人、公司、编曲、录音、演唱、歌名等说明；
 * - 去掉 LRC 元数据标签（保留 offset，避免改变时间轴）；
 * - 保留真正歌词的时间轴和空行；
 * - 可选地把中文歌词转成简体。
 */
export function cleanLyrics(
  raw: string,
  options: CleanLyricsOptions = {}
): string {
  const text = String(raw || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (!text.trim()) return ''

  const cleanCredits = options.cleanCredits !== false
  const simplify = options.simplify !== false

  if (!cleanCredits) {
    return (simplify ? toSimplified(text) : text).trim()
  }

  const parsed = text.split('\n').map(parseLine)
  let start = 0

  while (start < parsed.length) {
    const line = parsed[start]
    if (line.kind === 'tag') {
      // offset 会在输出阶段保留；这里只是跳过它继续识别后面的头部。
      start++
      continue
    }
    if (line.kind === 'text') {
      if (isHeaderNoise(line.text, options.title, options.artist)) {
        start++
        continue
      }
      break
    }
    if (!line.text) {
      start++
      continue
    }
    if (isHeaderNoise(line.text, options.title, options.artist)) {
      start++
      continue
    }
    break
  }

  const output: string[] = []
  for (let index = 0; index < parsed.length; index++) {
    const line = parsed[index]
    if (line.kind === 'tag') {
      // offset 会影响时间轴；其余 [ti:]/[ar:]/[kuwo:] 等只增加噪音。
      if (line.offsetTag) output.push(line.raw)
      continue
    }
    if (index < start) continue
    if (line.kind === 'lyric') {
      // 制作人/演唱者标签即使出现在正文中间也去掉，例如“JJ：”“合：”。
      if (isCreditText(line.text) || PERFORMER_LABEL_RE.test(line.text)) continue
      const rewritten = rewriteLyricLine(line.raw, options.artist)
      output.push(simplify ? toSimplified(rewritten) : rewritten)
      continue
    }
    if (isCreditText(line.text)) continue
    const rewritten = stripPerformerPrefix(line.raw, options.artist)
    output.push(simplify ? toSimplified(rewritten) : rewritten)
  }

  return output.join('\n').replace(/^\n+|\n+$/g, '').trim()
}
