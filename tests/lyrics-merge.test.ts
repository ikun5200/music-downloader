import { describe, expect, it } from 'vitest'
import { mergeTranslatedLyrics } from '../lib/metadata/lyrics'

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
