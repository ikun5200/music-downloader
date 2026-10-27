import path from 'path'
import { Worker } from 'worker_threads'

export interface SourceInitResult {
  ok: boolean
  sources?: Record<string, { name?: string; actions?: string[]; qualitys?: string[] }>
  name?: string
  logs?: string[]
  error?: string
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

export class SourceWorkerClient {
  readonly filePath: string
  private worker: Worker | null = null
  private pending = new Map<string, Pending>()
  private seq = 0
  private logs: string[] = []
  private disposed = false
  private readyPromise: Promise<SourceInitResult> | null = null
  private initResolve: ((r: SourceInitResult) => void) | null = null

  constructor(filePath: string) {
    this.filePath = filePath
  }

  getLogs(): string[] {
    return [...this.logs]
  }

  private spawn() {
    if (this.worker) return
    const workerPath = path.join(process.cwd(), 'worker', 'source-worker.mjs')
    this.worker = new Worker(workerPath, { workerData: {} })

    this.worker.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'log') {
        const line = `[${msg.level}] ${msg.message}`
        this.logs.push(line)
        if (this.logs.length > 200) this.logs.shift()
        return
      }
      if (msg.type === 'ready') {
        this.initResolve?.({
          ok: !!msg.ok,
          sources: msg.sources,
          name: msg.name,
          logs: msg.logs,
          error: msg.error,
        })
        this.initResolve = null
        return
      }
      if (msg.type === 'result') {
        const pending = this.pending.get(msg.id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(msg.id)
        if (msg.ok) pending.resolve(msg.result)
        else pending.reject(new Error(String(msg.error || '音源调用失败')))
      }
    })

    this.worker.on('error', (err) => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer)
        p.reject(new Error(`音源 worker 错误: ${err?.message || err}`))
      }
      this.pending.clear()
      this.initResolve?.({ ok: false, error: `worker 错误: ${err?.message || err}` })
      this.initResolve = null
    })

    this.worker.on('exit', (code) => {
      this.worker = null
      for (const p of this.pending.values()) {
        clearTimeout(p.timer)
        p.reject(new Error(`音源 worker 已退出（code ${code}）`))
      }
      this.pending.clear()
      this.initResolve?.({ ok: false, error: `worker 已退出（code ${code}）` })
      this.initResolve = null
    })
  }

  async init(code: string): Promise<SourceInitResult> {
    if (this.readyPromise) return this.readyPromise
    this.spawn()
    this.readyPromise = new Promise<SourceInitResult>((resolve) => {
      this.initResolve = resolve
      const timer = setTimeout(() => {
        this.initResolve = null
        resolve({ ok: false, error: '初始化超时（25s）' })
      }, 25000)
      const done = (r: SourceInitResult) => {
        clearTimeout(timer)
        resolve(r)
      }
      this.initResolve = done
      this.worker?.postMessage({ type: 'init', code })
    })
    return this.readyPromise
  }

  async call(payload: unknown, timeoutMs = 32000): Promise<unknown> {
    if (this.disposed) throw new Error('音源已释放')
    this.spawn()
    if (!this.worker) throw new Error('音源 worker 不可用')
    const id = `${Date.now()}-${++this.seq}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('音源解析超时（32s）'))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.worker?.postMessage({ type: 'call', id, payload })
    })
  }

  async dispose() {
    this.disposed = true
    try {
      this.worker?.postMessage({ type: 'dispose' })
    } catch {
      // ignore
    }
    const w = this.worker
    this.worker = null
    if (w) {
      try {
        await w.terminate()
      } catch {
        // ignore
      }
    }
  }
}
