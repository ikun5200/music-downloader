'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ChevronRight,
  Disc3,
  ExternalLink,
  Headphones,
  Library,
  ListMusic,
  Loader2,
  Music2,
  Pause,
  Play,
  Radio,
  Search,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react'
import { cn, formatDuration } from '@/lib/utils'
import { getItunesAlbum, searchItunes } from '@/lib/online/itunes'
import type {
  OnlineCard,
  OnlineCollection,
  OnlineHome,
  OnlineSearchResult,
  OnlineSection,
  OnlineTrack,
} from '@/lib/online/types'

interface PlayResponse {
  streamUrl: string
  platform: string
  platformName: string
  quality: string
  channel: { id: string; name: string }
  title: string
  artist: string
  album?: string
  coverUrl?: string
  duration?: number
}

interface SiteConfig {
  guestDownloadDisabled: boolean
  isAdmin: boolean
}

interface LrcLine {
  time: number
  text: string
}

const QUALITY_OPTIONS = [
  { value: 'auto', label: '自动（最快）' },
  { value: '128k', label: '标准 128k' },
  { value: '320k', label: '高品质 320k' },
  { value: 'flac', label: '无损 FLAC' },
] as const

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  return formatDuration(seconds)
}

function cardToTrack(card: OnlineCard): OnlineTrack {
  return {
    id: card.id,
    title: card.title,
    artist: card.subtitle || '',
    artwork: card.artwork,
    duration: card.duration,
    appleId: card.appleId,
    url: card.url,
  }
}

function parseLyrics(raw: string): { synced: LrcLine[]; plain: string[] } {
  const text = String(raw || '').replace(/\r\n?/g, '\n').trim()
  if (!text) return { synced: [], plain: [] }
  const lines: LrcLine[] = []
  const plain: string[] = []
  for (const line of text.split('\n')) {
    const matches = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,2}))?\]/g)]
    const content = line
      .replace(/\[(?:ti|ar|al|by|offset|re|ve|length|kuwo|kugou|qq|music):[^\]]*\]/gi, '')
      .replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,2})?\]/g, '')
      .trim()
    if (!content) continue
    if (!matches.length) {
      plain.push(content)
      continue
    }
    for (const match of matches) {
      const minute = Number(match[1])
      const second = Number(match[2])
      const fraction = match[3] ? Number(`0.${match[3].padEnd(2, '0')}`) : 0
      lines.push({ time: minute * 60 + second + fraction, text: content })
    }
  }
  lines.sort((a, b) => a.time - b.time)
  return { synced: lines, plain }
}

