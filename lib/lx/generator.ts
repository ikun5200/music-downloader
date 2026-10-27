import type { LxSources } from './manifest'

export function generateLxScript(baseUrl: string, token: string, sources: LxSources): string {
  const apiUrl = `${baseUrl.replace(/\/+$/, '')}/api/lx/resolve`
  return `/**
 * @name 飞牛音源下载站
 * @description 由飞牛音源下载站生成的洛雪兼容音源，自动选择可用渠道
 * @version 1.0.0
 * @author 飞牛音源下载站
 */

const { EVENT_NAMES, request, on, send } = globalThis.lx

const API_URL = ${JSON.stringify(apiUrl)}
const API_TOKEN = ${JSON.stringify(token)}
const SOURCES = ${JSON.stringify(sources, null, 2)}

const handleMusicUrl = ({ source, action, info }) => {
  if (action !== 'musicUrl') return Promise.reject(new Error('不支持的操作: ' + action))
  const payload = JSON.stringify({
    source,
    quality: info && info.type,
    musicInfo: info && info.musicInfo,
  })

  return new Promise((resolve, reject) => {
    request(
      API_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_TOKEN,
        },
        body: payload,
        timeout: 30000,
      },
      (err, resp) => {
        if (err) return reject(err)
        let data
        try {
          data = JSON.parse(resp.body)
        } catch (e) {
          return reject(new Error('响应不是有效 JSON'))
        }
        if (data && data.code === 0 && data.data && data.data.url) {
          return resolve(data.data.url)
        }
        reject(new Error((data && (data.message || data.error)) || '解析失败'))
      }
    )
  })
}

on(EVENT_NAMES.request, handleMusicUrl)
send(EVENT_NAMES.inited, { status: true, openDevTools: false, sources: SOURCES })
`
}
