import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from '../lib/secrets'
import { extractJsonObject } from '../lib/ai/client'

describe('secret storage', () => {
  it('encrypts and decrypts a key', () => {
    const encrypted = encryptSecret('sk-test-123456')
    expect(encrypted).toMatch(/^enc:/)
    expect(encrypted).not.toContain('sk-test-123456')
    expect(decryptSecret(encrypted)).toBe('sk-test-123456')
  })

  it('returns empty string for tampered ciphertext', () => {
    const encrypted = encryptSecret('sk-test-123456')
    expect(decryptSecret(`${encrypted.slice(0, -2)}xx`)).toBe('')
  })

  it('keeps backward compatibility with plaintext values', () => {
    expect(decryptSecret('plain-key')).toBe('plain-key')
    expect(decryptSecret(null)).toBe('')
  })
})

describe('AI response parsing', () => {
  it('extracts a JSON object from fenced markdown', () => {
    expect(
      extractJsonObject('```json\n{"index": 2, "reason": "原版"}\n```')
    ).toEqual({ index: 2, reason: '原版' })
  })

  it('returns null for invalid JSON', () => {
    expect(extractJsonObject('没有 JSON')).toBeNull()
  })
})