function artworkStyle(artwork?: string) {
  return artwork
    ? { backgroundImage: `url("${artwork}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : undefined
}

function Artwork({
  artwork,
  title,
  className,
  rounded = 'rounded-xl',
}: {
  artwork?: string
  title: string
  className?: string
  rounded?: string
}) {
  const [failed, setFailed] = useState(false)
  return (
    <div
      className={cn(
        'relative overflow-hidden bg-gradient-to-br from-[#3a3a3c] via-[#242426] to-[#151517]',
        rounded,
        className
      )}
    >
      {artwork && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artwork}
          alt={title}
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Music2 className="h-8 w-8 text-white/25" />
        </div>
      )}
    </div>
  )
}

function SectionHeader({ title, href }: { title: string; href?: string }) {
  if (!title) return null
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-white sm:text-[23px]">
        {title}
      </h2>
      {href ? (
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-[12px] font-medium text-[#fa2d48] hover:text-[#ff5c70]"
        >
          查看全部 <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </div>
  )
}

function Card({
  item,
  onPlay,
  onOpen,
  index,
}: {
  item: OnlineCard
  onPlay: (item: OnlineCard) => void
  onOpen: (item: OnlineCard) => void
  index: number
}) {
  const isSong = item.kind === 'song'
  return (
    <div
      className={cn(
        'group relative w-[154px] shrink-0 cursor-pointer sm:w-[178px]',
        index === 0 && 'w-[178px] sm:w-[210px]'
      )}
      onClick={() => (isSong ? onPlay(item) : onOpen(item))}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          isSong ? onPlay(item) : onOpen(item)
        }
      }}
    >
      <div className="relative overflow-hidden rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-transform duration-300 group-hover:-translate-y-1">
        <Artwork artwork={item.artwork} title={item.title} className="aspect-square w-full" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            void (isSong ? onPlay(item) : onOpen(item))
          }}
          aria-label={isSong ? `播放 ${item.title}` : `打开 ${item.title}`}
          className="absolute bottom-2.5 right-2.5 flex h-9 w-9 translate-y-1 items-center justify-center rounded-full bg-[#fa2d48] text-white opacity-0 shadow-[0_6px_18px_rgba(250,45,72,0.45)] transition-all group-hover:translate-y-0 group-hover:opacity-100"
        >
          {isSong ? <Play className="ml-0.5 h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {item.kind === 'playlist' ? (
          <span className="absolute left-2.5 top-2.5 rounded-md bg-black/45 px-1.5 py-0.5 text-[9px] font-medium text-white/80 backdrop-blur">
            歌单
          </span>
        ) : null}
      </div>
      <div className="mt-2 min-w-0">
        <div className="truncate text-[12.5px] font-medium text-white/90">{item.title}</div>
        <div className="mt-0.5 truncate text-[11px] text-white/40">{item.subtitle || ' '}</div>
      </div>
    </div>
  )
}

function SectionShelf({
  section,
  onPlay,
  onOpen,
}: {
  section: OnlineSection
  onPlay: (item: OnlineCard) => void
  onOpen: (item: OnlineCard) => void
}) {
  if (!section.items.length) return null
  return (
    <section className="mt-9">
      <SectionHeader title={section.title} />
      <div className="scrollbar-none -mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
        {section.items.map((item, index) => (
          <Card key={`${section.id}-${item.id}`} item={item} onPlay={onPlay} onOpen={onOpen} index={index} />
        ))}
      </div>
    </section>
  )
}

function TrackRow({
  track,
  index,
  active,
  playing,
  onPlay,
}: {
  track: OnlineTrack
  index: number
  active: boolean
  playing: boolean
  onPlay: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPlay}
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
        active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]'
      )}
    >
      <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-white/30">
        {active && playing ? (
          <span className="inline-flex h-3 items-end gap-[2px]">
            <span className="eq-bar h-2 w-[2px] rounded-full bg-[#fa2d48]" />
            <span className="eq-bar h-3 w-[2px] rounded-full bg-[#fa2d48]" />
            <span className="eq-bar h-1.5 w-[2px] rounded-full bg-[#fa2d48]" />
          </span>
        ) : (
          index + 1
        )}
      </span>
      <Artwork artwork={track.artwork} title={track.title} className="h-9 w-9 shrink-0" rounded="rounded-md" />
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-[12.5px] font-medium', active ? 'text-[#fa2d48]' : 'text-white/85')}>
          {track.title}
        </div>
        <div className="truncate text-[10.5px] text-white/35">{track.artist}</div>
      </div>
      <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-white/25">
        {track.duration ? clock(track.duration) : ''}
      </span>
    </button>
  )
}

export function OnlineClient({ initial }: { initial: OnlineHome }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const lyricsRef = useRef<HTMLDivElement>(null)
  const [sections] = useState(initial.sections)
  const [site, setSite] = useState<SiteConfig | null>(null)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResult, setSearchResult] = useState<OnlineSearchResult | null>(null)
  const [searchError, setSearchError] = useState('')
  const [collection, setCollection] = useState<OnlineCollection | null>(null)
  const [collectionLoading, setCollectionLoading] = useState(false)
  const [collectionError, setCollectionError] = useState('')

  const [queue, setQueue] = useState<OnlineTrack[]>([])
  const [queueIndex, setQueueIndex] = useState(-1)
  const [current, setCurrent] = useState<OnlineTrack | null>(null)
  const [streamUrl, setStreamUrl] = useState('')
  const [loadingTrack, setLoadingTrack] = useState(false)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [quality, setQuality] = useState<(typeof QUALITY_OPTIONS)[number]['value']>('auto')
  const [actualQuality, setActualQuality] = useState('')
  const [sourceName, setSourceName] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [lyricsSource, setLyricsSource] = useState('')
  const [lyricsLoading, setLyricsLoading] = useState(false)
  const [playerOpen, setPlayerOpen] = useState(false)
  const [volume, setVolume] = useState(0.85)

  useEffect(() => {
    fetch('/api/site', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (json.code === 0) setSite(json.data as SiteConfig)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onPlay = () => {
      // 某些浏览器/扩展会沿用上一次的播放速率，强制回到原速。
      if (audio.playbackRate !== 1) audio.playbackRate = 1
      setPlaying(true)
    }
    const onPause = () => setPlaying(false)
    const onTime = () => setCurrentTime(audio.currentTime || 0)
    const onMeta = () => {
      const value = Number(audio.duration)
      if (Number.isFinite(value) && value > 0) setDuration(value)
    }
    const onEnded = () => {
      setPlaying(false)
      setCurrentTime(0)
      if (queueIndex >= 0 && queueIndex < queue.length - 1) {
        void playTrack(queue[queueIndex + 1], queue, undefined, queueIndex + 1)
      }
    }
    const onError = () => {
      setPlaying(false)
      if (!audio.getAttribute('src')) return
      setError('音频加载失败，请重试或换一首')
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
  }, [queue, queueIndex])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  const parsedLyrics = useMemo(() => parseLyrics(lyrics), [lyrics])
  const activeLyricIndex = useMemo(() => {
    if (!parsedLyrics.synced.length) return -1
    let active = -1
    for (let index = 0; index < parsedLyrics.synced.length; index++) {
      if (parsedLyrics.synced[index].time <= currentTime + 0.25) active = index
      else break
    }
    return active
  }, [parsedLyrics.synced, currentTime])

  useEffect(() => {
    if (activeLyricIndex < 0 || !lyricsRef.current) return
    const node = lyricsRef.current.querySelector<HTMLElement>(
      `[data-lyric-line="${activeLyricIndex}"]`
    )
    if (node) {
      node.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [activeLyricIndex, playerOpen])

  const loadLyrics = useCallback(async (track: OnlineTrack) => {
    setLyrics('')
    setLyricsSource('')
    setLyricsLoading(true)
    try {
      const res = await fetch('/api/online/lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: track.title,
          artist: track.artist,
          album: track.album || collection?.title || '',
          duration: track.duration || null,
        }),
      })
      const json = await res.json()
      if (res.ok && json.code === 0) {
        setLyrics(String(json.data.lyrics || ''))
        setLyricsSource(String(json.data.source || ''))
      }
    } catch {
      // 歌词失败不影响播放
    } finally {
      setLyricsLoading(false)
    }
  }, [collection?.title])

  const playTrack = useCallback(
    async (
      track: OnlineTrack,
      nextQueue?: OnlineTrack[],
      nextQuality?: (typeof QUALITY_OPTIONS)[number]['value'],
      nextIndex?: number,
      seekTo?: number
    ) => {
      const audio = audioRef.current
      if (!audio) return
      const useQuality = nextQuality || quality
      setLoadingTrack(true)
      setError('')
      try {
        const res = await fetch('/api/online/play', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: track.title,
            artist: track.artist,
            album: track.album || collection?.title || '',
            duration: track.duration || null,
            quality: useQuality,
          }),
        })
        const json = await res.json()
        if (!res.ok || json.code !== 0) throw new Error(json.message || '播放解析失败')
        const data = json.data as PlayResponse
        if (nextQueue) setQueue(nextQueue)
        if (typeof nextIndex === 'number') setQueueIndex(nextIndex)
        setCurrent({ ...track, artwork: track.artwork || data.coverUrl })
        setStreamUrl(data.streamUrl)
        setActualQuality(data.quality)
        setSourceName(data.platformName)
        setDuration(data.duration || track.duration || 0)
        audio.pause()
        audio.defaultPlaybackRate = 1
        audio.playbackRate = 1
        audio.preservesPitch = true
        audio.src = data.streamUrl
        audio.load()
        if (seekTo && Number.isFinite(seekTo)) {
          audio.currentTime = seekTo
        }
        await audio.play().catch(() => setError('浏览器拦截了播放，请再点一次播放'))
        void loadLyrics({ ...track, album: track.album || data.album })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoadingTrack(false)
      }
    },
    [collection?.title, loadLyrics, quality]
  )

  const changeQuality = useCallback(
    (value: (typeof QUALITY_OPTIONS)[number]['value']) => {
      setQuality(value)
      if (!current) return
      void playTrack(current, undefined, value, undefined, currentTime)
    },
    [current, currentTime, playTrack]
  )

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !current) return
    if (audio.paused) {
      void audio.play().catch(() => setError('浏览器拦截了播放，请再点一次播放'))
    } else {
      audio.pause()
    }
  }, [current])

  const playNext = useCallback(() => {
    if (!queue.length) return
    const next = Math.min(queue.length - 1, queueIndex + 1)
    if (next === queueIndex) return
    void playTrack(queue[next], queue, undefined, next)
  }, [playTrack, queue, queueIndex])

  const playPrevious = useCallback(() => {
    if (!queue.length) return
    const previous = Math.max(0, queueIndex - 1)
    if (previous === queueIndex) return
    void playTrack(queue[previous], queue, undefined, previous)
  }, [playTrack, queue, queueIndex])

  const playCard = useCallback(
    (card: OnlineCard) => {
      const tracks = card.kind === 'song' ? [cardToTrack(card)] : []
      void playTrack(cardToTrack(card), tracks.length ? tracks : undefined, undefined, 0)
    },
    [playTrack]
  )

  const openCollection = useCallback(async (card: OnlineCard) => {
    if (!card.url) {
      if (card.url) window.open(card.url, '_blank', 'noopener,noreferrer')
      return
    }
    setCollectionLoading(true)
    setCollectionError('')
    setCollection(null)
    try {
      // 专辑直接由浏览器请求 Apple（CORS 允许）；歌单仍用服务端解析。
      if (card.kind === 'album' && card.appleId) {
        const album = await getItunesAlbum(card.appleId)
        if (!album) throw new Error('没有读取到专辑曲目')
        setCollection(album)
      } else {
        const res = await fetch(`/api/online/collection?url=${encodeURIComponent(card.url)}`)
        const json = await res.json()
        if (!res.ok || json.code !== 0) throw new Error(json.message || '加载失败')
        setCollection(json.data as OnlineCollection)
      }
    } catch (e) {
      setCollectionError(e instanceof Error ? e.message : String(e))
    } finally {
      setCollectionLoading(false)
    }
  }, [])

  const submitSearch = useCallback(async (event?: React.FormEvent) => {
    event?.preventDefault()
    const value = query.trim()
    if (!value || searching) return
    setSearching(true)
    setSearchError('')
    setSearchResult(null)
    try {
      // 浏览器直接请求 Apple iTunes Search，不经过 NAS；失败再回退服务端。
      try {
        setSearchResult(await searchItunes(value))
      } catch {
        const res = await fetch(`/api/online/search?q=${encodeURIComponent(value)}`)
        const json = await res.json()
        if (!res.ok || json.code !== 0) throw new Error(json.message || '搜索失败')
        setSearchResult(json.data as OnlineSearchResult)
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e))
    } finally {
      setSearching(false)
    }
  }, [query, searching])

  const hero = sections.find((section) => section.kind === 'flowcaseLockup') || sections[0]
  const restSections = sections.filter((section) => section !== hero)

  return (
    <div className="min-h-screen bg-[#0b0b0d] text-white">
      <audio ref={audioRef} preload="metadata" className="hidden" />

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[236px] flex-col border-r border-white/[0.06] bg-[#070708]/95 px-4 py-5 backdrop-blur-xl lg:flex">
        <Link href="/online" className="flex items-center gap-2.5 px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#fa2d48]">
            <Headphones className="h-5 w-5 text-white" />
          </span>
          <span>
            <span className="block text-[15px] font-semibold tracking-tight">声渡音乐</span>
            <span className="block text-[9px] uppercase tracking-[0.2em] text-white/30">Music Online</span>
          </span>
        </Link>

        <nav className="mt-9 space-y-1">
          {[
            { label: '新发现', icon: Sparkles, active: true, onClick: () => setSearchResult(null) },
            { label: '搜索', icon: Search, onClick: () => document.getElementById('online-search')?.focus() },
            { label: '下载站', icon: Library, href: '/downloads' },
          ].map((item) => {
            const Icon = item.icon
            const content = (
              <>
                <Icon className="h-4 w-4" />
                {item.label}
              </>
            )
            return item.href ? (
              <Link
                key={item.label}
                href={item.href}
                className="flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13px] text-white/55 transition-colors hover:bg-white/[0.05] hover:text-white"
              >
                {content}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                onClick={item.onClick}
                className={cn(
                  'flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[13px] transition-colors',
                  item.active
                    ? 'bg-white/[0.08] font-medium text-white'
                    : 'text-white/55 hover:bg-white/[0.05] hover:text-white'
                )}
              >
                {content}
              </button>
            )
          })}
        </nav>

        <div className="mt-8">
          <div className="px-3 text-[10px] font-medium uppercase tracking-[0.18em] text-white/25">
            播放列表
          </div>
          <div className="mt-2 space-y-1">
            {[
              { label: '新歌与推荐', icon: ListMusic },
              { label: '热门歌曲', icon: Radio },
              { label: '新发行', icon: Disc3 },
            ].map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    const target = sections.find((section) => section.title === item.label)
                    if (target) document.getElementById(target.id)?.scrollIntoView({ behavior: 'smooth' })
                  }}
                  className="flex h-8 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[12px] text-white/40 hover:bg-white/[0.05] hover:text-white/80"
                >
                  <Icon className="h-3.5 w-3.5" /> {item.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-auto space-y-2 px-2">
          <Link href="/" className="flex h-8 items-center gap-2 text-[11px] text-white/35 hover:text-white/70">
            <ExternalLink className="h-3.5 w-3.5" /> 返回下载站
          </Link>
          {site && !site.isAdmin ? (
            <Link href="/login?next=/online" className="text-[11px] text-white/35 hover:text-white/70">
              管理员登录
            </Link>
          ) : site?.isAdmin ? (
            <Link href="/admin" className="text-[11px] text-white/35 hover:text-white/70">
              进入管理后台
            </Link>
          ) : null}
          <p className="text-[9.5px] leading-4 text-white/20">
            推荐数据来自 Apple Music 公开页面；播放由本站音源解析。
          </p>
        </div>
      </aside>

      <div className="min-h-screen lg:pl-[236px]">
        <header className="sticky top-0 z-30 border-b border-white/[0.05] bg-[#0b0b0d]/82 backdrop-blur-xl">
          <div className="mx-auto flex h-16 w-full max-w-[1500px] items-center gap-3 px-4 sm:px-8">
            <div className="flex items-center gap-2 lg:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fa2d48]">
                <Headphones className="h-4 w-4 text-white" />
              </span>
              <span className="text-[14px] font-semibold">声渡音乐</span>
            </div>
            <div className="hidden items-center gap-2 text-[13px] text-white/35 lg:flex">
              <span>新发现</span>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="font-medium text-white/80">推荐</span>
            </div>
            <form onSubmit={(event) => void submitSearch(event)} className="ml-auto w-full max-w-[420px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                <input
                  id="online-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索 Apple Music 歌曲、专辑"
                  className="h-9 w-full rounded-xl border border-white/[0.08] bg-white/[0.055] pl-9 pr-10 text-[13px] text-white outline-none transition-colors placeholder:text-white/25 focus:border-[#fa2d48]/50 focus:bg-white/[0.08]"
                />
                {searching ? (
                  <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-white/40" />
                ) : null}
              </div>
            </form>
            <Link
              href={site?.isAdmin ? '/admin' : '/login?next=/online'}
              className="hidden h-9 shrink-0 items-center rounded-xl border border-white/[0.1] px-3 text-[12px] text-white/55 hover:border-white/20 hover:text-white sm:flex"
            >
              {site?.isAdmin ? '管理后台' : '管理员登录'}
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1500px] px-4 pb-[130px] pt-6 sm:px-8">
          {searchResult || searchError ? (
            <section className="animate-fade-in">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[#fa2d48]">Apple Music 搜索</div>
                  <h1 className="mt-1 text-[30px] font-semibold tracking-[-0.03em]">“{query}”</h1>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSearchResult(null)
                    setSearchError('')
                    setQuery('')
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/[0.07] px-3 text-[12px] text-white/60 hover:bg-white/[0.11] hover:text-white"
                >
                  <X className="h-3.5 w-3.5" /> 关闭搜索
                </button>
              </div>
              {searchError ? (
                <div className="mt-5 rounded-xl border border-red-400/20 bg-red-500/[0.06] px-4 py-3 text-[12px] text-red-200">
                  {searchError}
                </div>
              ) : null}
              {searchResult ? (
                <div className="mt-5 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
                  <div>
                    <h2 className="mb-2 text-[18px] font-semibold">歌曲</h2>
                    {searchResult.songs.length ? (
                      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-2">
                        {searchResult.songs.map((track, index) => (
                          <TrackRow
                            key={track.id}
                            track={track}
                            index={index}
                            active={current?.id === track.id}
                            playing={playing}
                            onPlay={() => {
                              setQueue(searchResult.songs)
                              setQueueIndex(index)
                              void playTrack(track, searchResult.songs, undefined, index)
                            }}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px] text-white/35">没有找到歌曲。</p>
                    )}
                  </div>
                  <div>
                    <h2 className="mb-2 text-[18px] font-semibold">专辑</h2>
                    <div className="grid grid-cols-2 gap-4">
                      {searchResult.albums.map((album) => (
                        <Card
                          key={album.id}
                          item={album}
                          index={0}
                          onPlay={playCard}
                          onOpen={(item) => void openCollection(item)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          ) : (
            <>
              <section className="animate-fade-in relative overflow-hidden rounded-3xl border border-white/[0.07] bg-gradient-to-br from-[#21141a] via-[#121216] to-[#0b0b0d] px-5 py-7 sm:px-8 sm:py-9">
                <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[#fa2d48]/20 blur-3xl" />
                <div className="relative flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#fa2d48]">
                      Apple Music · New
                    </div>
                    <h1 className="mt-2 text-[32px] font-semibold tracking-[-0.04em] sm:text-[46px]">
                      新发现
                    </h1>
                    <p className="mt-2 max-w-xl text-[12.5px] leading-6 text-white/40">
                      跟随 Apple Music 中国区的本周推荐，发现新歌、专辑与歌单。点击即可由本站音源在线播放。
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-[10.5px] text-white/25">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {initial.source === 'apple' ? 'Apple Music 实时推荐' : '热门榜单回退'}
                  </div>
                </div>
              </section>

              {hero ? (
                <section className="mt-8" id={hero.id}>
                  <SectionHeader title={hero.title || '新歌与推荐'} />
                  <div className="scrollbar-none -mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
                    {hero.items.map((item, index) => (
                      <Card
                        key={`${hero.id}-${item.id}`}
                        item={item}
                        onPlay={playCard}
                        onOpen={(card) => void openCollection(card)}
                        index={index}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {restSections.map((section) => (
                <div key={section.id} id={section.id}>
                  <SectionShelf section={section} onPlay={playCard} onOpen={(card) => void openCollection(card)} />
                </div>
              ))}

              {!sections.length ? (
                <div className="mt-10 rounded-2xl border border-dashed border-white/[0.1] px-6 py-16 text-center">
                  <p className="text-[14px] text-white/55">推荐数据暂时不可用</p>
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="mt-3 text-[12px] text-[#fa2d48] hover:text-[#ff5c70]"
                  >
                    重新加载
                  </button>
                </div>
              ) : null}
            </>
          )}
        </main>
      </div>

      {collection || collectionLoading || collectionError ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 px-0 backdrop-blur-sm sm:items-center sm:px-6">
          <div className="animate-slide-up flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl border border-white/[0.08] bg-[#151517] shadow-2xl sm:rounded-3xl">
            <div className="flex items-start gap-4 border-b border-white/[0.06] p-5 sm:p-6">
              <Artwork
                artwork={collection?.artwork}
                title={collection?.title || '专辑'}
                className="h-24 w-24 shrink-0 sm:h-32 sm:w-32"
                rounded="rounded-xl"
              />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-[0.2em] text-[#fa2d48]">
                  {collection?.kind === 'playlist' ? 'Apple Music 歌单' : 'Apple Music 专辑'}
                </div>
                <h2 className="mt-1 truncate text-[22px] font-semibold tracking-[-0.03em] sm:text-[28px]">
                  {collection?.title || (collectionLoading ? '正在加载…' : '加载失败')}
                </h2>
                <p className="mt-1 truncate text-[12px] text-white/40">{collection?.subtitle || collectionError}</p>
                {collection?.description ? (
                  <p className="mt-2 line-clamp-2 text-[10.5px] leading-4 text-white/30">{collection.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => {
                  setCollection(null)
                  setCollectionError('')
                }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-white/50 hover:bg-white/[0.12] hover:text-white"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
              {collectionLoading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-[12px] text-white/35">
                  <Loader2 className="h-4 w-4 animate-spin" /> 正在读取 Apple Music 曲目…
                </div>
              ) : collectionError ? (
                <div className="py-16 text-center text-[12px] text-red-300/70">{collectionError}</div>
              ) : collection?.tracks.length ? (
                collection.tracks.map((track, index) => (
                  <TrackRow
                    key={`${track.id}-${index}`}
                    track={track}
                    index={index}
                    active={current?.id === track.id}
                    playing={playing}
                    onPlay={() => {
                      if (!collection) return
                      setQueue(collection.tracks)
                      setQueueIndex(index)
                      void playTrack(track, collection.tracks, undefined, index)
                    }}
                  />
                ))
              ) : (
                <div className="py-16 text-center text-[12px] text-white/35">没有可播放曲目。</div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {current ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-[#111113]/95 backdrop-blur-xl">
          <div className="mx-auto flex h-[76px] w-full max-w-[1500px] items-center gap-3 px-3 sm:px-6">
            <button
              type="button"
              onClick={() => setPlayerOpen(true)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <Artwork artwork={current.artwork} title={current.title} className="h-12 w-12 shrink-0" rounded="rounded-lg" />
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-medium text-white/90">{current.title}</div>
                <div className="truncate text-[10.5px] text-white/35">
                  {current.artist}
                  {sourceName ? ` · ${sourceName}` : ''}
                </div>
              </div>
            </button>
            <div className="hidden items-center gap-1 sm:flex">
              <button type="button" onClick={playPrevious} className="player-icon" aria-label="上一首">
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={togglePlay}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black hover:scale-105"
                aria-label={playing ? '暂停' : '播放'}
              >
                {loadingTrack ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : playing ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="ml-0.5 h-4 w-4" />
                )}
              </button>
              <button type="button" onClick={playNext} className="player-icon" aria-label="下一首">
                <SkipForward className="h-4 w-4" />
              </button>
            </div>
            <div className="hidden max-w-[360px] flex-1 items-center gap-2 md:flex">
              <span className="w-9 text-right text-[10px] tabular-nums text-white/30">{clock(currentTime)}</span>
              <input
                type="range"
                min={0}
                max={duration || 1}
                step={0.1}
                value={Math.min(currentTime, duration || 1)}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setCurrentTime(value)
                  if (audioRef.current) audioRef.current.currentTime = value
                }}
                className="player-range min-w-0 flex-1"
                style={{ '--progress': `${duration ? (currentTime / duration) * 100 : 0}%` } as React.CSSProperties}
                aria-label="播放进度"
              />
              <span className="w-9 text-[10px] tabular-nums text-white/30">{clock(duration)}</span>
            </div>
            <select
              value={quality}
              onChange={(event) => changeQuality(event.target.value as (typeof QUALITY_OPTIONS)[number]['value'])}
              className="hidden h-8 rounded-lg border border-white/[0.08] bg-white/[0.06] px-2 text-[10.5px] text-white/60 outline-none sm:block"
              aria-label="播放音质"
            >
              {QUALITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} className="bg-[#1c1c1e]">
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setPlayerOpen(true)}
              className="hidden items-center gap-1.5 rounded-lg px-2 py-1 text-[10.5px] text-white/40 hover:bg-white/[0.06] hover:text-white/70 sm:flex"
            >
              <ListMusic className="h-3.5 w-3.5" /> 歌词
            </button>
          </div>
          {error ? (
            <div className="mx-auto max-w-[1500px] px-4 pb-2 text-[10px] text-red-300/70">{error}</div>
          ) : null}
        </div>
      ) : null}

      {playerOpen && current ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#08080a]">
          <div
            className="pointer-events-none fixed inset-0 opacity-45 blur-3xl"
            style={artworkStyle(current.artwork)}
          />
          <div className="relative mx-auto flex min-h-screen w-full max-w-[1500px] flex-col px-5 py-5 sm:px-10">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-[0.22em] text-white/35">正在播放</div>
              <button
                type="button"
                onClick={() => setPlayerOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] text-white/60 hover:bg-white/[0.14] hover:text-white"
                aria-label="收起播放器"
              >
                <ChevronRight className="h-4 w-4 rotate-90" />
              </button>
            </div>
            <div className="mt-8 grid flex-1 gap-10 lg:grid-cols-[0.7fr_1.3fr] lg:items-center">
              <div className="mx-auto w-full max-w-[430px]">
                <Artwork
                  artwork={current.artwork}
                  title={current.title}
                  className="aspect-square w-full shadow-[0_30px_80px_rgba(0,0,0,0.55)]"
                  rounded="rounded-2xl"
                />
                <div className="mt-6">
                  <h2 className="text-[26px] font-semibold tracking-[-0.03em]">{current.title}</h2>
                  <p className="mt-1 text-[13px] text-white/45">{current.artist}</p>
                  <div className="mt-4 flex items-center gap-2 text-[10px] text-white/30">
                    {actualQuality ? <span className="rounded-full bg-white/[0.06] px-2 py-1">{actualQuality}</span> : null}
                    {sourceName ? <span>{sourceName}</span> : null}
                  </div>
                  <div className="mt-5 flex items-center gap-2">
                    <span className="w-10 text-right text-[10px] tabular-nums text-white/30">{clock(currentTime)}</span>
                    <input
                      type="range"
                      min={0}
                      max={duration || 1}
                      step={0.1}
                      value={Math.min(currentTime, duration || 1)}
                      onChange={(event) => {
                        const value = Number(event.target.value)
                        setCurrentTime(value)
                        if (audioRef.current) audioRef.current.currentTime = value
                      }}
                      className="player-range flex-1"
                      style={{ '--progress': `${duration ? (currentTime / duration) * 100 : 0}%` } as React.CSSProperties}
                      aria-label="播放进度"
                    />
                    <span className="w-10 text-[10px] tabular-nums text-white/30">{clock(duration)}</span>
                  </div>
                  <div className="mt-5 flex items-center justify-center gap-5">
                    <button type="button" onClick={playPrevious} className="player-icon" aria-label="上一首">
                      <SkipBack className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={togglePlay}
                      className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-black hover:scale-105"
                      aria-label={playing ? '暂停' : '播放'}
                    >
                      {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
                    </button>
                    <button type="button" onClick={playNext} className="player-icon" aria-label="下一首">
                      <SkipForward className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="mt-5 flex items-center justify-center gap-2">
                    <Volume2 className="h-4 w-4 text-white/30" />
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume}
                      onChange={(event) => setVolume(Number(event.target.value))}
                      className="player-range w-36"
                      style={{ '--progress': `${volume * 100}%` } as React.CSSProperties}
                      aria-label="音量"
                    />
                    <select
                      value={quality}
                      onChange={(event) => changeQuality(event.target.value as (typeof QUALITY_OPTIONS)[number]['value'])}
                      className="ml-3 h-8 rounded-lg border border-white/[0.08] bg-white/[0.06] px-2 text-[10.5px] text-white/60 outline-none"
                      aria-label="播放音质"
                    >
                      {QUALITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value} className="bg-[#1c1c1e]">
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="relative flex h-[58vh] min-h-[380px] flex-col lg:h-[78vh] lg:min-h-[520px]">
                <div className="flex items-center justify-between gap-3 px-1">
                  <div className="flex items-center gap-2 text-[12px] font-medium tracking-[0.02em] text-white/65">
                    <Music2 className="h-4 w-4 text-[#fa2d48]" /> 歌词
                  </div>
                  <div className="text-[10px] text-white/25">
                    {lyricsLoading ? '加载中…' : lyricsSource || '暂无歌词'}
                  </div>
                </div>
                <div
                  ref={lyricsRef}
                  className="scrollbar-none mt-2 min-h-0 flex-1 overflow-y-auto px-1 py-16 lg:py-[30vh]"
                  style={{
                    maskImage:
                      'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
                    WebkitMaskImage:
                      'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
                  }}
                >
                  {lyricsLoading ? (
                    <div className="flex items-center gap-2 py-10 text-[12px] text-white/30">
                      <Loader2 className="h-4 w-4 animate-spin" /> 正在获取歌词…
                    </div>
                  ) : parsedLyrics.synced.length ? (
                    <div className="space-y-5">
                      {parsedLyrics.synced.map((line, index) => (
                        <button
                          key={`${line.time}-${index}`}
                          type="button"
                          data-lyric-line={index}
                          onClick={() => {
                            setCurrentTime(line.time)
                            if (audioRef.current) audioRef.current.currentTime = line.time
                          }}
                          className={cn(
                            'block w-full origin-left text-left text-[24px] font-semibold leading-[1.32] tracking-[-0.035em] transition-all duration-500 sm:text-[30px]',
                            index === activeLyricIndex
                              ? 'scale-[1.015] text-white drop-shadow-[0_2px_24px_rgba(255,255,255,0.14)]'
                              : 'text-white/20 hover:text-white/45'
                          )}
                        >
                          {line.text}
                        </button>
                      ))}
                    </div>
                  ) : parsedLyrics.plain.length ? (
                    <div className="space-y-3 pb-6">
                      {parsedLyrics.plain.map((line, index) => (
                        <p
                          key={`${line}-${index}`}
                          className="text-[18px] font-semibold leading-8 tracking-[-0.02em] text-white/55 sm:text-[22px]"
                        >
                          {line}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <div className="py-16 text-center text-[12px] text-white/25">
                      这首歌暂时没有歌词
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
