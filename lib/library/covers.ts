import type { AppSettings } from '../settings'
import { getMetadataAdapter } from '../metadata/sources'
import { scoreCandidate } from '../metadata/normalize'
import { writeMetadataTags } from '../metadata/tag'
import { detectCandidateVersionTags } from '../version-intent'
import type { MetadataCandidate, MetadataSourceId } from '../metadata/types'
import { inspectLibraryFile } from './scan'
import type { CoverWorkflowItem, LibraryFile, WorkflowStatus } from './types'

function unprotect(value: string): string {
  return String(value || '')
    .replace(/＆/g, '&')
    .replace(/／/g, '/')
    .replace(/＼/g, '\\')
    .replace(/｜/g, '|')
    .replace(/﹔/g, ';')
    .replace(/・/g, '、')
}

function candidateMatches(candidate: MetadataCandidate): boolean {
  return (
    candidate.acceptable &&
    (candidate.titleScore || 0) >= 0.75 &&
    (candidate.artistScore || 0) >= 0.5
  )
}

function hasCover(candidate: MetadataCandidate): boolean {
  return !!(candidate.coverUrl || candidate.coverUrls?.length)
}

export interface CoverCandidate {
  candidate: MetadataCandidate
  source: string
}

export async function fetchCoverCandidates(
  file: Pick<LibraryFile, 'title' | 'artist' | 'album' | 'duration'>,
  settings: AppSettings
): Promise<CoverCandidate[]> {
  const title = unprotect(file.title).trim()
  const artist = unprotect(file.artist).trim()
  if (!title) return []
  const all = settings.metadataSourceOrder?.length
    ? settings.metadataSourceOrder
    : (['itunes', 'qqmusic', 'netease', 'kugou', 'kuwo', 'theaudiodb'] as MetadataSourceId[])
  const order = all.filter((source) => getMetadataAdapter(source).supportsCover)
  if (!order.length) order.push('itunes', 'qqmusic', 'netease', 'kugou', 'kuwo', 'theaudiodb')

  const query = {
    title,
    artist,
    album: file.album || '',
    duration: file.duration,
    versionTags: detectCandidateVersionTags(file.title, file.album),
    languageTags: [],
  }

  const out: CoverCandidate[] = []
  const seen = new Set<string>()
  for (const source of order) {
    const adapter = getMetadataAdapter(source)
    let candidates: MetadataCandidate[] = []
    try {
      const result = await adapter.search(query, 6)
      candidates = result.candidates
        .map((candidate) => scoreCandidate(candidate, query, order))
        .filter(candidateMatches)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
    } catch {
      continue
    }

    for (const candidate of candidates) {
      if (!hasCover(candidate) && adapter.enrich) {
        await adapter.enrich(candidate).catch(() => {})
      }
      const url = candidate.coverUrl || candidate.coverUrls?.[0]
      if (!url || seen.has(url)) continue
      seen.add(url)
      out.push({ candidate, source: adapter.label })
      if (out.length >= 6) return out
    }
  }
  return out
}

export interface ApplyCoverResult {
  status: WorkflowStatus
  source?: string
  note: string
}

export async function applyCoverToFile(
  root: string,
  file: LibraryFile,
  settings: AppSettings
): Promise<ApplyCoverResult> {
  if (!file.title || !file.artist) {
    return { status: 'skipped', note: '缺少歌名或歌手，无法搜索封面' }
  }
  const ext = file.path.split('.').pop()?.toLowerCase() || ''
  if (['ogg', 'opus', 'wav'].includes(ext)) {
    return { status: 'skipped', note: `${ext} 格式不支持写入内嵌封面` }
  }

  const candidates = await fetchCoverCandidates(file, settings).catch(() => [])
  if (!candidates.length) return { status: 'not_found', note: '没有找到可信匹配的封面' }

  let lastNote = ''
  for (const item of candidates) {
    const write = await writeMetadataTags(file.absolute, item.candidate, {
      writeInfo: false,
      writeCover: true,
      writeLyrics: false,
      fallbackCoverUrls: [],
    })
    if (!write.ok) {
      lastNote = write.note || '写入封面失败'
      continue
    }
    const verified = await inspectLibraryFile(root, file.absolute, true)
    if (verified.hasCover && !verified.coverPlaceholder) {
      return {
        status: 'fixed',
        source: item.source,
        note: `封面已写入${verified.coverWidth ? `（${verified.coverWidth}×${verified.coverHeight}）` : ''}`,
      }
    }
    lastNote = verified.coverPlaceholder ? '候选封面是占位图' : '写入后校验不到封面'
  }
  return { status: 'failed', note: lastNote || '所有封面候选都写入失败' }
}

export function toCoverItem(
  file: LibraryFile,
  result: ApplyCoverResult
): CoverWorkflowItem {
  return {
    path: file.path,
    title: file.title,
    artist: file.artist,
    album: file.album,
    status: result.status,
    source: result.source,
    note: result.note,
  }
}
