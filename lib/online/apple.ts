import type {
  OnlineCard,
  OnlineCardKind,
  OnlineCollection,
  OnlineHome,
  OnlineSearchResult,
  OnlineSection,
  OnlineTrack,
} from './types'

const APPLE_NEW_URL = 'https://music.apple.com/cn/new'
const APPLE_SEARCH_URL = 'https://music.apple.com/cn/search?term='
const RSS_ALBUMS_URL =
  'https://rss.applemarketingtools.com/api/v2/cn/music/most-played/18/albums.json'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
const HOME_TTL = 30 * 60 * 1000
const COLLECTION_TTL = 30 * 60 * 1000
const SEARCH_TTL = 5 * 60 * 1000
const CACHE_MAX = 80

type Json = Record<string, any>

function cacheGet<T>(key: string, ttl: number): T | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > ttl) {
    cache.delete(key)
    return null
  }
  return hit.value as T
}

function cacheSet(key: string, value: unknown) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, { at: Date.now(), value })
}

const cache = new Map<string, { at: number; value: unknown }>()

function record(value: unknown): Json {
  return value && typeof value === 'object' ? (value as Json) : {}
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function number(value: unknown): number | undefined {
  const result = Number(value)
  return Number.isFinite(result) && result > 0 ? result : undefined
}

function firstLink(value: unknown): string {
  for (const item of list(value)) {
    const title = text(record(item).title)
    if (title) return title
  }
  return ''
}

function artworkUrl(value: unknown): string | undefined {
  const dictionary = record(record(value).dictionary)
  const raw = text(dictionary.url)
  if (!raw) return undefined
  return raw
    .replace(/\{w\}/g, '700')
    .replace(/\{h\}/g, '700')
    .replace(/\{c\}/g, 'bb')
    .replace(/\{f\}/g, 'jpg')
}

function artworkOf(item: Json, fallback?: string): string | undefined {
  return artworkUrl(item.artwork) || artworkUrl(item.tallArtwork) || fallback
}

function sectionTitle(section: Json): string {
  const header = record(section.header)
  const item = record(header.item)
  const titleLink = record(item.titleLink)
  return text(titleLink.title) || text(item.title) || text(section.title)
}

function cardFromItem(
  raw: unknown,
  itemKind: string,
  fallbackArtwork?: string
): OnlineCard | null {
  const item = record(raw)
  const descriptor = record(item.contentDescriptor)
  const identifiers = record(descriptor.identifiers)
  const kind = text(descriptor.kind)
  const cardKind = (['song', 'album', 'playlist', 'radio', 'video', 'link'] as const).includes(
    kind as OnlineCardKind
  )
    ? (kind as OnlineCardKind)
    : null
  const id = text(identifiers.storeAdamID) || text(item.id)
  const url = text(descriptor.url)
  const artwork = artworkOf(item, fallbackArtwork)

  if (itemKind === 'trackLockup' || itemKind === 'topSearchLockup') {
    const title = text(item.title)
    if (!title) return null
    const artist =
      firstLink(item.subtitleLinks) || text(item.artistName) || text(item.subtitle)
    const durationRaw = number(item.duration)
    return {
      id: id || `${title}-${artist}`,
      kind: itemKind === 'trackLockup' ? 'song' : cardKind || 'song',
      title,
      subtitle: artist,
      artwork,
      url,
      appleId: id || undefined,
      duration: durationRaw ? (durationRaw > 1000 ? durationRaw / 1000 : durationRaw) : undefined,
    }
  }

  if (itemKind === 'squareLockup' || itemKind === 'flowcaseLockup' || itemKind === 'bubbleLockup') {
    const title = firstLink(item.titleLinks) || text(item.title)
    if (!title) return null
    const targetKind: OnlineCard['kind'] =
      cardKind === 'playlist' || cardKind === 'radio' || cardKind === 'video'
        ? cardKind
        : cardKind === 'album'
          ? 'album'
          : itemKind === 'flowcaseLockup'
            ? 'playlist'
            : 'album'
    return {
      id: id || `${title}-${targetKind}`,
      kind: targetKind,
      title,
      subtitle: firstLink(item.subtitleLinks) || text(item.subtitle),
      artwork,
      url,
      appleId: id || undefined,
      trackCount: number(item.trackCount),
    }
  }

  return null
}

function normalizeSections(data: Json): OnlineSection[] {
  const sections: OnlineSection[] = []
  for (const raw of list(data.sections)) {
    const section = record(raw)
    const itemKind = text(section.itemKind)
    if (
      ![
        'flowcaseLockup',
        'trackLockup',
        'squareLockup',
        'topSearchLockup',
        'containerDetailHeaderLockup',
      ].includes(itemKind)
    ) {
      continue
    }
    const fallbackArtwork =
      artworkUrl(record(list(section.items)[0]).artwork) ||
      artworkUrl(section.containerArtwork)
    const items = list(section.items)
      .map((item) => cardFromItem(item, itemKind, fallbackArtwork))
      .filter((item): item is OnlineCard => !!item)
      .slice(0, 30)
    if (!items.length) continue
    const presentation = record(section.presentation)
    const layout = record(presentation.layout)
    const title =
      sectionTitle(section) ||
      (itemKind === 'flowcaseLockup' ? '新歌与推荐' : '') ||
      (itemKind === 'squareLockup' ? '编辑精选' : '')
    sections.push({
      id: text(section.id) || `${itemKind}-${sections.length}`,
      title,
      kind: itemKind,
      layout: text(layout.kind) === 'grid' ? 'grid' : 'shelf',
      items,
    })
  }
  return sections
}

function parseSerialized(html: string): Json {
  const match = html.match(
    /<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/i
  )
  if (!match?.[1]) throw new Error('Apple Music 页面缺少推荐数据')
  const parsed = JSON.parse(match[1]) as Json
  const data = list(parsed.data)[0]
  const page = record(record(data).data)
  if (!list(page.sections).length) throw new Error('Apple Music 推荐数据为空')
  return page
}

async function fetchAppleHtml(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Apple Music 请求超时')), 18_000)
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Accept: 'text/html,application/xhtml+xml',
      },
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Apple Music HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

async function rssFallback(): Promise<OnlineHome> {
  try {
    const res = await fetch(RSS_ALBUMS_URL, { cache: 'no-store' })
    if (!res.ok) throw new Error(`RSS HTTP ${res.status}`)
    const json = (await res.json()) as Json
    const results = list(record(json.feed).results)
    const items: OnlineCard[] = results
      .map((raw): OnlineCard | null => {
        const item = record(raw)
        const id = text(item.id)
        const title = text(item.name)
        if (!id || !title) return null
        const artwork = text(item.artworkUrl100).replace('100x100', '600x600')
        return {
          id,
          kind: 'album' as const,
          title,
          subtitle: text(item.artistName),
          artwork: artwork || undefined,
          url: text(item.url),
          appleId: id,
        }
      })
      .filter((item): item is OnlineCard => !!item)
    return {
      fetchedAt: new Date().toISOString(),
      source: 'rss',
      sections: items.length
        ? [
            {
              id: 'rss-hot-albums',
              title: '热门专辑',
              kind: 'squareLockup',
              layout: 'shelf',
              items,
            },
          ]
        : [],
    }
  } catch {
    return { fetchedAt: new Date().toISOString(), source: 'rss', sections: [] }
  }
}

export async function getAppleNewHome(): Promise<OnlineHome> {
  const cached = cacheGet<OnlineHome>('home', HOME_TTL)
  if (cached) return cached
  try {
    const html = await fetchAppleHtml(APPLE_NEW_URL)
    const data = parseSerialized(html)
    const sections = normalizeSections(data).filter(
      (section) => section.kind !== 'containerDetailHeaderLockup'
    )
    if (!sections.length) throw new Error('Apple Music 推荐为空')
    const result: OnlineHome = {
      fetchedAt: new Date().toISOString(),
      source: 'apple',
      sections,
    }
    cacheSet('home', result)
    return result
  } catch {
    const fallback = await rssFallback()
    cacheSet('home', fallback)
    return fallback
  }
}

function validateAppleUrl(raw: string): string {
  const url = new URL(raw)
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'music.apple.com' ||
    !url.pathname.startsWith('/cn/')
  ) {
    throw new Error('不支持的 Apple Music 链接')
  }
  return url.toString()
}

