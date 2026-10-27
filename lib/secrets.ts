import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

function key(): Buffer {
  return createHash('sha256')
    .update(process.env.AUTH_SECRET || 'dev-secret-please-change-this-to-a-long-random-string')
    .digest()
}

/** 加密敏感配置（如 AI API Key），数据库里不保存明文。 */
export function encryptSecret(value: string): string {
  if (!value) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `enc:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`
}

export function decryptSecret(value: string | null | undefined): string {
  if (!value) return ''
  // 兼容早期可能写入的明文配置。
  if (!value.startsWith('enc:')) return value
  try {
    const [, iv, tag, data] = value.split(':')
    if (!iv || !tag || !data) return ''
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return ''
  }
}
