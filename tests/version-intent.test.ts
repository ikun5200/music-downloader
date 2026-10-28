import { describe, expect, it } from 'vitest'
import {
  detectQueryLanguageTags,
  detectQueryVersionTags,
  detectVersionTags,
} from '../lib/version-intent'

describe('query version intent', () => {
  it('detects bracketed and standalone version words', () => {
    expect(detectQueryVersionTags('K歌之王 (Live) 陈奕迅')).toContain('live')
    expect(detectQueryVersionTags('K歌之王 Live 陈奕迅')).toContain('live')
    expect(detectQueryVersionTags('想见就能相见 (Live版) 王力宏')).toContain('live')
    expect(detectQueryVersionTags('K歌之王 伴奏 陈奕迅')).toContain('instrumental')
    expect(detectQueryVersionTags('K歌之王 钢琴版 陈奕迅')).toEqual(
      expect.arrayContaining(['instrumental', 'piano'])
    )
  })

  it('does not treat a song title containing 演唱会 as a live request', () => {
    expect(detectQueryVersionTags('她来听我的演唱会 张学友')).toEqual([])
    expect(detectVersionTags('她来听我的演唱会')).toContain('live')
  })

  it('detects explicit language requests', () => {
    expect(detectQueryLanguageTags('K歌之王 粤语 陈奕迅')).toContain('cantonese')
    expect(detectQueryLanguageTags('K歌之王（国语版）陈奕迅')).toContain('mandarin')
  })
})
