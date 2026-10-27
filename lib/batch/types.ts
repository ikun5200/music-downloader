export interface BatchItemDto {
  id: string
  line: string
  status: string
  platform?: string | null
  title?: string | null
  artist?: string | null
  album?: string | null
  downloadJobId?: string | null
  downloadStatus?: string | null
  downloadProgress?: number
  downloadBytesDone?: number
  downloadBytesTotal?: number | null
  downloadError?: string | null
  selectionReason?: string | null
  aiUsed?: boolean
  error?: string | null
}

export interface BatchDto {
  id: string
  status: string
  quality?: string | null
  total: number
  processed: number
  succeeded: number
  failed: number
  error?: string | null
  downloadCompleted: number
  downloadFailed: number
  downloadTotal: number
  downloadProgress: number
  items: BatchItemDto[]
  createdAt: string
  finishedAt?: string | null
}
