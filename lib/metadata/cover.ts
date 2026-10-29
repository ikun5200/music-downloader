import { createHash } from 'crypto'

/**
 * 酷狗对没有专辑封面的文件 hash 会返回一张固定的黑胶占位图。
 * 这个 hash 对应的就是该占位图，必须拒绝，不能写进音乐文件。
 */
export const KUGOU_PLACEHOLDER_COVER_SHA256 =
  '609bab7f28b23df35bbd0be8dc28f057388d40f46594a9ec0d46546efbf625ea'

export function isPlaceholderCover(buffer: Buffer): boolean {
  if (!buffer.length) return false
  if (buffer.length !== 17853) return false
  return (
    createHash('sha256').update(buffer).digest('hex') ===
    KUGOU_PLACEHOLDER_COVER_SHA256
  )
}
