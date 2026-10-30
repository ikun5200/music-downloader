import { prisma } from './db'
import { decryptSecret, encryptSecret } from './secrets'
import { PLATFORMS, type Platform } from './constants'
import type { MetadataSourceId } from './metadata/types'
import { normalizeQualityCap, type QualityCap } from './download/quality-cap'

export type QualityStrategy = 'highest' | 'strict' | 'flacFirst'

export interface AppSettings {
  qualityStrategy: QualityStrategy
  maxQuality: QualityCap
  maxConcurrent: number
  /** 音乐库扫描/歌词/封面/刮削的 CPU 使用上限（百分比）。 */
  cpuLimitPercent: number
  filenameTemplate: string
  maxFileSizeMb: number
  verifyWrongSong: boolean
  platformOrder: Platform[]
  platformPriority: Record<string, string[]> | null
  aiEnabled: boolean
  aiBaseUrl: string
  aiModel: string
  aiApiKeySet: boolean
  aiTitleCleanEnabled: boolean
  metadataScrapeEnabled: boolean
  metadataSourceOrder: MetadataSourceId[]
  metadataWriteInfo: boolean
  metadataWriteCover: boolean
  metadataWriteLyrics: boolean
  lyricsCleanCredits: boolean
  lyricsSimplify: boolean
  lyricsAiCleanEnabled: boolean
  metadataAiEnabled: boolean
  /** 是否用 AI 判断 artist 里的 & / , / feat. 是合作分隔还是乐队名的一部分。 */
  metadataArtistAiEnabled: boolean
  /** 下载前/后让 AI 复核版本与语言。 */
  aiVersionGuardEnabled: boolean
  /** 下载渠道失败时，让 AI 跨平台重新识别并兜底。 */
  aiCrossPlatformFallbackEnabled: boolean
}

export interface AiConfig {
  enabled: boolean
  baseUrl: string
  model: string
  apiKey: string
  /** 是否用 AI 清理歌名中的主题曲/推广曲等说明。 */
  titleClean?: boolean
}

export interface SettingsPatch extends Partial<AppSettings> {
  aiApiKey?: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  qualityStrategy: 'highest',
  maxQuality: 'auto',
  maxConcurrent: Number(process.env.MAX_CONCURRENT_DOWNLOADS || 2) || 2,
  cpuLimitPercent: 25,
  filenameTemplate: '{title}.{ext}',
  maxFileSizeMb: 1024,
  verifyWrongSong: true,
  platformOrder: [...PLATFORMS],
  platformPriority: null,
  aiEnabled: false,
  aiBaseUrl: 'https://api.openai.com/v1',
  aiModel: 'gpt-4o-mini',
  aiApiKeySet: false,
  aiTitleCleanEnabled: true,
  metadataScrapeEnabled: true,
  metadataSourceOrder: [
    'itunes',
    'qqmusic',
    'netease',
    'kuwo',
    'kugou',
    'lrclib',
    'theaudiodb',
  ],
  metadataWriteInfo: true,
  metadataWriteCover: true,
  metadataWriteLyrics: true,
  lyricsCleanCredits: true,
  lyricsSimplify: true,
  lyricsAiCleanEnabled: true,
  metadataAiEnabled: true,
  metadataArtistAiEnabled: true,
  aiVersionGuardEnabled: true,
  aiCrossPlatformFallbackEnabled: true,
}

export const METADATA_SOURCES: MetadataSourceId[] = [
  'itunes',
  'netease',
  'kugou',
  'kuwo',
  'qqmusic',
  'lrclib',
  'theaudiodb',
]

export function normalizeMetadataSourceOrder(value: unknown): MetadataSourceId[] {
  const input = Array.isArray(value) ? value : []
  // 旧版默认值是 iTunes → QQ；QQ 搜索接口 2026-10 起返回 500，
  // 自动迁移到包含网易云/酷狗/酷我/歌词源的新默认顺序。
  if (input.length === 2 && input[0] === 'itunes' && input[1] === 'qqmusic') {
    return [...METADATA_SOURCES]
  }
  const out: MetadataSourceId[] = []
  for (const item of input) {
    if (
      typeof item === 'string' &&
      (METADATA_SOURCES as string[]).includes(item) &&
      !out.includes(item as MetadataSourceId)
    ) {
      out.push(item as MetadataSourceId)
    }
  }
  for (const source of METADATA_SOURCES) {
    if (!out.includes(source)) out.push(source)
  }
  return out
}

function parseMetadataSourceOrder(raw?: string): MetadataSourceId[] {
  if (!raw) return [...METADATA_SOURCES]
  try {
    return normalizeMetadataSourceOrder(JSON.parse(raw))
  } catch {
    return [...METADATA_SOURCES]
  }
}

