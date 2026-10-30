import type { AiConfig } from '../settings'
import { chatCompletion, extractJsonObject } from './client'
import {
  detectCandidateLanguageTags,
  detectCandidateVersionTags,
  detectQueryLanguageTags,
  detectQueryVersionTags,
  type LanguageTag,
  type VersionTag,
} from '../version-intent'

export interface VersionCheckCandidate {
  title: string
  album?: string | null
  artist?: string | null
}

export interface VersionCheckResult {
  ok: boolean
  reason: string
  aiUsed: boolean
  ruleRejected: boolean
  requestedVersion: VersionTag[]
  requestedLanguage: LanguageTag[]
  candidateVersion: VersionTag[]
  candidateLanguage: LanguageTag[]
}

export interface VersionCheckOptions {
  /** 用户原始点歌行；没有时用 title + album 推断。 */
  requestLine?: string | null
  title: string
  album?: string | null
  candidate: VersionCheckCandidate
  aiConfig?: AiConfig | null
  aiEnabled?: boolean
  stage?: 'pre' | 'post'
  chat?: typeof chatCompletion
}

const CACHE_TTL = 12 * 60 * 60 * 1000
const CACHE_MAX = 500
const cache = new Map<string, { at: number; result: VersionCheckResult }>()

function cacheGet(key: string): VersionCheckResult | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(key)
    return null
  }
  return hit.result
}

function cacheSet(key: string, result: VersionCheckResult) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, { at: Date.now(), result })
}

function requestTags(options: VersionCheckOptions) {
  const line = String(options.requestLine || '').trim()
  const text = line || `${options.title} ${options.album || ''}`.trim()
  return {
    version: detectQueryVersionTags(text),
    language: detectQueryLanguageTags(text),
  }
}

function ruleResult(options: VersionCheckOptions): VersionCheckResult {
  const requested = requestTags(options)
  const candidateVersion = detectCandidateVersionTags(
    options.candidate.title,
    options.candidate.album
  )
  const candidateLanguage = detectCandidateLanguageTags(
    options.candidate.title,
    options.candidate.album
  )
  const hasRequest = requested.version.length > 0 || requested.language.length > 0
  let ok: boolean
  let reason = ''
  if (hasRequest) {
    // 用户点名了版本/语言：候选缺少版本信息时放行（交给 AI 复核），
    // 只有候选明确带有冲突标记时才由规则否决。否则很多源不写
    // “Live/伴奏”标签，会把正确的现场版/伴奏版误杀。
    const allowed = new Set(requested.version)
    if (allowed.has('instrumental')) {
      allowed.add('piano')
      allowed.add('guitar')
    }
    const versionConflicts = candidateVersion.filter((tag) => !allowed.has(tag))
    const languageConflicts =
      requested.language.length && candidateLanguage.length
        ? candidateLanguage.filter((tag) => !requested.language.includes(tag))
        : []
    ok = versionConflicts.length === 0 && languageConflicts.length === 0
    if (!ok) {
      reason = `候选版本与要求冲突（要求 ${[...requested.version, ...requested.language].join('/')}，实际 ${[...versionConflicts, ...languageConflicts].join('/')}）`
    }
  } else {
    ok = candidateVersion.length === 0
    if (!ok) reason = `未指定版本，但候选带有变体标记（${candidateVersion.join('/')}）`
  }
  return {
    ok,
    reason,
    aiUsed: false,
    ruleRejected: !ok,
    requestedVersion: requested.version,
    requestedLanguage: requested.language,
    candidateVersion,
    candidateLanguage,
  }
}

function shouldAskAi(result: VersionCheckResult, options: VersionCheckOptions): boolean {
  if (!options.aiConfig?.enabled || !options.aiConfig.apiKey || options.aiEnabled === false) {
    return false
  }
  // 规则已经明确拒绝时，AI 也不能推翻（见下方 ruleRejected 保护），
  // 再请求一次只会浪费 token，直接返回规则结论。
  if (result.ruleRejected) return false
  if (result.requestedVersion.length || result.requestedLanguage.length) return true
  if (result.candidateVersion.length || result.candidateLanguage.length) return true
  // 标题/专辑里出现模糊的版本词（如“版”“现场”“电影”）时让 AI 复核。
  return /(现场|演唱会|纯音乐|伴奏|钢琴|吉他|remix|cover|翻唱|live|version|demo|acoustic|电影|主题曲|片头曲|片尾曲|推广曲|ost)/i.test(
    `${options.title} ${options.album || ''} ${options.candidate.title} ${options.candidate.album || ''}`
  )
}

