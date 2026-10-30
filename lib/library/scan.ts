import { createHash } from 'crypto'
import { execFile } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import { promisify } from 'util'
import { actualQuality } from '../download/quality'
import { isSyncedLyrics } from '../metadata/normalize'
import { KUGOU_PLACEHOLDER_COVER_SHA256 } from '../metadata/cover'
import type { LibraryFile } from './types'

const execFileAsync = promisify(execFile)

export const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.flac',
  '.m4a',
  '.aac',
  '.wav',
  '.ogg',
  '.opus',
  '.ape',
  '.wma',
  '.aiff',
  '.aif',
  '.alac',
  '.dsf',
  '.dff',
])

const SKIP_DIRS = new Set([
  '@eaDir',
  '#recycle',
  '.quarantine',
  'quarantine',
  'lost+found',
  'tmp',
  '.tmp',
  'node_modules',
])

function isAudioFile(name: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase())
}

export async function listAudioFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string) {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const absolute = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(absolute)
        continue
      }
      if (entry.isFile() && isAudioFile(entry.name)) out.push(absolute)
    }
  }
  await walk(root)
  out.sort((a, b) => a.localeCompare(b, 'zh-CN'))
  return out
}

export function relativeLibraryPath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/')
}

async function runBuffer(
  command: string,
  args: string[],
  timeoutMs: number,
  maxBytes: number
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const child = execFile(command, args, { encoding: 'buffer', maxBuffer: maxBytes })
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      child.kill('SIGKILL')
      resolve(null)
    }, timeoutMs)
    child.on('error', () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', (code, stdout) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (code !== 0) return resolve(null)
      resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || ''))
    })
  })
}

function lowerTags(tags: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tags || {})) {
    if (value == null) continue
    out[key.toLowerCase()] = String(value)
  }
  return out
}

function tag(tags: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const value = tags[key]
    if (value && value.trim()) return value.trim()
  }
  return ''
}

function lyricsFromTags(tags: Record<string, string>): string {
  const exact = tag(tags, 'lyrics', 'unsyncedlyrics', 'syncedlyrics', 'lyric', 'uslt')
  if (exact) return exact
  for (const [key, value] of Object.entries(tags)) {
    if (key.includes('lyric') && value.trim()) return value
  }
  return ''
}

async function quickHash(filePath: string, size: number): Promise<string> {
  const hash = createHash('sha1')
  hash.update(String(size))
  if (size <= 0) return hash.digest('hex')
  const handle = await fs.open(filePath, 'r')
  try {
    const chunk = Math.min(512 * 1024, size)
    const head = Buffer.alloc(chunk)
    const headRead = await handle.read(head, 0, chunk, 0)
    hash.update(head.subarray(0, headRead.bytesRead))
    if (size > chunk) {
      const tail = Buffer.alloc(chunk)
      const tailRead = await handle.read(tail, 0, chunk, size - chunk)
      hash.update(tail.subarray(0, tailRead.bytesRead))
    }
  } finally {
    await handle.close().catch(() => {})
  }
  return hash.digest('hex')
}

function coverHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export interface ScanLibraryOptions {
  checkCover?: boolean
  concurrency?: number
  onProgress?: (done: number, total: number) => void
  shouldCancel?: () => boolean
}

export async function inspectLibraryFile(
  root: string,
  absolute: string,
  checkCover = true
): Promise<LibraryFile> {
  const relative = relativeLibraryPath(root, absolute)
  const stat = await fs.stat(absolute).catch(() => null)
  const size = stat?.size || 0
  const mtimeMs = stat?.mtimeMs || 0
  const hash = await quickHash(absolute, size).catch(() => '')

  const base: LibraryFile = {
    path: relative,
    absolute,
    size,
    mtimeMs,
    title: '',
    artist: '',
    album: '',
    albumArtist: '',
    track: '',
    disc: '',
    duration: null,
    codec: '',
    bitRate: null,
    sampleRate: null,
    bitsPerRaw: null,
    quality: 'unknown',
    hasCover: false,
    coverWidth: null,
    coverHeight: null,
    coverHash: null,
    coverPlaceholder: false,
    hasLyrics: false,
    lyrics: '',
    syncedLyrics: false,
    quickHash: hash,
    probeOk: false,
    issues: [],
  }

  if (!stat) {
    return { ...base, probeError: '文件不存在或无法访问' }
  }

  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', absolute],
      { timeout: 60_000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' }
    )
    const data = JSON.parse(stdout || '{}') as {
      format?: { duration?: string; bit_rate?: string; tags?: Record<string, unknown> }
      streams?: Array<Record<string, unknown>>
    }
    const tags = lowerTags(data.format?.tags)
    const streams = data.streams || []
    const audio = streams.find((stream) => stream.codec_type === 'audio')
    const video = streams.find((stream) => stream.codec_type === 'video')
    const duration = Number(audio?.duration || data.format?.duration)
    const codec = String(audio?.codec_name || '')
    const bitRate = Number(audio?.bit_rate || data.format?.bit_rate) || null
    const sampleRate = Number(audio?.sample_rate) || null
    const bitsPerRaw =
      Number(audio?.bits_per_raw_sample || audio?.bits_per_sample) || null
    const lyrics = lyricsFromTags(tags)
    const result: LibraryFile = {
      ...base,
      title: tag(tags, 'title'),
      artist: tag(tags, 'artist'),
      album: tag(tags, 'album'),
      albumArtist: tag(tags, 'album_artist', 'albumartist', 'album artist'),
      track: tag(tags, 'track', 'tracknumber'),
      disc: tag(tags, 'disc', 'discnumber'),
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
      codec,
      bitRate,
      sampleRate,
      bitsPerRaw,
      quality: actualQuality({
        ok: true,
        codec,
        bitRate: bitRate || undefined,
        sampleRate: sampleRate || undefined,
        bitsPerRaw: bitsPerRaw || undefined,
      }),
      hasCover: !!video,
      coverWidth: video?.width ? Number(video.width) : null,
      coverHeight: video?.height ? Number(video.height) : null,
      hasLyrics: !!lyrics,
      lyrics,
      syncedLyrics: !!lyrics && isSyncedLyrics(lyrics),
      probeOk: true,
    }

    if (checkCover && video) {
      const image = await runBuffer(
        'ffmpeg',
        [
          '-v',
          'error',
          '-nostdin',
          '-i',
          absolute,
          '-map',
          '0:v:0',
          '-frames:v',
          '1',
          '-c',
          'copy',
          '-f',
          'image2pipe',
          '-',
        ],
        20_000,
        16 * 1024 * 1024
      )
      if (image?.length) {
        const digest = coverHash(image)
        result.coverHash = digest
        result.coverPlaceholder = digest === KUGOU_PLACEHOLDER_COVER_SHA256
      }
    }
    return result
  } catch (error) {
    return {
      ...base,
      probeError: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
  onDone?: (done: number, total: number) => void
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  let done = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index])
      done++
      onDone?.(done, items.length)
    }
  })
  await Promise.all(runners)
  return results
}

export async function scanLibrary(
  root: string,
  options: ScanLibraryOptions = {}
): Promise<LibraryFile[]> {
  const files = await listAudioFiles(root)
  return mapLimit(
    files,
    options.concurrency || 4,
    (absolute) => inspectLibraryFile(root, absolute, options.checkCover !== false),
    options.onProgress
  )
}
