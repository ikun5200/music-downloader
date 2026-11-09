const VERSION_WORDS = [
  'slowed',
  'sped\\s*up',
  'speed\\s*up',
  'nightcore',
  'reverb',
  'remix',
  'dj',
  'live',
  'acoustic',
  'instrumental',
  'karaoke',
  'cover',
  'demo',
  '8d',
  '慢放',
  '慢速',
  '降速',
  '加速',
  '加快',
  '降调',
  '升调',
  '变调',
  '伴奏',
  '纯音乐',
  '翻唱',
  '现场',
  '演唱会',
  '混音',
  '串烧',
  '铃声',
  '片段',
  '剪辑',
  '女声版',
  '男声版',
  '童声',
  '钢琴版',
  '吉他版',
  '弹唱版',
  '纯享版',
  '深情版',
  '治愈版',
  '温柔版',
  '烟嗓版',
  '环绕版',
  '广场舞',
  '车载',
  '试听',
  '抢听',
  '预告',
  '改编',
  '体验版',
  '黑胶版',
  '0\\.8x',
  '0\\.9x',
  '1\\.2x',
].join('|')

// 版本标记通常出现在括号里或破折号后的结尾，例如 Song (Live)、Song - Remix。
// 不能直接在整段标题里搜 live/cover/dj，否则 Deliver、Discover、Live Forever 会误判。
const BRACKETED_VARIANT = new RegExp(`[（(【\\[][^）)】\\]]*(?:${VERSION_WORDS})[^）)】\\]]*[）)】\\]]`, 'i')
const SUFFIX_VARIANT = new RegExp(`(?:^|[-—–])\\s*(?:${VERSION_WORDS})\\s*$`, 'i')
// slowed/nightcore/8D 这类词几乎不会出现在正常歌名里，可以整段匹配。
const UNAMBIGUOUS_VARIANT = /(?<![a-z])(?:slowed|sped\s*up|speed\s*up|nightcore|reverb|8d(?:\s*audio)?)(?![a-z])/i
// 专辑名里的 Live at/in/from 基本可以确定是现场专辑；不直接匹配所有 live，
// 避免把 “Live Through This” 这类正式专辑名误判。
const ALBUM_LIVE = /(?:^|[\s(（-])live(?:\s+(?:at|in|from|on)\b|$)/i
// 中文版本词通常直接写在标题里，如“某某（降调版）”“某某慢放版”。
const CHINESE_VARIANT = /(慢放|慢速|降速|降调|升调|变调|加速版|加快版|伴奏|纯音乐|翻唱|混音|串烧|铃声|片段|剪辑)/

/** 判断一个搜索结果是否是慢放/降调/Live/伴奏等非原版版本。 */
export function hasPlaybackVariant(title: string, album?: string | null): boolean {
  const text = `${title || ''} ${album || ''}`.trim()
  if (!text) return false
  return (
    BRACKETED_VARIANT.test(text) ||
    SUFFIX_VARIANT.test(text) ||
    UNAMBIGUOUS_VARIANT.test(text) ||
    ALBUM_LIVE.test(album || '') ||
    CHINESE_VARIANT.test(text)
  )
}
