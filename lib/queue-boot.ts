import { prisma } from './db'

const BOOT_KEY = 'queueBootId'

/**
 * 每个容器/进程启动时唯一。Docker 入口脚本会注入 QUEUE_BOOT_ID；
 * 本地直接运行时用 PID。同一进程的多个路由上下文共享这个值。
 */
export function queueBootId(): string {
  return process.env.QUEUE_BOOT_ID || `pid-${process.pid}`
}

/**
 * 只允许本次启动的第一个上下文恢复中断的任务。
 * 返回 true 表示本次调用完成了恢复；后续上下文返回 false，避免把
 * 正在运行的任务再次重置为 queued。
 */
export async function claimQueueBoot(): Promise<boolean> {
  const bootId = queueBootId()
  return prisma.$transaction(async (tx) => {
    const row = await tx.setting.findUnique({ where: { key: BOOT_KEY } })
    if (row?.value === bootId) return false

    await tx.setting.upsert({
      where: { key: BOOT_KEY },
      update: { value: bootId },
      create: { key: BOOT_KEY, value: bootId },
    })
    await tx.batchJob.updateMany({
      where: { status: 'running' },
      data: { status: 'queued' },
    })
    await tx.batchItem.updateMany({
      where: { status: 'searching' },
      data: { status: 'pending' },
    })
    await tx.downloadJob.updateMany({
      where: { status: { in: ['resolving', 'downloading'] } },
      data: { status: 'queued', startedAt: null },
    })
    return true
  })
}
