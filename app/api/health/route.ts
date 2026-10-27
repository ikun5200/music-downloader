import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
    ffmpeg: process.env.FFMPEG_PATH || 'ffprobe',
  })
}
