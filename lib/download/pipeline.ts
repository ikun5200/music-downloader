import fs from 'fs/promises'
import path from 'path'
import type { DownloadJob } from '@prisma/client'
import { PLATFORM_NAMES, QUALITY_RANK, type Platform } from '../constants'
import { prisma, withDbRetry } from '../db'
import { getSettings } from '../settings'
import { getRankedChannels, type RankedChannel } from '../sources/selection'
import { sourceManager } from '../sources/manager'
import { recordStat } from '../sources/stats'
import { safeJson, urlHost } from '../utils'
import { downloadFile } from './downloader'
import { buildRelativePath, ensureDownloadDirs, uniquePath } from './filename'
import { probeAudio } from './probe'
import { actualQuality as deriveActualQuality, extensionFor } from './quality'
import { capQuality } from './quality-cap'
import { validateFile } from './validator'
import { processMetadataForJob, type MetadataProcessResult } from '../metadata/process'

const cancelControllers = new Map<string, AbortController>()
const lastProgressAt = new Map<string, number>()

export function cancelJob(jobId: string) {
  const controller = cancelControllers.get(jobId)
  if (controller) controller.abort(new Error('用户取消下载'))
}

export function pauseJob(jobId: string) {
  const controller = cancelControllers.get(jobId)
  if (controller) controller.abort(new Error('用户暂停下载'))
}

export function isJobRunning(jobId: string): boolean {
  return cancelControllers.has(jobId)
}

async function updateJob(id: string, data: Record<string, unknown>) {
  await withDbRetry(() => prisma.downloadJob.update({ where: { id }, data }))
}

async function updateProgress(
  id: string,
  bytes: number,
  total: number | null,
  force = false
) {
  const now = Date.now()
  const last = lastProgressAt.get(id) || 0
  if (!force && now - last < 700) return
  lastProgressAt.set(id, now)
  const progress = total && total > 0 ? Math.min(99, Math.round((bytes / total) * 1000) / 10) : 0
  await updateJob(id, {
    status: 'downloading',
    bytesDone: Math.min(bytes, 2_147_483_647),
    bytesTotal: total ? Math.min(total, 2_147_483_647) : null,
    progress,
  }).catch(() => {})
}


function candidateQualities(
  channels: RankedChannel[],
  platform: Platform,
  requested: string | null,
  strategy: string
): string[] {
  const union = new Set<string>()
  for (const channel of channels) for (const q of channel.qualities) union.add(q)
  let list = [...union].sort((a, b) => (QUALITY_RANK[b] || 0) - (QUALITY_RANK[a] || 0))

  if (requested && requested !== 'auto') {
    const maxRank = QUALITY_RANK[requested] || 0
    list = list.filter((q) => (QUALITY_RANK[q] || 0) <= maxRank)
  }

  if (strategy === 'flacFirst') {
    const lossless = list.filter((q) => (QUALITY_RANK[q] || 0) >= 4)
    const lossy = list.filter((q) => (QUALITY_RANK[q] || 0) < 4)
    list = [...lossless, ...lossy]
  }

  if (strategy === 'strict') {
    const top = list[0]
    return top ? [top] : []
  }

  return list
}

interface FallbackCandidate {
  tempFile: string
  channel: RankedChannel
  quality: string
  validation: Awaited<ReturnType<typeof validateFile>>
  bytes: number
  total: number | null
  url: string
  startedAt: number
}

interface HeaderFallback {
  url: string
  channel: RankedChannel
  quality: string
  hint: string
  startedAt: number
}

async function moveIntoPlace(source: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true })
  try {
    await fs.rename(source, dest)
    return
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
  }
  // 跨挂载点无法 rename：先复制到同一文件系统的 .part，再原子改名，避免留下半截成品文件。
  const staged = `${dest}.part`
  try {
    await fs.copyFile(source, staged)
    await fs.rename(staged, dest)
  } catch (e) {
    await fs.unlink(staged).catch(() => {})
    throw e
  }
  await fs.unlink(source).catch(() => {})
}

