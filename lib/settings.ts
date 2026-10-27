import { prisma } from './db'
import { decryptSecret, encryptSecret } from './secrets'
import { PLATFORMS, type Platform } from './constants'
import type { MetadataSourceId } from './metadata/types'

export type QualityStrategy = 'highest' | 'strict' | 'flacFirst'

export interface AppSettings {
  qualityStrategy: QualityStrategy
  maxConcurrent: number
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
  metadataAiEnabled: boolean
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
  maxConcurrent: Number(process.env.MAX_CONCURRENT_DOWNLOADS || 2) || 2,
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
  metadataSourceOrder: ['itunes', 'qqmusic'],
  metadataWriteInfo: true,
  metadataWriteCover: true,
  metadataWriteLyrics: true,
  metadataAiEnabled: true,
}

export const METADATA_SOURCES: MetadataSourceId[] = ['itunes', 'qqmusic']

export function normalizeMetadataSourceOrder(value: unknown): MetadataSourceId[] {
  const input = Array.isArray(value) ? value : []
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
    maxConcurrent: Math.max(
      1,
      Math.min(8, Number(pick('maxConcurrent') || DEFAULT_SETTINGS.maxConcurrent) || 2)
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
    metadataAiEnabled: (pick('metadataAiEnabled') ?? 'true') !== 'false',
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
  if (values.maxConcurrent != null) entries.push(['maxConcurrent', String(values.maxConcurrent)])
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
  if (values.metadataAiEnabled != null) {
    entries.push(['metadataAiEnabled', String(values.metadataAiEnabled)])
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
