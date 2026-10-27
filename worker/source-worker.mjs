import { parentPort } from 'node:worker_threads'
import vm from 'node:vm'
import nodeCrypto from 'node:crypto'
import nodeZlib from 'node:zlib'

const DEFAULT_TIMEOUT = 30000
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_LOG_LINES = 500

let requestHandler = null
let initedData = null
let resolveInit = null
let rejectInit = null
let initDone = false
const logs = []

function sendLog(level, args) {
  try {
    const text = args
      .map((a) => {
        if (typeof a === 'string') return a
        try {
          return JSON.stringify(a)
        } catch {
          return String(a)
        }
      })
      .join(' ')
      .slice(0, 2000)
    logs.push(`[${level}] ${text}`)
    if (logs.length > MAX_LOG_LINES) logs.shift()
    parentPort?.postMessage({ type: 'log', level, message: text })
  } catch {
    // ignore
  }
}

function parseHeader(code) {
  const comment = /^\s*\/\*[!*](?:.|\n)+?\*\//.exec(code)?.[0] || ''
  const get = (key) => new RegExp('\\*\\s*@' + key + '\\s+(.+)').exec(comment)?.[1]?.trim()
  return {
    name: get('name') || 'unknown',
    description: get('description') || '',
    version: get('version') || '',
    author: get('author') || '',
    homepage: get('homepage') || '',
    rawScript: code,
  }
}

function lxRequest(urlStr, options = {}, callback) {
  const controller = new AbortController()
  const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : DEFAULT_TIMEOUT
  const timer = setTimeout(() => controller.abort(new Error('request timeout')), timeout)

  const run = async () => {
    const method = String(options.method || 'GET').toUpperCase()
    const headers = { ...(options.headers || {}) }
    let body

    if (options.form != null) {
      body = new URLSearchParams(options.form).toString()
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
      }
    } else if (options.body != null) {
      body = options.body
    }

    const res = await fetch(urlStr, {
      method,
      headers,
      body,
      redirect: 'follow',
      signal: controller.signal,
    })

    const contentLength = Number(res.headers.get('content-length') || 0)
    if (contentLength > MAX_RESPONSE_BYTES) {
      throw new Error(`响应体过大（${contentLength} bytes）`)
    }

    const chunks = []
    let length = 0
    if (res.body) {
      const reader = res.body.getReader()
      while (length < MAX_RESPONSE_BYTES) {
        const { value, done } = await reader.read()
        if (done) break
        const buf = Buffer.from(value)
        chunks.push(buf)
        length += buf.length
      }
      try {
        await reader.cancel()
      } catch {
        // ignore
      }
    }

    const raw = Buffer.concat(chunks)
    const respHeaders = {}
    for (const [k, v] of res.headers.entries()) respHeaders[k] = v
    return {
      statusCode: res.status,
      statusMessage: res.statusText,
      headers: respHeaders,
      body: options.binary ? raw : raw.toString('utf8'),
      bytes: raw.length,
      finalUrl: res.url,
    }
  }

  run().then(
    (resp) => {
      clearTimeout(timer)
      try {
        callback(null, resp, resp.body)
      } catch (e) {
        sendLog('error', ['request callback error:', e?.message || e])
      }
    },
    (err) => {
      clearTimeout(timer)
      try {
        callback(err, null, null)
      } catch (e) {
        sendLog('error', ['request error callback:', e?.message || e])
      }
    }
  )

  return () => {
    clearTimeout(timer)
    controller.abort(new Error('request cancelled'))
  }
}

