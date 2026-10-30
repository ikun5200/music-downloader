import path from 'path'
import { QUALITY_RANK } from '../constants'
import { cleanLyrics } from '../metadata/lyrics'
import { artistKeys, titleKey, toSimplified } from '../metadata/normalize'
import type {
  AuditIssueRow,
  AuditResult,
  LibraryFile,
  LibraryIssue,
  LibraryJobRef,
} from './types'

const TIMESTAMP_PREFIX_RE = /^\s*(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+\s*/
const TAG_ONLY_RE = /^\s*\[(?:ti|ar|al|by|offset|re|ve|length|kuwo|kugou|qq|music):[^\]]*\]\s*$/i
const MOJIBAKE_RE = /(?:\uFFFD|Ã.|Â.|â€|ã€|锟斤拷)/

function issue(code: string, severity: LibraryIssue['severity'], message: string): LibraryIssue {
  return { code, severity, message }
}

function meaningfulLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !!line && !TAG_ONLY_RE.test(line))
}

export function lyricsHasHeader(raw: string): boolean {
  const lines = meaningfulLines(raw)
  if (!lines.length) return false
  const cleaned = meaningfulLines(
    cleanLyrics(raw, { simplify: false, cleanCredits: true })
  )
  if (!cleaned.length) return true
  const firstRaw = lines[0].replace(TIMESTAMP_PREFIX_RE, '').trim()
  const firstClean = cleaned[0].replace(TIMESTAMP_PREFIX_RE, '').trim()
  return !!firstRaw && firstRaw !== firstClean
}

function isInstrumental(file: LibraryFile): boolean {
  return /(伴奏|纯音乐|instrumental|karaoke|ktv|消音|钢琴版|吉他版)/i.test(
    `${file.title} ${file.album}`
  )
}

function sameText(a: string, b: string): boolean {
  return !!a && !!b && titleKey(a) === titleKey(b)
}

function jobMatchesFile(job: LibraryJobRef, file: LibraryFile): boolean {
  if (job.title && file.title && !sameText(job.title, file.title)) return false
  if (job.artist && file.artist) {
    const wanted = new Set(artistKeys(job.artist))
    const actual = artistKeys(file.artist)
    if (wanted.size && actual.length && !actual.some((key) => wanted.has(key))) return false
  }
  if (job.album && file.album && !sameText(job.album, file.album)) return false
  return true
}

