import { describe, expect, it } from 'vitest'
import { parseM4aDuration, parseMp3Info } from '../lib/download/probe'
import { isDurationMismatch } from '../lib/playback/duration'
import { hasPlaybackVariant } from '../lib/playback/variant'

function mp3Frame(): Buffer {
  const frame = Buffer.alloc(417)
  // MPEG1 Layer III, 128kbps, 44100Hz, stereo, no CRC.
  frame[0] = 0xff
  frame[1] = 0xfb
  frame[2] = 0x90
  frame[3] = 0x00
  return frame
}

describe('parseMp3Info', () => {
  it('按 CBR 帧数估算时长', () => {
    const frame = mp3Frame()
    const buf = Buffer.concat(Array.from({ length: 100 }, () => frame))
    const info = parseMp3Info(buf, buf.length)
    expect(info?.sampleRate).toBe(44100)
    expect(info?.bitRate).toBe(128000)
    expect(info?.duration).toBeCloseTo((100 * 1152) / 44100, 3)
  })

  it('优先使用 Xing 总帧数', () => {
    const frame = mp3Frame()
    frame.write('Xing', 36, 'latin1')
    frame.writeUInt32BE(1, 40)
    frame.writeUInt32BE(1000, 44)
    const info = parseMp3Info(frame, 417)
    expect(info?.duration).toBeCloseTo((1000 * 1152) / 44100, 3)
  })
})

describe('parseM4aDuration', () => {
  it('读取 mvhd timescale/duration', () => {
    const buf = Buffer.alloc(64)
    buf.write('mvhd', 0, 'latin1')
    buf[4] = 0
    buf.writeUInt32BE(1000, 16)
    buf.writeUInt32BE(30_000, 20)
    expect(parseM4aDuration(buf)).toBe(30)
  })
})

describe('isDurationMismatch', () => {
  it('识别 0.8x 慢放版本', () => {
    expect(isDurationMismatch(243, 304)).toBe(true)
  })

  it('容忍几秒的元数据误差', () => {
    expect(isDurationMismatch(243, 250)).toBe(false)
    expect(isDurationMismatch(30, 30.2)).toBe(false)
  })

  it('缺少时长时不拦截', () => {
    expect(isDurationMismatch(243, undefined)).toBe(false)
    expect(isDurationMismatch(undefined, 243)).toBe(false)
  })
})

describe('hasPlaybackVariant', () => {
  it('识别慢放、降调、Live 与伴奏', () => {
    expect(hasPlaybackVariant('Song (Slowed + Reverb)')).toBe(true)
    expect(hasPlaybackVariant('Song (0.8x)')).toBe(true)
    expect(hasPlaybackVariant('Song (Live)')).toBe(true)
    expect(hasPlaybackVariant('Song - Remix')).toBe(true)
    expect(hasPlaybackVariant('慢放版')).toBe(true)
    expect(hasPlaybackVariant('Song', 'Live at Wembley')).toBe(true)
  })

  it('不误伤正常英文歌名', () => {
    expect(hasPlaybackVariant('Deliver')).toBe(false)
    expect(hasPlaybackVariant('Discover')).toBe(false)
    expect(hasPlaybackVariant('Live Forever')).toBe(false)
    expect(hasPlaybackVariant('Song')).toBe(false)
  })
})
