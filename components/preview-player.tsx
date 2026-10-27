'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { Loader2, Music2, Pause, Play, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { QUALITY_NAMES, type SearchSong } from '@/lib/constants'
import { cn, formatDuration } from '@/lib/utils'

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  return formatDuration(seconds)
}

export interface PreviewTrack {
  key: string
  title: string
  artist: string
  coverUrl?: string | null
  streamUrl: string
  quality: string
  channelName: string
  duration?: number | null
}

export function usePreviewPlayer(audioRef: RefObject<HTMLAudioElement | null>) {
  const [track, setTrack] = useState<PreviewTrack | null>(null)
  const [loadingKey, setLoadingKey] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const requestRef = useRef(0)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onTime = () => setCurrentTime(audio.currentTime || 0)
    const onMeta = () => {
      const value = Number(audio.duration)
      if (Number.isFinite(value) && value > 0) setDuration(value)
    }
    const onEnded = () => {
      setPlaying(false)
      setCurrentTime(0)
    }
    const onError = () => {
      setPlaying(false)
      // 关闭播放器时会先清空 src，这种情况不提示错误。
      if (!audio.getAttribute('src')) return
      toast.error('试听加载失败，链接可能已过期，请重新点击歌曲')
      setTrack(null)
      setDuration(0)
      setCurrentTime(0)
    }

    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
    }
  }, [audioRef])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !track) return
    audio.src = track.streamUrl
    audio.load()
    setCurrentTime(0)
    setDuration(track.duration || 0)
    const promise = audio.play()
    if (promise) promise.catch(() => setPlaying(false))
  }, [audioRef, track])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      audioRef.current?.pause()
    }
  }, [audioRef])

  const toggle = useCallback(
    async (song: SearchSong) => {
      const key = `${song.platform}:${song.id}`
      const audio = audioRef.current
      if (!audio) return
      if (loadingKey === key) return

      if (track?.key === key) {
        if (audio.paused) {
          try {
            await audio.play()
          } catch {
            toast.error('浏览器拦截了播放，请再点一次')
          }
        } else {
          audio.pause()
        }
        return
      }

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const requestId = ++requestRef.current
      setLoadingKey(key)
      audio.pause()

      try {
        const res = await fetch('/api/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: song.platform,
            musicInfo: song.musicInfo,
            title: song.title,
            artist: song.artist,
            coverUrl: song.coverUrl,
          }),
          signal: controller.signal,
        })
        const json = await res.json()
        if (!res.ok || json.code !== 0) throw new Error(json.message || '试听解析失败')
        if (controller.signal.aborted || requestRef.current !== requestId) return

        const data = json.data
        setTrack({
          key,
          title: data.title || song.title,
          artist: data.artist || song.artist,
          coverUrl: data.coverUrl || song.coverUrl,
          streamUrl: data.streamUrl,
          quality: data.quality,
          channelName: data.channel?.name || '',
          duration: data.duration || song.duration || null,
        })
      } catch (e) {
        if (controller.signal.aborted) return
        toast.error(e instanceof Error ? e.message : String(e))
      } finally {
        if (requestRef.current === requestId) setLoadingKey(null)
      }
    },
    [audioRef, loadingKey, track]
  )

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !track) return
    if (audio.paused) {
      void audio.play().catch(() => toast.error('浏览器拦截了播放，请再点一次'))
    } else {
      audio.pause()
    }
  }, [audioRef, track])

  const seek = useCallback(
    (value: number) => {
      const audio = audioRef.current
      if (!audio) return
      audio.currentTime = value
      setCurrentTime(value)
    },
    [audioRef]
  )

  const close = useCallback(() => {
    abortRef.current?.abort()
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    setTrack(null)
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setLoadingKey(null)
  }, [audioRef])

  return { track, loadingKey, playing, currentTime, duration, toggle, togglePlay, seek, close }
}

export type PreviewPlayer = ReturnType<typeof usePreviewPlayer>

export function PreviewBar({ player }: { player: PreviewPlayer }) {
  const { track, playing, currentTime, duration, togglePlay, seek, close } = player
  const [coverFailed, setCoverFailed] = useState(false)

  useEffect(() => {
    setCoverFailed(false)
  }, [track?.coverUrl])

  if (!track) return null

  const max = duration > 0 ? duration : track.duration || 0
  const progress = max > 0 ? Math.min(100, (currentTime / max) * 100) : 0

  return (
    <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-50 w-[min(760px,calc(100vw-1.5rem))] -translate-x-1/2">
      <div className="animate-slide-up flex items-center gap-3 rounded-2xl border border-white/[0.1] bg-[#111116]/95 px-3 py-2.5 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-xl">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-violet-500/25 to-cyan-400/15">
          {track.coverUrl && !coverFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={track.coverUrl}
              alt=""
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
              onError={() => setCoverFailed(true)}
              onLoad={(e) => {
                // 有些平台用 1x1 占位图代替“无封面”，同样回退到图标。
                if (e.currentTarget.naturalWidth < 2 || e.currentTarget.naturalHeight < 2) {
                  setCoverFailed(true)
                }
              }}
            />
          ) : (
            <Music2 className="h-4 w-4 text-violet-200/80" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-white/90">{track.title}</span>
            <Badge tone="violet" className="shrink-0">
              {QUALITY_NAMES[track.quality] || track.quality}
            </Badge>
          </div>
          <div className="truncate text-[11px] text-white/35">
            {track.artist}
            {track.channelName ? ` · ${track.channelName}` : ''}
          </div>

          <div className="mt-1.5 flex items-center gap-2">
            <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-white/30">
              {clock(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={max || 1}
              step={0.1}
              value={Math.min(currentTime, max || 1)}
              onChange={(e) => seek(Number(e.target.value))}
              disabled={!max}
              aria-label="试听进度"
              className="player-range min-w-0 flex-1"
              style={{ '--progress': `${progress}%` } as CSSProperties}
            />
            <span className="w-9 shrink-0 text-[10px] tabular-nums text-white/30">
              {clock(max)}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? '暂停试听' : '继续试听'}
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
            'bg-violet-500 text-white shadow-[0_6px_18px_rgba(139,92,246,0.35)] hover:bg-violet-400'
          )}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
        </button>

        <button
          type="button"
          onClick={close}
          aria-label="关闭试听"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/70"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
