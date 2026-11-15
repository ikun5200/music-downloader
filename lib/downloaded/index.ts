import fs from 'fs/promises'
import path from 'path'
import type { DownloadedTrack, Prisma } from '@prisma/client'
import { prisma, withDbRetry } from '../db'
import { ffprobeFile, type FileAudioInfo } from '../download/probe'
import { ensureDownloadDirs, resolveDownloadRoot } from '../download/filename'
import { listAudioFiles } from '../library/scan'
import { cpuScanConcurrency, getSettings, setSetting } from '../settings'
import { safeJson } from '../utils'
import {
  artistKeysOverlap,
  buildRequestIdentity,
  buildTrackIdentity,
  isGenericArtist,
  normalizeArtistKey,
  versionSignature,
} from './identity'

export interface DownloadedMatch {
  path: string
  title: string
  artist: string
  album: string | null
  duration: number | null
  versionKey: string
}

export interface DownloadedIndexRefreshResult {
  total: number
  added: number
  updated: number
  unchanged: number
  removed: number
  errors: number
  elapsedMs: number
  finishedAt: string
}

export class AlreadyDownloadedError extends Error {
  match: DownloadedMatch

  constructor(match: DownloadedMatch) {
    super(
      `已下载过同名同歌手同版本：${match.title}${match.artist ? ` - ${match.artist}` : ''}`
    )
    this.name = 'AlreadyDownloadedError'
    this.match = match
  }
}

const globalForIndex = globalThis as unknown as {
  __mdDownloadedRefresh?: Promise<DownloadedIndexRefreshResult> | null
}

function relativePath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/')
}

function parseFilename(name: string): { title: string; artist: string } {
  const base = path
    .parse(name)
    .name.replace(/\s+\(\d+\)$/, '')
    .trim()
  const separator = base.indexOf(' - ')
  if (separator > 0) {
    return {
      artist: base.slice(0, separator).trim(),
      title: base.slice(separator + 3).trim(),
    }
  }
  return { title: base, artist: '' }
}

function clamp(value: string, max = 300): string {
  return value.trim().slice(0, max)
}

function buildRow(
  absolute: string,
  rel: string,
  stat: { size: number; mtimeMs: number },
  probe: FileAudioInfo | null,
  downloadJobId?: string | null
): Prisma.DownloadedTrackUncheckedCreateInput {
  const fileName = path.basename(absolute)
  const parsed = parseFilename(fileName)
  const title = clamp(probe?.title || parsed.title || path.parse(fileName).name || fileName)
  const artist = clamp(probe?.artist || parsed.artist || '')
  const album = probe?.album ? clamp(probe.album) : null
  const identity = buildTrackIdentity(title, artist, album)
  // 标签没写版本时，用文件名里的 (Live)/(0.8x) 补上，避免把变体当原版。
  const versionKey =
    identity.versionKey || versionSignature(fileName, album)
  const duration =
    probe?.duration && Number.isFinite(probe.duration) && probe.duration > 0
      ? probe.duration
      : null

  return {
    path: rel,
    fileName,
    title,
    artist,
    album,
    titleKey: identity.titleKey,
    artistKey: identity.artistKey,
    versionKey,
    duration,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    downloadJobId: downloadJobId || null,
    lastSeenAt: new Date(),
  }
}

async function upsertRow(row: Prisma.DownloadedTrackUncheckedCreateInput) {
  const update: Prisma.DownloadedTrackUncheckedUpdateInput = {
    fileName: row.fileName,
    title: row.title,
    artist: row.artist,
    album: row.album,
    titleKey: row.titleKey,
    artistKey: row.artistKey,
    versionKey: row.versionKey,
    duration: row.duration,
    size: row.size,
    mtimeMs: row.mtimeMs,
    lastSeenAt: row.lastSeenAt,
  }
  if (row.downloadJobId) update.downloadJobId = row.downloadJobId
  await withDbRetry(() =>
    prisma.downloadedTrack.upsert({
      where: { path: row.path },
      create: row,
      update,
    })
  )
}