export function normalizePlatformOrder(value: unknown): Platform[] {
  const input = Array.isArray(value) ? value : []
  const out: Platform[] = []
  for (const item of input) {
    if (
      typeof item === 'string' &&
      (PLATFORMS as readonly string[]).includes(item) &&
      !out.includes(item as Platform)
    ) {
      out.push(item as Platform)
    }
  }
  for (const platform of PLATFORMS) {
    if (!out.includes(platform)) out.push(platform)
  }
  return out
}

function parsePlatformOrder(raw?: string): Platform[] {
  if (!raw) return [...PLATFORMS]
  try {
    return normalizePlatformOrder(JSON.parse(raw))
  } catch {
    return [...PLATFORMS]
  }
}

function parseSettings(rows: { key: string; value: string }[]): AppSettings {
  const map = new Map(rows.map((r) => [r.key, r.value]))
  const pick = (key: string) => map.get(key)

  const strategy = pick('qualityStrategy')
  const priorityRaw = pick('platformPriority')

  return {
    qualityStrategy:
      strategy === 'strict' || strategy === 'flacFirst' || strategy === 'highest'
        ? strategy
        : DEFAULT_SETTINGS.qualityStrategy,
    maxQuality: normalizeQualityCap(pick('maxQuality')),
    maxConcurrent: Math.max(
      1,
      Math.min(8, Number(pick('maxConcurrent') || DEFAULT_SETTINGS.maxConcurrent) || 2)
    ),
    cpuLimitPercent: Math.max(
      10,
      Math.min(100, Number(pick('cpuLimitPercent') || DEFAULT_SETTINGS.cpuLimitPercent) || 25)
    ),
    filenameTemplate: pick('filenameTemplate') || DEFAULT_SETTINGS.filenameTemplate,
    maxFileSizeMb: Math.max(
      64,
      Math.min(4096, Number(pick('maxFileSizeMb') || DEFAULT_SETTINGS.maxFileSizeMb) || 1024)
    ),
    verifyWrongSong: (pick('verifyWrongSong') ?? 'true') !== 'false',
    platformOrder: parsePlatformOrder(pick('platformOrder')),
    platformPriority: priorityRaw ? safeParsePriority(priorityRaw) : null,
    aiEnabled: (pick('aiEnabled') ?? 'false') === 'true',
    aiBaseUrl: (pick('aiBaseUrl') || DEFAULT_SETTINGS.aiBaseUrl).replace(/\/+$/, ''),
    aiModel: pick('aiModel') || DEFAULT_SETTINGS.aiModel,
    aiApiKeySet: !!pick('aiApiKey'),
    aiTitleCleanEnabled: (pick('aiTitleCleanEnabled') ?? 'true') !== 'false',
    metadataScrapeEnabled: (pick('metadataScrapeEnabled') ?? 'true') !== 'false',
    metadataSourceOrder: parseMetadataSourceOrder(pick('metadataSourceOrder')),
    metadataWriteInfo: (pick('metadataWriteInfo') ?? 'true') !== 'false',
    metadataWriteCover: (pick('metadataWriteCover') ?? 'true') !== 'false',
    metadataWriteLyrics: (pick('metadataWriteLyrics') ?? 'true') !== 'false',
    lyricsCleanCredits: (pick('lyricsCleanCredits') ?? 'true') !== 'false',
    lyricsSimplify: (pick('lyricsSimplify') ?? 'true') !== 'false',
    lyricsAiCleanEnabled: (pick('lyricsAiCleanEnabled') ?? 'true') !== 'false',
    metadataAiEnabled: (pick('metadataAiEnabled') ?? 'true') !== 'false',
    metadataArtistAiEnabled: (pick('metadataArtistAiEnabled') ?? 'true') !== 'false',
    aiVersionGuardEnabled: (pick('aiVersionGuardEnabled') ?? 'true') !== 'false',
    aiCrossPlatformFallbackEnabled: (pick('aiCrossPlatformFallbackEnabled') ?? 'true') !== 'false',
  }
}

export async function getAiConfig(): Promise<AiConfig> {
  const rows = await prisma.setting.findMany({
    where: {
      key: {
        in: ['aiEnabled', 'aiBaseUrl', 'aiModel', 'aiApiKey', 'aiTitleCleanEnabled'],
      },
    },
  })
  const map = new Map(rows.map((row) => [row.key, row.value]))
  return {
    enabled: (map.get('aiEnabled') ?? 'false') === 'true',
    baseUrl: (map.get('aiBaseUrl') || DEFAULT_SETTINGS.aiBaseUrl).replace(/\/+$/, ''),
    model: map.get('aiModel') || DEFAULT_SETTINGS.aiModel,
    apiKey: decryptSecret(map.get('aiApiKey')),
    titleClean: (map.get('aiTitleCleanEnabled') ?? 'true') !== 'false',
  }
}

