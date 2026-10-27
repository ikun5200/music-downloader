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
      sampleRate: flac?.sampleRate,
      bitsPerRaw: flac?.bitsPerRaw,
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
