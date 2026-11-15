import { artistKeys, titleKey } from '../metadata/normalize'
import {
  detectAlbumVersionTags,
  detectLanguageTags,
  detectVersionTags,
} from '../version-intent'
import { normalizeText } from '../utils'

const BRACKET_RE = /[\(\[【（]([^\)\]】）]*)[\)\]】）]/g
const DASH_SUFFIX_RE = /[-–—|｜]\s*([^-–—|｜]+)$/

const GENERIC_ARTISTS = new Set([
  '未知歌手',
  '未知',
  'unknown',
  'variousartists',
  '群星',
])

export interface TrackIdentity {
  titleKey: string
  artistKey: string
  versionKey: string
}

function addVersionTags(text: string, tokens: Set<string>) {
  for (const tag of detectVersionTags(text)) tokens.add(tag)
  for (const tag of detectLanguageTags(text)) tokens.add(tag)
}

/**
 * 只把“括号里的版本词 / 破折号后的版本词 / 最后一个独立版本词 / 专辑版本”
 * 当作版本标记。不能直接对整句跑 detectVersionTags，
 * 否则《Live Forever》这种正常歌名会被误判成 Live 版。
 */
export function versionSignature(text: string, album?: string | null): string {
  const value = String(text || '').trim()
  if (!value) return ''
  const tokens = new Set<string>()

  for (const match of value.matchAll(BRACKET_RE)) {
    if (match[1]) addVersionTags(match[1], tokens)
  }

  const dash = value.match(DASH_SUFFIX_RE)
  if (dash?.[1]) addVersionTags(dash[1], tokens)

  const words = value.split(/\s+/).filter(Boolean)
  const last = words[words.length - 1]
  // 单字歌名《Live》不当作版本；但“晴天 Live”“晴天 现场版”这种后缀要识别。
  if (last && words.length > 1) addVersionTags(last, tokens)

  if (album) {
    for (const tag of detectAlbumVersionTags(album)) tokens.add(tag)
    for (const tag of detectLanguageTags(album)) tokens.add(tag)
  }

  return [...tokens].sort().join('|')
}

export function normalizeArtistKey(artist: string): string {
  return artistKeys(artist || '').sort().join('|')
}

export function isGenericArtist(artist: string): boolean {
  const compact = normalizeText(artist)
  return !compact || GENERIC_ARTISTS.has(compact)
}

export function buildTrackIdentity(
  title: string,
  artist: string,
  album?: string | null
): TrackIdentity {
  return {
    titleKey: titleKey(title) || normalizeText(title),
    artistKey: normalizeArtistKey(artist),
    versionKey: versionSignature(title, album),
  }
}

export function buildRequestIdentity(
  title: string,
  artist: string,
  album?: string | null,
  requestLine?: string | null
): TrackIdentity {
  const identity = buildTrackIdentity(title, artist, album)
  const line = String(requestLine || '').trim()
  if (line) identity.versionKey = versionSignature(line, album)
  return identity
}

export function artistKeysOverlap(wantedKey: string, gotKey: string): boolean {
  const wanted = wantedKey.split('|').filter(Boolean)
  const got = gotKey.split('|').filter(Boolean)
  if (!wanted.length || !got.length) return false
  return wanted.some((want) =>
    got.some((candidate) => {
      if (want === candidate) return true
      const min = Math.min(want.length, candidate.length)
      return min >= 2 && (want.includes(candidate) || candidate.includes(want))
    })
  )
}
