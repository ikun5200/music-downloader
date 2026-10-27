import { chatCompletion, extractJsonObject } from '../ai/client'
import type { AiConfig } from '../settings'
import type { MetadataCandidate, MetadataQuery, MetadataSourceId } from './types'

export interface AiMetadataPick {
  index: number
  reason: string
}

/**
 * 让 AI 在规则筛出的候选里选录音室原版。
 * 返回 index=-1 表示 AI 判断没有可信原版；抛异常表示 AI 不可用/返回异常，调用方应回退规则。
 */
export async function pickMetadataWithAi(
  query: MetadataQuery,
  candidates: MetadataCandidate[],
  order: MetadataSourceId[],
  config: AiConfig
): Promise<AiMetadataPick> {
  if (!candidates.length) return { index: -1, reason: '没有候选' }

  const payload = {
    song: {
      title: query.title,
      artist: query.artist,
      album: query.album || '',
      duration: query.duration || null,
    },
    sourcePriority: order,
    candidates: candidates.map((candidate, index) => ({
      index,
      source: candidate.source,
      title: candidate.title,
      artist: candidate.artist,
      album: candidate.album,
      date: candidate.date,
      duration: candidate.duration || null,
      variantFlags: candidate.variantFlags,
      ruleScore: candidate.score,
      reasons: candidate.reasons,
    })),
  }

  const reply = await chatCompletion(
    config,
    [
      {
        role: 'system',
        content:
          '你是音乐元数据匹配助手。根据下载的歌曲信息，从候选中选择同一首录音室原版。' +
          '必须排除翻唱、live/现场、remix、伴奏、纯音乐、DJ、片段、MV版、铃声等版本；' +
          '简体/繁体差异可以接受。选择顺序：先保证是同一首原版；如果有多个候选都正确，' +
          '选择 sourcePriority 更靠前的来源（例如 iTunes 在 QQ 音乐前面时优先 iTunes），' +
          '不要因为 1-2 秒的时长差就改选后面的来源；只有靠前来源是翻唱/变体/错误歌曲时，' +
          '才选后面的来源。如果候选里没有可信的原版，返回 index=-1。只返回 JSON，不要解释。',
      },
      {
        role: 'user',
        content:
          '请从下列候选中选择最匹配的原版，返回 {"index": 数字, "reason": "简短中文理由"}；' +
          '没有可信候选返回 {"index": -1, "reason": "原因"}。\n' +
          JSON.stringify(payload),
      },
    ],
    { timeoutMs: 20_000, maxTokens: 300 }
  )

  const parsed = extractJsonObject(reply)
  if (!parsed) throw new Error('AI 返回的不是 JSON 对象')
  const index = Number(parsed.index)
  if (!Number.isInteger(index) || index < -1 || index >= candidates.length) {
    throw new Error(`AI 返回的 index 无效：${String(parsed.index)}`)
  }
  return {
    index,
    reason: String(parsed.reason || '').slice(0, 200),
  }
}
