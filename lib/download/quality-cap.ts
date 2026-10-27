import { QUALITY_RANK } from '../constants'

/** 后台可选的最高音质档位，从高到低。auto 表示不限制。 */
export const QUALITY_CAPS = [
  'auto',
  'hires',
  'flac24bit',
  'flac',
  '320k',
  '192k',
  '128k',
] as const

export type QualityCap = (typeof QUALITY_CAPS)[number]

export const QUALITY_CAP_LABELS: Record<QualityCap, string> = {
  auto: '自动（不限制，最高可用）',
  hires: 'Hi-Res（24bit/192k 等）',
  flac24bit: 'FLAC 24bit',
  flac: 'FLAC（CD 级 16bit/44.1kHz，推荐省空间）',
  '320k': '320k',
  '192k': '192k',
  '128k': '128k',
}

export function normalizeQualityCap(value: unknown): QualityCap {
  return typeof value === 'string' && (QUALITY_CAPS as readonly string[]).includes(value)
    ? (value as QualityCap)
    : 'auto'
}

/**
 * 计算实际请求音质：
 * - 后台上限是 auto：保留单次请求（null/auto 表示最高可用）。
 * - 后台上限是具体档位：单次请求更高时截断到上限；更低时尊重单次请求。
 */
export function capQuality(
  requested: string | null | undefined,
  cap: string | null | undefined
): string | null {
  const normalizedCap = normalizeQualityCap(cap)
  const requestedValue =
    requested &&
    requested !== 'auto' &&
    Object.prototype.hasOwnProperty.call(QUALITY_RANK, requested)
      ? requested
      : null

  if (normalizedCap === 'auto') return requestedValue

  const capRank = QUALITY_RANK[normalizedCap] || 0
  if (!requestedValue) return normalizedCap
  const requestedRank = QUALITY_RANK[requestedValue] || 0
  return requestedRank > capRank ? normalizedCap : requestedValue
}
