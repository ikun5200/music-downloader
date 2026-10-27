import type { Metadata } from 'next'
import { Toaster } from 'sonner'
import { SiteHeader } from '@/components/site-header'
import './globals.css'

export const metadata: Metadata = {
  title: '声渡 · 音乐下载站',
  description: '搜索、试听并下载全网音乐，自动选择最优音源渠道。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">
        <div className="pointer-events-none fixed inset-0 -z-10 noise" />
        <SiteHeader />
        <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 sm:px-6">{children}</main>
        <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-center text-[11px] leading-5 text-white/25 sm:px-6">
          <p>声渡 Music Dock · 自托管音乐下载站</p>
          <p>请仅下载你有权使用的内容；音源接口由第三方提供，失效与版权风险请自行承担。</p>
        </footer>
        <Toaster theme="dark" position="top-center" richColors closeButton />
      </body>
    </html>
  )
}