/** 下载完成后立即写入索引，不必等每日扫描。 */
export async function indexDownloadedFile(
  absolute: string,
  options: { downloadJobId?: string | null; probe?: FileAudioInfo | null } = {}
): Promise<DownloadedTrack | null> {
  try {
    const root = resolveDownloadRoot()
    const rel = relativePath(root, absolute)
    if (!rel || rel.startsWith('..')) return null
    const stat = await fs.stat(absolute)
    if (!stat.isFile()) return null
    const probe =
      options.probe === undefined ? await ffprobeFile(absolute).catch(() => null) : options.probe
    const row = buildRow(absolute, rel, stat, probe, options.downloadJobId)
    await upsertRow(row)
    return await prisma.downloadedTrack.findUnique({ where: { path: rel } })
  } catch (error) {
    console.warn('[downloaded] 写入文件索引失败:', error)
    return null
  }
}

async function doRefresh(): Promise<DownloadedIndexRefreshResult> {
  const started = Date.now()
  const { root } = await ensureDownloadDirs()
  const rootStat = await fs.stat(root)
  if (!rootStat.isDirectory()) throw new Error('下载目录不是文件夹')

  const settings = await getSettings().catch(() => null)
  const concurrency = Math.max(
    1,
    Math.min(4, cpuScanConcurrency(settings?.cpuLimitPercent ?? 25))
  )
  const files = await listAudioFiles(root, { strictRoot: true })
  const existing = await prisma.downloadedTrack.findMany()
  const byPath = new Map(existing.map((row) => [row.path, row]))
  const seen = new Set<string>()
  let added = 0
  let updated = 0
  let unchanged = 0
  let errors = 0

  let cursor = 0
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = cursor++
      if (index >= files.length) return
      const absolute = files[index]
      const rel = relativePath(root, absolute)
      seen.add(rel)
      try {
        const stat = await fs.stat(absolute)
        if (!stat.isFile()) continue
        const previous = byPath.get(rel)
        if (
          previous &&
          previous.size === stat.size &&
          Math.abs(previous.mtimeMs - stat.mtimeMs) < 1
        ) {
          unchanged++
          continue
        }
        const probe = await ffprobeFile(absolute).catch(() => null)
        await upsertRow(buildRow(absolute, rel, stat, probe))
        if (previous) updated++
        else added++
      } catch (error) {
        errors++
        console.warn('[downloaded] 扫描文件失败:', absolute, error)
      }
    }
  })
  await Promise.all(workers)

  const missing = existing.filter((row) => !seen.has(row.path)).map((row) => row.id)
  let removed = 0
  for (let offset = 0; offset < missing.length; offset += 500) {
    const chunk = missing.slice(offset, offset + 500)
    const result = await prisma.downloadedTrack.deleteMany({ where: { id: { in: chunk } } })
    removed += result.count
  }

  const result: DownloadedIndexRefreshResult = {
    total: files.length,
    added,
    updated,
    unchanged,
    removed,
    errors,
    elapsedMs: Date.now() - started,
    finishedAt: new Date().toISOString(),
  }
  await setSetting('downloadedIndexLastScanAt', result.finishedAt)
  await setSetting('downloadedIndexSummary', JSON.stringify(result))
  return result
}

/** 全量校准下载目录索引；同一进程内并发调用会复用同一个任务。 */
export function refreshDownloadedIndex(): Promise<DownloadedIndexRefreshResult> {
  if (globalForIndex.__mdDownloadedRefresh) return globalForIndex.__mdDownloadedRefresh
  globalForIndex.__mdDownloadedRefresh = doRefresh().finally(() => {
    globalForIndex.__mdDownloadedRefresh = null
  })
  return globalForIndex.__mdDownloadedRefresh
}

