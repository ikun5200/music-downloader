import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chatCompletion } from '../lib/ai/client'
import { cleanLyricsWithAi } from '../lib/metadata/lyrics-ai'

vi.mock('../lib/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/ai/client')>()
  return { ...actual, chatCompletion: vi.fn() }
})

const config = {
  enabled: true,
  baseUrl: 'http://ai.local/v1',
  model: 'test-model',
  apiKey: 'test-key',
}

const rawWithCredits = [
  '[00:00.00]作词 : 甲',
  '[00:01.00]作曲 : 乙',
  '[00:02.00]制作人 : 丙',
  '[00:03.00]韩红：风 让云长出花',
  '[00:04.00]无声开在乌云之下',
].join('\n')

describe('cleanLyricsWithAi', () => {
  beforeEach(() => {
    vi.mocked(chatCompletion).mockReset()
  })

  it('AI 未启用时直接使用规则清理，不发起请求', async () => {
    const result = await cleanLyricsWithAi(rawWithCredits, {
      title: '飞云之下',
      artist: '韩红',
      aiEnabled: false,
      aiConfig: config,
    })
    expect(result.aiUsed).toBe(false)
    expect(result.text).toBe(
      ['[00:03.00]韩红：风 让云长出花', '[00:04.00]无声开在乌云之下'].join('\n')
    )
    expect(chatCompletion).not.toHaveBeenCalled()
  })

  it('AI 返回第一句歌词行号后，删掉制作信息并保留演唱者前缀', async () => {
    vi.mocked(chatCompletion).mockResolvedValue('{"firstLyricLine":3}')
    const result = await cleanLyricsWithAi(rawWithCredits, {
      title: '飞云之下',
      artist: '韩红',
      aiEnabled: true,
      aiConfig: config,
    })
    expect(result.aiUsed).toBe(true)
    expect(result.text).toBe(
      ['[00:03.00]韩红：风 让云长出花', '[00:04.00]无声开在乌云之下'].join('\n')
    )
    expect(result.note).toContain('AI')
  })

  it('AI 判定第一行就是歌词时保留重复歌名', async () => {
    const raw = [
      '[00:02.44]我很想爱他',
      '[00:11.48]',
      '[00:32.48]天空 下起雨了',
    ].join('\n')
    vi.mocked(chatCompletion).mockResolvedValue('{"firstLyricLine":0}')
    const result = await cleanLyricsWithAi(raw, {
      title: '我很想爱他',
      artist: '林俊杰',
      aiEnabled: true,
      aiConfig: config,
    })
    expect(result.aiUsed).toBe(true)
    expect(result.text).toContain('[00:02.44]我很想爱他')
    expect(result.text).toContain('[00:32.48]天空 下起雨了')
  })

  it('AI 把“歌名 - 歌手”标题行当成歌词时回退规则', async () => {
    const raw = [
      '[00:00.00]珊瑚海 - 周杰伦/Lara梁心颐',
      '[00:13.12]男：',
      '[00:15.16]海平面远方开始阴霾',
    ].join('\n')
    vi.mocked(chatCompletion).mockResolvedValue('{"firstLyricLine":0}')
    const result = await cleanLyricsWithAi(raw, {
      title: '珊瑚海',
      artist: '周杰伦/Lara梁心颐',
      aiEnabled: true,
      aiConfig: config,
    })
    expect(result.aiUsed).toBe(false)
    expect(result.text).not.toContain('珊瑚海 - 周杰伦')
    expect(result.text).toContain('[00:13.12]男：')
  })

  it('AI 返回非法行号时回退规则清理', async () => {
    vi.mocked(chatCompletion).mockResolvedValue('{"firstLyricLine":99}')
    const result = await cleanLyricsWithAi(rawWithCredits, {
      title: '飞云之下',
      artist: '韩红',
      aiEnabled: true,
      aiConfig: config,
    })
    expect(result.aiUsed).toBe(false)
    expect(result.text).toContain('[00:03.00]韩红：风 让云长出花')
    expect(result.note).toContain('回退规则')
  })

  it('AI 结果丢失过多歌词时回退规则清理', async () => {
    const raw = [
      '[00:00.00]作词 : 甲',
      '[00:01.00]第一句',
      '[00:02.00]第二句',
      '[00:03.00]第三句',
      '[00:04.00]第四句',
      '[00:05.00]第五句',
      '[00:06.00]第六句',
      '[00:07.00]第七句',
      '[00:08.00]第八句',
    ].join('\n')
    vi.mocked(chatCompletion).mockResolvedValue('{"firstLyricLine":8}')
    const result = await cleanLyricsWithAi(raw, {
      title: '测试',
      artist: '歌手',
      aiEnabled: true,
      aiConfig: config,
    })
    expect(result.aiUsed).toBe(false)
    expect(result.text).toContain('[00:01.00]第一句')
    expect(result.note).toContain('丢失过多')
  })

  it('AI 请求失败时回退规则清理', async () => {
    vi.mocked(chatCompletion).mockRejectedValue(new Error('timeout'))
    const result = await cleanLyricsWithAi(rawWithCredits, {
      title: '飞云之下',
      artist: '韩红',
      aiEnabled: true,
      aiConfig: config,
    })
    expect(result.aiUsed).toBe(false)
    expect(result.text).toContain('韩红：')
    expect(result.note).toContain('timeout')
  })
})
