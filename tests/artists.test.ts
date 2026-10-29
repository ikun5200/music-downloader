import { describe, expect, it, vi } from 'vitest'
import {
  decodeHtmlEntities,
  normalizeArtists,
  resolveArtists,
  splitArtistsByRules,
  validateAiArtists,
} from '../lib/artists'
import type { AiConfig } from '../lib/settings'

const aiConfig: AiConfig = {
  enabled: true,
  baseUrl: 'https://api.example.com/v1',
  model: 'test-model',
  apiKey: 'test-key',
}

describe('artist HTML entity decoding', () => {
  it('decodes the entities that Feiniu fails to decode before splitting', () => {
    expect(decodeHtmlEntities('Guns N&apos; Roses')).toBe("Guns N' Roses")
    expect(decodeHtmlEntities('A&amp;B')).toBe('A&B')
    expect(decodeHtmlEntities('A&#39;B')).toBe("A'B")
    expect(decodeHtmlEntities('A\\&B')).toBe('A&B')
  })

  it('does not split a decoded apostrophe name', () => {
    const result = normalizeArtists('Guns N&apos; Roses')
    expect(result.artists).toEqual(["Guns N' Roses"])
    expect(result.artistTag).toBe("Guns N' Roses")
  })
})

describe('artist rule fallback', () => {
  it('keeps band names containing & or / intact', () => {
    expect(splitArtistsByRules('AC/DC')).toEqual(['AC/DC'])
    expect(splitArtistsByRules('Simon & Garfunkel')).toEqual(['Simon & Garfunkel'])
    expect(splitArtistsByRules('Earth, Wind & Fire')).toEqual(['Earth, Wind & Fire'])
  })

  it('protects a single band name from Feiniu splitting', () => {
    expect(normalizeArtists('AC/DC').artistTag).toBe('AC／DC')
    expect(normalizeArtists('Simon & Garfunkel').artistTag).toBe('Simon ＆ Garfunkel')
    expect(normalizeArtists('Earth, Wind & Fire').artistTag).toBe('Earth, Wind ＆ Fire')
  })

  it('splits Chinese comma and & lists', () => {
    expect(splitArtistsByRules('王力宏&任家萱Selina')).toEqual(['王力宏', '任家萱Selina'])
    expect(splitArtistsByRules('林忆莲, 张惠妹, 蔡健雅 & 那英')).toEqual([
      '林忆莲',
      '张惠妹',
      '蔡健雅',
      '那英',
    ])
  })

  it('splits a slash when either side contains a space', () => {
    expect(splitArtistsByRules('Maroon 5/Wiz Khalifa')).toEqual([
      'Maroon 5',
      'Wiz Khalifa',
    ])
    expect(splitArtistsByRules('A / B')).toEqual(['A', 'B'])
  })

  it('splits explicit feat. and list separators', () => {
    expect(splitArtistsByRules('A feat. B')).toEqual(['A', 'B'])
    expect(splitArtistsByRules('A；B、C')).toEqual(['A', 'B', 'C'])
  })

  it('joins multiple artists with a Feiniu-recognized separator', () => {
    const result = normalizeArtists('林忆莲, 张惠妹, 蔡健雅 & 那英')
    expect(result.artistTag).toBe('林忆莲、张惠妹、蔡健雅、那英')
    expect(result.albumArtist).toBe('林忆莲')
  })
})

describe('AI artist validation', () => {
  it('accepts names that are substrings of the decoded raw value', () => {
    expect(validateAiArtists('A & B', ['A', 'B'])).toEqual(['A', 'B'])
    expect(validateAiArtists('Simon & Garfunkel', ['Simon & Garfunkel'])).toEqual([
      'Simon & Garfunkel',
    ])
  })

  it('rejects invented names and splitting a name with no collaboration marker', () => {
    expect(validateAiArtists('A & B', ['A', 'C'])).toBeNull()
    expect(validateAiArtists("Guns N' Roses", ['Guns N', 'Roses'])).toBeNull()
  })

  it('expands a combined Chinese name returned by AI', () => {
    expect(validateAiArtists('林忆莲, 张惠妹 & 那英', ['林忆莲, 张惠妹', '那英'])).toEqual([
      '林忆莲',
      '张惠妹',
      '那英',
    ])
  })

  it('keeps a short all-caps slash name as one band', () => {
    expect(validateAiArtists('AC/DC', ['AC', 'DC'])).toBeNull()
  })
})

describe('resolveArtists with AI', () => {
  it('uses AI to split an ambiguous collaboration', async () => {
    const chat = vi.fn(async () =>
      JSON.stringify({ artists: ['A', 'B'], reason: '两位歌手合作' })
    )
    const result = await resolveArtists('A & B', {
      title: 'Test',
      aiConfig,
      aiEnabled: true,
      chat,
    })
    expect(chat).toHaveBeenCalledTimes(1)
    expect(result.aiUsed).toBe(true)
    expect(result.artists).toEqual(['A', 'B'])
    expect(result.artistTag).toBe('A、B')
  })

  it('uses AI to keep a band name intact', async () => {
    const chat = vi.fn(async () =>
      JSON.stringify({ artists: ['Simon & Garfunkel'], reason: '乐队名' })
    )
    const result = await resolveArtists('Simon & Garfunkel', {
      aiConfig,
      aiEnabled: true,
      chat,
    })
    expect(result.aiUsed).toBe(true)
    expect(result.artists).toEqual(['Simon & Garfunkel'])
    expect(result.artistTag).toBe('Simon ＆ Garfunkel')
  })

  it('does not call AI for a plain single artist', async () => {
    const chat = vi.fn(async () => JSON.stringify({ artists: ['周杰伦'] }))
    const result = await resolveArtists('周杰伦', {
      aiConfig,
      aiEnabled: true,
      chat,
    })
    expect(chat).not.toHaveBeenCalled()
    expect(result.aiUsed).toBe(false)
    expect(result.artistTag).toBe('周杰伦')
  })

  it('falls back to rules when AI fails', async () => {
    const chat = vi.fn(async () => {
      throw new Error('timeout')
    })
    const result = await resolveArtists('A & B', {
      aiConfig,
      aiEnabled: true,
      chat,
    })
    expect(result.aiUsed).toBe(false)
    expect(result.artistTag).toBe('A ＆ B')
    expect(result.note).toContain('回退规则')
  })
})
