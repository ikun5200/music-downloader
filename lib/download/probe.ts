import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface AudioProbe {
  ok: boolean
  status?: number | null
  contentType?: string
  contentLength?: number | null
  contentRange?: string | null
  finalUrl?: string
  bytesRead?: number
  magic?: string
  isAudio?: boolean
  qualityHint?: string
  sampleRate?: number
  bitsPerRaw?: number
  bitRate?: number
  duration?: number
  note?: string
  error?: string
  elapsedMs?: number
}

const AUDIO_MAGICS = [
  'MP3 (ID3)',
  'MP3 (frame)',
  'FLAC',
  'OGG',
  'M4A/MP4',
  'WAV',
  'APE',
  'AAC (ADTS)',
]

export function detectMagic(buf: Buffer): string {
  if (!buf || buf.length === 0) return '空响应'
  const s = (start: number, end: number) => buf.subarray(start, end).toString('latin1')
  if (buf.length >= 3 && s(0, 3) === 'ID3') return 'MP3 (ID3)'
  if (buf.length >= 4 && s(0, 4) === 'fLaC') return 'FLAC'
  if (buf.length >= 4 && s(0, 4) === 'OggS') return 'OGG'
  if (buf.length >= 8 && s(4, 8) === 'ftyp') return 'M4A/MP4'
  if (buf.length >= 12 && s(0, 4) === 'RIFF' && s(8, 12) === 'WAVE') return 'WAV'
  if (buf.length >= 4 && s(0, 4) === 'MAC ') return 'APE'
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return 'AAC (ADTS)'
  if (buf.length >= 4 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'MP3 (frame)'
  const first = buf.subarray(0, 16).toString('utf8').trim()
  if (first.startsWith('{') || first.startsWith('[')) return 'JSON (非音频)'
  if (first.startsWith('<')) return 'HTML/XML (非音频)'
  return '未知'
}

export function isAudioMagic(magic: string): boolean {
  return AUDIO_MAGICS.includes(magic)
}


/**
 * 从 FLAC STREAMINFO 读取采样率/位深，可在只拉取前 128KB 时判断真实音质。
 * STREAMINFO 结构见 RFC 9639：magic(4) + block header(4) + 34 bytes。
 */
export function parseFlacStreamInfo(
  buf: Buffer
): { sampleRate?: number; bitsPerRaw?: number; duration?: number; qualityHint?: string } | null {
  if (buf.length < 42) return null
  const magicAt = buf.indexOf(Buffer.from('fLaC', 'latin1'))
  if (magicAt < 0) return null
  const start = magicAt + 4
  const header = buf.subarray(start, start + 4)
  if (header.length < 4) return null
  const type = header[0] & 0x7f
  const length = (header[1] << 16) | (header[2] << 8) | header[3]
  if (type !== 0 || length < 34) return null
  const data = buf.subarray(start + 4, start + 4 + 34)
  if (data.length < 34) return null
  const packed = data.readBigUInt64BE(10)
  const sampleRate = Number((packed >> 44n) & 0xfffffn)
  const bitsPerRaw = Number((packed >> 36n) & 0x1fn) + 1
  const totalSamples = packed & 0xfffffffffn
  if (!sampleRate || !bitsPerRaw) return null
  const qualityHint =
    bitsPerRaw >= 24 ? (sampleRate >= 96000 ? 'hires' : 'flac24bit') : 'flac'
  return {
    sampleRate,
    bitsPerRaw,
    duration: sampleRate ? Number(totalSamples) / sampleRate : undefined,
    qualityHint,
  }
}

const MPEG_BITRATES: Record<number, number[]> = {
  // MPEG1 Layer I
  1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  // MPEG1 Layer II
  2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  // MPEG1 Layer III
  3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  // MPEG2/2.5 Layer I
  4: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  // MPEG2/2.5 Layer II/III
  5: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}

interface Mp3Info {
  duration?: number
  sampleRate?: number
  bitRate?: number
  audioStart: number
}

/**
 * 从 MP3 帧头（以及 Xing/Info 帧）估算时长。
 * 试听只需要判断“是否明显比原曲长”，不追求精确到毫秒。
 */
export function parseMp3Info(buf: Buffer, totalBytes?: number | null): Mp3Info | null {
  if (buf.length < 4) return null
  let offset = 0
  if (buf.length >= 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    const size =
      ((buf[6] & 0x7f) << 21) |
      ((buf[7] & 0x7f) << 14) |
      ((buf[8] & 0x7f) << 7) |
      (buf[9] & 0x7f)
    offset = 10 + size
  }

  let frame = offset
  while (frame + 4 <= buf.length) {
    if (buf[frame] === 0xff && (buf[frame + 1] & 0xe0) === 0xe0) break
    frame++
  }
  if (frame + 4 > buf.length) return null

  const header = buf.readUInt32BE(frame)
  const versionBits = (header >> 19) & 3 // 3=MPEG1, 2=MPEG2, 0=MPEG2.5, 1=保留
  const layerBits = (header >> 17) & 3 // 3=Layer I, 2=Layer II, 1=Layer III
  const bitrateIndex = (header >> 12) & 0xf
  const sampleRateIndex = (header >> 10) & 3
  const padding = (header >> 9) & 1
  const channelMode = (header >> 6) & 3
  if (
    versionBits === 1 ||
    layerBits === 0 ||
    bitrateIndex === 0 ||
    bitrateIndex === 15 ||
    sampleRateIndex === 3
  ) {
    return null
  }

  const sampleRates =
    versionBits === 3
      ? [44100, 48000, 32000]
      : versionBits === 2
        ? [22050, 24000, 16000]
        : [11025, 12000, 8000]
  const sampleRate = sampleRates[sampleRateIndex]
  const tableKey = versionBits === 3 ? (4 - layerBits) : layerBits === 3 ? 4 : 5
  const bitRate = MPEG_BITRATES[tableKey][bitrateIndex] * 1000
  const layer = 4 - layerBits
  const samplesPerFrame =
    layer === 1 ? 384 : layer === 2 ? 1152 : versionBits === 3 ? 1152 : 576

  // Xing/Info 位于帧头 + side info 之后，可直接拿到总帧数（VBR 也准确）。
  const sideInfo = versionBits === 3 ? (channelMode === 3 ? 17 : 32) : channelMode === 3 ? 9 : 17
  const xingOffset = frame + 4 + sideInfo
  if (xingOffset + 12 <= buf.length) {
    const tag = buf.toString('latin1', xingOffset, xingOffset + 4)
    if (tag === 'Xing' || tag === 'Info') {
      const flags = buf.readUInt32BE(xingOffset + 4)
      if (flags & 1) {
        const frames = buf.readUInt32BE(xingOffset + 8)
        if (frames > 0) {
          return {
            duration: (frames * samplesPerFrame) / sampleRate,
            sampleRate,
            bitRate,
            audioStart: frame,
          }
        }
      }
    }
  }

  if (totalBytes && totalBytes > frame && bitRate > 0) {
    // 无 Xing 时按 CBR 估算；VBR 文件可能偏差，但足以识别 0.8x 这类慢放版本。
    const audioBytes = totalBytes - frame
    const frameLength =
      layer === 1
        ? Math.floor((12 * bitRate) / sampleRate + padding) * 4
        : Math.floor(((layer === 3 && versionBits !== 3 ? 72 : 144) * bitRate) / sampleRate + padding)
    if (frameLength > 0) {
      const frames = Math.floor(audioBytes / frameLength)
      return {
        duration: (frames * samplesPerFrame) / sampleRate,
        sampleRate,
        bitRate,
        audioStart: frame,
      }
    }
  }

  return { sampleRate, bitRate, audioStart: frame }
}

/** 从 MP4/M4A 的 mvhd box 读取时长；moov 不在前 128KB 时返回 null。 */
export function parseM4aDuration(buf: Buffer): number | undefined {
  const at = buf.indexOf(Buffer.from('mvhd', 'latin1'))
  if (at < 0 || at + 32 > buf.length) return undefined
  const version = buf[at + 4]
  if (version === 0) {
    const timescale = buf.readUInt32BE(at + 16)
    const duration = buf.readUInt32BE(at + 20)
    return timescale > 0 ? duration / timescale : undefined
  }
  if (at + 40 > buf.length) return undefined
  const timescale = buf.readUInt32BE(at + 24)
  const duration = Number(buf.readBigUInt64BE(at + 28))
  return timescale > 0 ? duration / timescale : undefined
}

export async function probeAudio(url: string, timeout = 20000): Promise<AudioProbe> {
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: '返回的不是合法 HTTP 链接', isAudio: false }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('probe timeout')), timeout)
  const started = Date.now()
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let buf = Buffer.alloc(0)

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: '*/*',
        Range: 'bytes=0-131071',
      },
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
    })

    const contentType = res.headers.get('content-type') || ''
    const contentLength = res.headers.get('content-length')
    const contentRange = res.headers.get('content-range')

    if (res.body) {
      reader = res.body.getReader()
      const chunks: Buffer[] = []
      let length = 0
      while (length < 131072) {
        const { value, done } = await reader.read()
        if (done) break
        const b = Buffer.from(value)
        chunks.push(b)
        length += b.length
      }
      buf = Buffer.concat(chunks).subarray(0, 131072)
    }

    const magic = detectMagic(buf)
    const isAudio = (res.status >= 200 && res.status < 400) && isAudioMagic(magic)
    const flac = magic === 'FLAC' ? parseFlacStreamInfo(buf) : null
    const rangeTotal = contentRange?.match(/\/(\d+)\s*$/)?.[1]
    // 206 且没有 Content-Range 时，Content-Length 只是分片长度，不能拿来估算总时长。
    const totalBytes = rangeTotal
      ? Number(rangeTotal)
      : res.status === 200 && contentLength
        ? Number(contentLength)
        : null
    const mp3 = magic.startsWith('MP3') ? parseMp3Info(buf, totalBytes) : null
    const m4aDuration = magic === 'M4A/MP4' ? parseM4aDuration(buf) : undefined
    const duration = flac?.duration ?? mp3?.duration ?? m4aDuration
    let note = ''
    if (res.status === 206 && isAudio) note = '支持 Range'
    else if (res.status === 200 && isAudio) note = '服务器返回完整响应'
    else if (res.status === 403) note = '链接拒绝访问'
    else if (res.status === 404) note = '链接 404'
    else if (res.status >= 500) note = '服务端错误'
    else if (!isAudio) note = `响应不是音频（${magic}）`

    return {
      ok: res.status >= 200 && res.status < 400,
      status: res.status,
      contentType,
      contentLength: contentLength ? Number(contentLength) : null,
      contentRange,
      finalUrl: res.url,
      bytesRead: buf.length,
      magic,
      isAudio,
      qualityHint: flac?.qualityHint,
      sampleRate: flac?.sampleRate ?? mp3?.sampleRate,
      bitsPerRaw: flac?.bitsPerRaw,
      bitRate: mp3?.bitRate,
      duration,
      note,
      elapsedMs: Date.now() - started,
    }
  } catch (e) {
    return {
      ok: false,
      status: null,
      error: `探测失败: ${e instanceof Error ? e.message : String(e)}`,
      bytesRead: buf.length,
      magic: detectMagic(buf),
      isAudio: false,
      elapsedMs: Date.now() - started,
    }
  } finally {
    clearTimeout(timer)
    if (reader) {
      try {
        await reader.cancel()
      } catch {
        // ignore
      }
    }
  }
}

