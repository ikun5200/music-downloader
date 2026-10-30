import { describe, expect, it, vi } from 'vitest'
import {
  checkVersion,
  checkVersionAfterDownload,
  checkVersionBeforeDownload,
} from '../lib/ai/version-guard'
import type { AiConfig } from '../lib/settings'

const aiConfig: AiConfig = {
  enabled: true,
  baseUrl: 'https://api.example.com/v1',
  model: 'test-model',
  apiKey: 'test-key',
}

describe('version guard rules', () => {
  it('accepts a studio original when the request has no version', async () => {
    const result = await checkVersionBeforeDownload({
      title: '晴天',
      candidate: { title: '晴天', album: '叶惠美' },
      aiConfig,
    })
    expect(result.ok).toBe(true)
    expect(result.aiUsed).toBe(false)
  })

  it('rejects a live candidate when the request did not ask for live', async () => {
    const chat = vi.fn(async () => '{"ok":true,"reason":"AI 想放行"}')
    const result = await checkVersionBeforeDownload({
      title: '晴天',
      candidate: { title: '晴天 (Live)', album: '演唱会现场' },
      aiConfig,
      chat,
    })
    expect(result.ok).toBe(false)
    expect(result.ruleRejected).toBe(true)
    // 规则明确拒绝时不再调用 AI（AI 也不能推翻规则）。
    expect(chat).not.toHaveBeenCalled()
  })

  it('accepts a live candidate when the request explicitly asks for live', async () => {
    const chat = vi.fn(async () => '{"ok":true,"reason":"匹配现场版"}')
    const result = await checkVersionBeforeDownload({
      requestLine: '晴天 (Live)',
      title: '晴天',
      candidate: { title: '晴天 (Live)', album: '叶惠美 Live' },
      aiConfig,
      chat,
    })
    expect(result.ok).toBe(true)
    expect(result.aiUsed).toBe(true)
    expect(result.requestedVersion).toContain('live')
  })

  it('rejects a candidate that clearly conflicts with the requested version', async () => {
    const chat = vi.fn(async () => '{"ok":true,"reason":"AI 想放行"}')
    const result = await checkVersionBeforeDownload({
      requestLine: '晴天 现场版',
      title: '晴天',
      candidate: { title: '晴天 (Remix)', album: '叶惠美' },
      aiConfig,
      chat,
    })
    expect(result.ok).toBe(false)
    expect(result.ruleRejected).toBe(true)
  })

  it('lets a candidate without version tags pass when the source omits them', async () => {
    const chat = vi.fn(async () => '{"ok":true,"reason":"信息不足，放行"}')
    const result = await checkVersionBeforeDownload({
      requestLine: '晴天 现场版',
      title: '晴天',
      candidate: { title: '晴天', album: '叶惠美' },
      aiConfig,
      chat,
    })
    expect(result.ok).toBe(true)
    expect(result.aiUsed).toBe(true)
  })

  it('lets AI reject an ambiguous studio candidate', async () => {
    const chat = vi.fn(async () => '{"ok":false,"reason":"候选其实是电影主题曲版"}')
    const result = await checkVersionBeforeDownload({
      title: '晴天',
      candidate: { title: '晴天 (电影主题曲)', album: '叶惠美' },
      aiConfig,
      chat,
    })
    expect(result.ok).toBe(false)
    expect(result.aiUsed).toBe(true)
  })

  it('falls back to rules when AI fails', async () => {
    const chat = vi.fn(async () => {
      throw new Error('timeout')
    })
    const result = await checkVersionBeforeDownload({
      requestLine: '晴天（现场版）',
      title: '晴天',
      candidate: { title: '晴天（现场版）', album: '叶惠美 现场版' },
      aiConfig,
      chat,
    })
    expect(result.ok).toBe(true)
    expect(result.aiUsed).toBe(false)
  })
})

describe('post-download version check', () => {
  it('rejects a file whose embedded title is a live version', async () => {
    const chat = vi.fn(async () => '{"ok":true,"reason":"AI 想放行"}')
    const result = await checkVersionAfterDownload({
      title: '晴天',
      candidate: { title: '晴天 (Live)', album: '叶惠美' },
      aiConfig,
      chat,
    })
    expect(result.ok).toBe(false)
    expect(result.ruleRejected).toBe(true)
  })

  it('accepts a file with matching studio tags', async () => {
    const result = await checkVersionAfterDownload({
      title: '晴天',
      candidate: { title: '晴天', album: '叶惠美' },
      aiConfig,
    })
    expect(result.ok).toBe(true)
  })
})
