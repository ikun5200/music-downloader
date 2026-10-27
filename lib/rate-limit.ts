type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()
let lastCleanup = Date.now()

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now()
  if (now - lastCleanup > 60_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
    lastCleanup = now
  }

  let bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs }
    buckets.set(key, bucket)
  }

  bucket.count++
  if (bucket.count > limit) {
    return { ok: false, remaining: 0, retryAfterMs: bucket.resetAt - now }
  }
  return { ok: true, remaining: limit - bucket.count, retryAfterMs: 0 }
}