const SYSTEM_PROMPT = `你是音乐下载器的版本校验助手。只根据用户请求和候选标题/专辑文本判断，不要使用外部知识或猜测。

规则：
- 用户明确写了 Live/现场/演唱会/伴奏/纯音乐/钢琴/吉他/Remix/翻唱/不插电/Demo/粤语/国语/英文/日语/韩语 等，候选必须匹配；不匹配就拒绝。
- 用户没有写版本时，候选应是录音室原版；标题或专辑带 Live/现场/伴奏/纯音乐/钢琴/吉他/Remix/翻唱/Demo 等标记就拒绝。
- 只是歌名里含“演唱会/现场”等词、但专辑和版本信息看不出是现场版时，不要误判。
- 候选缺少版本信息、无法判断时，返回 ok=true，并在 reason 说明“信息不足，放行”。

只输出 JSON：{"ok": true/false, "reason": "简短中文理由"}。`

/**
 * 下载前（候选）或下载后（文件标签）的版本校验。
 * 规则先判；规则不确定时让 AI 复核；AI 失败/非法时回退规则，不阻塞下载。
 */
export async function checkVersion(
  options: VersionCheckOptions
): Promise<VersionCheckResult> {
  const fallback = ruleResult(options)
  if (!shouldAskAi(fallback, options)) return fallback

  const key = [
    options.stage || 'pre',
    options.requestLine || '',
    options.title,
    options.album || '',
    options.candidate.title,
    options.candidate.album || '',
  ].join('\u0000')
  const cached = cacheGet(key)
  if (cached) return cached

  try {
    const chat = options.chat || chatCompletion
    const reply = await chat(
      options.aiConfig!,
      [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            stage: options.stage || 'pre',
            requestLine: options.requestLine || '',
            requestedTitle: options.title,
            requestedAlbum: options.album || '',
            candidateTitle: options.candidate.title,
            candidateAlbum: options.candidate.album || '',
            ruleResult: {
              ok: fallback.ok,
              reason: fallback.reason,
              requestedVersion: fallback.requestedVersion,
              requestedLanguage: fallback.requestedLanguage,
              candidateVersion: fallback.candidateVersion,
              candidateLanguage: fallback.candidateLanguage,
            },
          }),
        },
      ],
      { timeoutMs: 12_000, maxTokens: 220 }
    )
    const parsed = extractJsonObject(reply)
    if (!parsed || typeof parsed.ok !== 'boolean') return fallback
    const result: VersionCheckResult = {
      ...fallback,
      ok: parsed.ok,
      reason: String(parsed.reason || '').slice(0, 240),
      aiUsed: true,
      // AI 只能补充/推翻规则，但不能把规则明确拒绝的变体放行。
      ruleRejected: fallback.ruleRejected,
    }
    if (fallback.ruleRejected && parsed.ok) {
      result.ok = false
      result.reason = fallback.reason || '规则判定版本不符'
    }
    cacheSet(key, result)
    return result
  } catch (error) {
    console.warn('[version-guard] AI 校验失败，回退规则:', error)
    return fallback
  }
}

/** 下载前：搜索结果候选。 */
export function checkVersionBeforeDownload(
  options: Omit<VersionCheckOptions, 'stage'>
): Promise<VersionCheckResult> {
  return checkVersion({ ...options, stage: 'pre' })
}

/** 下载后：文件内嵌标签。 */
export function checkVersionAfterDownload(
  options: Omit<VersionCheckOptions, 'stage'>
): Promise<VersionCheckResult> {
  return checkVersion({ ...options, stage: 'post' })
}
