import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  fetchSourceScript,
  fileNameFromSourceUrl,
  normalizeSourceUrl,
  SourceImportError,
} from '../lib/sources/import-url'

const servers: Array<ReturnType<typeof createServer>> = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        })
    )
  )
})

describe('source URL import', () => {
  it('accepts http/https and rejects other schemes or credentials', () => {
    expect(normalizeSourceUrl('https://example.com/source.js').hostname).toBe('example.com')
    expect(() => normalizeSourceUrl('file:///etc/passwd')).toThrow(SourceImportError)
    expect(() => normalizeSourceUrl('not-a-url')).toThrow(SourceImportError)
    expect(() => normalizeSourceUrl('https://user:pass@example.com/source.js')).toThrow(
      SourceImportError
    )
  })

  it('derives a safe .js filename from the URL', () => {
    expect(fileNameFromSourceUrl(new URL('https://example.com/a/My%20Source.js'))).toBe(
      'My-Source.js'
    )
    expect(fileNameFromSourceUrl(new URL('https://example.com/source'))).toMatch(
      /^imported-\d+\.js$/
    )
  })

  it('downloads a valid LX script', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/javascript' })
      res.end('globalThis.lx = { name: "test", version: "1.0.0" }')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server address unavailable')

    const result = await fetchSourceScript(`http://127.0.0.1:${address.port}/source.js`)
    expect(result.code).toContain('globalThis.lx')
    expect(result.fileName).toBe('source.js')
  })

  it('rejects content that is not an LX script', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('console.log("not a source")')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server address unavailable')

    await expect(fetchSourceScript(`http://127.0.0.1:${address.port}/x.js`)).rejects.toThrow(
      '不是洛雪自定义源脚本'
    )
  })
})
