import { artistKeys, isCompilationAlbum, titleKey, toSimplified } from '../metadata/normalize'
import type {
  AlbumFile,
  AlbumMergeGroup,
  AlbumResult,
  LibraryFile,
} from './types'

const EDITION_RE =
  /[\(\[【（][^\)\]】）]*(?:deluxe|special|limited|remaster(?:ed)?|expanded|bonus|anniversary|edition|explicit|clean|豪华|特别|限量|纪念|珍藏|再版|重制|完整|升级|精选)[^\)\]】）]*[\)\]】）]/gi

const CONTENT_VARIANT_RE =
  /(explicit|clean|super\s*deluxe|超豪华|脏版|Clean版|伴奏|纯音乐|instrumental|live|现场|演唱会)/i

const EDITION_SUFFIX_RE =
  /\s*[-–—]\s*(?:deluxe|special|limited|remaster(?:ed)?|expanded|bonus|anniversary|edition|explicit|clean|豪华版|特别版|限量版|纪念版|珍藏版|再版|重制版|完整版|升级版|精选版).*$/i

export function albumBaseName(album: string): string {
  const simplified = toSimplified(String(album || '')).trim()
  if (!simplified) return ''
  const stripped = simplified
    .replace(EDITION_RE, ' ')
    .replace(EDITION_SUFFIX_RE, ' ')
    .replace(/[\s\-–—_·・,，.。:：;；'"“”‘’()[\]【】（）]+/g, '')
    .toLowerCase()
  return stripped || titleKey(simplified)
}

function artistForGroup(file: LibraryFile): string {
  const albumArtist = file.albumArtist.trim()
  if (albumArtist && !isCompilationAlbum(albumArtist)) return albumArtist
  return file.artist
}

function artistKeyForGroup(file: LibraryFile): string {
  const artist = artistForGroup(file)
  return artistKeys(artist)[0] || titleKey(artist)
}

function albumCounts(files: LibraryFile[]): Array<{ album: string; count: number }> {
  const counts = new Map<string, number>()
  for (const file of files) {
    const album = file.album.trim()
    if (!album) continue
    counts.set(album, (counts.get(album) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([album, count]) => ({ album, count }))
    .sort((a, b) => b.count - a.count || a.album.localeCompare(b.album, 'zh-CN'))
}

function isEdition(album: string): boolean {
  return new RegExp(EDITION_RE.source, 'i').test(album) || EDITION_SUFFIX_RE.test(album)
}

function canonicalAlbum(albums: Array<{ album: string; count: number }>): string {
  return [...albums].sort((a, b) => {
    // 正式版优先于 Deluxe/特别版，即使特别版曲目更多。
    const editionDiff = Number(isEdition(a.album)) - Number(isEdition(b.album))
    if (editionDiff !== 0) return editionDiff
    if (b.count !== a.count) return b.count - a.count
    return a.album.length - b.album.length || a.album.localeCompare(b.album, 'zh-CN')
  })[0]?.album || ''
}

function canonicalAlbumArtist(files: LibraryFile[]): string {
  const counts = new Map<string, number>()
  for (const file of files) {
    const artist = artistForGroup(file).trim()
    if (artist) counts.set(artist, (counts.get(artist) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || ''
}

function toAlbumFile(file: LibraryFile): AlbumFile {
  return {
    path: file.path,
    title: file.title,
    artist: file.artist,
    album: file.album,
    albumArtist: file.albumArtist,
    track: file.track,
  }
}

export function findAlbumMerges(files: LibraryFile[]): AlbumResult {
  const startedAt = Date.now()
  const byGroup = new Map<string, LibraryFile[]>()
  for (const file of files) {
    if (!file.album.trim()) continue
    const base = albumBaseName(file.album)
    if (!base) continue
    const key = `${artistKeyForGroup(file)}::${base}`
    const list = byGroup.get(key) || []
    list.push(file)
    byGroup.set(key, list)
  }

  const groups: AlbumMergeGroup[] = []
  for (const [key, list] of byGroup) {
    if (list.length < 2) continue
    const albums = albumCounts(list)
    if (albums.length < 2) continue
    // Explicit/Clean、Live、伴奏、Super Deluxe 等内容版本不能合并，
    // 否则会把不同内容的专辑混成一张。
    const contentVariants = new Set(
      albums
        .map((item) => (item.album.match(CONTENT_VARIANT_RE) || [])[0]?.toLowerCase())
        .filter((value): value is string => !!value)
    )
    if (contentVariants.size > 1) continue
    const base = albumBaseName(list[0].album)
    if (!base) continue
    const canonical = canonicalAlbum(albums)
    if (!canonical) continue
    const [artistKey] = key.split('::')
    const confidence: AlbumMergeGroup['confidence'] =
      base.length >= 2 && !/^(未知|unknown|downloads?)$/i.test(canonical) ? 'high' : 'medium'
    groups.push({
      id: `album-${artistKey}-${base}`.slice(0, 120),
      artistKey,
      albumBase: base,
      canonicalAlbum: canonical,
      canonicalAlbumArtist: canonicalAlbumArtist(list),
      albums,
      files: list.map(toAlbumFile).sort((a, b) => a.path.localeCompare(b.path, 'zh-CN')),
      confidence,
      reason: `同一张专辑存在 ${albums.length} 种专辑名：${albums
        .map((item) => `${item.album}（${item.count}）`)
        .join('、')}`,
    })
  }

  groups.sort((a, b) => b.files.length - a.files.length || a.albumBase.localeCompare(b.albumBase))
  const mergeableFiles = groups.reduce(
    (sum, group) =>
      sum + group.files.filter((file) => file.album !== group.canonicalAlbum).length,
    0
  )

  return {
    summary: {
      totalFiles: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      elapsedMs: Date.now() - startedAt,
      errorCount: 0,
      warnCount: 0,
      infoCount: 0,
      byCode: {},
      checkedAt: new Date().toISOString(),
      groups: groups.length,
      mergeableFiles,
    },
    groups,
  }
}
