export const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'

export interface FetchOptions {
  headers?: Record<string, string>
  timeout?: number
  method?: string
  body?: BodyInit | null
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'User-Agent': DESKTOP_UA,
      Accept: '*/*',
      ...(options.headers || {}),
    },
    body: options.body ?? undefined,
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(options.timeout || 15000),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}`)
  }
  return text
}

export async function fetchJson<T = unknown>(
  url: string,
  options: FetchOptions = {}
): Promise<T> {
  const text = await fetchText(url, options)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`响应不是有效 JSON: ${url}`)
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  delays = [600, 1400]
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delays[Math.min(i, delays.length - 1)]))
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}
