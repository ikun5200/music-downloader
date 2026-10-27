'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AudioLines, Download, Search, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const links = [
  { href: '/', label: '搜索', icon: Search },
  { href: '/downloads', label: '下载', icon: Download },
]

export function SiteHeader() {
  const pathname = usePathname()
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#08080a]/72 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400 shadow-[0_8px_24px_rgba(139,92,246,0.35)]">
            <AudioLines className="h-5 w-5 text-white" strokeWidth={2.2} />
          </span>
          <span className="leading-tight">
            <span className="block text-[15px] font-semibold tracking-tight text-white">
              声渡
            </span>
            <span className="block text-[9px] font-medium uppercase tracking-[0.22em] text-white/35">
              Music Dock
            </span>
          </span>
        </Link>

        <nav className="ml-2 flex items-center gap-1 sm:ml-6">
          {links.map((link) => {
            const active = pathname === link.href
            const Icon = link.icon
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'relative inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors',
                  active
                    ? 'bg-violet-500/[0.14] text-white'
                    : 'text-white/55 hover:bg-white/[0.05] hover:text-white/90'
                )}
              >
                <Icon className="h-4 w-4" />
                {link.label}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/admin"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-[13px] font-medium text-white/60 transition-colors hover:border-white/20 hover:text-white"
          >
            <Settings2 className="h-4 w-4" />
            <span className="hidden sm:inline">管理</span>
          </Link>
        </div>
      </div>
    </header>
  )
}
