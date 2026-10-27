import type { Platform } from '../constants'

/**
 * 仓库不再内置任何音源脚本或推荐名单。
 * 未在后台设置平台专属顺序时，按音源自身的全局 priority 排序。
 */
export function defaultPlatformRank(_platform: Platform, _name: string): number {
  return 0
}
