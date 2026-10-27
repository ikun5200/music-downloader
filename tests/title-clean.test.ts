import { describe, expect, it, vi } from 'vitest'
import { cleanSongTitle } from '../lib/ai/title-clean'
import type { AiConfig } from '../lib/settings'

const config: AiConfig = {
  enabled: true,
  baseUrl: 'https://example.com/v1',
  model: 'test-model',
  apiKey: 'test-key',
  titleClean: true,
}

describe('AI title cleanup', () => {
  it('removes a theme-song suffix', async () => {
    const chat = vi.fn(async () => JSON.stringify({ title: '孤勇者' }))
    const title = await cleanSongTitle(
      '孤勇者 (动画《英雄联盟：双城之战》中文主题曲)',
      '陈奕迅',
      config,
      chat
    )
    expect(title).toBe('孤勇者')
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('does not call AI for a normal title', async () => {
    const chat = vi.fn(async () => JSON.stringify({ title: '晴天' }))
    const title = await cleanSongTitle('晴天', '周杰伦', config, chat)
    expect(title).toBe('晴天')
    expect(chat).not.toHaveBeenCalled()
  })

  it('keeps the original title when AI fails', async () => {
    const chat = vi.fn(async () => {
      throw new Error('timeout')
    })
    const title = await cleanSongTitle('小瓶子-电影印象曲', '林俊杰', config, chat)
    expect(title).toBe('小瓶子-电影印象曲')
  })

  it('rejects a rewritten unrelated title', async () => {
    const chat = vi.fn(async () => JSON.stringify({ title: '完全不同的歌' }))
    const title = await cleanSongTitle('小瓶子-电影印象曲', '林俊杰', config, chat)
    expect(title).toBe('小瓶子-电影印象曲')
  })

  it('respects the admin toggle', async () => {
    const chat = vi.fn(async () => JSON.stringify({ title: '小瓶子' }))
    const title = await cleanSongTitle('小瓶子-电影印象曲', '林俊杰', {
      ...config,
      titleClean: false,
    }, chat)
    expect(title).toBe('小瓶子-电影印象曲')
    expect(chat).not.toHaveBeenCalled()
  })
})