export async function getAppleCollection(rawUrl: string): Promise<OnlineCollection> {
  const url = validateAppleUrl(rawUrl)
  const cached = cacheGet<OnlineCollection>(`collection:${url}`, COLLECTION_TTL)
  if (cached) return cached

  const html = await fetchAppleHtml(url)
  const data = parseSerialized(html)
  const headerSection = list(data.sections)
    .map((item) => record(item))
    .find((section) => text(section.itemKind) === 'containerDetailHeaderLockup')
  const header = record(list(headerSection?.items)[0])
  const descriptor = record(header.contentDescriptor)
  const kindText = text(descriptor.kind)
  const kind: OnlineCollection['kind'] =
    kindText === 'album' || kindText === 'playlist' ? kindText : 'unknown'
  const headerArtwork =
    artworkUrl(header.artwork) || artworkUrl(header.tallArtwork) || undefined
  const title = text(header.title)
  const subtitle = firstLink(header.subtitleLinks) || text(header.artistName)
  const description =
    text(header.description) ||
    text(record(list(data.sections).map(record).find((s) => text(s.itemKind) === 'containerDetailTracklistFooterLockup')?.items?.[0]).description)

  const tracks: OnlineTrack[] = []
  for (const rawSection of list(data.sections)) {
    const section = record(rawSection)
    if (text(section.itemKind) !== 'trackLockup') continue
    for (const raw of list(section.items)) {
      const item = record(raw)
      const trackDescriptor = record(item.contentDescriptor)
      const identifiers = record(trackDescriptor.identifiers)
      const trackTitle = text(item.title)
      if (!trackTitle) continue
      const durationRaw = number(item.duration)
      tracks.push({
        id: text(identifiers.storeAdamID) || text(item.id) || `${trackTitle}-${tracks.length}`,
        title: trackTitle,
        artist: firstLink(item.subtitleLinks) || subtitle,
        album: title || undefined,
        artwork: artworkOf(item, headerArtwork),
        duration: durationRaw ? (durationRaw > 1000 ? durationRaw / 1000 : durationRaw) : undefined,
        appleId: text(identifiers.storeAdamID) || undefined,
        url: text(trackDescriptor.url) || undefined,
        trackNumber: number(item.trackNumber),
      })
    }
  }

  const result: OnlineCollection = {
    id: text(descriptor.identifiers?.storeAdamID) || url,
    kind,
    title,
    subtitle,
    artwork: headerArtwork,
    description,
    tracks,
    url,
  }
  cacheSet(`collection:${url}`, result)
  return result
}

