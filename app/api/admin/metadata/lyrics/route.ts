import fs from 'fs/promises'
import path from 'path'
import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/auth'
import { resolveDownloadRoot } from '@/lib/download/filename'
import { ffprobeFile } from '@/lib/download/probe'
import { cleanLyricsWithAi } from '@/lib/metadata/lyrics-ai'
import { writeLyricsOnly } from '@/lib/metadata/tag'
import { getAiConfig, getSettings } from '@/lib/settings'
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
    const aiConfig = await getAiConfig().catch(() => null)
    // 给 AI 留出处理时间；接近路由超时后剩余文件直接走规则，避免整批失败。
    const aiDeadline = Date.now() + 240_000
    let withLyrics = 0
    let changed = 0
    let unchanged = 0
    let failed = 0
    let aiUsed = 0
    let aiFallback = 0
    const errors: string[] = []

    const processFile = async (file: string) => {
      const info = await ffprobeFile(file)
      if (!info.ok || !info.lyrics || !info.lyrics.trim()) return null
      const cleaned = await cleanLyricsWithAi(info.lyrics, {
        title: info.title,
        artist: info.artist,
        cleanCredits: settings.lyricsCleanCredits,
        simplify: settings.lyricsSimplify,
        aiEnabled: settings.lyricsAiCleanEnabled && Date.now() < aiDeadline,
        aiConfig,
      })
      if (!cleaned.text) {
        return {
          withLyrics: true,
          changed: false,
          unchanged: true,
          failed: false,
          aiUsed: cleaned.aiUsed,
          error: '',
        }
      }
      const result = {
        withLyrics: true,
        changed: false,
        unchanged: false,
        failed: false,
        aiUsed: cleaned.aiUsed,
        error: '',
      }
      if (cleaned.text === info.lyrics.trim()) {
        result.unchanged = true
        return result
      }
      const written = await writeLyricsOnly(file, cleaned.text)
      if (written.ok) {
        result.changed = true
      } else {
        result.failed = true
        result.error = `${path.basename(file)}：${written.note}`
      }
      return result
    }

    // 每首最多一次 AI 请求，限制并发避免本地 AI 服务被瞬时打满。
    const concurrency = Math.min(4, files.length || 1)
    let cursor = 0
    const outcomes: Array<Awaited<ReturnType<typeof processFile>>> = new Array(files.length)
    const worker = async () => {
      while (true) {
        const index = cursor++
        if (index >= files.length) return
        outcomes[index] = await processFile(files[index])
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()))

    for (const outcome of outcomes) {
      if (!outcome) continue
      if (outcome.withLyrics) withLyrics++
      if (outcome.changed) changed++
      if (outcome.unchanged) unchanged++
      if (outcome.failed) failed++
      if (outcome.aiUsed) aiUsed++
      if (outcome.withLyrics && !outcome.aiUsed) aiFallback++
      if (outcome.error && errors.length < 20) errors.push(outcome.error)
    }

    return NextResponse.json({
      code: 0,
      data: {
        scanned: files.length,
        withLyrics,
        changed,
        unchanged,
        failed,
        aiUsed,
        aiFallback,
        truncated,
        errors,
        note: `清理完成：扫描 ${files.length} 首，带歌词 ${withLyrics} 首，改写 ${changed} 首；AI 识别 ${aiUsed} 首，其余 ${aiFallback} 首按规则处理。${
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