export async function getDownloadedIndexStatus() {
  const [count, lastScan, summary] = await Promise.all([
    prisma.downloadedTrack.count(),
    prisma.setting.findUnique({ where: { key: 'downloadedIndexLastScanAt' } }),
    prisma.setting.findUnique({ where: { key: 'downloadedIndexSummary' } }),
  ])
  return {
    count,
    lastScanAt: lastScan?.value || null,
    summary: summary ? safeJson<DownloadedIndexRefreshResult | null>(summary.value, null) : null,
    refreshing: !!globalForIndex.__mdDownloadedRefresh,
  }
}

function matchFromRow(row: DownloadedTrack): DownloadedMatch {
  return {
    path: row.path,
    title: row.title,
    artist: row.artist,
    album: row.album,
    duration: row.duration,
    versionKey: row.versionKey,
  }
}

function durationDiffTooLarge(expected?: number | null, actual?: number | null): boolean {
  if (!expected || !actual || expected < 20 || actual < 20) return false
  return Math.abs(expected - actual) > Math.max(15, expected * 0.12)
}

/** 按“歌名 + 歌手 + 版本”查已下载文件；不依赖 DownloadJob 记录。 */
export async function findDownloadedDuplicate(input: {
  title: string
  artist: string
  album?: string | null
  requestLine?: string | null
  duration?: number | null
}): Promise<DownloadedMatch | null> {
  const identity = buildRequestIdentity(
    input.title,
    input.artist,
    input.album,
    input.requestLine
  )
  if (!identity.titleKey) return null

  const rows = await prisma.downloadedTrack.findMany({
    where: { titleKey: identity.titleKey },
    take: 100,
  })
  const genericArtist = isGenericArtist(input.artist)
  for (const row of rows) {
    if ((row.versionKey || '') !== identity.versionKey) continue
    if (!genericArtist) {
      if (row.artistKey) {
        if (!artistKeysOverlap(identity.artistKey, row.artistKey)) continue
      } else {
        // 老文件可能没有 artist 标签；时长几乎一致时才敢按同名同版本跳过。
        if (
          !input.duration ||
          !row.duration ||
          Math.abs(input.duration - row.duration) > 2
        ) {
          continue
        }
      }
    }
    if (durationDiffTooLarge(input.duration, row.duration)) continue
    return matchFromRow(row)
  }
  return null
}

/**
 * 批量名单入队前的快速预检：把一行拆成词，找“一个词是已下载歌名，
 * 另一个词是已下载歌手”的组合。找不到就交给选版后的精确检查。
 */
export async function findDownloadedDuplicateByLine(
  line: string
): Promise<DownloadedMatch | null> {
  const terms = String(line || '')
    .split(/[\s,，、/|｜\-–—]+/)
    .map((term) => term.trim())
    .filter(Boolean)
  if (terms.length < 2) return null
  const phrases: Array<{ key: string; start: number; end: number }> = []
  for (let start = 0; start < terms.length; start++) {
    let phrase = ''
    for (let end = start; end < terms.length; end++) {
      phrase = phrase ? `${phrase} ${terms[end]}` : terms[end]
      const key = buildTrackIdentity(phrase, '').titleKey
      if (key) phrases.push({ key, start, end })
    }
  }
  const keys = [...new Set(phrases.map((phrase) => phrase.key))]
  if (!keys.length) return null

  const rows = await prisma.downloadedTrack.findMany({
    where: { titleKey: { in: keys } },
    take: 200,
  })
  const versionKey = versionSignature(line)
  for (const row of rows) {
    if (!row.artistKey) continue
    if ((row.versionKey || '') !== versionKey) continue
    const candidates = phrases.filter((phrase) => phrase.key === row.titleKey)
    for (const phrase of candidates) {
      const artistText = terms
        .filter((_, index) => index < phrase.start || index > phrase.end)
        .join(' ')
      const artistKey = normalizeArtistKey(artistText)
      if (!artistKey || !artistKeysOverlap(artistKey, row.artistKey)) continue
      return matchFromRow(row)
    }
  }
  return null
}
