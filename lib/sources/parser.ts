export interface ParsedSourceHeader {
  name: string
  version: string
  author: string
  description: string
  homepage: string
}

export function parseSourceHeader(code: string): ParsedSourceHeader {
  const comment = /^\s*\/\*[!*](?:.|\n)+?\*\//.exec(code)?.[0] || ''
  const get = (key: string) =>
    new RegExp(`\\*\\s*@${key}\\s+(.+)`).exec(comment)?.[1]?.trim() || ''
  return {
    name: get('name') || '未命名音源',
    version: get('version') || '',
    author: get('author') || '',
    description: get('description') || '',
    homepage: get('homepage') || '',
  }
}
