import { NextResponse } from 'next/server'
import { ensureRuntime } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  // Docker healthcheck 每 30 秒请求一次，借此启动下载/批量/索引调度器；
  // 否则容器重启后如果没人访问页面，每日扫描不会启动。
  await ensureRuntime()
  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
    ffmpeg: process.env.FFMPEG_PATH || 'ffprobe',
  })
}