export interface FileAudioInfo {
  ok: boolean
  codec?: string
  formatName?: string
  bitRate?: number
  sampleRate?: number
  channels?: number
  bitsPerRaw?: number
  duration?: number
  title?: string
  artist?: string
  album?: string
  lyrics?: string
  error?: string
}

export async function ffprobeFile(filePath: string): Promise<FileAudioInfo> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath],
      { timeout: 60000, maxBuffer: 8 * 1024 * 1024 }
    )
    const json = JSON.parse(stdout)
    const stream =
      (json.streams || []).find((s: any) => s.codec_type === 'audio') || json.streams?.[0] || {}
    const format = json.format || {}
    const tags = format.tags || {}
    return {
      ok: true,
      codec: stream.codec_name || undefined,
      formatName: format.format_name || undefined,
      bitRate: stream.bit_rate
        ? Number(stream.bit_rate)
        : format.bit_rate
          ? Number(format.bit_rate)
          : undefined,
      sampleRate: stream.sample_rate ? Number(stream.sample_rate) : undefined,
      channels: stream.channels ? Number(stream.channels) : undefined,
      bitsPerRaw: stream.bits_per_raw_sample
        ? Number(stream.bits_per_raw_sample)
        : stream.bits_per_sample
          ? Number(stream.bits_per_sample)
          : undefined,
      duration: format.duration ? Number(format.duration) : undefined,
      title: tags.title || tags.TITLE || undefined,
      artist: tags.artist || tags.ARTIST || tags.album_artist || undefined,
      album: tags.album || tags.ALBUM || undefined,
      lyrics:
        tags.lyrics ||
        tags.LYRICS ||
        tags.unsyncedlyrics ||
        tags.UNSYNCEDLYRICS ||
        undefined,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
