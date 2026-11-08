import type { Metadata } from 'next'
import { OnlineClient } from '@/components/online/online-client'
import { getAppleNewHome } from '@/lib/online/apple'

// 页面静态化，Apple 推荐每 6 小时由服务端在后台更新一次，不占用户请求时的资源。
export const revalidate = 21600

export const metadata: Metadata = {
  title: '新发现 · 声渡音乐',
  description: 'Apple Music 风格的在线音乐推荐与播放。',
}

export default async function OnlinePage() {
  const initial = await getAppleNewHome()
  return <OnlineClient initial={initial} />
}
