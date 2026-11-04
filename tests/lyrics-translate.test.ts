import { describe, expect, it, vi } from 'vitest'
import {
  shouldTranslateLyricsToChinese,
  translateLyricsToChinese,
} from '../lib/metadata/lyrics-translate'
import type { AiConfig } from '../lib/settings'

const aiConfig: AiConfig = {
  enabled: true,
  baseUrl: 'https://api.example.com/v1',
  model: 'test-model',
  apiKey: 'test-key',
}

describe('lyrics translation detection', () => {
  it('detects English, Japanese and Korean lyrics', () => {
    expect(
      shouldTranslateLyricsToChinese(
        '[00:01.00]This is a long English lyric line for testing translation'
      )
    ).toBe(true)
    expect(shouldTranslateLyricsToChinese('[00:01.00]こんにちは世界、今日も歌う')).toBe(true)
    expect(shouldTranslateLyricsToChinese('[00:01.00]안녕하세요 오늘도 노래해요')).toBe(true)
  })

  it('skips Chinese and already bilingual lyrics', () => {
    expect(shouldTranslateLyricsToChinese('[00:01.00]这是中文歌词，不需要翻译')).toBe(false)
    expect(
      shouldTranslateLyricsToChinese(
        '[00:01.00]This is a long English lyric line\n[00:01.00]这是一句很长的英文歌词'
      )
    ).toBe(false)
  })
})

describe('AI lyrics translation', () => {
  it('merges translated lines after the original timestamps', async () => {
    const chat = vi.fn(async () => JSON.stringify({
      translations: [
        { i: 0, text: '这是第一句英文歌词的翻译' },
        { i: 1, text: '这是第二句英文歌词的翻译' },
      ],
    }))
    const source =
      '[00:01.00]This is the first English lyric line\n[00:02.00]This is the second English lyric line'
    const result = await translateLyricsToChinese(source, {
      title: 'Test',
      artist: 'Tester',
      aiConfig,
      aiEnabled: true,
      chat,
    })
    expect(result.translatedLines).toBe(2)
    expect(result.text).toContain('[00:01.00]This is the first English lyric line')
    expect(result.text).toContain('[00:01.00]这是第一句英文歌词的翻译')
    expect(result.text).toContain('[00:02.00]这是第二句英文歌词的翻译')
  })

  it('keeps the original when AI returns invalid content', async () => {
    const chat = vi.fn(async () => 'not json')
    const source = '[00:01.00]This is a long English lyric line for testing translation'
    const result = await translateLyricsToChinese(source, {
      aiConfig,
      aiEnabled: true,
      chat,
    })
    expect(result.text).toBe(source)
    expect(result.translatedLines).toBe(0)
  })
})
