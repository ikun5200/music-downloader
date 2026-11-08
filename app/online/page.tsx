import type { Metadata } from 'next'
import { OnlineClient } from '@/components/online/online-client'
import { getAppleNewHome } from '@/lib/online/apple'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '新发现 · 声渡音乐',
  description: 'Apple Music 风格的在线音乐推荐与播放。',
}

export default async function OnlinePage() {
  const initial = await getAppleNewHome()
  return <OnlineClient initial={initial} />
}