export async function searchAppleMusic(term: string): Promise<OnlineSearchResult> {
  const query = term.trim().slice(0, 100)
  if (!query) return { songs: [], albums: [] }
  const cached = cacheGet<OnlineSearchResult>(`search:${query}`, SEARCH_TTL)
  if (cached) return cached

  const html = await fetchAppleHtml(`${APPLE_SEARCH_URL}${encodeURIComponent(query)}`)
  const data = parseSerialized(html)
  const songs: OnlineTrack[] = []
  const albums: OnlineCard[] = []

  for (const rawSection of list(data.sections)) {
    const section = record(rawSection)
    const itemKind = text(section.itemKind)
    if (itemKind === 'trackLockup') {
      for (const raw of list(section.items)) {
        const card = cardFromItem(raw, itemKind)
        if (!card || card.kind !== 'song') continue
        songs.push({
          id: card.id,
          title: card.title,
          artist: card.subtitle || '',
          album: undefined,
          artwork: card.artwork,
          duration: card.duration,
          appleId: card.appleId,
          url: card.url,
        })
      }
    } else if (itemKind === 'squareLockup') {
      for (const raw of list(section.items)) {
        const card = cardFromItem(raw, itemKind)
        if (card?.kind === 'album') albums.push(card)
      }
    }
  }

  const result = { songs: songs.slice(0, 20), albums: albums.slice(0, 12) }
  cacheSet(`search:${query}`, result)
  return result
}
