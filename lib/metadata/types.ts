export type MetadataSourceId =
  | 'itunes'
  | 'netease'
  | 'kugou'
  | 'kuwo'
  | 'qqmusic'
  | 'lrclib'
  | 'theaudiodb'

export interface MetadataCandidate {
  source: MetadataSourceId
  sourceLabel: string
  title: string
  artist: string
  artists?: string[]
  album: string
  albumArtist?: string
  date: string
  genre: string
  track?: string
  trackTotal?: string
  disc?: string
  publisher?: string
  language?: string
  duration?: number
  songId?: string
  albumId?: string
  coverUrl?: string
  coverUrls?: string[]
  lyrics?: string
  rawTitle?: string
  /** 规则打分，仅用于排序和 AI 参考。 */
  score: number
  /** 标题/歌手/时长等是否达到可接受阈值。 */
  acceptable: boolean
  /** 版本标记数量（live/remix/伴奏等）。 */
  variantFlags: number
  titleScore?: number
  artistScore?: number
  durationScore?: number
  reasons: string[]
}

export interface MetadataQuery {
  title: string
  artist: string
  album?: string | null
  duration?: number | null
}

export interface MetadataScrapeResult {
  status: 'success' | 'not_found' | 'failed'
  candidate?: MetadataCandidate
  note?: string
  aiUsed?: boolean
  lyricsFromQq?: boolean
}

export interface MetadataSourceResult {
  candidates: MetadataCandidate[]
  note?: string
}

export interface MetadataSourceAdapter {
  id: MetadataSourceId
  label: string
  supportsLyrics: boolean
  supportsCover: boolean
  search(query: MetadataQuery, limit: number): Promise<MetadataSourceResult>
  enrich?(candidate: MetadataCandidate): Promise<void>
  lyrics?(candidate: MetadataCandidate): Promise<string>
}

export interface MetadataWriteResult {
  ok: boolean
  partial: boolean
  wrote: string[]
  note: string
}
