import { isAdmin } from '../auth'
import { getSettings } from '../settings'

/**
 * 游客下载开关打开时，只有管理员可以创建/重试下载任务。
 * 在线播放走独立接口，不受这里影响。
 */
export async function canCreateDownloads(): Promise<boolean> {
  const settings = await getSettings().catch(() => null)
  if (!settings?.guestDownloadDisabled) return true
  return isAdmin()
}

export function downloadForbiddenResponse() {
  return {
    code: 401,
    message: '游客下载已关闭，请登录管理员账号后再下载；当前可以继续在线试听。',
  }
}
