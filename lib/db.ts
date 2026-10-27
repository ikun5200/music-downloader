import { PrismaClient } from '@prisma/client'

// SQLite 只允许一个写入者。批量队列、下载队列和页面请求会同时写库，
// 默认连接池会让多个连接互相抢锁，表现为 “Socket timeout”。
// 统一收敛到单连接，并给锁等待留出足够时间。
const databaseUrl = process.env.DATABASE_URL
if (databaseUrl?.startsWith('file:') && !/[?&]connection_limit=/.test(databaseUrl)) {
  process.env.DATABASE_URL = `${databaseUrl}${databaseUrl.includes('?') ? '&' : '?'}connection_limit=1&socket_timeout=30`
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

function isTransientDbError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /Socket timeout|database is locked|SQLITE_BUSY|Timed out fetching a new connection|P1008|P2024/i.test(
    message
  )
}

/** 重试只读查询和幂等写入；不要用于带 increment 的事务。 */
export async function withDbRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!isTransientDbError(error) || attempt === attempts - 1) throw error
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)))
    }
  }
  throw lastError
}