function createLx(code) {
  const lx = {
    version: '2.9.0',
    env: 'desktop',
    currentScriptInfo: parseHeader(code),
    EVENT_NAMES: { request: 'request', inited: 'inited', updateAlert: 'updateAlert' },
    on(eventName, handler) {
      if (eventName === 'request') requestHandler = handler
    },
    send(eventName, data) {
      if (eventName === 'inited') {
        if (data && data.status === false) {
          rejectInit?.(new Error(data.message || '音源初始化返回 status:false'))
          return
        }
        initedData = data
        if (!initDone) {
          initDone = true
          resolveInit?.(data)
        }
      } else if (eventName === 'updateAlert') {
        if (data?.log) sendLog('info', [`[updateAlert] ${data.log}`])
      }
    },
    request: lxRequest,
    utils: {
      buffer: {
        from: (...args) => Buffer.from(...args),
        bufToString: (buf, format) => Buffer.from(buf).toString(format || 'utf8'),
      },
      crypto: {
        md5: (str) => nodeCrypto.createHash('md5').update(str).digest('hex'),
        randomBytes: (size) => nodeCrypto.randomBytes(size),
        aesEncrypt: (buffer, mode, key, iv) =>
          new Promise((resolve, reject) => {
            try {
              const cipher = nodeCrypto.createCipheriv(mode, key, iv)
              resolve(Buffer.concat([cipher.update(buffer), cipher.final()]))
            } catch (e) {
              reject(e)
            }
          }),
        aesDecrypt: (buffer, mode, key, iv) =>
          new Promise((resolve, reject) => {
            try {
              const decipher = nodeCrypto.createDecipheriv(mode, key, iv)
              resolve(Buffer.concat([decipher.update(buffer), decipher.final()]))
            } catch (e) {
              try {
                const decipher = nodeCrypto.createDecipheriv(mode, key, iv)
                decipher.setAutoPadding(false)
                resolve(Buffer.concat([decipher.update(buffer), decipher.final()]))
              } catch {
                reject(e)
              }
            }
          }),
        rsaEncrypt: (buffer, key) =>
          new Promise((resolve, reject) => {
            try {
              resolve(
                nodeCrypto.publicEncrypt(
                  { key, padding: nodeCrypto.constants.RSA_PKCS1_PADDING },
                  buffer
                )
              )
            } catch (e) {
              reject(e)
            }
          }),
      },
      zlib: {
        inflate: (buf) =>
          new Promise((resolve, reject) =>
            nodeZlib.inflate(buf, (e, r) => (e ? reject(e) : resolve(r)))
          ),
        deflate: (buf) =>
          new Promise((resolve, reject) =>
            nodeZlib.deflate(buf, (e, r) => (e ? reject(e) : resolve(r)))
          ),
      },
    },
  }

  const sandbox = {
    lx,
    console: {
      log: (...a) => sendLog('log', a),
      info: (...a) => sendLog('info', a),
      warn: (...a) => sendLog('warn', a),
      error: (...a) => sendLog('error', a),
      debug: (...a) => sendLog('debug', a),
      group: (...a) => sendLog('log', a),
      groupCollapsed: (...a) => sendLog('log', a),
      groupEnd: () => {},
      table: (...a) => sendLog('log', a),
      time: () => {},
      timeEnd: () => {},
      trace: () => {},
      assert: () => {},
      count: () => {},
    },
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    crypto: nodeCrypto.webcrypto,
    performance,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    fetch: (...args) => fetch(...args),
    process: { env: {}, versions: process.versions, platform: process.platform },
    global: null,
    globalThis: null,
  }

  const context = vm.createContext(sandbox, { name: 'lx-source' })
  sandbox.global = context
  sandbox.globalThis = context
  return { lx, context }
}

async function initSource(code) {
  const { context } = createLx(code)
  const initPromise = new Promise((resolve, reject) => {
    resolveInit = resolve
    rejectInit = reject
  })

  try {
    vm.runInContext(code, context, { filename: 'source.js', timeout: 10000 })
  } catch (e) {
    throw new Error(`脚本执行失败: ${e?.message || e}`)
  }

  const result = await Promise.race([
    initPromise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('初始化超时（20s 内未收到 inited 事件）')), 20000)
    ),
  ])

  const sources = result?.sources || {}
  return {
    sources,
    name: result?.name || parseHeader(code).name,
    logs: logs.slice(-50),
  }
}

parentPort?.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return

  if (msg.type === 'init') {
    try {
      const result = await initSource(msg.code)
      parentPort.postMessage({ type: 'ready', ok: true, ...result })
    } catch (e) {
      parentPort.postMessage({ type: 'ready', ok: false, error: String(e?.message || e) })
    }
    return
  }

  if (msg.type === 'call') {
    if (!requestHandler) {
      parentPort.postMessage({
        type: 'result',
        id: msg.id,
        ok: false,
        error: '脚本未注册 request 处理器',
      })
      return
    }

    const timer = setTimeout(() => {
      parentPort.postMessage({ type: 'result', id: msg.id, ok: false, error: '解析超时（30s）' })
    }, 30000)

    try {
      const value = await Promise.resolve().then(() => requestHandler(msg.payload))
      clearTimeout(timer)
      parentPort.postMessage({ type: 'result', id: msg.id, ok: true, result: value })
    } catch (e) {
      clearTimeout(timer)
      parentPort.postMessage({
        type: 'result',
        id: msg.id,
        ok: false,
        error: String(e?.message || e),
      })
    }
    return
  }

  if (msg.type === 'dispose') {
    process.exit(0)
  }
})

process.on('unhandledRejection', (reason) => {
  sendLog('warn', ['unhandledRejection:', reason?.message || reason])
})
process.on('uncaughtException', (err) => {
  sendLog('error', ['uncaughtException:', err?.message || err])
})
