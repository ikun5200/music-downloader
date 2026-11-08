import type { Metadata } from 'next'
import { Toaster } from 'sonner'
import { AppShell } from '@/components/app-shell'
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
        <AppShell>{children}</AppShell>
        <Toaster theme="dark" position="top-center" richColors closeButton />
      </body>
    </html>
  )
}
