import { spawn } from 'child_process'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { fetchImage } from './http'
import type { MetadataCandidate, MetadataWriteResult } from './types'

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe'

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

function run(command: string, args: string[], timeoutMs = 60_000): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let finished = false
    const timer = setTimeout(() => {
      if (finished) return
      finished = true
      child.kill('SIGKILL')
      resolve({ code: -1, stdout, stderr: `${stderr}\n处理超时` })
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      if (stdout.length < 200_000) stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 20_000) stderr += chunk.toString()
    })
    child.on('error', (error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: `${stderr}${error.message}` })
    })
    child.on('close', (code) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

function tagValue(value: string | undefined | null): string | null {
  const trimmed = String(value || '').trim()
  return trimmed ? trimmed : null
}

function trackValue(track?: string, total?: string): string | null {
  if (!track) return null
  return total ? `${track}/${total}` : track
}

function ffmpegMuxerArgs(ext: string, hasCover: boolean): string[] {
  if (!hasCover) return ['-map', '0', '-c', 'copy']
  const args = ['-map', '0:a:0', '-map', '1:v:0', '-c:a', 'copy', '-c:v', 'copy']
  if (ext === 'mp3') {
    args.push(
      '-id3v2_version',
      '3',
      '-metadata:s:v',
      'title=Album cover',
      '-metadata:s:v',
      'comment=Cover (front)'
    )
  } else if (ext !== 'ogg' && ext !== 'opus' && ext !== 'wav') {
    args.push('-disposition:v', 'attached_pic')
  }
  return args
}

function buildMetadataArgs(
  candidate: MetadataCandidate,
  options: { writeInfo: boolean; writeLyrics: boolean }
): string[] {
  const args: string[] = []
  if (options.writeInfo) {
    const tags: Array<[string, string | null]> = [
      ['title', tagValue(candidate.title)],
      ['artist', tagValue(candidate.artist)],
      ['album', tagValue(candidate.album)],
      ['album_artist', tagValue(candidate.albumArtist)],
      ['date', tagValue(candidate.date)],
      ['genre', tagValue(candidate.genre)],
      ['track', trackValue(candidate.track, candidate.trackTotal)],
      ['disc', tagValue(candidate.disc)],
      ['publisher', tagValue(candidate.publisher)],
      ['language', tagValue(candidate.language)],
    ]
    for (const [key, value] of tags) {
      if (value) args.push('-metadata', `${key}=${value}`)
    }
  }
  if (options.writeLyrics) {
    const lyrics = tagValue(candidate.lyrics)
    if (lyrics) args.push('-metadata', `lyrics=${lyrics}`)
  }
  return args
}

async function prepareCover(
  candidate: MetadataCandidate,
  tempDir: string
): Promise<string | null> {
  const urls = candidate.coverUrls?.length
    ? candidate.coverUrls
    : candidate.coverUrl
      ? [candidate.coverUrl]
      : []
  const headers =
    candidate.source === 'qqmusic' ? { Referer: 'https://y.qq.com/' } : undefined
  for (const url of urls) {
    const image = await fetchImage(url, { headers, timeoutMs: 20_000 })
    if (!image) continue
    const isPng = image.buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const file = path.join(tempDir, isPng ? 'cover.png' : 'cover.jpg')
    await fs.writeFile(file, image.buffer)
    return file
  }
  return null
}

interface ProbeResult {
  tags: Record<string, string>
  hasCover: boolean
  hasLyrics: boolean
}

async function probe(filePath: string): Promise<ProbeResult | null> {
  const result = await run(
    FFPROBE,
    ['-v', 'error', '-show_entries', 'format_tags:stream=codec_type', '-of', 'json', filePath],
    20_000
  )
  if (result.code !== 0) return null
  try {
    const data = JSON.parse(result.stdout || '{}') as {
      format?: { tags?: Record<string, string> }
      streams?: Array<{ codec_type?: string }>
    }
    const tags: Record<string, string> = {}
    for (const [key, value] of Object.entries(data.format?.tags || {})) {
      tags[key.toLowerCase()] = String(value)
    }
    return {
      tags,
      hasCover: (data.streams || []).some((stream) => stream.codec_type === 'video'),
      hasLyrics: !!tags.lyrics,
    }
  } catch {
    return null
  }
}

async function replaceFile(source: string, target: string): Promise<void> {
  try {
    await fs.rename(source, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await fs.copyFile(source, target)
    await fs.unlink(source).catch(() => {})
  }
}

/**
 * 用 ffmpeg 把歌曲信息、封面、LRC 歌词写进音频文件（不重新编码音频）。
 * 封面失败时自动退回“只写信息/歌词”，不会破坏原文件。
 */
export async function writeMetadataTags(
  filePath: string,
  candidate: MetadataCandidate,
  options: { writeInfo: boolean; writeCover: boolean; writeLyrics: boolean }
): Promise<MetadataWriteResult> {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  if (!ext) return { ok: false, partial: false, wrote: [], note: '无法识别文件扩展名' }
  if (!options.writeInfo && !options.writeCover && !options.writeLyrics) {
    return { ok: true, partial: false, wrote: [], note: '未选择写入项' }
  }

  const stat = await fs.stat(filePath)
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'md-tag-'))
  const output = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath, path.extname(filePath))}.tag-${Date.now()}-${process.pid}${path.extname(filePath)}`
  )
  const supportsCover = !['ogg', 'opus', 'wav'].includes(ext)
  let coverPath: string | null = null

  try {
    if (options.writeCover && supportsCover) {
      coverPath = await prepareCover(candidate, tempDir)
    }

    const metadataArgs = buildMetadataArgs(candidate, {
      writeInfo: options.writeInfo,
      writeLyrics: options.writeLyrics,
    })

    const runFfmpeg = async (withCover: boolean) => {
      await fs.unlink(output).catch(() => {})
      const args = [
        '-y',
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        filePath,
      ]
      if (withCover && coverPath) args.push('-i', coverPath)
      args.push('-map_metadata', '0')
      args.push(...ffmpegMuxerArgs(ext, withCover && !!coverPath))
      args.push(...metadataArgs)
      args.push(output)
      return run(FFMPEG, args)
    }

    let result = await runFfmpeg(!!coverPath)
    let coverWritten = !!coverPath
    let note = ''

    if (result.code !== 0 && coverPath) {
      coverWritten = false
      note = `封面写入失败（${result.stderr.trim().slice(0, 160)}），已改为只写歌曲信息和歌词`
      result = await runFfmpeg(false)
    }

    if (result.code !== 0) {
      return {
        ok: false,
        partial: false,
        wrote: [],
        note: `ffmpeg 写入失败：${result.stderr.trim().slice(0, 300) || '未知错误'}`,
      }
    }

    const outputStat = await fs.stat(output)
    if (!outputStat.size) {
      return { ok: false, partial: false, wrote: [], note: 'ffmpeg 输出文件为空' }
    }
    await fs.chmod(output, stat.mode & 0o777)
    await replaceFile(output, filePath)

    const wrote: string[] = []
    if (options.writeInfo) wrote.push('歌曲信息')
    if (options.writeLyrics && candidate.lyrics) wrote.push('歌词')
    if (coverWritten && coverPath) wrote.push('封面')

    const probed = await probe(filePath)
    const missing: string[] = []
    if (options.writeCover && !coverPath) missing.push('未找到封面')
    if (options.writeLyrics && !candidate.lyrics) missing.push('未找到歌词')
    if (options.writeInfo && probed && !probed.tags.title) missing.push('歌名')
    if (options.writeLyrics && candidate.lyrics && probed && !probed.hasLyrics) missing.push('歌词')
    if (coverWritten && probed && !probed.hasCover) missing.push('封面')

    if (missing.length) {
      return {
        ok: false,
        partial: true,
        wrote,
        note: `${note ? `${note}；` : ''}写入后校验缺少：${missing.join('、')}`,
      }
    }

    return {
      ok: true,
      partial: !!note,
      wrote,
      note: note || `已写入${wrote.length ? `：${wrote.join('、')}` : '元数据'}`,
    }
  } catch (error) {
    return {
      ok: false,
      partial: false,
      wrote: [],
      note: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await fs.unlink(output).catch(() => {})
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}
