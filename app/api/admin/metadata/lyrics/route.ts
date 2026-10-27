import fs from 'fs/promises'
import path from 'path'
import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/auth'
import { resolveDownloadRoot } from '@/lib/download/filename'
import { ffprobeFile } from '@/lib/download/probe'
import { cleanLyrics } from '@/lib/metadata/lyrics'
import { writeLyricsOnly } from '@/lib/metadata/tag'
import { getSettings } from '@/lib/settings'
import { ensureRuntime } from '@/lib/runtime'

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

const globalForLyricsClean = globalThis as unknown as { __mdCleaningLyrics?: boolean }

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
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await walkAudioFiles(full, depth + 1)
      files.push(...nested.files)
      truncated = truncated || nested.truncated
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).slice(1).toLowerCase()
      if (!AUDIO_EXT.has(ext)) continue
      if (files.length >= MAX_FILES) {
        truncated = true
        break
      }
      files.push(full)
    }
  }
  return { files, truncated }
}

export async function POST() {
  await ensureRuntime()
  if (!(await isAdmin())) {
    return NextResponse.json({ code: 401, message: '需要管理员登录' }, { status: 401 })
  }
  if (globalForLyricsClean.__mdCleaningLyrics) {
    return NextResponse.json(
      { code: 409, message: '正在清理歌词，请等当前任务完成' },
      { status: 409 }
    )
  }

  globalForLyricsClean.__mdCleaningLyrics = true
  try {
    const root = resolveDownloadRoot()
    const { files, truncated } = await walkAudioFiles(root)
    const settings = await getSettings()
    let withLyrics = 0
    let changed = 0
    let unchanged = 0
    let failed = 0
    const errors: string[] = []

    for (const file of files) {
      const info = await ffprobeFile(file)
      if (!info.ok || !info.lyrics || !info.lyrics.trim()) continue
      withLyrics++
      const cleaned = cleanLyrics(info.lyrics, {
        title: info.title,
        artist: info.artist,
        cleanCredits: settings.lyricsCleanCredits,
        simplify: settings.lyricsSimplify,
      })
      if (!cleaned) {
        unchanged++
        continue
      }
      if (cleaned === info.lyrics.trim()) {
        unchanged++
        continue
      }
      const result = await writeLyricsOnly(file, cleaned)
      if (result.ok) {
        changed++
      } else {
        failed++
        if (errors.length < 20) {
          errors.push(`${path.basename(file)}：${result.note}`)
        }
      }
    }

    return NextResponse.json({
      code: 0,
      data: {
        scanned: files.length,
        withLyrics,
        changed,
        unchanged,
        failed,
        truncated,
        errors,
        note: `清理完成：扫描 ${files.length} 首，带歌词 ${withLyrics} 首，改写 ${changed} 首。${
          truncated ? '文件过多，只处理了前 2000 首。' : ''
        }`,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { code: 500, message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  } finally {
    globalForLyricsClean.__mdCleaningLyrics = false
  }
}