function fileIssues(file: LibraryFile, job: LibraryJobRef | undefined): LibraryIssue[] {
  const issues: LibraryIssue[] = []
  if (!file.size) issues.push(issue('empty', 'error', '文件大小为 0'))
  if (!file.probeOk) {
    issues.push(issue('unreadable', 'error', `无法解析音频：${file.probeError || '未知错误'}`))
    return issues
  }
  if (!file.codec) issues.push(issue('no_audio', 'error', '文件中没有音频流'))
  if (file.duration != null && file.duration < 20) {
    issues.push(issue('short', 'warn', `时长仅 ${Math.round(file.duration)} 秒，可能下载不完整`))
  }
  if (!file.title) issues.push(issue('missing_title', 'error', '缺少歌名标签'))
  if (!file.artist) issues.push(issue('missing_artist', 'error', '缺少歌手标签'))
  if (!file.album) issues.push(issue('missing_album', 'warn', '缺少专辑标签'))
  if (!file.albumArtist) issues.push(issue('missing_album_artist', 'info', '缺少专辑歌手标签'))

  const textTags = `${file.title} ${file.artist} ${file.album}`
  if (/&(?:amp|lt|gt|quot|apos|#\d+);/i.test(textTags)) {
    issues.push(issue('html_entities', 'warn', '标签里残留 HTML 实体（&amp; 等）'))
  }

  if (!file.hasCover) {
    issues.push(issue('missing_cover', 'warn', '文件内没有封面'))
  } else {
    if (file.coverPlaceholder) {
      issues.push(issue('placeholder_cover', 'error', '封面是酷狗黑胶占位图'))
    }
    if (
      file.coverWidth != null &&
      file.coverHeight != null &&
      Math.min(file.coverWidth, file.coverHeight) < 300
    ) {
      issues.push(
        issue(
          'low_res_cover',
          'warn',
          `封面分辨率偏低（${file.coverWidth}×${file.coverHeight}）`
        )
      )
    }
  }

  if (!file.hasLyrics) {
    if (!isInstrumental(file)) issues.push(issue('missing_lyrics', 'warn', '文件内没有歌词'))
  } else {
    if (MOJIBAKE_RE.test(file.lyrics)) {
      issues.push(issue('lyrics_mojibake', 'error', '歌词疑似乱码'))
    }
    if (lyricsHasHeader(file.lyrics)) {
      issues.push(issue('lyrics_dirty', 'warn', '歌词开头残留作词/作曲/制作信息'))
    }
    if (!file.syncedLyrics) {
      issues.push(issue('lyrics_unsynced', 'warn', '歌词没有时间轴，无法滚动'))
    }
    if (toSimplified(file.lyrics) !== file.lyrics) {
      issues.push(issue('lyrics_traditional', 'info', '歌词含繁体字'))
    }
    if (meaningfulLines(file.lyrics).length < 2) {
      issues.push(issue('lyrics_too_short', 'warn', '歌词行数过少'))
    }
  }

  const rank = QUALITY_RANK[file.quality] || 0
  if (rank <= 1 && file.codec && !/flac|alac|ape|wav|wv|tta/i.test(file.codec)) {
    const severity = (file.bitRate || 0) < 64_000 ? 'warn' : 'info'
    issues.push(issue('low_quality', severity, `音质偏低（${file.quality}）`))
  }
  if (file.bitRate && file.bitRate < 64_000 && !/flac|alac|ape|wav/i.test(file.codec)) {
    issues.push(issue('low_bitrate', 'warn', `码率仅 ${Math.round(file.bitRate / 1000)}kbps`))
  }

  const ext = path.extname(file.path).toLowerCase()
  const codec = file.codec.toLowerCase()
  const extMismatch =
    (ext === '.flac' && codec !== 'flac') ||
    (ext === '.mp3' && !['mp3', 'mp2'].includes(codec)) ||
    (ext === '.m4a' && !['aac', 'alac'].includes(codec)) ||
    (ext === '.wav' && !['pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le'].includes(codec))
  if (extMismatch) {
    issues.push(issue('extension_mismatch', 'warn', `扩展名 ${ext} 与实际编码 ${codec} 不一致`))
  }

  const filename = path.basename(file.path, path.extname(file.path))
  if (file.title && titleKey(file.title) && !titleKey(filename).includes(titleKey(file.title))) {
    issues.push(issue('filename_mismatch', 'info', '文件名与歌名标签不一致'))
  }

  if (job) {
    if (!jobMatchesFile(job, file)) {
      issues.push(issue('db_mismatch', 'warn', '下载记录与文件标签不一致'))
    }
    const requestedRank = QUALITY_RANK[job.requestedQuality || ''] || 0
    if (requestedRank > rank && rank > 0) {
      issues.push(
        issue(
          'quality_downgrade',
          'warn',
          `请求 ${job.requestedQuality}，实际 ${file.quality}`
        )
      )
    }
  } else {
    issues.push(issue('no_job_record', 'info', '没有对应的下载记录（可能是手动放入）'))
  }

  return issues
}

export function auditLibrary(
  files: LibraryFile[],
  jobs: LibraryJobRef[]
): AuditResult {
  const startedAt = Date.now()
  const jobMap = new Map<string, LibraryJobRef>()
  for (const job of jobs) {
    if (!job.filePath) continue
    jobMap.set(job.filePath.replace(/\\/g, '/').replace(/^\/+/, ''), job)
  }

  const issues: AuditIssueRow[] = []
  const byCode: Record<string, number> = {}
  let errorCount = 0
  let warnCount = 0
  let infoCount = 0
  let totalBytes = 0
  const seen = new Set<string>()

  for (const file of files) {
    totalBytes += file.size
    seen.add(file.path)
    const job = jobMap.get(file.path)
    const fileIssueList = fileIssues(file, job)
    for (const item of fileIssueList) {
      byCode[item.code] = (byCode[item.code] || 0) + 1
      if (item.severity === 'error') errorCount++
      else if (item.severity === 'warn') warnCount++
      else infoCount++
    }
    if (!fileIssueList.length) continue
    issues.push({
      path: file.path,
      title: file.title,
      artist: file.artist,
      album: file.album,
      duration: file.duration,
      quality: file.quality,
      size: file.size,
      issues: fileIssueList,
    })
  }

  const severityRank: Record<LibraryIssue['severity'], number> = {
    error: 0,
    warn: 1,
    info: 2,
  }
  issues.sort((a, b) => {
    const aRank = Math.min(...a.issues.map((item) => severityRank[item.severity]))
    const bRank = Math.min(...b.issues.map((item) => severityRank[item.severity]))
    if (aRank !== bRank) return aRank - bRank
    return a.path.localeCompare(b.path, 'zh-CN')
  })

  const missingFiles = jobs
    .filter((job) => job.filePath && !seen.has(job.filePath.replace(/\\/g, '/').replace(/^\/+/, '')))
    .map((job) => ({
      path: job.filePath || '',
      title: job.title,
      artist: job.artist,
      status: job.status,
    }))

  return {
    summary: {
      totalFiles: files.length,
      totalBytes,
      elapsedMs: Date.now() - startedAt,
      errorCount,
      warnCount,
      infoCount,
      byCode,
      missingJobFiles: missingFiles.length,
      checkedAt: new Date().toISOString(),
    },
    issues,
    missingFiles,
  }
}
