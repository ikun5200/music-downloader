import { describe, expect, it } from 'vitest'
import { isTtmlLyrics, mergeTranslatedLyrics, toTtmlLyrics } from '../lib/metadata/lyrics'

describe('translated lyrics merge', () => {
  it('adds translation lines after matching timestamps', () => {
    const original = '[00:01.00]Hello\n[00:02.50]World'
    const translation = '[00:01.00]你好\n[00:02.50]世界'
    expect(mergeTranslatedLyrics(original, translation)).toBe(
      '[00:01.00]Hello\n[00:01.00]你好\n[00:02.50]World\n[00:02.50]世界'
    )
  })

  it('returns the original when translation is empty or lacks timestamps', () => {
    expect(mergeTranslatedLyrics('[00:01.00]Hello', '')).toBe('[00:01.00]Hello')
    expect(mergeTranslatedLyrics('[00:01.00]Hello', '你好')).toBe('[00:01.00]Hello')
  })

  it('does not duplicate a translation identical to the original', () => {
    expect(mergeTranslatedLyrics('[00:01.00]Hello', '[00:01.00]Hello')).toBe(
      '[00:01.00]Hello'
    )
  })
})

describe('Feiniu TTML lyrics', () => {
  it('converts bilingual LRC into TTML with x-translation', () => {
    const lrc = '[00:01.00]Hello world\n[00:01.00]你好世界\n[00:03.50]Goodbye'
    const ttml = toTtmlLyrics(lrc)
    expect(ttml).toContain('<tt xmlns=')
    expect(ttml).toContain('<p begin="00:01.000"')
    expect(ttml).toContain('role="x-translation">你好世界')
    expect(ttml).toContain('Goodbye')
    expect(isTtmlLyrics(ttml || '')).toBe(true)
  })

  it('leaves ordinary LRC untouched when there is no translation', () => {
    expect(toTtmlLyrics('[00:01.00]Hello world\n[00:03.00]Goodbye')).toBeNull()
  })

  it('escapes XML special characters', () => {
    const ttml = toTtmlLyrics('[00:01.00]A & B\n[00:01.00]甲 & 乙')
    expect(ttml).toContain('A &amp; B')
    expect(ttml).toContain('甲 &amp; 乙')
  })
})
