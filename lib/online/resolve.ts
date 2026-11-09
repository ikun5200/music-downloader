import { PLATFORM_NAMES, type Platform } from '../constants'
import { searchAll } from '../search'
import type { RawSearchSong } from '../search/types'
import { artistKeys, titleKey } from '../metadata/normalize'
import { hasPlaybackVariant } from '../playback/variant'
import { resolvePreview, type PreviewResult } from '../preview'
import { getSettings } from '../settings'
import { signPreviewToken } from '../preview-token'

export interface OnlinePlayInput {
  title: string
  artist?: string
  album?: string
  duration?: number | null
  quality?: string | null
}

export interface OnlinePlayResult {
  streamUrl: string
  platform: Platform
  platformName: string
  quality: string
  channel: { id: string; name: string }
  title: string
  artist: string
  album?: string
  coverUrl?: string
  duration?: number
  requestedQuality?: string | null
}

interface Candidate {
  song: RawSearchSong
  platform: Platform
  score: number
  queryIndex: number
  variant: boolean
}

function artistOverlap(wanted: Set<string>, got: string[]): boolean {
  if (!wanted.size || !got.length) return false
  for (const key of got) {
    if (wanted.has(key)) return true
    for (const want of wanted) {
      const min = Math.min(want.length, key.length)
      if (min >= 2 && (want.includes(key) || key.includes(want))) return true
    }
  }
  return false
}

function scoreCandidate(
  song: RawSearchSong,
  input: OnlinePlayInput,
  platformIndex: number,
  queryIndex: number
): number {
  const wantTitle = titleKey(input.title)
  const gotTitle = titleKey(song.title)
  let score = 0
  if (wantTitle && gotTitle === wantTitle) score += 120
  else if (wantTitle && gotTitle && (gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle))) {
    score += 60
  } else {
    return 0
  }

  const wantedArtists = new Set(artistKeys(input.artist || ''))
  const gotArtists = artistKeys(song.artist)
  const genericArtist = /^(various artists|群星|未知|unknown)$/i.test(
    String(input.artist || '').trim()
  )
  if (!genericArtist && wantedArtists.size && gotArtists.length) {
    // 在线播放宁可报错，也不要播成同名的翻唱/其他歌手版本。
    if (!artistOverlap(wantedArtists, gotArtists)) return 0
    score += 45
  }

  if (input.album) {
    const wantAlbum = titleKey(input.album)
    const gotAlbum = titleKey(song.album || '')
    if (wantAlbum && gotAlbum === wantAlbum) score += 8
  }
  const requestedVariant = hasPlaybackVariant(input.title, input.album)
  if (!requestedVariant && hasPlaybackVariant(song.title, song.album)) {
    // 原曲请求不能落到慢放/降调/Live/伴奏版本上。
    score -= 90
  }
  if (input.duration && song.duration) {
    const diff = Math.abs(input.duration - song.duration)
    if (diff <= 3) score += 20
    else if (diff <= 10) score += 10
    else if (diff > Math.max(20, input.duration * 0.2)) score -= 80
    else score -= Math.min(25, diff / 4)
  }
  score += Math.max(0, 8 - platformIndex) + Math.max(0, 3 - queryIndex)
  return score
}

function collectCandidates(
  results: Awaited<ReturnType<typeof searchAll>>,
  input: OnlinePlayInput,
  queryIndex: number
): Candidate[] {
  const requestedVariant = hasPlaybackVariant(input.title, input.album)
  const out: Candidate[] = []
  results.forEach((result, platformIndex) => {
    for (const song of result.results) {
      const score = scoreCandidate(song, input, platformIndex, queryIndex)
      if (score > 0) {
        out.push({
          song,
          platform: result.platform,
          score,
          queryIndex,
          variant: !requestedVariant && hasPlaybackVariant(song.title, song.album),
        })
      }
    }
  })
  return out
}

export async function resolveOnlinePlay(input: OnlinePlayInput): Promise<OnlinePlayResult> {
  const title = String(input.title || '').trim()
  const artist = String(input.artist || '').trim()
  if (!title) throw new Error('缺少歌曲名')
  const settings = await getSettings()
  const platforms = settings.platformOrder
  const queries = [artist ? `${title} ${artist}` : title, title]
  const seen = new Set<string>()
  let candidates: Candidate[] = []

  for (let index = 0; index < queries.length; index++) {
    const query = queries[index]
    if (!query || seen.has(query)) continue
    seen.add(query)
    const results = await searchAll(query, platforms)
    candidates = candidates.concat(collectCandidates(results, input, index))
  }

  candidates.sort((a, b) => b.score - a.score || a.queryIndex - b.queryIndex)
  const deduped: Candidate[] = []
  const keys = new Set<string>()
  for (const candidate of candidates) {
    const key = `${candidate.platform}:${candidate.song.id}`
    if (keys.has(key)) continue
    keys.add(key)
    deduped.push(candidate)
  }
  if (!deduped.length) throw new Error('音源里没有找到匹配版本')

  // 有原版候选时优先原版；只有慢放/降调等版本时宁可报错，也不要播成慢放。
  const clean = deduped.filter((candidate) => !candidate.variant)
  const pool = clean.length ? clean : deduped
  if (!clean.length) {
    throw new Error('只找到慢放/降调/现场等非原版音源，已跳过')
  }

  const errors: string[] = []
  for (const candidate of pool.slice(0, 6)) {
    try {
      const result: PreviewResult = await resolvePreview(
        candidate.platform,
        candidate.song.musicInfo,
        { quality: input.quality, expectedDuration: input.duration }
      )
      return {
        streamUrl: `/api/preview/stream?t=${encodeURIComponent(
          signPreviewToken(result.url, candidate.platform)
        )}`,
        platform: candidate.platform,
        platformName: PLATFORM_NAMES[candidate.platform],
        quality: result.quality,
        channel: result.channel,
        title: candidate.song.title,
        artist: candidate.song.artist,
        album: candidate.song.album,
        coverUrl: candidate.song.coverUrl,
        duration: result.duration ?? candidate.song.duration,
        requestedQuality: input.quality || null,
      }
    } catch (e) {
      errors.push(
        `${PLATFORM_NAMES[candidate.platform]}/${candidate.song.title}: ${
          e instanceof Error ? e.message : String(e)
        }`
      )
    }
  }
  throw new Error(`没有可播放的音源：${errors.slice(-2).join(' | ')}`.slice(0, 700))
}

