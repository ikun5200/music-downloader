'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  PlugZap,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

interface TokenDto {
  id: string
  name: string
  enabled: boolean
  lastUsedAt: string | null
  createdAt: string
}

export function LxApiPanel({
  publicBaseUrl,
  initialTokens,
}: {
  publicBaseUrl: string
  initialTokens: TokenDto[]
}) {
  const [tokens, setTokens] = useState<TokenDto[]>(initialTokens)
  const [selected, setSelected] = useState<string>(
    initialTokens.find((t) => t.enabled)?.id || initialTokens[0]?.id || ''
  )
  const [name, setName] = useState('洛雪音源')
  const [created, setCreated] = useState<{ id: string; token: string; name: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const selectedToken = useMemo(
    () => tokens.find((t) => t.id === selected) || null,
    [tokens, selected]
  )

  const base = publicBaseUrl.replace(/\/+$/, '')
  const tokenForUrl = created && selected === created.id ? created.token : null
  const scriptUrl = tokenForUrl
    ? `${base}/api/lx/source.js?token=${encodeURIComponent(tokenForUrl)}`
    : ''
  const manifestUrl = tokenForUrl
    ? `${base}/api/lx/manifest?token=${encodeURIComponent(tokenForUrl)}`
    : ''

  async function refresh() {
    const res = await fetch('/api/admin/tokens', { cache: 'no-store' })
    const json = await res.json()
    if (res.ok && json.code === 0) setTokens(json.data as TokenDto[])
  }

  async function createToken() {
    if (busy) return
    if (!name.trim()) {
      toast.error('请输入 Token 名称')
      return
    }
    setBusy('create')
    try {
      const res = await fetch('/api/admin/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '创建失败')
      setCreated({ id: json.data.id, token: json.data.token, name: json.data.name })
      setSelected(json.data.id)
      await refresh()
      toast.success('Token 已创建')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function toggleToken(token: TokenDto, enabled: boolean) {
    setBusy(`toggle:${token.id}`)
    try {
      const res = await fetch(`/api/admin/tokens/${token.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '更新失败')
      setTokens((prev) => prev.map((t) => (t.id === token.id ? { ...t, enabled } : t)))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function removeToken(token: TokenDto) {
    if (!window.confirm(`删除 Token「${token.name}」？已导入的洛雪源会立即失效。`)) return
    setBusy(`delete:${token.id}`)
    try {
      const res = await fetch(`/api/admin/tokens/${token.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '删除失败')
      setTokens((prev) => prev.filter((t) => t.id !== token.id))
      if (selected === token.id) setSelected('')
      toast.success('已删除')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('已复制')
    } catch {
      toast.error('复制失败，请手动选择文本')
    }
  }, [])

  const localhost = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(publicBaseUrl)

  return (
    <div className="animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">洛雪 API</h1>
          <p className="mt-1 text-[12px] text-white/35">
            生成可直接导入洛雪的自定义源脚本；解析请求会走本站的自动渠道选择。
          </p>
        </div>
        <Badge tone="violet">
          <PlugZap className="h-3 w-3" /> 洛雪兼容
        </Badge>
      </div>

      {localhost ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-500/[0.06] px-3.5 py-3 text-[11.5px] text-amber-200/80">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            当前对外地址是 <code>{publicBaseUrl}</code>。如果洛雪在另一台设备上，请在容器环境变量里把
            <code> PUBLIC_BASE_URL </code> 改成 NAS 的局域网地址（如 http://192.168.1.10:3000）。
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 lg:grid-cols-[1.25fr_1fr]">
        <div className="lift rounded-2xl border border-white/[0.06] bg-white/[0.022] p-5 hover:border-white/[0.1]">
          <div className="flex items-center gap-2 text-[12px] font-medium text-white/70">
            <KeyRound className="h-4 w-4 text-violet-300/60" /> 访问 Token
          </div>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Token 名称，例如：我的洛雪"
              className="h-9 text-[12px]"
            />
            <Button size="sm" onClick={() => void createToken()} disabled={busy === 'create'} className="shrink-0 whitespace-nowrap">
              {busy === 'create' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
              生成 Token
            </Button>
          </div>

          {created ? (
            <div className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-200">
                <Check className="h-3.5 w-3.5" /> Token 已生成（只显示这一次）
              </div>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-black/30 px-2 py-1.5 text-[10.5px] text-emerald-100/80">
                  {created.token}
                </code>
                <Button size="sm" variant="secondary" onClick={() => void copy(created.token)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ) : null}

          <div className="mt-4 space-y-2">
            {tokens.map((token) => (
              <div
                key={token.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
              >
                <button
                  type="button"
                  onClick={() => setSelected(token.id)}
                  className={`text-left ${selected === token.id ? 'text-violet-200' : 'text-white/70'}`}
                >
                  <div className="text-[12px] font-medium">{token.name}</div>
                  <div className="mt-0.5 text-[10px] text-white/25">
                    创建 {new Date(token.createdAt).toLocaleString('zh-CN', { hour12: false })}
                    {token.lastUsedAt
                      ? ` · 最近使用 ${new Date(token.lastUsedAt).toLocaleString('zh-CN', { hour12: false })}`
                      : ' · 未使用'}
                  </div>
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <Switch
                    checked={token.enabled}
                    onChange={(next) => void toggleToken(token, next)}
                    disabled={busy === `toggle:${token.id}`}
                    label="启用 Token"
                  />
                  <button
                    type="button"
                    onClick={() => void removeToken(token)}
                    disabled={busy === `delete:${token.id}`}
                    className="rounded p-1 text-white/25 hover:text-red-300"
                    title="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {!tokens.length ? (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-6 text-center text-[11px] text-white/25">
                还没有 Token，先生成一个
              </div>
            ) : null}
          </div>
        </div>

        <div className="lift rounded-2xl border border-white/[0.06] bg-white/[0.022] p-5 hover:border-white/[0.1]">
          <div className="text-[12px] font-medium text-white/70">导入到洛雪</div>
          <ol className="mt-3 list-decimal space-y-2 pl-4 text-[11.5px] leading-5 text-white/40">
            <li>在左侧生成一个 Token，并确保它是启用状态。</li>
            <li>复制下方的在线导入地址。</li>
            <li>洛雪 → 设置 → 音源 → 添加自定义源 → 在线导入，粘贴地址并启用。</li>
            <li>在洛雪搜索歌曲，播放时就会自动走本站的渠道选择。</li>
          </ol>

          <div className="mt-4">
            <div className="text-[10.5px] text-white/30">在线导入地址</div>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-2 text-[10.5px] leading-5 text-white/55">
                {tokenForUrl
                  ? scriptUrl
                  : selectedToken
                    ? '请在左侧重新生成 Token 以获取完整地址'
                    : '请选择或生成一个 Token'}
              </code>
              <Button
                size="sm"
                variant="secondary"
                disabled={!tokenForUrl}
                onClick={() => tokenForUrl && void copy(scriptUrl)}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="mt-1.5 text-[10px] leading-4 text-white/20">
              出于安全考虑，页面不会回显已保存的 Token 明文。生成新 Token 后，用上方显示的完整地址；
              旧 Token 仍然有效，但页面只能显示占位提示。
            </p>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {tokenForUrl ? (
              <a
                href={manifestUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 px-2.5 text-[11px] text-white/55 hover:text-white"
              >
                查看 manifest <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 text-[10.5px] leading-5 text-white/25">
        生成的脚本只包含本站地址与 Token，不包含任何音源脚本密钥。Token 泄露等同于把解析接口开放给他人，
        请定期轮换；不需要时直接禁用或删除。
      </div>
    </div>
  )
}
