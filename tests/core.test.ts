import { describe, expect, it } from 'vitest'
import { normalizeText, sanitizeFilename } from '../lib/utils'
import { parsePythonLiteral } from '../lib/search/parse-kuwo'
import { relevance, decodeHtml } from '../lib/search/normalize'
import { actualQuality, extensionFor, judgeQuality } from '../lib/download/quality'
import { parseFlacStreamInfo } from '../lib/download/probe'
import type { FileAudioInfo } from '../lib/download/probe'
import type { RawSearchSong } from '../lib/search/types'
import { cpuScanConcurrency } from '../lib/settings'

function song(title: string, artist: string): RawSearchSong {
  return {
    platform: 'kw',
    id: `${title}:${artist}`,
    title,
    artist,
    musicInfo: { source: 'kw', songmid: '1', name: title, singer: artist },
  }
}

function info(partial: Partial<FileAudioInfo>): FileAudioInfo {
  return { ok: true, ...partial }
}

describe('CPU limit', () => {
  it('maps a CPU percentage to bounded scan concurrency', () => {
    expect(cpuScanConcurrency(25)).toBe(1)
    expect(cpuScanConcurrency(50)).toBe(2)
    expect(cpuScanConcurrency(75)).toBe(3)
    expect(cpuScanConcurrency(100)).toBe(4)
    expect(cpuScanConcurrency(0)).toBe(2)
  })
})

describe('sanitizeFilename', () => {
  it('removes path separators and control characters', () => {
    expect(sanitizeFilename('../../etc/passwd')).not.toContain('/')
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j')
    expect(sanitizeFilename('\u0000\u0001')).toBe('未命名')
  })

  it('clips to the requested length', () => {
    expect(sanitizeFilename('abcdefghij', 5)).toBe('abcde')
  })
})

describe('relevance', () => {
  it('decodes HTML entities and double-escaped unicode', () => {
    expect(decodeHtml('林俊杰\\u0026G.E.M.邓紫棋')).toBe('林俊杰&G.E.M.邓紫棋')
    expect(decodeHtml('林俊杰' + '\\\\'.repeat(4) + 'u0026G.E.M.邓紫棋')).toBe(
      '林俊杰&G.E.M.邓紫棋'
    )
    expect(decodeHtml('A &amp; B')).toBe('A & B')
  })

  it('ranks the exact original above a cover', () => {
    const original = relevance(song('孤勇者', '陈奕迅'), '孤勇者 陈奕迅')
    const cover = relevance(song('孤勇者 (cover: 陈奕迅)', '某翻唱'), '孤勇者 陈奕迅')
    const otherSong = relevance(song('十年', '陈奕迅'), '孤勇者 陈奕迅')
    expect(original).toBeGreaterThan(cover)
    expect(original).toBeGreaterThan(otherSong)
  })

  it('normalizes full-width punctuation and case', () => {
    expect(normalizeText('Hello（Live）')).toBe('hello')
  })
})

describe('quality judgement', () => {
  it('requires 24bit for FLAC 24bit', () => {
    expect(
      judgeQuality('flac24bit', info({ codec: 'flac', bitsPerRaw: 16, sampleRate: 44100 }))
    ).toBe('downgraded')
    expect(
      judgeQuality('flac24bit', info({ codec: 'flac', bitsPerRaw: 24, sampleRate: 48000 }))
    ).toBe('match')
  })

  it('detects fake lossless and low-bitrate MP3', () => {
    expect(judgeQuality('flac', info({ codec: 'mp3', bitRate: 128000 }))).toBe('downgraded')
    expect(judgeQuality('320k', info({ codec: 'mp3', bitRate: 128000 }))).toBe('downgraded')
    expect(judgeQuality('320k', info({ codec: 'mp3', bitRate: 320000 }))).toBe('match')
  })

  it('maps actual codec/bit depth to a quality label', () => {
    expect(actualQuality(info({ codec: 'flac', bitsPerRaw: 24, sampleRate: 96000 }))).toBe('hires')
    expect(actualQuality(info({ codec: 'flac', bitsPerRaw: 24, sampleRate: 48000 }))).toBe('flac24bit')
    expect(actualQuality(info({ codec: 'flac', bitsPerRaw: 16, sampleRate: 44100 }))).toBe('flac')
    expect(actualQuality(info({ codec: 'mp3', bitRate: 320000 }))).toBe('320k')
    expect(actualQuality(info({ codec: 'mp3', bitRate: 128000 }))).toBe('128k')
    expect(actualQuality(info({ codec: 'aac', bitRate: 52000 }))).toBe('64k')
    expect(actualQuality(info({ codec: 'aac', bitRate: 32000 }))).toBe('32k')
  })

  it('chooses the right file extension', () => {
    expect(extensionFor(info({ codec: 'flac' }))).toBe('flac')
    expect(extensionFor(info({ codec: 'mp3' }))).toBe('mp3')
    expect(extensionFor(info({ codec: 'alac', formatName: 'mov,mp4,m4a' }))).toBe('m4a')
  })
})

describe('FLAC STREAMINFO preflight', () => {
  it('reads 24bit/96kHz from the first metadata block', () => {
    const buf = Buffer.alloc(42)
    buf.write('fLaC', 0, 'latin1')
    buf[4] = 0x00 // last block, type STREAMINFO
    buf[5] = 0x00
    buf[6] = 0x00
    buf[7] = 0x22 // length 34
    const sampleRate = 96000n
    const channels = 2n
    const bits = 24n
    const totalSamples = BigInt(96000 * 231)
    const packed =
      (sampleRate << 44n) |
      ((channels - 1n) << 41n) |
      ((bits - 1n) << 36n) |
      totalSamples
    buf.writeBigUInt64BE(packed, 18)
    const parsed = parseFlacStreamInfo(buf)
    expect(parsed).toMatchObject({
      sampleRate: 96000,
      bitsPerRaw: 24,
      qualityHint: 'hires',
    })
  })

  it('returns null for a non-FLAC buffer', () => {
    expect(parseFlacStreamInfo(Buffer.from('not a flac file'))).toBeNull()
  })
})

describe('Python literal parser', () => {
  it('parses Kuwo-style nested dicts with escapes', () => {
    const parsed = parsePythonLiteral(
      "{'abslist': [{'SONGNAME': '孤勇者', 'ARTIST': '陈奕迅\\\\u0026x', 'DURATION': '250'}]}"
    ) as any
    expect(parsed.abslist[0].SONGNAME).toBe('孤勇者')
    expect(parsed.abslist[0].DURATION).toBe('250')
  })
})
