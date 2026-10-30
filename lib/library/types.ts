export type LibraryTaskType = 'audit' | 'duplicates' | 'albums' | 'lyrics' | 'covers'

export type LibraryIssueSeverity = 'error' | 'warn' | 'info'

export interface LibraryIssue {
  code: string
  severity: LibraryIssueSeverity
  message: string
}

export interface LibraryFile {
  /** 相对下载根目录的 POSIX 路径。 */
  path: string
  absolute: string
  size: number
  mtimeMs: number
  title: string
  artist: string
  album: string
  albumArtist: string
  track: string
  disc: string
  duration: number | null
  codec: string
  bitRate: number | null
  sampleRate: number | null
  bitsPerRaw: number | null
  quality: string
  hasCover: boolean
  coverWidth: number | null
  coverHeight: number | null
  coverHash: string | null
  coverPlaceholder: boolean
  hasLyrics: boolean
  lyrics: string
  syncedLyrics: boolean
  quickHash: string
  probeOk: boolean
  probeError?: string
  issues: LibraryIssue[]
}

export interface LibraryJobRef {
  id: string
  title: string
  artist: string
  album: string | null
  metadataTitle?: string | null
  metadataArtist?: string | null
  metadataAlbum?: string | null
  filePath: string | null
  status: string
  requestedQuality: string | null
  actualQuality: string | null
  qualityVerdict: string | null
}

export interface LibraryTaskSummary {
  totalFiles: number
  totalBytes: number
  elapsedMs: number
  errorCount: number
  warnCount: number
  infoCount: number
  byCode: Record<string, number>
  missingJobFiles?: number
  checkedAt: string
}

export interface AuditIssueRow {
  path: string
  title: string
  artist: string
  album: string
  duration: number | null
  quality: string
  size: number
  issues: LibraryIssue[]
}

export interface AuditResult {
  summary: LibraryTaskSummary
  issues: AuditIssueRow[]
  missingFiles: Array<{ path: string; title: string; artist: string; status: string }>
}

export interface DuplicateFile {
  path: string
  title: string
  artist: string
  album: string
  duration: number | null
  quality: string
  size: number
  hasCover: boolean
  hasLyrics: boolean
}

export interface DuplicateGroup {
  id: string
  kind: 'exact' | 'version'
  title: string
  artist: string
  duration: number | null
  confidence: 'high' | 'medium'
  reason: string
  keep: DuplicateFile
  remove: DuplicateFile[]
}

export interface DuplicateResult {
  summary: LibraryTaskSummary & { groups: number; removableFiles: number; removableBytes: number }
  groups: DuplicateGroup[]
}

export interface AlbumFile {
  path: string
  title: string
  artist: string
  album: string
  albumArtist: string
  track: string
}

export interface AlbumMergeGroup {
  id: string
  artistKey: string
  albumBase: string
  canonicalAlbum: string
  canonicalAlbumArtist: string
  albums: Array<{ album: string; count: number }>
  files: AlbumFile[]
  confidence: 'high' | 'medium'
  reason: string
}

export interface AlbumResult {
  summary: LibraryTaskSummary & { groups: number; mergeableFiles: number }
  groups: AlbumMergeGroup[]
}

export type WorkflowStatus = 'fixed' | 'not_found' | 'skipped' | 'failed'

export interface LyricsWorkflowItem {
  path: string
  title: string
  artist: string
  album: string
  status: WorkflowStatus
  source?: string
  note: string
  preview?: string
}

export interface LyricsResult {
  summary: LibraryTaskSummary & {
    targets: number
    fixed: number
    notFound: number
    failed: number
  }
  items: LyricsWorkflowItem[]
}

export interface CoverWorkflowItem {
  path: string
  title: string
  artist: string
  album: string
  status: WorkflowStatus
  source?: string
  note: string
}

export interface CoverResult {
  summary: LibraryTaskSummary & {
    targets: number
    fixed: number
    notFound: number
    failed: number
  }
  items: CoverWorkflowItem[]
}

export interface LibraryActionFileResult {
  path: string
  ok: boolean
  note: string
}
