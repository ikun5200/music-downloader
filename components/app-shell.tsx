'use client'

import { usePathname } from 'next/navigation'
import { SiteHeader } from '@/components/site-header'

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  if (pathname?.startsWith('/online')) {
    return <>{children}</>
  }
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 sm:px-6">{children}</main>
      <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-center text-[11px] leading-5 text-white/25 sm:px-6">
        <p>声渡 Music Dock · 自托管音乐下载站</p>
        <p>请仅下载你有权使用的内容；音源接口由第三方提供，失效与版权风险请自行承担。</p>
      </footer>
    </>
  )
}