export async function runPipeline(job: DownloadJob): Promise<void> {
  const controller = new AbortController()
  cancelControllers.set(job.id, controller)
  const attempts: Array<Record<string, unknown>> = []
  let fallback: FallbackCandidate | null = null
  let headerFallback: HeaderFallback | null = null

  const discardFallback = async () => {
    if (!fallback) return
    await fs.unlink(fallback.tempFile).catch(() => {})
    fallback = null
  }

  try {
    const settings = await getSettings()
    const platform = job.platform as Platform
    const musicInfo = safeJson<Record<string, unknown>>(job.musicInfo, {})
    const requestedQuality = capQuality(job.requestedQuality, settings.maxQuality)
    if ((job.requestedQuality || null) !== requestedQuality) {
      await updateJob(job.id, { requestedQuality })
    }

    const channels = await getRankedChannels(platform)
    if (!channels.length) throw new Error(`平台 ${PLATFORM_NAMES[platform] || platform} 没有可用渠道`)

    const qualities = candidateQualities(
      channels,
      platform,
      requestedQuality,
      settings.qualityStrategy
    )
    if (!qualities.length) throw new Error('没有可用的音质档位')

    const { root, temp } = await ensureDownloadDirs()

    const downloadCandidate = async (
      url: string,
      channel: RankedChannel,
      quality: string,
      startedAt: number
    ): Promise<FallbackCandidate> => {
      const tempFile = path.join(
        temp,
        `${job.id}-${channel.id}-${quality}-${Date.now()}.part`
      )
      try {
        const downloaded = await downloadFile(url, tempFile, {
          signal: controller.signal,
          maxBytes: settings.maxFileSizeMb * 1024 * 1024,
          onProgress: (done, total) => {
            void updateProgress(job.id, done, total)
          },
        })

        const validation = await validateFile({
          filePath: tempFile,
          expectedTitle: job.title,
          expectedArtist: job.artist,
          expectedDuration: musicInfo.interval ? Number(musicInfo.interval) : null,
          requestedQuality: quality,
          verifyWrongSong: settings.verifyWrongSong,
        })
        if (!validation.ok) throw new Error(validation.reason || '文件校验失败')

        return {
          tempFile,
          channel,
          quality,
          validation,
          bytes: downloaded.bytes,
          total: downloaded.total,
          url,
          startedAt,
        }
      } catch (e) {
        await fs.unlink(tempFile).catch(() => {})
        throw e
      }
    }

    const completeWith = async (candidate: FallbackCandidate) => {
      const actualRank = QUALITY_RANK[candidate.validation.actualQuality] || 0
      const requested = requestedQuality
      const requestedRank = requested ? QUALITY_RANK[requested] || 0 : 0
      const downgraded = !!requested && actualRank < requestedRank

      const ext = extensionFor(candidate.validation.probe)
      const relative = buildRelativePath(
        {
          artist: job.artist,
          title: job.title,
          album: job.album,
          quality: candidate.validation.actualQuality,
          ext,
        },
        settings.filenameTemplate
      )
      const planned = await uniquePath(root, relative)
      // 关键：先在 /app/data/tmp（飞牛音乐不会扫描的目录）里写标签/封面/歌词，
      // 全部完成后再原子移动到 /downloads，避免飞牛先扫到 track 12 / album 这种空标签。
      let stagedFile = candidate.tempFile
      let metadataResult: MetadataProcessResult | null = null
      if (settings.metadataScrapeEnabled) {
        const stagedPath = path.join(
          temp,
          `${job.id}-${Date.now()}${path.extname(planned.relative)}`
        )
        await fs.rename(candidate.tempFile, stagedPath)
        stagedFile = stagedPath
        try {
          metadataResult = await processMetadataForJob(job, stagedFile, settings)
        } catch (error) {
          metadataResult = {
            status: 'failed',
            note: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
          }
        }
      }

      const finalPath = await uniquePath(root, planned.relative)
      await moveIntoPlace(stagedFile, finalPath.absolute)
      fallback = null

      await updateJob(job.id, {
        status: 'completed',
        channelId: candidate.channel.id,
        actualQuality: candidate.validation.actualQuality,
        qualityVerdict: downgraded ? 'downgraded' : 'match',
        filePath: finalPath.relative,
        urlHost: urlHost(candidate.url),
        bytesDone: candidate.bytes,
        bytesTotal: candidate.total,
        progress: 100,
        verified: candidate.validation.verified,
        reviewNote: downgraded
          ? `请求 ${requested}，实际最高可用 ${candidate.validation.actualQuality}`
          : candidate.validation.reviewNote || null,
        attempts: JSON.stringify(attempts.slice(-30)),
        error: null,
        metadataStatus: metadataResult?.status || 'disabled',
        metadataSource: metadataResult?.source || null,
        metadataTitle: metadataResult?.title || null,
        metadataArtist: metadataResult?.artist || null,
        metadataAlbum: metadataResult?.album || null,
        metadataNote: metadataResult?.note || '下载后自动刮削未开启',
        metadataAt: metadataResult ? new Date() : null,
        finishedAt: new Date(),
      })
      await recordStat(candidate.channel.id, platform, true, Date.now() - candidate.startedAt)
    }

    for (const quality of qualities) {
      const tierRank = QUALITY_RANK[quality] || 0
      if (fallback) {
        const fallbackRank = QUALITY_RANK[fallback.validation.actualQuality] || 0
        if (fallbackRank >= tierRank) break
      }

      for (const channel of channels) {
        if (!channel.qualities.includes(quality)) continue
        if (controller.signal.aborted) throw new Error('用户取消下载')

        const started = Date.now()
        let tempFile: string | null = null
        try {
          await updateJob(job.id, { status: 'resolving' })
          const resolved = await sourceManager.resolve(channel.id, platform, quality, musicInfo)
          const preflight = await probeAudio(resolved.url)
          if (!preflight.isAudio) {
            throw new Error(preflight.error || preflight.note || '链接不是有效音频')
          }

          const hint = preflight.qualityHint
          const hintRank = hint ? QUALITY_RANK[hint] || 0 : 0
          if (hint && hintRank > 0 && hintRank < tierRank) {
            const message = `链接头部音质 ${hint} < ${quality}，跳过完整下载`
            if (settings.qualityStrategy === 'strict') {
              throw new Error(`严格模式：${message}`)
            }
            attempts.push({
              sourceId: channel.id,
              sourceName: channel.name,
              quality,
              ok: false,
              downgraded: true,
              actualQuality: hint,
              error: message,
              elapsedMs: Date.now() - started,
            })
            if (!headerFallback || hintRank > (QUALITY_RANK[headerFallback.hint] || 0)) {
              headerFallback = {
                url: resolved.url,
                channel,
                quality,
                hint,
                startedAt: started,
              }
            }
            continue
          }

          const candidate = await downloadCandidate(resolved.url, channel, quality, started)
          tempFile = candidate.tempFile
          const actualRank = QUALITY_RANK[candidate.validation.actualQuality] || 0

          if (candidate.validation.verdict === 'downgraded' || actualRank < tierRank) {
            if (settings.qualityStrategy === 'strict') {
              throw new Error(
                `严格模式：实际音质 ${candidate.validation.actualQuality} 低于请求 ${quality}`
              )
            }

            attempts.push({
              sourceId: channel.id,
              sourceName: channel.name,
              quality,
              ok: false,
              downgraded: true,
              actualQuality: candidate.validation.actualQuality,
              error: `音质降级：${candidate.validation.actualQuality} < ${quality}，继续尝试更高可用渠道`,
              elapsedMs: Date.now() - started,
            })

            const bestRank = fallback
              ? QUALITY_RANK[fallback.validation.actualQuality] || 0
              : -1
            if (actualRank > bestRank) {
              await discardFallback()
              fallback = candidate
            } else {
              await fs.unlink(candidate.tempFile).catch(() => {})
            }
            tempFile = null
            continue
          }

          await discardFallback()
          await completeWith(candidate)
          tempFile = null
          return
        } catch (e) {
          if (tempFile) await fs.unlink(tempFile).catch(() => {})
          const message = e instanceof Error ? e.message : String(e)
          if (controller.signal.aborted || /取消/.test(message)) {
            throw new Error('用户取消下载')
          }
          attempts.push({
            sourceId: channel.id,
            sourceName: channel.name,
            quality,
            ok: false,
            error: message.slice(0, 400),
            elapsedMs: Date.now() - started,
          })
          await recordStat(channel.id, platform, false, Date.now() - started, message)
        }
      }
    }

    if (fallback && headerFallback) {
      const fallbackRank = QUALITY_RANK[fallback.validation.actualQuality] || 0
      const headerRank = QUALITY_RANK[headerFallback.hint] || 0
      if (headerRank > fallbackRank) {
        try {
          const candidate = await downloadCandidate(
            headerFallback.url,
            headerFallback.channel,
            headerFallback.quality,
            headerFallback.startedAt
          )
          await discardFallback()
          fallback = candidate
        } catch (e) {
          attempts.push({
            sourceId: headerFallback.channel.id,
            sourceName: headerFallback.channel.name,
            quality: headerFallback.quality,
            ok: false,
            error: `下载候选失败：${e instanceof Error ? e.message : String(e)}`.slice(0, 400),
            elapsedMs: Date.now() - headerFallback.startedAt,
          })
        }
      }
    } else if (!fallback && headerFallback) {
      try {
        fallback = await downloadCandidate(
          headerFallback.url,
          headerFallback.channel,
          headerFallback.quality,
          headerFallback.startedAt
        )
      } catch (e) {
        attempts.push({
          sourceId: headerFallback.channel.id,
          sourceName: headerFallback.channel.name,
          quality: headerFallback.quality,
          ok: false,
          error: `下载候选失败：${e instanceof Error ? e.message : String(e)}`.slice(0, 400),
          elapsedMs: Date.now() - headerFallback.startedAt,
        })
      }
    }

    if (fallback) {
      await completeWith(fallback)
      return
    }

    const summary = attempts
      .slice(-10)
      .map((a) => `${a.sourceName}/${a.quality}: ${a.error}`)
      .join(' | ')
    await updateJob(job.id, {
      status: 'failed',
      progress: 0,
      attempts: JSON.stringify(attempts.slice(-30)),
      error: (summary || '所有渠道均失败').slice(0, 1200),
      finishedAt: new Date(),
    })
  } catch (e) {
    await discardFallback().catch(() => {})
    const reason = controller.signal.reason
    const reasonText =
      reason instanceof Error ? reason.message : reason ? String(reason) : ''
    const message = e instanceof Error ? e.message : String(e)
    const paused = controller.signal.aborted && /暂停/.test(reasonText)
    const canceled = controller.signal.aborted && /取消/.test(reasonText)
    await updateJob(job.id, {
      status: paused ? 'paused' : canceled ? 'canceled' : 'failed',
      attempts: JSON.stringify(attempts.slice(-30)),
      error: paused ? null : (message || '下载失败').slice(0, 1200),
      finishedAt: paused ? null : new Date(),
    }).catch(() => {})
  } finally {
    await discardFallback().catch(() => {})
    cancelControllers.delete(job.id)
    lastProgressAt.delete(job.id)
  }
}
