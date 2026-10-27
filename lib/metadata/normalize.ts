import * as OpenCC from 'opencc-js'
import type { MetadataCandidate, MetadataQuery, MetadataSourceId } from './types'

const t2s = OpenCC.Converter({ from: 'tw', to: 'cn' })

const VARIANT_RE =
  /(live|现场|演唱会|remix|混音|伴奏|纯音乐|instrumental|acoustic|karaoke|卡拉\s*ok|翻唱|cover|dj|慢摇|加快|加速|变调|降调|升调|串烧|铃声|mv版|片段|剪辑|独白版|女声版|男声版|童声|钢琴版|吉他版|弹唱版|纯享版|深情版|治愈版|温柔版|烟嗓版|环绕版|3d环绕|广场舞|车载|demo|试听|抢听|预告|改编|慢速|0\.8x|1\.2x)/gi

const BRACKET_RE = /[（(【\[][^）)】\]]*[）)】\]]/g
const PROMO_SUFFIX_RE =
  /\s*[-—–]\s*[^-—–]*(?:主题曲|片头曲|片尾曲|插曲|推广曲|宣传曲|印象曲|概念曲|人物曲|角色曲|献礼曲|周年|活动|游戏|电影|电视剧|动画|网剧|纪录片|综艺|官方|mv|版)[^-—–]*$/i
const VERSION_SUFFIX_RE =
  /\s*[-—–]\s*(?:铃声|伴奏|remix|mix|live|现场|演唱会|纯音乐|翻唱|cover|instrumental|acoustic|dj|慢摇|加快|加速|变调|降调|升调|串烧|伴奏版|纯音乐版|独白版|mv版|片段|剪辑|女声版|男声版|童声|钢琴版|吉他版|弹唱版|纯享版|深情版|治愈版|温柔版|烟嗓版|环绕版|广场舞|车载|demo|试听|抢听|预告|改编)[版曲]?\s*$/i

// 精选/合集类专辑的曲目号和封面经常被重新编排，不能拿来当原版专辑信息。
// “概念自选辑”这类正式发行专辑不算合集。
const COMPILATION_RE =
  /(精选|作品精选|作品集|合集|合辑|纪念专辑|珍藏|典藏|套装|新歌\+|金曲|全记录|历年|他[是为][…\.．]{1,3}|greatest\s*hits|best\s*of|collection|anthology|compilation|box\s*set)/i

export function isCompilationAlbum(value: string | null | undefined): boolean {
  const text = toSimplified(String(value || '')).trim()
  return !!text && COMPILATION_RE.test(text)
}

export function isSyncedLyrics(value: string | null | undefined): boolean {
  return /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(String(value || ''))
}

export function toSimplified(value: string): string {
  if (!value) return ''
  try {
    return t2s(value)
  } catch {
    return value
  }
}