function safeParsePriority(value: string): Record<string, string[]> | null {
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return null
    const out: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v)) out[k] = v.map(String)
    }
    return out
  } catch {
    return null
  }
}

export async function getSettings(): Promise<AppSettings> {
  const rows = await prisma.setting.findMany()
  return parseSettings(rows)
}

export async function setSetting(key: string, value: string) {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
}

export async function setSettings(values: SettingsPatch) {
  const entries: [string, string][] = []
  if (values.qualityStrategy) entries.push(['qualityStrategy', values.qualityStrategy])
  if (values.maxQuality) entries.push(['maxQuality', normalizeQualityCap(values.maxQuality)])
  if (values.maxConcurrent != null) entries.push(['maxConcurrent', String(values.maxConcurrent)])
  if (values.cpuLimitPercent != null) {
    entries.push([
      'cpuLimitPercent',
      String(Math.max(10, Math.min(100, Math.round(values.cpuLimitPercent)))),
    ])
  }
  if (values.filenameTemplate) entries.push(['filenameTemplate', values.filenameTemplate])
  if (values.maxFileSizeMb != null) entries.push(['maxFileSizeMb', String(values.maxFileSizeMb)])
  if (values.verifyWrongSong != null) entries.push(['verifyWrongSong', String(values.verifyWrongSong)])
  if (values.platformOrder) {
    entries.push(['platformOrder', JSON.stringify(normalizePlatformOrder(values.platformOrder))])
  }
  if (values.platformPriority !== undefined) {
    entries.push(['platformPriority', values.platformPriority ? JSON.stringify(values.platformPriority) : ''])
  }
  if (values.aiEnabled != null) entries.push(['aiEnabled', String(values.aiEnabled)])
  if (values.aiBaseUrl) entries.push(['aiBaseUrl', values.aiBaseUrl.replace(/\/+$/, '')])
  if (values.aiModel) entries.push(['aiModel', values.aiModel])
  if (values.aiTitleCleanEnabled != null) {
    entries.push(['aiTitleCleanEnabled', String(values.aiTitleCleanEnabled)])
  }
  if (values.metadataScrapeEnabled != null) {
    entries.push(['metadataScrapeEnabled', String(values.metadataScrapeEnabled)])
  }
  if (values.metadataSourceOrder) {
    entries.push([
      'metadataSourceOrder',
      JSON.stringify(normalizeMetadataSourceOrder(values.metadataSourceOrder)),
    ])
  }
  if (values.metadataWriteInfo != null) {
    entries.push(['metadataWriteInfo', String(values.metadataWriteInfo)])
  }
  if (values.metadataWriteCover != null) {
    entries.push(['metadataWriteCover', String(values.metadataWriteCover)])
  }
  if (values.metadataWriteLyrics != null) {
    entries.push(['metadataWriteLyrics', String(values.metadataWriteLyrics)])
  }
  if (values.lyricsCleanCredits != null) {
    entries.push(['lyricsCleanCredits', String(values.lyricsCleanCredits)])
  }
  if (values.lyricsSimplify != null) {
    entries.push(['lyricsSimplify', String(values.lyricsSimplify)])
  }
  if (values.lyricsAiCleanEnabled != null) {
    entries.push(['lyricsAiCleanEnabled', String(values.lyricsAiCleanEnabled)])
  }
  if (values.metadataAiEnabled != null) {
    entries.push(['metadataAiEnabled', String(values.metadataAiEnabled)])
  }
  if (values.metadataArtistAiEnabled != null) {
    entries.push(['metadataArtistAiEnabled', String(values.metadataArtistAiEnabled)])
  }
  if (values.aiVersionGuardEnabled != null) {
    entries.push(['aiVersionGuardEnabled', String(values.aiVersionGuardEnabled)])
  }
  if (values.aiCrossPlatformFallbackEnabled != null) {
    entries.push(['aiCrossPlatformFallbackEnabled', String(values.aiCrossPlatformFallbackEnabled)])
  }
  if (values.aiApiKey !== undefined && !/^[•*]+$/.test(values.aiApiKey)) {
    entries.push(['aiApiKey', values.aiApiKey ? encryptSecret(values.aiApiKey) : ''])
  }
  for (const [key, value] of entries) await setSetting(key, value)
}

export function getDownloadDir(): string {
  return process.env.DOWNLOAD_DIR || './downloads'
}

export function getDisplayDownloadDir(): string {
  return process.env.HOST_DOWNLOAD_DIR || getDownloadDir()
}

export function getPublicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
}


/** 把 CPU 上限换算成音乐库扫描/刮削的并发数；100% 时最多 4 路。 */
export function cpuScanConcurrency(percent: number | null | undefined): number {
  const value = Number(percent)
  if (!Number.isFinite(value) || value <= 0) return 2
  if (value >= 90) return 4
  if (value >= 65) return 3
  if (value >= 40) return 2
  return 1
}
