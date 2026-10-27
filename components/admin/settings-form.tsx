'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Layers,
  Loader2,
  Save,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { PLATFORMS, PLATFORM_NAMES, type Platform } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { AppSettings, QualityStrategy } from '@/lib/settings'

interface SourceOption {
  id: string
  name: string
  version: string | null
  enabled: boolean
  priority: number
  platforms: string[]
}

function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta
  if (target < 0 || target >= list.length) return list
  const next = [...list]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function SettingsForm({
  initial,
  downloadDir,
  publicBaseUrl,
}: {
  initial: AppSettings
  downloadDir: string
  publicBaseUrl: string
}) {
  const [strategy, setStrategy] = useState<QualityStrategy>(initial.qualityStrategy)
  const [maxConcurrent, setMaxConcurrent] = useState(String(initial.maxConcurrent))
  const [template, setTemplate] = useState(initial.filenameTemplate)
  const [maxSize, setMaxSize] = useState(String(initial.maxFileSizeMb))
  const [verify, setVerify] = useState(initial.verifyWrongSong)
  const [aiEnabled, setAiEnabled] = useState(initial.aiEnabled)
  const [aiBaseUrl, setAiBaseUrl] = useState(initial.aiBaseUrl)
  const [aiModel, setAiModel] = useState(initial.aiModel)
  const [aiApiKey, setAiApiKey] = useState('')
  const [keySet, setKeySet] = useState(initial.aiApiKeySet)
  const [testingAi, setTestingAi] = useState(false)
  const [clearingAi, setClearingAi] = useState(false)
  const [saving, setSaving] = useState(false)
  const [platformOrder, setPlatformOrder] = useState<Platform[]>(
    initial.platformOrder?.length ? initial.platformOrder : [...PLATFORMS]
  )
  const [sources, setSources] = useState<SourceOption[]>([])
  const [sourcePlatform, setSourcePlatform] = useState<Platform>('kw')
  const [sourceOrders, setSourceOrders] = useState<Record<string, string[]>>(
    initial.platformPriority || {}
  )
  const [sourceOrdersReady, setSourceOrdersReady] = useState(false)
  const platformOrderRef = useRef<Platform[]>(
    initial.platformOrder?.length ? initial.platformOrder : [...PLATFORMS]
  )
  const sourceOrdersRef = useRef<Record<string, string[]>>(
    initial.platformPriority || {}
  )

  useEffect(() => {
    fetch('/api/admin/sources', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (json.code === 0) setSources(json.data as SourceOption[])
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!sources.length || sourceOrdersReady) return
    const next: Record<string, string[]> = {}
    for (const platform of PLATFORMS) {
      const supported = sources.filter((source) => source.platforms.includes(platform))
      const saved = (initial.platformPriority?.[platform] || []).filter((id) =>
        supported.some((source) => source.id === id)
      )
      const rest = supported
        .filter((source) => !saved.includes(source.id))
        .sort((a, b) => a.priority - b.priority)
        .map((source) => source.id)
      next[platform] = [...saved, ...rest]
    }
    setSourceOrders(next)
    sourceOrdersRef.current = next
    setSourceOrdersReady(true)
  }, [initial.platformPriority, sourceOrdersReady, sources])

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qualityStrategy: strategy,
          maxConcurrent: Number(maxConcurrent),
          filenameTemplate: template,
          maxFileSizeMb: Number(maxSize),
          verifyWrongSong: verify,
          platformOrder: platformOrderRef.current,
          ...(Object.keys(sourceOrdersRef.current).length
            ? { platformPriority: sourceOrdersRef.current }
            : {}),
          aiEnabled,
          aiBaseUrl: aiBaseUrl.trim(),
          aiModel: aiModel.trim(),
          ...(aiApiKey.trim() ? { aiApiKey: aiApiKey.trim() } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '保存失败')
      if (aiApiKey.trim()) {
        setKeySet(true)
        setAiApiKey('')
      }
      toast.success('设置已保存')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function testAi() {
    if (testingAi) return
    setTestingAi(true)
    try {
      // 先保存当前 AI 字段，确保测试的是刚输入的地址/模型/Key，而不是旧配置。
      const saveRes = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiEnabled,
          aiBaseUrl: aiBaseUrl.trim(),
          aiModel: aiModel.trim(),
          ...(aiApiKey.trim() ? { aiApiKey: aiApiKey.trim() } : {}),
        }),
      })
      const saveJson = await saveRes.json()
      if (!saveRes.ok || saveJson.code !== 0) {
        throw new Error(saveJson.message || '保存 AI 设置失败')
      }
      if (aiApiKey.trim()) {
        setKeySet(true)
        setAiApiKey('')
      }

      const res = await fetch('/api/admin/ai/test', { method: 'POST' })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || 'AI 测试失败')
      toast.success('AI 连接成功', {
        description: `${json.data.model}：${String(json.data.reply).slice(0, 80)}`,
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setTestingAi(false)
    }
  }

  async function clearAiKey() {
    if (clearingAi) return
    if (!window.confirm('清除已保存的 AI API Key？清除后 AI 选版会停止工作。')) return
    setClearingAi(true)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiApiKey: '' }),
      })
      const json = await res.json()
      if (!res.ok || json.code !== 0) throw new Error(json.message || '清除失败')
      setKeySet(false)
      setAiApiKey('')
      toast.success('已清除 AI API Key')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setClearingAi(false)
    }
  }

  const platformSources = sources.filter((source) =>
    source.platforms.includes(sourcePlatform)
  )
  const currentSourceIds = sourceOrders[sourcePlatform] || []
  const orderedSources = [
    ...currentSourceIds
      .map((id) => platformSources.find((source) => source.id === id))
      .filter((source): source is SourceOption => !!source),
    ...platformSources
      .filter((source) => !currentSourceIds.includes(source.id))
      .sort((a, b) => a.priority - b.priority),
  ]

  function movePlatform(index: number, delta: number) {
    const next = moveItem(platformOrderRef.current, index, delta)
    platformOrderRef.current = next
    setPlatformOrder(next)
  }

  function moveSource(index: number, delta: number) {
    const saved = sourceOrdersRef.current[sourcePlatform] || []
    const valid = saved.filter((id) => platformSources.some((source) => source.id === id))
    const ids = [
      ...valid,
      ...platformSources
        .map((source) => source.id)
        .filter((id) => !valid.includes(id)),
    ]
    const next = moveItem(ids, index, delta)
    const nextOrders = { ...sourceOrdersRef.current, [sourcePlatform]: next }
    sourceOrdersRef.current = nextOrders
    setSourceOrders(nextOrders)
    setSourceOrdersReady(true)
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">设置</h1>
          <p className="mt-1 text-[12px] text-white/35">下载策略、平台与音源优先级、AI 选版。</p>
        </div>
        <Button size="sm" onClick={() => void save()} disabled={saving} className="shrink-0 whitespace-nowrap">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          保存设置
        </Button>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <div className="lift rounded-2xl border border-white/[0.06] bg-white/[0.022] p-5 hover:border-white/[0.1]">
          <div className="flex items-center gap-2 text-[12px] font-medium text-white/70">
            <SlidersHorizontal className="h-4 w-4 text-violet-300/60" /> 下载策略
          </div>

          <label className="mt-4 block text-[11px] text-white/35">音质策略</label>
          <Select
            className="mt-1.5 w-full"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as QualityStrategy)}
          >
            <option value="highest">最高可用 + 多渠道回退（推荐）</option>
            <option value="flacFirst">FLAC 优先，再降级</option>
            <option value="strict">严格最高档，失败即报错</option>
          </Select>
          <p className="mt-1.5 text-[10.5px] leading-4 text-white/25">
            自动模式会从母带/24bit 开始，逐档尝试；任何一个渠道能给出该档位就下载。
          </p>

          <label className="mt-4 block text-[11px] text-white/35">最大并发下载数</label>
          <Input
            className="mt-1.5"
            type="number"
            min={1}
            max={8}
            value={maxConcurrent}
            onChange={(e) => setMaxConcurrent(e.target.value)}
          />
          <p className="mt-1.5 text-[10.5px] leading-4 text-white/25">
            免费音源接口普遍有 QPS 限制，建议保持 1–2。
          </p>

          <div className="mt-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] text-white/55">错歌/占位音频校验</div>
              <div className="mt-0.5 text-[10.5px] leading-4 text-white/25">
                下载完成后比对标题、歌手与时长，命中则换渠道。
              </div>
            </div>
            <Switch checked={verify} onChange={setVerify} label="错歌校验" />
          </div>
        </div>

        <div className="lift rounded-2xl border border-white/[0.06] bg-white/[0.022] p-5 hover:border-white/[0.1]">
          <div className="text-[12px] font-medium text-white/70">文件与存储</div>

          <label className="mt-4 block text-[11px] text-white/35">命名模板</label>
          <Input
            className="mt-1.5 font-mono text-[12px]"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          />
          <p className="mt-1.5 text-[10.5px] leading-4 text-white/25">
            可用变量：{'{artist}'} {'{album}'} {'{title}'} {'{quality}'} {'{ext}'}；下载文件直接放在根目录，模板里的 / 会转成横线，不会创建子文件夹。
          </p>

          <label className="mt-4 block text-[11px] text-white/35">单文件大小上限（MB）</label>
          <Input
            className="mt-1.5"
            type="number"
            min={64}
            max={4096}
            value={maxSize}
            onChange={(e) => setMaxSize(e.target.value)}
          />

          <div className="mt-4 space-y-1.5 rounded-xl border border-white/[0.06] bg-black/20 p-3 text-[10.5px] text-white/35">
            <div>
              <span className="text-white/25">下载目录：</span>
              <code className="break-all text-white/55">{downloadDir}</code>
            </div>
            <div>
              <span className="text-white/25">对外地址：</span>
              <code className="break-all text-white/55">{publicBaseUrl}</code>
            </div>
            <div className="text-white/20">
              Docker 部署时用 volume 把 NAS 音乐目录挂到 /downloads。
            </div>
          </div>

          <Link
            href="/admin/api"
            className="mt-4 inline-flex h-8 items-center gap-1 rounded-lg border border-violet-400/25 bg-violet-500/10 px-2.5 text-[11px] text-violet-200 hover:bg-violet-500/20"
          >
            管理洛雪 API Token <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>

      <div className="mt-3 lift rounded-2xl border border-white/[0.06] bg-white/[0.022] p-5 hover:border-white/[0.1]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[12px] font-medium text-white/70">
            <Sparkles className="h-4 w-4 text-violet-300/60" /> AI 选版（OpenAI 兼容）
          </div>
          <Switch checked={aiEnabled} onChange={setAiEnabled} label="启用 AI 选版" />
        </div>
        <p className="mt-1.5 text-[10.5px] leading-4 text-white/25">
          批量任务会先把候选歌曲按规则过滤（排除翻唱/伴奏/live/组曲/MV首播/改编），再让 AI
          从候选中选择原版。AI 未配置、超时或返回异常时自动回退规则排序。
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-[11px] text-white/35">
            Base URL
            <Input
              className="mt-1.5 font-mono text-[11.5px]"
              value={aiBaseUrl}
              onChange={(e) => setAiBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
            />
          </label>
          <label className="block text-[11px] text-white/35">
            模型
            <Input
              className="mt-1.5 font-mono text-[11.5px]"
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              placeholder="gpt-4o-mini"
              spellCheck={false}
            />
          </label>
        </div>

        <label className="mt-3 block text-[11px] text-white/35">
          API Key
          <Input
            type="password"
            className="mt-1.5 font-mono text-[11.5px]"
            value={aiApiKey}
            onChange={(e) => setAiApiKey(e.target.value)}
            placeholder={keySet ? '已配置，留空保持不变' : 'sk-...'}
            autoComplete="new-password"
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void testAi()}
            disabled={testingAi || (!keySet && !aiApiKey.trim())}
            className="shrink-0 whitespace-nowrap"
          >
            {testingAi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            测试 AI
          </Button>
          {keySet ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void clearAiKey()}
              disabled={clearingAi}
              className="shrink-0 whitespace-nowrap"
            >
              {clearingAi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              清除 Key
            </Button>
          ) : null}
          <span className="text-[10.5px] text-white/25">
            Key 使用 AES-256-GCM 加密后保存在数据库；只支持 /chat/completions 格式。
          </span>
        </div>
      </div>

      <div className="mt-3 lift rounded-2xl border border-white/[0.06] bg-white/[0.022] p-5 hover:border-white/[0.1]">
        <div className="flex items-center gap-2 text-[12px] font-medium text-white/70">
          <Layers className="h-4 w-4 text-violet-300/60" /> 平台与音源优先级
        </div>
        <p className="mt-1 text-[10.5px] leading-4 text-white/25">
          平台优先级影响批量自动选版和搜索结果的平台顺序；音源优先级按平台分别设置，越靠前越优先。保存后立即生效。
        </p>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <div className="text-[11px] text-white/40">音乐平台优先级</div>
            <div className="mt-2 space-y-1">
              {platformOrder.map((platform, index) => (
                <div
                  key={platform}
                  className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-black/15 px-2.5 py-1.5"
                >
                  <span className="w-4 text-[10px] tabular-nums text-white/25">{index + 1}</span>
                  <span className="flex-1 text-[11.5px] text-white/70">
                    {PLATFORM_NAMES[platform]}
                  </span>
                  <button
                    type="button"
                    onClick={() => movePlatform(index, -1)}
                    disabled={index === 0}
                    aria-label={`上移 ${PLATFORM_NAMES[platform]}`}
                    className="rounded p-1 text-white/30 hover:bg-white/[0.06] hover:text-white/70 disabled:pointer-events-none disabled:opacity-20"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => movePlatform(index, 1)}
                    disabled={index === platformOrder.length - 1}
                    aria-label={`下移 ${PLATFORM_NAMES[platform]}`}
                    className="rounded p-1 text-white/30 hover:bg-white/[0.06] hover:text-white/70 disabled:pointer-events-none disabled:opacity-20"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-white/40">音源优先级</span>
              <span className="text-[9.5px] text-white/20">按平台设置</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {PLATFORMS.map((platform) => (
                <button
                  key={platform}
                  type="button"
                  onClick={() => setSourcePlatform(platform)}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                    sourcePlatform === platform
                      ? 'border-violet-400/30 bg-violet-500/15 text-violet-200'
                      : 'border-white/[0.08] bg-white/[0.02] text-white/35 hover:text-white/70'
                  )}
                >
                  {PLATFORM_NAMES[platform]}
                </button>
              ))}
            </div>
            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {orderedSources.length ? (
                orderedSources.map((source, index) => (
                  <div
                    key={source.id}
                    className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-black/15 px-2.5 py-1.5"
                  >
                    <span className="w-4 text-[10px] tabular-nums text-white/25">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] text-white/70">{source.name}</div>
                      <div className="truncate text-[9.5px] text-white/25">
                        {source.version || '未知版本'}
                        {source.enabled ? '' : ' · 已禁用'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => moveSource(index, -1)}
                      disabled={index === 0}
                      aria-label={`上移音源 ${source.name}`}
                      className="rounded p-1 text-white/30 hover:bg-white/[0.06] hover:text-white/70 disabled:pointer-events-none disabled:opacity-20"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSource(index, 1)}
                      disabled={index === orderedSources.length - 1}
                      aria-label={`下移音源 ${source.name}`}
                      className="rounded p-1 text-white/30 hover:bg-white/[0.06] hover:text-white/70 disabled:pointer-events-none disabled:opacity-20"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-white/[0.08] px-3 py-4 text-center text-[10.5px] text-white/25">
                  还没有支持 {PLATFORM_NAMES[sourcePlatform]} 的音源
                </div>
              )}
            </div>
            <Link
              href="/admin/sources"
              className="mt-2 inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 px-2.5 text-[11px] text-white/60 hover:text-white/90"
            >
              管理/上传音源 <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>

        <p className="mt-3 text-[10px] leading-4 text-white/20">
          音源渠道页的全局上移/下移会覆盖各平台顺序；这里保存的是各平台自己的顺序。禁用的音源不会参与自动选择。
        </p>
      </div>
    </div>
  )
}
