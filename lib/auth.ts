import { createHash, randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { jwtVerify, SignJWT } from 'jose'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from './db'

const COOKIE_NAME = 'md_session'
const SESSION_TTL = '7d'

function secretKey(): Uint8Array {
  const configured = process.env.AUTH_SECRET
  if (process.env.NODE_ENV === 'production' && (!configured || configured.length < 32)) {
    throw new Error('AUTH_SECRET 未设置或长度不足 32 个字符')
  }
  const secret = configured || 'dev-secret-please-change-this-to-a-long-random-string'
  return new TextEncoder().encode(secret)
}

let cachedHash: string | null = null
let cachedPassword: string | null = null

async function adminPasswordHash(): Promise<string> {
  const configured = process.env.ADMIN_PASSWORD
  if (process.env.NODE_ENV === 'production') {
    if (!configured) throw new Error('ADMIN_PASSWORD 未设置')
    if (configured === 'admin123' || configured === 'change-me-please') {
      throw new Error('ADMIN_PASSWORD 不能使用默认值')
    }
  }
  const password = configured || 'admin123'
  if (cachedHash && cachedPassword === password) return cachedHash
  cachedPassword = password
  cachedHash = await bcrypt.hash(password, 10)
  return cachedHash
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  if (!password) return false
  const hash = await adminPasswordHash()
  return bcrypt.compare(password, hash)
}

export async function verifyAdminCredentials(
  username: string,
  password: string
): Promise<boolean> {
  const expected = process.env.ADMIN_USERNAME || 'admin'
  if (username !== expected) return false
  return verifyAdminPassword(password)
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(secretKey())
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
}

export async function clearSessionCookie() {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
}

export async function isAdmin(): Promise<boolean> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(COOKIE_NAME)?.value
    if (!token) return false
    await jwtVerify(token, secretKey())
    return true
  } catch {
    return false
  }
}

export async function requireAdminPage() {
  if (!(await isAdmin())) redirect('/login')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateApiToken(): { token: string; hash: string } {
  const token = `md_${randomBytes(24).toString('base64url')}`
  return { token, hash: hashToken(token) }
}

export function getTokenFromRequest(req: Request): string | null {
  const header = req.headers.get('x-api-key')
  if (header) return header.trim()
  const auth = req.headers.get('authorization')
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    if (token) return token.trim()
  } catch {
    // ignore
  }
  return null
}

export async function verifyApiToken(token: string): Promise<boolean> {
  if (!token) return false
  const hash = hashToken(token)
  const row = await prisma.apiToken.findUnique({ where: { tokenHash: hash } })
  if (!row || !row.enabled) return false
  await prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
  return true
}

export async function authenticateApiRequest(req: Request): Promise<boolean> {
  const token = getTokenFromRequest(req)
  if (!token) return false
  return verifyApiToken(token)
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'local'
}
