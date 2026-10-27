import type { MusicInfo, Platform } from '../constants'

export interface RawSearchSong {
  platform: Platform
  id: string
  title: string
  artist: string
  album?: string
  duration?: number
  coverUrl?: string
  musicInfo: MusicInfo
}

export interface PlatformSearchResult {
  platform: Platform
  results: RawSearchSong[]
  error?: string
}
