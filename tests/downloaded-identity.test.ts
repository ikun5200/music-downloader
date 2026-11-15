import { describe, expect, it } from 'vitest'
import {
  artistKeysOverlap,
  buildRequestIdentity,
  buildTrackIdentity,
  versionSignature,
} from '../lib/downloaded/identity'

describe('download version signature', () => {
  it('distinguishes explicit versions from normal song titles', () => {
    expect(versionSignature('Live Forever')).toBe('')
    expect(versionSignature('Song (Live)')).toBe('live')
    expect(versionSignature('Song - Remix')).toBe('remix')
    expect(versionSignature('Song (0.8x)')).toBe('remix')
    expect(versionSignature('晴天 Live')).toBe('live')
    expect(versionSignature('晴天 现场版')).toBe('live')
  })

  it('keeps language versions separate', () => {
    expect(versionSignature('晴天 粤语版')).toBe('cantonese')
    expect(versionSignature('Song (国语版)')).toBe('mandarin')
  })

  it('uses the album for live albums', () => {
    expect(versionSignature('Song', 'Live at Wembley')).toBe('live')
    expect(versionSignature('Song', '叶惠美')).toBe('')
  })
})

describe('download identity', () => {
  it('normalizes traditional/simplified and artist separators', () => {
    const a = buildTrackIdentity('牽掛', '曾沛慈')
    const b = buildTrackIdentity('牵挂', '曾沛慈')
    expect(a.titleKey).toBe(b.titleKey)
    expect(a.artistKey).toBe(b.artistKey)
    expect(artistKeysOverlap(a.artistKey, b.artistKey)).toBe(true)
  })

  it('uses request line version intent', () => {
    const original = buildRequestIdentity('晴天', '周杰伦', null, '晴天 周杰伦')
    const live = buildRequestIdentity('晴天', '周杰伦', null, '晴天 周杰伦 Live')
    expect(original.versionKey).toBe('')
    expect(live.versionKey).toBe('live')
  })
})
