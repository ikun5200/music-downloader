'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AudioLines, KeyRound, Loader2, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function LoginClient() {
  const router = useRouter()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '登录失败')
      router.push('/admin')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md items-center justify-center">
      <form onSubmit={submit} className="noise relative w-full rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-white/[0.02] p-7 shadow-soft">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400">
            <AudioLines className="h-5 w-5 text-white" />
          </span>
          <div>
            <div className="text-[15px] font-semibold text-white">管理员登录</div>
            <div className="text-[11px] text-white/35">声渡 Music Dock</div>
          </div>
        </div>

        <label className="mt-7 block text-[11px] font-medium uppercase tracking-wider text-white/35">
          管理员用户名
        </label>
        <div className="relative mt-2">
          <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="输入管理员用户名"
            className="pl-10"
            autoComplete="username"
            autoFocus
          />
        </div>

        <label className="mt-4 block text-[11px] font-medium uppercase tracking-wider text-white/35">
          管理密码
        </label>
        <div className="relative mt-2">
          <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="输入管理员密码"
            className="pl-10"
            autoComplete="current-password"
          />
        </div>

        {error ? (
          <div className="mt-3 rounded-lg border border-red-400/20 bg-red-500/[0.06] px-3 py-2 text-[12px] text-red-200">
            {error}
          </div>
        ) : null}

        <Button type="submit" className="mt-5 w-full" size="lg" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {loading ? '登录中…' : '登录'}
        </Button>
        <p className="mt-4 text-center text-[10.5px] leading-4 text-white/20">
          用户名/密码来自容器环境变量 ADMIN_USERNAME / ADMIN_PASSWORD。局域网 HTTP 部署请不要使用弱密码。
        </p>
      </form>
    </div>
  )
}
