export type OnlineCardKind = 'song' | 'album' | 'playlist' | 'radio' | 'video' | 'link'

export interface OnlineCard {
  id: string
  kind: OnlineCardKind
  title: string
  subtitle?: string
  artwork?: string
  url?: string
  appleId?: string
  duration?: number
  trackCount?: number
}

export interface OnlineSection {
  id: string
  title: string
  kind: string
  layout: 'shelf' | 'grid'
  items: OnlineCard[]
}

export interface OnlineHome {
  fetchedAt: string
  source: 'apple' | 'rss'
  sections: OnlineSection[]
}

export interface OnlineTrack {
  id: string
  title: string
  artist: string
  album?: string
  artwork?: string
  duration?: number
  appleId?: string
  url?: string
  trackNumber?: number
}

export interface OnlineCollection {
  id: string
  kind: 'album' | 'playlist' | 'unknown'
  title: string
  subtitle?: string
  artwork?: string
  description?: string
  tracks: OnlineTrack[]
  url?: string
}

export interface OnlineSearchResult {
  songs: OnlineTrack[]
  albums: OnlineCard[]
}
