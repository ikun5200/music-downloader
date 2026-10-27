export const PLATFORMS = ['kw', 'kg', 'tx', 'wy', 'mg'] as const
export type Platform = (typeof PLATFORMS)[number]

export const PLATFORM_NAMES: Record<Platform, string> = {
  kw: '酷我',
  kg: '酷狗',
  tx: 'QQ',
  wy: '网易云',
  mg: '咪咕',
}

export const PLATFORM_COLORS: Record<Platform, string> = {
  kw: '#f59e0b',
  kg: '#3b82f6',
  tx: '#22c55e',
  wy: '#ef4444',
  mg: '#a855f7',
}

export const QUALITY_NAMES: Record<string, string> = {
  '128k': '128k',
  '192k': '192k',
  '320k': '320k',
  flac: 'FLAC',
  flac24bit: 'FLAC 24bit',
  '24bit': '24bit',
  hires: 'Hi-Res',
  atmos: 'Atmos',
  atmos_plus: 'Atmos Plus',
  master: '母带',
  jymaster: '臻品母带',
  jyeffect: '臻品音效',
  sky: '沉浸声',
}

export const QUALITY_RANK: Record<string, number> = {
  '128k': 1,
  '192k': 2,
  '320k': 3,
  flac: 4,
  flac24bit: 5,
  '24bit': 5,
  jyeffect: 5,
  hires: 6,
  sky: 6,
  atmos: 6,
  atmos_plus: 7,
  jymaster: 7,
  master: 8,
}

export const QUALITY_ORDER = Object.entries(QUALITY_RANK)
  .sort((a, b) => b[1] - a[1])
  .map(([q]) => q)

export interface MusicInfo {
  source: Platform | string
  songmid?: string
  hash?: string
  copyrightId?: string
  strMediaMid?: string
  name?: string
  singer?: string
  albumName?: string
  albumId?: string
  albumMid?: string
  songId?: string
  rid?: string
  musicrid?: string
  audioid?: string
  contentId?: string
  interval?: number
  _types?: Record<string, { hash?: string; size?: number }>
  [key: string]: unknown
}

export interface SearchSong {
  platform: Platform
  id: string
  title: string
  artist: string
  album?: string
  duration?: number
  coverUrl?: string
  musicInfo: MusicInfo
  qualities: string[]
  channels: number
}

export interface SearchPlatformResponse {
  id: Platform
  name: string
  available: boolean
  channels: number
  qualities: string[]
  results: SearchSong[]
  error?: string
}

export interface SearchResponse {
  query: string
  tookMs: number
  platforms: SearchPlatformResponse[]
}

export const JOB_STATUSES = [
  'queued',
  'resolving',
  'downloading',
  'completed',
  'failed',
  'canceled',
] as const

export type JobStatus = (typeof JOB_STATUSES)[number]
