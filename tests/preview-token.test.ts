import { describe, expect, it } from 'vitest'
import { signPreviewToken, verifyPreviewToken } from '../lib/preview-token'

describe('preview token', () => {
  it('round-trips a signed source URL', () => {
    const token = signPreviewToken('https://example.com/song.mp3?x=1', 'kw')
    expect(verifyPreviewToken(token)).toEqual({
      url: 'https://example.com/song.mp3?x=1',
      platform: 'kw',
    })
  })

  it('rejects a tampered token', () => {
    const token = signPreviewToken('https://example.com/song.mp3', 'kw')
    const [payload, signature] = token.split('.')
    const tampered = `${payload.slice(0, -1)}A.${signature}`
    expect(verifyPreviewToken(tampered)).toBeNull()
  })

  it('rejects an invalid signature and malformed token', () => {
    expect(verifyPreviewToken('not-a-token')).toBeNull()
    expect(verifyPreviewToken('')).toBeNull()
    expect(
      verifyPreviewToken(signPreviewToken('https://example.com/song.mp3', 'kw').replace(/.$/, 'x'))
    ).toBeNull()
  })

  it('rejects non-http source URLs', () => {
    const token = signPreviewToken('file:///etc/passwd', 'kw')
    expect(verifyPreviewToken(token)).toBeNull()
  })
})
