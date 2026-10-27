'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  ArrowLeft,
  LayoutDashboard,
  Layers,
  LogOut,
  PlugZap,
  SlidersHorizontal,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const links = [
  { href: '/admin', label: '概览', icon: LayoutDashboard },
  { href: '/admin/sources', label: '音源渠道', icon: Layers },
  { href: '/admin/settings', label: '设置', icon: SlidersHorizontal },
  { href: '/admin/api', label: '洛雪 API', icon: PlugZap },
]

export function AdminNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)

  async function logout() {
    if (loggingOut) return
    setLoggingOut(true)
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-white/[0.07] bg-white/[0.02] p-1.5 lg:flex-col lg:overflow-visible">
        {links.map((link) => {
          const active =
            link.href === '/admin' ? pathname === '/admin' : pathname.startsWith(link.href)
          const Icon = link.icon
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[12.5px] font-medium transition-colors',
                active
                  ? 'bg-white/[0.09] text-white'
                  : 'text-white/45 hover:bg-white/[0.05] hover:text-white/85'
              )}
            >
              <Icon className="h-4 w-4" />
              {link.label}
            </Link>
          )
        })}
        <div className="my-1 hidden border-t border-white/[0.06] lg:block" />
        <Link
          href="/"
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[12.5px] font-medium text-white/40 transition-colors hover:bg-white/[0.05] hover:text-white/85"
        >
          <ArrowLeft className="h-4 w-4" /> 返回站点
        </Link>
        <button
          type="button"
          onClick={() => void logout()}
          disabled={loggingOut}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[12.5px] font-medium text-white/40 transition-colors hover:bg-red-500/10 hover:text-red-200"
        >
          <LogOut className="h-4 w-4" /> 退出登录
        </button>
      </nav>
    </aside>
  )
}
