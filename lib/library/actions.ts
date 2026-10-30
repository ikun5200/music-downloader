import fs from 'fs/promises'
import path from 'path'
import { prisma } from '../db'
import { getDownloadDir } from '../settings'
import { writeAlbumOnly } from '../metadata/tag'
import type { LibraryActionFileResult } from './types'

export function resolveLibraryPath(relative: string): string | null {
  const root = path.resolve(getDownloadDir())
  const value = String(relative || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!value) return null
  const absolute = path.resolve(root, value)
  const rel = path.relative(root, absolute)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return absolute
}

async function appendJobNote(filePath: string, note: string): Promise<void> {
  const jobs = await prisma.downloadJob.findMany({
    where: { filePath },
    select: { id: true, reviewNote: true },
  })
  for (const job of jobs) {
    const combined = [job.reviewNote, note].filter(Boolean).join('；').slice(0, 1000)
    await prisma.downloadJob
      .update({ where: { id: job.id }, data: { reviewNote: combined } })
      .catch(() => {})
  }
}

export interface DeleteDuplicatesOptions {
  paths: string[]
  deleteFiles: boolean
  deleteRecords: boolean
}

export async function deleteDuplicateFiles(
  options: DeleteDuplicatesOptions
): Promise<LibraryActionFileResult[]> {
  const results: LibraryActionFileResult[] = []
  const paths = [...new Set(options.paths || [])].filter(Boolean)

  for (const relative of paths) {
    const absolute = resolveLibraryPath(relative)
    if (!absolute) {
      results.push({ path: relative, ok: false, note: '路径不在下载目录内，已拒绝' })
      continue
    }
    let fileNote = '保留文件'
    if (options.deleteFiles) {
      try {
        await fs.unlink(absolute)
        fileNote = '文件已删除'
      } catch (error) {
        results.push({
          path: relative,
          ok: false,
          note: `删除文件失败：${error instanceof Error ? error.message : String(error)}`,
        })
        continue
      }
    }

    let recordNote = '保留下载记录'
    if (options.deleteRecords) {
      const deleted = await prisma.downloadJob.deleteMany({ where: { filePath: relative } })
      recordNote = deleted.count ? `删除 ${deleted.count} 条下载记录` : '没有对应下载记录'
    } else if (options.deleteFiles) {
      await appendJobNote(relative, '重复清理：文件已删除，记录保留')
      recordNote = '下载记录已标记文件删除'
    }

    results.push({ path: relative, ok: true, note: `${fileNote}；${recordNote}` })
  }
  return results
}

export interface AlbumMergeFile {
  path: string
}

export interface AlbumMergeOptions {
  files: AlbumMergeFile[]
  album: string
  albumArtist?: string
}

export async function mergeAlbums(
  options: AlbumMergeOptions
): Promise<LibraryActionFileResult[]> {
  const album = String(options.album || '').trim()
  if (!album) return []
  const results: LibraryActionFileResult[] = []
  for (const item of options.files || []) {
    const absolute = resolveLibraryPath(item.path)
    if (!absolute) {
      results.push({ path: item.path, ok: false, note: '路径不在下载目录内，已拒绝' })
      continue
    }
    try {
      const result = await writeAlbumOnly(absolute, album, options.albumArtist)
      if (!result.ok) {
        results.push({ path: item.path, ok: false, note: result.note || '写入专辑失败' })
        continue
      }
      await prisma.downloadJob
        .updateMany({
          where: { filePath: item.path },
          data: {
            album,
            metadataAlbum: album,
            metadataNote: `专辑合并：${album}`,
            metadataAt: new Date(),
          },
        })
        .catch(() => {})
      results.push({ path: item.path, ok: true, note: result.note })
    } catch (error) {
      results.push({
        path: item.path,
        ok: false,
        note: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return results
}
