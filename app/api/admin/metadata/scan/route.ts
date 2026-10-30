import { createHash } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { resolveDownloadRoot } from '@/lib/download/filename'
import { ffprobeFile, type FileAudioInfo } from '@/lib/download/probe'
import { actualQuality } from '@/lib/download/quality'
import { wakeMetadataQueue } from '@/lib/metadata/queue'
import { ensureRuntime } from '@/lib/runtime'
import { cpuScanConcurrency, getSettings } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const AUDIO_EXT = new Set([
  'flac',
  'mp3',
  'm4a',
  'mp4',
  'aac',
  'ogg',
  'opus',
  'wav',
  'ape',
  'wv',
  'tta',
  'aiff',
  'aif',
  'wma',
  'dsf',
  'dff',
])

const MAX_FILES = 2000
const MAX_DEPTH = 8

const globalForScan = globalThis as unknown as { __mdScanning?: boolean }

function normalizeRelative(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '')
}

function safeInt(value: number): number {
  return Math.min(Math.max(0, Math.round(value)), 2_147_483_647)
}

function cleanBaseName(value: string): string {
  return value
    .replace(/\s*[\[(](?:128k|192k|320k|flac|hires|24bit|无损|hq|sq)[\])]\s*$/i, '')
    .trim()
}

function inferFromFilename(filePath: string): { title: string; artist: string } {
  const base = cleanBaseName(path.basename(filePath, path.extname(filePath)))
  const parts = base.split(/\s+[-–—]\s+/)
  if (parts.length >= 2) {
    return {
      artist: parts[0].trim(),
      title: parts.slice(1).join(' - ').trim(),
    }
  }
  return { artist: '', title: base }
}

async function walkAudioFiles(
  dir: string,
  depth = 0
): Promise<{ files: string[]; truncated: boolean }> {
  if (depth > MAX_DEPTH) return { files: [], truncated: false }
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return { files: [], truncated: false }
  }
  const files: string[] = []
  let truncated = false

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('@') || entry.name.startsWith('#')) {
      continue
    }
    const absolute = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      const nested = await walkAudioFiles(absolute, depth + 1)
      files.push(...nested.files)
      truncated = truncated || nested.truncated
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).slice(1).toLowerCase()
      if (!AUDIO_EXT.has(ext) || entry.name.endsWith('.part')) continue
      files.push(absolute)
    }
    if (files.length >= MAX_FILES) {
      truncated = true
      break
    }
  }
  return { files, truncated }
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let index = 0
  async function worker() {
    while (true) {
      const current = index++
      if (current >= items.length) return
      results[current] = await fn(items[current])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  )
  return results
}

interface NewLocalJob {
  platform: string
  songId: string
  title: string
  artist: string
  album: string | null
  musicInfo: string
  actualQuality: string | null
  qualityVerdict: string
  status: string
  progress: number
  bytesDone: number
  bytesTotal: number
  filePath: string
  attempts: string
  verified: boolean
  reviewNote: string
  metadataStatus: string
  metadataNote: string
  createdAt: Date
  startedAt: Date
  finishedAt: Date
}

function localQuality(info: FileAudioInfo): string | null {
  try {
    const quality = actualQuality(info)
    return quality === 'unknown' ? null : quality
  } catch {
    return null
  }
}

