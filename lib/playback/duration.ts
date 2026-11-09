const DURATION_TOLERANCE_RATIO = 0.15
const DURATION_TOLERANCE_MIN = 10

/**
 * 0.8x 慢放、加速版、剪辑版与正式版的时长差异通常远超 15%。
 * 元数据里的时长本身可能差几秒，所以保留至少 10 秒容差。
 */
export function isDurationMismatch(
  expected?: number | null,
  actual?: number | null
): boolean {
  if (!expected || !actual || expected < 20 || actual < 20) return false
  return (
    Math.abs(expected - actual) >
    Math.max(DURATION_TOLERANCE_MIN, expected * DURATION_TOLERANCE_RATIO)
  )
}
