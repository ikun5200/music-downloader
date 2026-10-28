import { describe, expect, it } from 'vitest'
import { selectBestSong, type PlatformInfo } from '../lib/batch/selector'
import type { Platform } from '../lib/constants'
import type { PlatformSearchResult, RawSearchSong } from '../lib/search/types'
import type { AiConfig } from '../lib/settings'

const info = new Map<Platform, PlatformInfo>(
  (['kw', 'kg', 'tx', 'wy', 'mg'] as Platform[]).map((platform) => [
    platform,
    { channels: 3, qualities: ['128k', '320k', 'flac'] },
  ])
)

function song(
  platform: Platform,
  title: string,
  artist: string,
  duration = 240,
  album = '专辑'
): RawSearchSong {
  return {
    platform,
    id: `${platform}:${title}:${artist}`,
    title,
    artist,
    album,
    duration,
    musicInfo: { source: platform, songmid: `${platform}-${title}`, name: title, singer: artist },
  }
}

function results(items: Array<[Platform, RawSearchSong[]]>): PlatformSearchResult[] {
  return items.map(([platform, list]) => ({ platform, results: list }))
}

const aiConfig: AiConfig = {
  enabled: true,
  baseUrl: 'https://example.com/v1',
  model: 'test-model',
  apiKey: 'test-key',
}

