import { isGenericTitle, normalizeText } from '../utils'
import { actualQuality as deriveActualQuality, judgeQuality, type QualityVerdict } from './quality'
import { ffprobeFile, type FileAudioInfo } from './probe'

export interface ValidationInput {
  filePath: string
  expectedTitle: string
  expectedArtist: string
  expectedDuration?: number | null
  requestedQuality: string
  verifyWrongSong?: boolean
}

export interface ValidationResult {
  ok: boolean
  probe: FileAudioInfo
  actualQuality: string
  verdict: QualityVerdict
  verified: boolean
  reviewNote?: string
  reason?: string
}

export async function validateFile(input: ValidationInput): Promise<ValidationResult> {
  const probe = await ffprobeFile(input.filePath)
  if (!probe.ok) {
    return {
      ok: false,
      probe,
      actualQuality: 'unknown',
      verdict: 'unknown',
      verified: false,
      reason: `ffprobe 无法识别音频: ${probe.error || '未知错误'}`,
    }
  }

  const quality = deriveActualQuality(probe)
  const verdict = judgeQuality(input.requestedQuality, probe)

  const actualTitle = probe.title
  const actualArtist = probe.artist
  const wantTitle = normalizeText(input.expectedTitle)
  const wantArtist = normalizeText(input.expectedArtist)

  const titleMatch = !!(
    actualTitle &&
    wantTitle &&
    (normalizeText(actualTitle).includes(wantTitle) || wantTitle.includes(normalizeText(actualTitle)))
  )
  const artistMatch = !!(
    actualArtist &&
    wantArtist &&
    (normalizeText(actualArtist).includes(wantArtist) ||
      wantArtist.includes(normalizeText(actualArtist)))
  )
  const generic = !!actualTitle && isGenericTitle(actualTitle)

  const durationDelta =
    input.expectedDuration && probe.duration
      ? Math.abs(Number(probe.duration) - Number(input.expectedDuration))
      : null
  const durationTolerance = input.expectedDuration
    ? Math.max(20, Number(input.expectedDuration) * 0.2)
    : null
  const durationBad = durationDelta != null && durationTolerance != null && durationDelta > durationTolerance

  let wrong = false
  let wrongReason = ''
  if (input.verifyWrongSong !== false) {
    if (actualTitle && !generic && !titleMatch && actualArtist && !artistMatch) {
      wrong = true
      wrongReason = `错歌/占位音频（标签：${actualTitle} / ${actualArtist}）`
    } else if (durationBad && !titleMatch && !artistMatch) {
      wrong = true
      wrongReason = `错歌/占位音频（时长偏差 ${Math.round(durationDelta || 0)}s）`
    } else if (durationBad && (!actualTitle || !actualArtist)) {
      wrong = true
      wrongReason = `错歌/占位音频（缺少标签且时长偏差 ${Math.round(durationDelta || 0)}s）`
    }
  }

  if (wrong) {
    return {
      ok: false,
      probe,
      actualQuality: quality,
      verdict,
      verified: false,
      reason: wrongReason,
    }
  }

  const durationOk =
    durationDelta != null &&
    durationTolerance != null &&
    durationDelta <= Math.max(10, Number(input.expectedDuration) * 0.1)
  const verified = titleMatch || artistMatch || durationOk

  let reviewNote: string | undefined
  if (!actualTitle) reviewNote = '缺少标题标签，未做歌曲名核对'
  else if (!titleMatch && artistMatch) reviewNote = '标题标签不一致，按歌手/时长放行'
  if (!input.expectedDuration) reviewNote = reviewNote || '缺少期望时长，未做时长核对'
  else if (!probe.duration) reviewNote = reviewNote || '音频缺少时长信息'

  return {
    ok: true,
    probe,
    actualQuality: quality,
    verdict,
    verified,
    reviewNote,
  }
}
