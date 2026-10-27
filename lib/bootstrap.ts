import fs from 'fs/promises'
import path from 'path'
import { prisma } from './db'
import { ensureDownloadDirs } from './download/filename'
import { startQueue } from './download/queue'
import { startBatchQueue } from './batch/queue'
import { startMetadataQueue } from './metadata/queue'
import { claimQueueBoot } from './queue-boot'
import { defaultPlatformRank } from './sources/priority'
import { PLATFORMS } from './constants'

const globalForBootstrap = globalThis as unknown as { __mdBootstrap?: Promise<void> }

async function runBootstrap() {
  await ensureDirs()
  await prisma.$connect()
  // WAL 让读请求不必等待写入；busy_timeout 让写请求排队而不是直接报错。
  await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL').catch((e) => {
    console.error('[bootstrap] 启用 WAL 失败:', e)
  })
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout=15000').catch(() => {})
  await prisma.$queryRawUnsafe('PRAGMA synchronous=NORMAL').catch(() => {})
  await ensurePlatformPriority()
  // 每次进程启动只恢复一次中断任务；避免第二个路由上下文把运行中的任务重置。
  await claimQueueBoot()
  await startQueue()
  await startBatchQueue()
  await startMetadataQueue()
}

async function ensurePlatformPriority() {
  const existing = await prisma.setting.findUnique({ where: { key: 'platformPriority' } })
  if (existing) return

  const sources = await prisma.source.findMany({
    where: { enabled: true },
    orderBy: { priority: 'asc' },
  })
  if (!sources.length) return

  const map: Record<string, string[]> = {}
  for (const platform of PLATFORMS) {
    map[platform] = [...sources]
      .sort((a, b) => {
        const rankA = defaultPlatformRank(platform, a.name)
        const rankB = defaultPlatformRank(platform, b.name)
        if (rankA !== rankB) return rankA - rankB
        return a.priority - b.priority
      })
      .map((source) => source.id)
  }

  await prisma.setting.create({
    data: { key: 'platformPriority', value: JSON.stringify(map) },
  })
}

async function ensureDirs() {
  await fs.mkdir(path.join(process.cwd(), 'data', 'sources'), { recursive: true })
  await ensureDownloadDirs()
}

export function bootstrap(): Promise<void> {
  if (!globalForBootstrap.__mdBootstrap) {
    globalForBootstrap.__mdBootstrap = runBootstrap().catch((e) => {
      console.error('[bootstrap] 启动失败:', e)
      globalForBootstrap.__mdBootstrap = undefined
      throw e
    })
  }
  return globalForBootstrap.__mdBootstrap
}