function normalizeText(value: string): string {
  return toSimplified(value || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

export function titleKey(value: string): string {
  const cleaned = (value || '')
    .replace(BRACKET_RE, ' ')
    .replace(VERSION_SUFFIX_RE, ' ')
    .replace(PROMO_SUFFIX_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalizeText(cleaned)
}

export function cleanPromoSuffix(value: string): string {
  const cleaned = (value || '')
    .replace(PROMO_SUFFIX_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || (value || '').trim()
}

export function titleKeys(value: string): string[] {
  const base = (value || '').trim()
  const withoutBrackets = base.replace(BRACKET_RE, ' ').trim()
  const withoutSuffix = base.replace(VERSION_SUFFIX_RE, ' ').trim()
  const withoutPromo = base.replace(PROMO_SUFFIX_RE, ' ').trim()
  return [
    ...new Set(
      [
        titleKey(base),
        titleKey(withoutBrackets),
        titleKey(withoutSuffix),
        titleKey(withoutPromo),
      ].filter(Boolean)
    ),
  ]
}

const ARTIST_SPLIT_RE =
  /\s*(?:\/|&|,|，|、|;|；|\+| feat\.?\s*| ft\.?\s*)\s*/i

const ARTIST_ALIASES: Record<string, string> = {
  valorant: '无畏契约',
  '无畏契约': '无畏契约',
  jjlin: '林俊杰',
  jaychou: '周杰伦',
  easonchan: '陈奕迅',
  jolintsai: '蔡依林',
  gem: '邓紫棋',
  gem邓紫棋: '邓紫棋',
}

function artistKey(value: string): string {
  const key = normalizeText(value)
  return ARTIST_ALIASES[key] || key
}

export function artistKeys(value: string): string[] {
  return [
    ...new Set(
      (value || '')
        .split(ARTIST_SPLIT_RE)
        .map((part) => artistKey(part))
        .filter(Boolean)
    ),
  ]
}

export function matchTitle(want: string, got: string): number {
  const wantKeys = titleKeys(want)
  const gotKeys = titleKeys(got)
  if (!wantKeys.length || !gotKeys.length) return 0
  for (const w of wantKeys) {
    for (const g of gotKeys) {
      if (w === g) return 1
      const min = Math.min(w.length, g.length)
      if (min >= 4 && (w.includes(g) || g.includes(w))) return 0.78
    }
  }
  return 0
}

export function matchArtist(want: string, got: string): number {
  if (!(want || '').trim()) return 0.55
  const wantKeys = artistKeys(want)
  const gotKeys = artistKeys(got)
  if (!wantKeys.length || !gotKeys.length) return 0
  const wantJoined = wantKeys.join('')
  const gotJoined = gotKeys.join('')
  if (wantJoined === gotJoined) return 1

  const wantInGot = wantKeys.every((key) => gotKeys.includes(key))
  const gotInWant = gotKeys.every((key) => wantKeys.includes(key))
  // 候选多出歌手（常见于“周杰伦、林俊杰”这种合唱/翻唱）必须降权，
  // 否则会把独唱原版匹配成合唱版本。
  if (wantInGot && !gotInWant) return 0.55
  if (gotInWant && !wantInGot) return 0.7
  if (
    Math.min(wantJoined.length, gotJoined.length) >= 2 &&
    (wantJoined.includes(gotJoined) || gotJoined.includes(wantJoined))
  ) {
    return 0.65
  }
  return 0
}

export function countVariantFlags(rawTitle: string): number {
  const text = rawTitle || ''
  const matches = text.match(VARIANT_RE)
  if (!matches) return 0
  return new Set(matches.map((item) => item.toLowerCase())).size
}

function matchAlbum(want: string | null | undefined, got: string): number {
  if (!(want || '').trim()) return 0
  const a = titleKey(want || '')
  const b = titleKey(got || '')
  if (!a || !b) return 0
  if (a === b) return 1
  const wantCompilation = isCompilationAlbum(want)
  const gotCompilation = isCompilationAlbum(got)
  // 查询来自精选集时，后续来源给出的正式专辑才是更有价值的原版信息。
  if (wantCompilation && !gotCompilation) return 0.75
  // 候选是精选集、查询不是时，专辑信息不可信，避免它靠来源优先级胜出。
  if (!wantCompilation && gotCompilation) return 0.15
  return Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a)) ? 0.6 : 0
}

function durationScore(want: number | null | undefined, got: number | undefined): number {
  if (!want || !got) return 0.5
  const diff = Math.abs(want - got)
  if (diff <= 5) return 1
  if (diff <= 15) return 0.7
  if (diff <= 30) return 0.35
  if (diff > 45) return 0
  return 0.2
}

function sourceBonus(source: MetadataSourceId, order: MetadataSourceId[]): number {
  const index = order.indexOf(source)
  if (index < 0) return 0
  return index === 0 ? 12 : 5
}

/**
 * 规则打分。只有标题、歌手都匹配且没有 live/remix/伴奏等版本标记时才标记 acceptable，
 * 避免把现场版、翻唱或伴奏写进下载文件。
 */
export function scoreCandidate(
  candidate: MetadataCandidate,
  query: MetadataQuery,
  order: MetadataSourceId[]
): MetadataCandidate {
  const rawTitle = candidate.rawTitle || candidate.title
  const titleScore = matchTitle(query.title, rawTitle)
  const artistScore = matchArtist(query.artist, candidate.artist)
  const durScore = durationScore(query.duration, candidate.duration)
  const albumScore = matchAlbum(query.album, candidate.album)
  const variantFlags = countVariantFlags(rawTitle)
  const albumIsCompilation = isCompilationAlbum(candidate.album)

  const reasons: string[] = []
  if (titleScore >= 0.99) reasons.push('歌名完全一致')
  else if (titleScore > 0) reasons.push('歌名相近')
  else reasons.push('歌名不匹配')
  if (artistScore >= 0.99) reasons.push('歌手一致')
  else if (artistScore > 0) reasons.push('歌手相近')
  else reasons.push('歌手不匹配')
  if (query.duration && candidate.duration) {
    reasons.push(`时长差 ${Math.abs(query.duration - candidate.duration)} 秒`)
  }
  if (albumScore > 0) reasons.push('专辑一致')
  else if (query.album && candidate.album) reasons.push('专辑不一致')
  if (albumIsCompilation) reasons.push('合集/精选专辑')
  if (variantFlags > 0) reasons.push('含版本标记')

  const albumMismatch = query.album && candidate.album && albumScore < 0.5 ? 12 : 0
  const compilationPenalty = albumIsCompilation ? 30 : 0
  const base =
    titleScore * 50 +
    artistScore * 30 +
    durScore * 15 +
    albumScore * 5 +
    sourceBonus(candidate.source, order) -
    albumMismatch -
    compilationPenalty
  const score = Math.round((base - Math.min(variantFlags, 3) * 20) * 10) / 10

  const durationOk = !query.duration || !candidate.duration || durScore >= 0.35
  const artistOk = !query.artist.trim() || artistScore >= 0.7
  const acceptable =
    titleScore >= 0.75 &&
    artistOk &&
    variantFlags === 0 &&
    durationOk

  return {
    ...candidate,
    score,
    acceptable,
    variantFlags,
    titleScore,
    artistScore,
    durationScore: durScore,
    reasons,
  }
}

export function isLooseMatch(candidate: MetadataCandidate): boolean {
  return (
    (candidate.titleScore || 0) >= 0.5 &&
    (candidate.artistScore || 0) >= 0.5 &&
    candidate.variantFlags <= 1
  )
}

export function cleanMetadataText(value: string | undefined | null): string {
  return toSimplified(String(value || '').trim())
}
