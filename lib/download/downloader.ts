import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'

export interface DownloadOptions {
  signal?: AbortSignal
  maxBytes?: number
  timeoutMs?: number
  onProgress?: (bytesDone: number, bytesTotal: number | null) => void
}

export interface DownloadResult {
  bytes: number
  total: number | null
  contentType: string | null
  finalUrl: string
}

export async function downloadFile(
  url: string,
  dest: string,
  options: DownloadOptions = {}
): Promise<DownloadResult> {
  const maxBytes = options.maxBytes || 1024 * 1024 * 1024
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs || 15 * 60 * 1000)
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: '*/*',
    },
    redirect: 'follow',
    cache: 'no-store',
    signal,
  })

  if (!res.ok) throw new Error(`下载失败: HTTP ${res.status}`)
  const contentType = res.headers.get('content-type')
  if (contentType && /^(text\/html|application\/json|text\/plain)/i.test(contentType)) {
    throw new Error(`返回内容不是音频（${contentType}）`)
  }

  const contentLength = res.headers.get('content-length')
  const total = contentLength ? Number(contentLength) : null
  if (total && total > maxBytes) {
    throw new Error(`文件过大（${total} bytes，上限 ${maxBytes}）`)
  }
  if (!res.body) throw new Error('响应没有内容')

  await fsp.mkdir(path.dirname(dest), { recursive: true })
  const part = `${dest}.part`
  let bytesDone = 0
  let lastReport = 0

  const counter = new Transform({
    transform(chunk: Buffer, _enc, callback) {
      bytesDone += chunk.length
      if (bytesDone > maxBytes) {
        callback(new Error(`文件超过大小上限（${maxBytes} bytes）`))
        return
      }
      const now = Date.now()
      if (options.onProgress && now - lastReport > 700) {
        lastReport = now
        options.onProgress(bytesDone, total)
      }
      callback(null, chunk)
    },
  })

  try {
    await pipeline(
      Readable.fromWeb(res.body as any),
      counter,
      fs.createWriteStream(part, { flags: 'w' })
    )
    await fsp.rename(part, dest)
    options.onProgress?.(bytesDone, total || bytesDone)
    return { bytes: bytesDone, total: total || bytesDone, contentType, finalUrl: res.url }
  } catch (e) {
    await fsp.unlink(part).catch(() => {})
    throw e
  }
}
