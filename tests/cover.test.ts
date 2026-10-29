import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { isPlaceholderCover } from '../lib/metadata/cover'

describe('Kugou placeholder cover detection', () => {
  it('rejects the known Kugou vinyl placeholder', () => {
    const buffer = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'kugou-placeholder.jpg'))
    expect(isPlaceholderCover(buffer)).toBe(true)
  })

  it('accepts a normal image buffer', () => {
    expect(isPlaceholderCover(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe(false)
    expect(isPlaceholderCover(Buffer.alloc(0))).toBe(false)
  })
})
