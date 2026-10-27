import fs from 'fs/promises'
import path from 'path'
import { getDownloadDir } from '../settings'
import { sanitizeFilename } from '../utils'

export function resolveDownloadRoot(): string {
  const dir = getDownloadDir()
  return path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir)
}

export function getTempDir(): string {
  return path.join(process.cwd(), 'data', 'tmp')
}

export async function ensureDownloadDirs(): Promise<{ root: string; temp: string }> {
  const root = resolveDownloadRoot()
  const temp = getTempDir()
  await fs.mkdir(root, { recursive: true })
  await fs.mkdir(temp, { recursive: true })
  return { root, temp }
}

export function resolveInside(root: string, relative: string): string {
  const full = path.resolve(root, relative)
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
  if (full !== root && !full.startsWith(rootWithSep)) {
    throw new Error('非法的文件路径')
  }
  return full
}

export interface FilenameParts {
  artist: string
  title: string
  album?: string | null
  quality: string
  ext: string
}

export function buildRelativePath(parts: FilenameParts, template: string): string {
  const values: Record<string, string> = {
    artist: sanitizeFilename(parts.artist || '未知歌手', 80),
    title: sanitizeFilename(parts.title || '未知歌曲', 120),
    album: parts.album ? sanitizeFilename(parts.album, 80) : '',
    quality: sanitizeFilename(parts.quality || '未知音质', 30),
    ext: sanitizeFilename(parts.ext || 'audio', 10),
  }

  const segments = template
    .split('/')
    .map((segment) =>
      segment.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '').trim()
    )
    .filter((segment) => segment.length > 0)

  let relative = segments.join(path.sep)
  if (!relative) relative = `${values.artist} - ${values.title} [${values.quality}].${values.ext}`
  if (!relative.toLowerCase().endsWith(`.${values.ext.toLowerCase()}`)) {
    relative += `.${values.ext}`
  }
  return relative
}

export async function uniquePath(root: string, relative: string): Promise<{ relative: string; absolute: string }> {
  const parsed = path.parse(relative)
  let candidate = relative
  let i = 2
  while (true) {
    const absolute = resolveInside(root, candidate)
    try {
      await fs.access(absolute)
      candidate = path.join(parsed.dir, `${parsed.name} (${i++})${parsed.ext}`)
    } catch {
      return { relative: candidate, absolute }
    }
  }
}
