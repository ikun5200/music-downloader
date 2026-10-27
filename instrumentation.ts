/**
 * 服务启动钩子：容器重启后自动恢复下载/批量/元数据队列，
 * 不依赖用户先打开页面或发请求。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  try {
    const { bootstrap } = await import('./lib/bootstrap')
    await bootstrap()
  } catch (error) {
    console.error('[instrumentation] 启动队列失败:', error)
  }
}
