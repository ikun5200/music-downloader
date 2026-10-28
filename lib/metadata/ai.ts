import { chatCompletion, extractJsonObject } from '../ai/client'
import { isCompilationAlbum } from './normalize'
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
    requestedVersion: query.versionTags || [],
    requestedLanguage: query.languageTags || [],
    candidates: candidates.map((candidate, index) => ({
      index,
      source: candidate.source,
      title: candidate.title,
      artist: candidate.artist,
      album: candidate.album,
      albumIsCompilation: isCompilationAlbum(candidate.album),
      date: candidate.date,
      duration: candidate.duration || null,
      variantFlags: candidate.variantFlags,
      versionTags: candidate.versionTags || [],
      languageTags: candidate.languageTags || [],
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
          '你是音乐元数据匹配助手。根据下载的歌曲信息，从候选中选择同一首歌。' +
          '先看 requestedVersion/requestedLanguage：如果不为空，必须选择对应版本或语言，' +
          '例如 requestedVersion 含 live 就选现场版，含 instrumental 就选伴奏/纯音乐版，含 piano 就选钢琴版；' +
          'requestedLanguage 含 cantonese 就选粤语版，含 mandarin 就选国语版，不要改选录音室原版。' +
          '如果 requestedVersion 和 requestedLanguage 都为空，才默认选择录音室原版，' +
          '并排除翻唱、live/现场、remix、伴奏、纯音乐、DJ、片段、MV版、铃声等版本。' +
          '候选是各平台的完整检索结果，可能包含规则未通过的结果。' +
          '注意专辑名里的“演唱会/Live/精选/合集/钢琴/伴奏/AIR/新版本”等也可能是变体。' +
          '简体/繁体差异可以接受。选择顺序：先保证是同一首歌且版本/语言匹配；' +
          '如果有多个候选都正确，优先选择正式录音室专辑，专辑名含精选、合集、作品集、Greatest Hits、Collection 等' +
          '通常是重新编排的合集，只有没有正式专辑候选时才选；' +
          '选择 sourcePriority 更靠前的来源，不要因为 1-2 秒的时长差就改选后面的来源。' +
          '如果候选里没有可信的目标版本，返回 index=-1。只返回 JSON，不要解释。',
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
