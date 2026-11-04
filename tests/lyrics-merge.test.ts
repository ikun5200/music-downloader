import { describe, expect, it } from 'vitest'
import { fromTtmlLyrics, isTtmlLyrics, mergeTranslatedLyrics } from '../lib/metadata/lyrics'

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

describe('Feiniu bilingual lyrics', () => {
  const ttml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<tt xmlns="http://www.w3.org/ns/ttml"><body><div>',
    '  <p begin="00:01.000" end="00:03.500">Hello world<span role="x-translation">你好世界</span></p>',
    '  <p begin="00:03.500" end="00:05.000">Goodbye</p>',
    '</div></body></tt>',
  ].join('\n')

  it('restores bilingual LRC from TTML x-translation', () => {
    expect(isTtmlLyrics(ttml)).toBe(true)
    expect(fromTtmlLyrics(ttml)).toBe(
      '[00:01.000]Hello world\n[00:01.000]你好世界\n[00:03.500]Goodbye'
    )
  })

  it('leaves ordinary TTML untouched when there is no translation', () => {
    const plain = '<tt><body><div><p begin="00:01.000">Hello</p></div></body></tt>'
    expect(fromTtmlLyrics(plain)).toBeNull()
  })

  it('decodes XML entities when restoring', () => {
    const escaped =
      '<tt><body><div><p begin="00:01.000">A &amp; B<span role="x-translation">甲 &amp; 乙</span></p></div></body></tt>'
    expect(fromTtmlLyrics(escaped)).toBe('[00:01.000]A & B\n[00:01.000]甲 & 乙')
  })
})
