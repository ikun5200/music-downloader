export const METADATA_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

interface RequestOptions {
  headers?: Record<string, string>
  timeoutMs?: number
  retries?: number
}

async function request(url: string, options: RequestOptions = {}): Promise<Response> {
  const timeoutMs = options.timeoutMs || 15_000
  const retries = options.retries ?? 1
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('元数据请求超时')), timeoutMs)
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': METADATA_UA,
          Accept: '*/*',
          ...(options.headers || {}),
        },
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      return res
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
      }
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export async function fetchJson<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
  const res = await request(url, options)
  const text = await res.text()
  const trimmed = text.trim()
  if (!trimmed) throw new Error('元数据接口返回空内容')
  try {
    return JSON.parse(trimmed) as T
  } catch {
    // QQ 的旧歌词接口偶尔返回 JSONP：callback({...})
    const start = trimmed.indexOf('(')
    const end = trimmed.lastIndexOf(')')
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start + 1, end)) as T
    }
    throw new Error(`元数据接口返回非 JSON：${trimmed.slice(0, 120)}`)
  }
}

export async function fetchText(url: string, options: RequestOptions = {}): Promise<string> {
  const res = await request(url, options)
  return res.text()
}

export async function fetchImage(
  url: string,
  options: RequestOptions = {}
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const res = await request(url, { ...options, timeoutMs: options.timeoutMs || 20_000 })
    const contentType = res.headers.get('content-type') || ''
    const buffer = Buffer.from(await res.arrayBuffer())
    if (!buffer.length || buffer.length > 12 * 1024 * 1024) return null
    const isJpeg = buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    const isPng = buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    if (!isJpeg && !isPng) return null
    return { buffer, contentType }
  } catch {
    return null
  }
}
