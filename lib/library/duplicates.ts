import { QUALITY_RANK } from '../constants'
import { artistKeys, titleKey } from '../metadata/normalize'
import { detectCandidateLanguageTags, detectCandidateVersionTags } from '../version-intent'
import type {
  DuplicateFile,
  DuplicateGroup,
  DuplicateResult,
  LibraryFile,
} from './types'

function toDuplicateFile(file: LibraryFile): DuplicateFile {
  return {
    path: file.path,
    title: file.title,
    artist: file.artist,
    album: file.album,
    duration: file.duration,
    quality: file.quality,
    size: file.size,
    hasCover: file.hasCover && !file.coverPlaceholder,
    hasLyrics: file.hasLyrics,
  }
}

function keepScore(file: LibraryFile): number {
  const rank = QUALITY_RANK[file.quality] || 0
  return (
    rank * 1_000_000 +
    (file.hasCover && !file.coverPlaceholder ? 50_000 : 0) +
    (file.hasLyrics ? 20_000 : 0) +
    (file.title ? 5_000 : 0) +
    (file.artist ? 5_000 : 0) +
    Math.min(file.size, 1_000_000_000) / 1_000_000 -
    (/(?:copy|副本|\(\d+\)|（\d+）)/i.test(file.path) ? 1_000_000 : 0)
  )
}

function bestFile(files: LibraryFile[]): LibraryFile {
  return [...files].sort((a, b) => {
    const diff = keepScore(b) - keepScore(a)
    if (diff !== 0) return diff
    return a.path.localeCompare(b.path, 'zh-CN')
  })[0]
}

const BRACKET_RE = /[\(\[【（]([^\)\]】）]*)[\)\]】）]/g

/** 括号里的副标题/版本说明；纯数字 (2) 视为复制副本，不参与区分。 */
function bracketKey(title: string): string {
  return [...String(title || '').matchAll(BRACKET_RE)]
    .map((match) => (match[1] || '').trim().toLowerCase())
    .filter((text) => !!text && !/^\d+$/.test(text))
    .sort()
    .join('|')
}

function durationClusters(files: LibraryFile[]): LibraryFile[][] {
  const withDuration = files
    .filter((file) => file.duration != null)
    .sort((a, b) => (a.duration || 0) - (b.duration || 0))
  const withoutDuration = files.filter((file) => file.duration == null)
  const clusters: LibraryFile[][] = []
  for (const file of withDuration) {
    const current = clusters[clusters.length - 1]
    if (
      current &&
      Math.abs((current[current.length - 1].duration || 0) - (file.duration || 0)) <= 4
    ) {
      current.push(file)
    } else {
      clusters.push([file])
    }
  }
  if (withoutDuration.length) {
    if (clusters.length === 1) clusters[0].push(...withoutDuration)
    else if (!clusters.length) clusters.push(withoutDuration)
    else clusters[clusters.length - 1].push(...withoutDuration)
  }
  return clusters
}

export function findDuplicates(files: LibraryFile[]): DuplicateResult {
  const startedAt = Date.now()
  const groups: DuplicateGroup[] = []
  const consumed = new Set<string>()

  // 1) 内容完全一致：size + 首尾 512KB 的 SHA-1 相同。
  const byHash = new Map<string, LibraryFile[]>()
  for (const file of files) {
    if (!file.size || !file.quickHash) continue
    const list = byHash.get(file.quickHash) || []
    list.push(file)
    byHash.set(file.quickHash, list)
  }
  for (const list of byHash.values()) {
    if (list.length < 2) continue
    const keep = bestFile(list)
    const remove = list.filter((file) => file.path !== keep.path)
    for (const file of list) consumed.add(file.path)
    groups.push({
      id: `exact-${keep.quickHash.slice(0, 12)}`,
      kind: 'exact',
      title: keep.title,
      artist: keep.artist,
      duration: keep.duration,
      confidence: 'high',
      reason: '文件内容完全一致（大小与首尾指纹相同）',
      keep: toDuplicateFile(keep),
      remove: remove.map(toDuplicateFile),
    })
  }

  // 2) 同歌不同版本/音质：歌名 + 主歌手 + 版本标签相同，时长接近。
  const bySong = new Map<string, LibraryFile[]>()
  for (const file of files) {
    if (!file.title || !file.artist) continue
    const artist = artistKeys(file.artist)[0] || titleKey(file.artist)
    const version = detectCandidateVersionTags(file.title, file.album).sort().join('+')
    const language = detectCandidateLanguageTags(file.title, file.album).sort().join('+')
    // 括号副标题不同时不要合并，避免把“重生版/粤语版/电影主题曲”当成重复。
    // 有些文件的标签没带副标题，但文件名带了，所以两处都要看。
    const brackets = `${bracketKey(file.title)}|${bracketKey(file.path)}`
    const key = `${titleKey(file.title)}|${artist}|${version}|${language}|${brackets}`
    const list = bySong.get(key) || []
    list.push(file)
    bySong.set(key, list)
  }

  for (const list of bySong.values()) {
    if (list.length < 2) continue
    for (const cluster of durationClusters(list)) {
      const candidates = cluster.filter((file) => !consumed.has(file.path))
      if (candidates.length < 2) continue
      const keep = bestFile(candidates)
      const remove = candidates.filter((file) => file.path !== keep.path)
      if (!remove.length) continue
      const durations = candidates
        .map((file) => file.duration)
        .filter((value): value is number => value != null)
      const spread = durations.length
        ? Math.max(...durations) - Math.min(...durations)
        : null
      const confidence: DuplicateGroup['confidence'] =
        spread != null && spread <= 2 ? 'high' : 'medium'
      groups.push({
        id: `version-${titleKey(keep.title)}-${keep.path.length}-${groups.length}`,
        kind: 'version',
        title: keep.title,
        artist: keep.artist,
        duration: keep.duration,
        confidence,
        reason:
          spread == null
            ? '歌名/歌手相同，时长未知，疑似同一首歌的不同文件'
            : `歌名/歌手相同，时长相差 ${Math.round(spread)} 秒，疑似同歌不同音质`,
        keep: toDuplicateFile(keep),
        remove: remove.map(toDuplicateFile),
      })
    }
  }

  const removableBytes = groups.reduce(
    (sum, group) => sum + group.remove.reduce((inner, file) => inner + file.size, 0),
    0
  )
  const removableFiles = groups.reduce((sum, group) => sum + group.remove.length, 0)
  const groupedPaths = new Set(
    groups.flatMap((group) => [group.keep.path, ...group.remove.map((file) => file.path)])
  )
  const sameNameCopies = files.filter(
    (file) =>
      /(?:[（(]\d+[）)])$/.test(file.path.replace(/\.[^.]+$/, '')) &&
      !groupedPaths.has(file.path)
  )

  return {
    summary: {
      totalFiles: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      elapsedMs: Date.now() - startedAt,
      errorCount: 0,
      warnCount: 0,
      infoCount: 0,
      byCode: {},
      checkedAt: new Date().toISOString(),
      groups: groups.length,
      removableFiles,
      removableBytes,
      sameNameCopies: sameNameCopies.length,
      sameNameExamples: sameNameCopies.slice(0, 8).map((file) => file.path),
    },
    groups,
  }
}
