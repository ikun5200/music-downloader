import { normalizeText } from '../utils'
import type { RawSearchSong } from './types'

export function decodeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    // 酷我等接口会返回多层转义（\\\\u0026），解析器会留下多个反斜杠。
    .replace(/\\+u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\+x([0-9a-fA-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    )
}

export function relevance(song: RawSearchSong, query: string): number {
  const q = normalizeText(query)
  if (!q) return 0
  const title = normalizeText(song.title)
  const artist = normalizeText(song.artist)
  const album = normalizeText(song.album)

  const rawTitle = String(song.title || '')
  const versionMarker = /(cover|翻唱|童声|学生版|dj|伴奏|纯享|钢琴|女声|男声|片段|live|现场|remix|抖音|铃声|试听|翻自)/i.test(rawTitle)

  let score = 0
  if (title === q) score += 120
  else if (title.startsWith(q)) score += 80
  else if (title.includes(q)) score += 50
  if (artist.includes(q)) score += 40
  if (album.includes(q)) score += 10
  if (versionMarker) score -= 45
  score += Math.max(0, 12 - rawTitle.length)

  const terms = String(query)
    .split(/[\s,，]+/)
    .map((term) => normalizeText(term))
    .filter(Boolean)
  let matchedTerms = 0
  for (const term of terms) {
    const inTitle = title.includes(term)
    const inArtist = artist.includes(term)
    if (inTitle) score += 12
    if (inArtist) score += 10
    if (album.includes(term)) score += 3
    if (inTitle || inArtist) matchedTerms += 1
  }
  // 同时命中标题和歌手（如“孤勇者 陈奕迅”）的结果应明显优先于只命中一个词的翻唱/其他歌曲。
  if (terms.length > 1) score += matchedTerms === terms.length ? 30 : -15
  return score
}

export function sortResults(results: RawSearchSong[], query: string): RawSearchSong[] {
  const seen = new Set<string>()
  return results
    .filter((r) => {
      if (!r.id || !r.title || !r.artist) return false
      const key = `${r.platform}:${r.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((r) => ({ r, score: relevance(r, query) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.r)
}
