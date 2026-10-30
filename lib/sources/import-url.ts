const MAX_SOURCE_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3
const REQUEST_TIMEOUT_MS = 20_000

export class SourceImportError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'SourceImportError'
    this.status = status
  }
}

export function normalizeSourceUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(String(input || '').trim())
  } catch {
    throw new SourceImportError('URL 格式不正确')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SourceImportError('只支持 http/https URL')
  }
  if (url.username || url.password) {
    throw new SourceImportError('URL 不能包含用户名或密码')
  }
  return url
}

export function fileNameFromSourceUrl(url: URL): string {
  let base = ''
  try {
    base = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '')
  } catch {
    base = ''
  }
  const safe = base
    .replace(/[^\w.\-\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-120)
  if (safe && safe.toLowerCase().endsWith('.js')) return safe
  return `imported-${Date.now()}.js`
}

async function readLimited(res: Response): Promise<string> {
  const length = Number(res.headers.get('content-length') || 0)
  if (Number.isFinite(length) && length > MAX_SOURCE_BYTES) {
    throw new SourceImportError('音源文件不能超过 2MB', 413)
  }
  if (!res.body) return ''

  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_SOURCE_BYTES) {
        await reader.cancel().catch(() => {})
        throw new SourceImportError('音源文件不能超过 2MB', 413)
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString('utf8')
}

export interface ImportedSourceScript {
  code: string
  fileName: string
  finalUrl: string
}

/**
 * 从远程 URL 拉取洛雪音源脚本。只允许 http/https，限制大小和重定向次数。
 * 该接口只对管理员开放；真正执行脚本仍然走现有的音源 worker 沙箱。
 */
export async function fetchSourceScript(input: string): Promise<ImportedSourceScript> {
  let current = normalizeSourceUrl(input)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('音源下载超时')), REQUEST_TIMEOUT_MS)

  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
      const res = await fetch(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Music-Downloader-Source-Importer/1.0',
          Accept: 'application/javascript,text/javascript,text/plain,*/*',
        },
      })

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) throw new SourceImportError('远程地址返回了空重定向')
        if (redirect === MAX_REDIRECTS) {
          throw new SourceImportError('重定向次数过多')
        }
        current = normalizeSourceUrl(new URL(location, current).toString())
        continue
      }

      if (!res.ok) {
        throw new SourceImportError(`下载音源失败：HTTP ${res.status}`, 502)
      }

      const code = await readLimited(res)
      if (!code.trim()) throw new SourceImportError('远程 URL 返回了空内容')
      if (!code.includes('globalThis.lx') && !code.includes("globalThis['lx']")) {
        throw new SourceImportError('这看起来不是洛雪自定义源脚本')
      }
      return {
        code,
        fileName: fileNameFromSourceUrl(current),
        finalUrl: current.toString(),
      }
    }
    throw new SourceImportError('重定向次数过多')
  } catch (error) {
    if (error instanceof SourceImportError) throw error
    if (controller.signal.aborted) {
      throw new SourceImportError('下载音源超时，请检查 URL 或稍后重试', 504)
    }
    throw new SourceImportError(
      `下载音源失败：${error instanceof Error ? error.message : String(error)}`,
      502
    )
  } finally {
    clearTimeout(timer)
  }
}