export async function POST() {
  await ensureRuntime()
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '需要管理员登录' }, { status: 401 })
  }
  if (globalForScan.__mdScanning) {
    return NextResponse.json(
      { code: 409, message: '正在扫描中，请等当前扫描完成' },
      { status: 409 }
    )
  }

  globalForScan.__mdScanning = true
  try {
    const root = resolveDownloadRoot()
    const settings = await getSettings()
    const concurrency = cpuScanConcurrency(settings.cpuLimitPercent)
    const { files, truncated } = await walkAudioFiles(root)
    const existingJobs = await prisma.downloadJob.findMany({
      where: { filePath: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, filePath: true, status: true, metadataStatus: true },
    })
    const byPath = new Map<string, (typeof existingJobs)[number]>()
    for (const job of existingJobs) {
      if (!job.filePath) continue
      const key = normalizeRelative(job.filePath)
      if (!byPath.has(key)) byPath.set(key, job)
    }

    let queued = 0
    let skipped = 0
    let failed = 0
    const errors: string[] = []
    const newFiles: Array<{ absolute: string; relative: string }> = []

    for (const absolute of files) {
      const relative = normalizeRelative(path.relative(root, absolute))
      const existing = byPath.get(relative)
      if (existing) {
        if (existing.metadataStatus === 'success') {
          skipped++
          continue
        }
        if (existing.metadataStatus === 'pending' || existing.metadataStatus === 'processing') {
          skipped++
          continue
        }
        if (['queued', 'resolving', 'downloading', 'paused'].includes(existing.status)) {
          skipped++
          continue
        }
        if (existing.status !== 'completed') {
          // 文件已经存在但任务记录是失败/取消：当作本地文件重新完成并刮削。
          await prisma.downloadJob.update({
            where: { id: existing.id },
            data: {
              status: 'completed',
              progress: 100,
              error: null,
              metadataStatus: 'pending',
              metadataSource: null,
              metadataTitle: null,
              metadataArtist: null,
              metadataAlbum: null,
              metadataNote: '扫描目录后等待刮削',
              metadataAt: null,
              finishedAt: new Date(),
            },
          })
          queued++
          continue
        }
        await prisma.downloadJob.update({
          where: { id: existing.id },
          data: {
            metadataStatus: 'pending',
            metadataSource: null,
            metadataTitle: null,
            metadataArtist: null,
            metadataAlbum: null,
            metadataNote: '扫描目录后等待刮削',
            metadataAt: null,
          },
        })
        queued++
        continue
      }
      newFiles.push({ absolute, relative })
    }

    const probed = await mapLimit(newFiles, concurrency, async (file) => {
      try {
        const stat = await fs.stat(file.absolute)
        const info = await ffprobeFile(file.absolute)
        if (!info.ok || !info.codec) {
          return {
            ...file,
            error: info.error || '无法识别音频格式',
          }
        }
        const inferred = inferFromFilename(file.relative)
        const title = (info.title || inferred.title || '').trim().slice(0, 300)
        const artist = (info.artist || inferred.artist || '').trim().slice(0, 300)
        const album = (info.album || '').trim().slice(0, 300) || null
        if (!title) {
          return { ...file, error: '无法从标签或文件名推断歌名' }
        }
        const duration = info.duration ? Math.round(info.duration) : undefined
        const quality = localQuality(info)
        const noArtist = !artist
        const job: NewLocalJob = {
          platform: 'local',
          songId: `local:${createHash('sha1').update(file.relative).digest('hex').slice(0, 16)}`,
          title,
          artist,
          album,
          musicInfo: JSON.stringify({ interval: duration, local: true }),
          actualQuality: quality,
          qualityVerdict: quality ? 'match' : 'unknown',
          status: 'completed',
          progress: 100,
          bytesDone: safeInt(stat.size),
          bytesTotal: safeInt(stat.size),
          filePath: file.relative,
          attempts: '[]',
          verified: true,
          reviewNote: `本地文件扫描${noArtist ? '（无歌手标签）' : ''}`,
          metadataStatus: 'pending',
          metadataNote: noArtist
            ? '扫描目录后等待刮削；文件名/标签没有歌手信息'
            : '扫描目录后等待刮削',
          createdAt: new Date(),
          startedAt: stat.mtime,
          finishedAt: stat.mtime,
        }
        return { ...file, job }
      } catch (error) {
        return {
          ...file,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })

    const jobs: NewLocalJob[] = []
    for (const item of probed) {
      if ('job' in item && item.job) {
        jobs.push(item.job)
      } else {
        failed++
        if (errors.length < 8 && 'error' in item && item.error) {
          errors.push(`${item.relative}: ${item.error}`)
        }
      }
    }
    if (jobs.length) {
      await prisma.downloadJob.createMany({ data: jobs })
      queued += jobs.length
    }
    if (queued) wakeMetadataQueue()

    return NextResponse.json({
      code: 0,
      data: {
        scanned: files.length,
        queued,
        skipped,
        failed,
        hasMore: truncated,
        errors,
        note: [
          `扫描 ${files.length} 个音频文件`,
          `加入刮削 ${queued} 首`,
          `跳过 ${skipped} 首（已刮削或正在处理）`,
          failed ? `${failed} 首无法识别` : '',
          truncated ? '文件较多，本次只处理前 2000 个，可再次点击继续' : '',
        ]
          .filter(Boolean)
          .join('；'),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { code: 500, message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  } finally {
    globalForScan.__mdScanning = false
  }
}