describe('batch song selector', () => {
  it('prefers the original over a compilation channel with artist names in the title', async () => {
    const selection = await selectBestSong(
      '手心的蔷薇 林俊杰 邓紫棋',
      results([
        [
          'kw',
          [
            song('kw', '手心的蔷薇-林俊杰/G.E.M 邓紫棋', '我的音乐调频', 260),
            song('kw', '手心的蔷薇 (cover: 林俊杰)', '某翻唱', 250),
          ],
        ],
        ['kg', [song('kg', '手心的蔷薇', '林俊杰/G.E.M. 邓紫棋', 260)]],
      ]),
      info,
      { aiConfig: null }
    )
    expect(selection.song.title).toBe('手心的蔷薇')
    expect(selection.song.artist).toContain('林俊杰')
    expect(selection.platform).toBe('kg')
    expect(selection.aiUsed).toBe(false)
  })

  it('rejects MV/首播 news entries', async () => {
    const selection = await selectBestSong(
      '黑夜问白天 林俊杰',
      results([
        ['kw', [song('kw', '林俊杰最新单曲《黑夜问白天》MV首播，为老林疯狂打call！', '林俊杰', 30)]],
        ['kg', [song('kg', '黑夜问白天', '林俊杰', 260)]],
      ]),
      info,
      { aiConfig: null }
    )
    expect(selection.song.title).toBe('黑夜问白天')
  })

  it('rejects medley/组曲 and 改编对唱 versions', async () => {
    const selection = await selectBestSong(
      '伟大的渺小 林俊杰',
      results([
        [
          'kw',
          [
            song('kw', 'JJ林俊杰《伟大的渺小 X 不为谁而作的歌》男女对唱改编！', '林俊杰', 300),
            song('kw', '他... 是JJ林俊杰... Love组曲-江南 + 害怕 + 小酒窝', '林俊杰', 500),
          ],
        ],
        ['kg', [song('kg', '伟大的渺小', '林俊杰', 280)]],
      ]),
      info,
      { aiConfig: null }
    )
    expect(selection.song.title).toBe('伟大的渺小')
  })

  it('rejects covers for a normal query', async () => {
    const selection = await selectBestSong(
      '孤勇者 陈奕迅',
      results([
        [
          'kw',
          [
            song('kw', '孤勇者 (cover: 陈奕迅)', '某翻唱', 250),
            song('kw', '孤勇者', '陈奕迅', 250),
          ],
        ],
      ]),
      info,
      { aiConfig: null }
    )
    expect(selection.song.title).toBe('孤勇者')
    expect(selection.song.artist).toBe('陈奕迅')
  })

  it('uses AI to choose among valid candidates and marks aiUsed', async () => {
    const selection = await selectBestSong(
      '晴天 周杰伦',
      results([
        ['kw', [song('kw', '晴天', '周杰伦', 269)]],
        ['tx', [song('tx', '晴天', '周杰伦', 269)]],
      ]),
      info,
      {
        aiConfig,
        aiChat: async () => JSON.stringify({ index: 1, reason: '选择 QQ 音乐原版' }),
      }
    )
    expect(selection.platform).toBe('tx')
    expect(selection.aiUsed).toBe(true)
    expect(selection.reason).toContain('AI')
  })

  it('falls back to deterministic ranking when AI returns invalid JSON', async () => {
    const selection = await selectBestSong(
      '晴天 周杰伦',
      results([['kw', [song('kw', '晴天', '周杰伦', 269)]]]),
      info,
      {
        aiConfig,
        aiChat: async () => '这不是 JSON',
      }
    )
    expect(selection.song.title).toBe('晴天')
    expect(selection.aiUsed).toBe(false)
  })

  it('respects an explicit AI rejection instead of forcing a variant', async () => {
    await expect(
      selectBestSong(
        '晴天 周杰伦',
        results([['kw', [song('kw', '晴天', '周杰伦', 269)]]]),
        info,
        {
          aiConfig,
          aiChat: async () => JSON.stringify({ index: -1, reason: '全部是变体' }),
        }
      )
    ).rejects.toThrow(/AI 判断没有原版/)
  })

  it('sends the full candidate list to AI when rules cannot match', async () => {
    const selection = await selectBestSong(
      '完全不存在的歌 某歌手',
      results([['kw', [song('kw', '别的歌', '别人', 200)]]]),
      info,
      {
        aiConfig,
        aiChat: async () => JSON.stringify({ index: 0, reason: 'AI 从完整列表中找到原版' }),
      }
    )
    expect(selection.song.title).toBe('别的歌')
    expect(selection.aiUsed).toBe(true)
    expect(selection.reason).toContain('AI')
  })

  it('uses AI to reconsider candidates rejected by the variant rules', async () => {
    const selection = await selectBestSong(
      '愿与愁 林俊杰',
      results([['kw', [song('kw', '愿与愁 (Live)', '林俊杰', 250)]]]),
      info,
      {
        aiConfig,
        aiChat: async () => JSON.stringify({ index: 0, reason: 'AI 判断这是可下载版本' }),
      }
    )
    expect(selection.song.title).toContain('愿与愁')
    expect(selection.aiUsed).toBe(true)
  })

  it('sends every raw candidate to AI, including ones outside the rule top list', async () => {
    const bad = Array.from({ length: 20 }, (_, index) =>
      song('kw', `K歌之王 版本${index + 1}`, '陈奕迅', 222, `合集${index + 1}`)
    )
    const original = song('kw', 'K歌之王 (粤语)', '陈奕迅', 222, '打得火热')
    let payload: any = null
    const selection = await selectBestSong(
      'K歌之王 陈奕迅',
      results([['kw', [...bad, original]]]),
      info,
      {
        aiConfig,
        aiChat: async (_config, messages) => {
          payload = JSON.parse(String(messages[messages.length - 1].content))
          const index = payload.candidates.findIndex(
            (candidate: any) => candidate.album === '打得火热'
          )
          return JSON.stringify({ index, reason: '选择《打得火热》原版' })
        },
      }
    )
    expect(payload.candidates).toHaveLength(21)
    expect(payload.candidates.some((candidate: any) => candidate.album === '打得火热')).toBe(true)
    expect(selection.song.album).toBe('打得火热')
    expect(selection.aiUsed).toBe(true)
  })

  it('prefers the configured platform order when scores are close', async () => {
    const orderedInfo = new Map(info)
    orderedInfo.set('kw', { ...info.get('kw')!, order: 1 })
    orderedInfo.set('tx', { ...info.get('tx')!, order: 0 })
    const selection = await selectBestSong(
      '晴天 周杰伦',
      results([
        ['kw', [song('kw', '晴天', '周杰伦', 269)]],
        ['tx', [song('tx', '晴天', '周杰伦', 269)]],
      ]),
      orderedInfo,
      { aiConfig: null }
    )
    expect(selection.platform).toBe('tx')
  })

  it('does not download when AI says there is no original', async () => {
    await expect(
      selectBestSong(
        '愿与愁 林俊杰',
        results([['kw', [song('kw', '愿与愁 (Live)', '林俊杰', 250)]]]),
        info,
        {
          aiConfig,
          aiChat: async () => JSON.stringify({ index: -1, reason: '只有现场版' }),
        }
      )
    ).rejects.toThrow(/AI 判断没有原版.*未下载/)
  })

  it('fails instead of downloading an unrelated song', async () => {
    await expect(
      selectBestSong(
        '完全不存在的歌 某歌手',
        results([['kw', [song('kw', '别的歌', '别人', 200)]]]),
        info,
        { aiConfig: null }
      )
    ).rejects.toThrow(/未下载/)
  })
})
