import { QUALITY_RANK } from '../constants'
import type { FileAudioInfo } from './probe'

const LOSSLESS = new Set(['flac', 'alac', 'ape', 'wav', 'wv', 'tta'])
const LOSSY = new Set(['mp3', 'aac', 'opus', 'vorbis'])

export type QualityVerdict = 'match' | 'higher' | 'downgraded' | 'unknown'

export function judgeQuality(requested: string, probe: FileAudioInfo): QualityVerdict {
  if (!probe.ok) return 'unknown'
  const codec = String(probe.codec || '')
  const lossless = LOSSLESS.has(codec)
  const lossy = LOSSY.has(codec)
  const rank = QUALITY_RANK[requested] || 0

  if (rank >= 5) {
    if (lossless) return (probe.bitsPerRaw || 0) >= 24 ? 'match' : 'downgraded'
    if (lossy) return 'downgraded'
    return 'unknown'
  }
  if (rank === 4) {
    if (lossless) return 'match'
    if (lossy) return 'downgraded'
    return 'unknown'
  }

  const bitRate = probe.bitRate || 0
  if (rank === 3) {
    if (lossless) return 'higher'
    if (lossy) return bitRate >= 256000 ? 'match' : 'downgraded'
  }
  if (rank === 2) {
    if (lossless) return 'higher'
    if (lossy) return bitRate >= 256000 ? 'higher' : bitRate >= 160000 ? 'match' : 'downgraded'
  }
  if (rank === 1) {
    if (lossless) return 'higher'
    if (lossy) return bitRate >= 200000 ? 'higher' : bitRate >= 96000 ? 'match' : 'downgraded'
  }
  return 'unknown'
}

export function actualQuality(probe: FileAudioInfo): string {
  const codec = String(probe.codec || '')
  if (codec === 'flac') {
    if ((probe.bitsPerRaw || 0) >= 24) {
      return (probe.sampleRate || 0) >= 96000 ? 'hires' : 'flac24bit'
    }
    return 'flac'
  }
  if (LOSSLESS.has(codec)) return 'flac'
  if (LOSSY.has(codec)) {
    const br = probe.bitRate || 0
    if (br >= 256000) return '320k'
    if (br >= 160000) return '192k'
    return '128k'
  }
  return 'unknown'
}

export function extensionFor(probe: FileAudioInfo): string {
  const codec = String(probe.codec || '')
  const format = String(probe.formatName || '')
  if (codec === 'flac' || format.includes('flac')) return 'flac'
  if (codec === 'mp3' || format.includes('mp3')) return 'mp3'
  if (codec === 'alac' || format.includes('mp4') || format.includes('mov')) return 'm4a'
  if (codec === 'aac') return format.includes('adts') ? 'aac' : 'm4a'
  if (codec === 'opus' || codec === 'vorbis' || format.includes('ogg')) return 'ogg'
  if (codec === 'ape') return 'ape'
  if (codec === 'wav') return 'wav'
  return 'audio'
}

export function qualityRank(quality?: string | null): number {
  return quality ? QUALITY_RANK[quality] || 0 : 0
}
