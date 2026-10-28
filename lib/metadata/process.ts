import fs from 'fs/promises'
import type { DownloadJob } from '@prisma/client'
import { getAiConfig, type AppSettings } from '../settings'
import { safeJson } from '../utils'
import {
  detectCandidateLanguageTags,
  detectCandidateVersionTags,
} from '../version-intent'
import { scrapeMetadata } from './scrape'
import { cleanLyricsWithAi } from './lyrics-ai'
import { writeMetadataTags } from './tag'

export interface MetadataProcessResult {
  status: 'success' | 'partial' | 'failed' | 'not_found' | 'disabled'
  note: string
  source?: string | null
  title?: string | null
  artist?: string | null
  album?: string | null
}

/**
 * 对一个已经落盘的音频文件执行刮削并写标签。
 * 下载流程和后台补刮队列共用，避免两套逻辑产生不同结果。
 */
export async function processMetadataForJob(
  job: DownloadJob,
  absolutePath: string,
  settings: AppSettings
): Promise<MetadataProcessResult> {
  if (!settings.metadataScrapeEnabled) {
    return { status: 'disabled', note: '下载后自动刮削已关闭' }
  }

  try {
    await fs.access(absolutePath)
  } catch {
    return { status: 'failed', note: '文件不存在，无法写入元数据' }
  }

  const musicInfo = safeJson<Record<string, unknown>>(job.musicInfo, {})
  const duration = Number(musicInfo.interval)

  try {
    const aiConfig = await getAiConfig().catch(() => null)
    const aiEnabled = !!(
      settings.metadataAiEnabled &&
      aiConfig?.enabled &&
      aiConfig.apiKey
    )

    const result = await scrapeMetadata({
      query: {
        title: job.title,
        artist: job.artist,
        album: job.album,
        duration: Number.isFinite(duration) && duration > 0 ? duration : null,
        versionTags: detectCandidateVersionTags(job.title, job.album),
        languageTags: detectCandidateLanguageTags(job.title, job.album),
      },
      sourceOrder: settings.metadataSourceOrder,
      aiConfig: aiEnabled ? aiConfig : null,
    })

    if (result.status !== 'success' || !result.candidate) {
      return {
        status: result.status === 'not_found' ? 'not_found' : 'failed',
        note: (result.note || '没有找到可信的原版元数据').slice(0, 1000),
      }
    }

    const candidate = result.candidate
    const lyricsResult = candidate.lyrics
      ? await cleanLyricsWithAi(candidate.lyrics, {
          title: candidate.title,
          artist: candidate.artist,
          cleanCredits: settings.lyricsCleanCredits,
          simplify: settings.lyricsSimplify,
          aiEnabled: settings.lyricsAiCleanEnabled,
          aiConfig,
        })
      : null
    if (lyricsResult) candidate.lyrics = lyricsResult.text

    const written = await writeMetadataTags(absolutePath, candidate, {
      writeInfo: settings.metadataWriteInfo,
      writeCover: settings.metadataWriteCover,
      writeLyrics: settings.metadataWriteLyrics,
      // 歌词已在这里按 AI 优先的规则处理完，写标签时不要再跑一次规则清理。
      lyricsCleanCredits: false,
      lyricsSimplify: false,
    })

    return {
      status: written.ok ? 'success' : written.partial ? 'partial' : 'failed',
      note: [result.note, lyricsResult?.note, written.note]
        .filter(Boolean)
        .join('；')
        .slice(0, 1000),
      source: candidate.source,
      title: candidate.title || null,
      artist: candidate.artist || null,
      album: candidate.album || null,
    }
  } catch (error) {
    return {
      status: 'failed',
      note: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
    }
  }
}
