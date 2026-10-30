import { describe, expect, it } from 'vitest'
import { auditLibrary, lyricsHasHeader } from '../lib/library/audit'
import { albumBaseName, findAlbumMerges } from '../lib/library/albums'
import { artistKeys } from '../lib/metadata/normalize'
import { findDuplicates } from '../lib/library/duplicates'
import { lyricsLookUsable } from '../lib/library/lyrics'
import type { LibraryFile } from '../lib/library/types'

function file(partial: Partial<LibraryFile> & { path: string }): LibraryFile {
  return {
    absolute: `/music/${partial.path}`,
    size: 10_000_000,
    mtimeMs: Date.now(),
    title: '',
    artist: '',
    album: '',
    albumArtist: '',
    track: '',
    disc: '',
    duration: 240,
    codec: 'mp3',
    bitRate: 320_000,
    sampleRate: 44_100,
    bitsPerRaw: null,
    quality: '320k',
    hasCover: true,
    coverWidth: 800,
    coverHeight: 800,
    coverHash: 'cover',
    coverPlaceholder: false,
    hasLyrics: true,
    lyrics: '[00:01.00]第一句\n[00:05.00]第二句\n[00:09.00]第三句',
    syncedLyrics: true,
    quickHash: 'hash',
    probeOk: true,
    issues: [],
    ...partial,
  }
}

describe('library audit', () => {
  it('flags missing cover/lyrics, dirty lyrics and record mismatch', () => {
    const files = [
      file({
        path: '晴天.mp3',
        title: '晴天',
        artist: '周杰伦',
        album: '叶惠美',
        hasCover: false,
        hasLyrics: false,
        syncedLyrics: false,
        lyrics: '',
        quality: '128k',
        bitRate: 128_000,
      }),
      file({
        path: '演员.mp3',
        title: '演员',
        artist: '薛之谦',
        album: '演员',
        lyrics: '作词：某某\n[00:01.00]第一句\n[00:05.00]第二句\n[00:09.00]第三句',
      }),
    ]
    const result = auditLibrary(files, [
      {
        id: 'job-1',
        title: '演员',
        artist: '薛之谦',
        album: '演员',
        filePath: '演员.mp3',
        status: 'completed',
        requestedQuality: '320k',
        actualQuality: '320k',
        qualityVerdict: 'match',
      },
    ])
    const codes = result.issues.flatMap((row) => row.issues.map((item) => item.code))
    expect(codes).toContain('missing_cover')
    expect(codes).toContain('missing_lyrics')
    expect(codes).toContain('lyrics_dirty')
    expect(codes).not.toContain('db_mismatch')
    expect(result.summary.missingJobFiles).toBe(0)
  })

  it('accepts a job whose scraped metadata matches the file', () => {
    const files = [
      file({
        path: '爱你等于爱自己.flac',
        title: '爱你等于爱自己',
        artist: '王力宏',
        album: '公转.自转',
      }),
    ]
    const result = auditLibrary(files, [
      {
        id: 'job-1',
        title: '爱你等于爱自己',
        artist: '王力宏',
        album: 'Evolution 音乐进化论',
        metadataTitle: '爱你等于爱自己',
        metadataArtist: '王力宏',
        metadataAlbum: '公转.自转',
        filePath: '爱你等于爱自己.flac',
        status: 'completed',
        requestedQuality: 'flac',
        actualQuality: 'flac',
        qualityVerdict: 'match',
      },
    ])
    const codes = result.issues.flatMap((row) => row.issues.map((item) => item.code))
    expect(codes).not.toContain('db_mismatch')
  })

  it('detects lyrics headers without removing artist prefixes', () => {
    expect(lyricsHasHeader('作词：徐若瑄\n[00:01.00]故事的小黄花')).toBe(true)
    expect(lyricsHasHeader('[00:01.00]韩红：故事的小黄花\n[00:05.00]第二句')).toBe(false)
  })
})

describe('duplicate detection', () => {
  it('keeps the original path over a copy and groups exact content', () => {
    const files = [
      file({ path: '晴天.mp3', title: '晴天', artist: '周杰伦', album: '叶惠美', quickHash: 'same' }),
      file({ path: '晴天-copy.mp3', title: '晴天', artist: '周杰伦', album: '叶惠美', quickHash: 'same' }),
    ]
    const result = findDuplicates(files)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].kind).toBe('exact')
    expect(result.groups[0].keep.path).toBe('晴天.mp3')
    expect(result.groups[0].remove[0].path).toBe('晴天-copy.mp3')
  })

  it('groups same song at different quality', () => {
    const files = [
      file({ path: '演员.flac', title: '演员', artist: '薛之谦', quality: 'flac', codec: 'flac', quickHash: 'a' }),
      file({ path: '演员.mp3', title: '演员', artist: '薛之谦', quality: '128k', quickHash: 'b' }),
    ]
    const result = findDuplicates(files)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].kind).toBe('version')
    expect(result.groups[0].keep.path).toBe('演员.flac')
  })
})

describe('library matching', () => {
  it('treats full-width separators as their ASCII equivalents', () => {
    expect(artistKeys('Selena Gomez ＆ The Scene')).toEqual(
      artistKeys('Selena Gomez & The Scene')
    )
  })
})

describe('album merge analysis', () => {
  it('prefers the non-edition album name as canonical', () => {
    const files = [
      file({ path: 'a.mp3', title: 'A', artist: '周杰伦', album: '叶惠美' }),
      file({ path: 'b.mp3', title: 'B', artist: '周杰伦', album: '叶惠美 (Deluxe Edition)' }),
      file({ path: 'c.mp3', title: 'C', artist: '周杰伦', album: '叶惠美 (Deluxe Edition)' }),
    ]
    const result = findAlbumMerges(files)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].canonicalAlbum).toBe('叶惠美')
    expect(result.groups[0].canonicalAlbumArtist).toBe('周杰伦')
  })

  it('normalizes edition suffixes', () => {
    expect(albumBaseName('叶惠美 (Deluxe Edition)')).toBe(albumBaseName('叶惠美'))
    expect(albumBaseName('叶惠美 - Special Edition')).toBe(albumBaseName('叶惠美'))
  })
})

describe('lyrics validation', () => {
  it('rejects mojibake and too-short lyrics', () => {
    expect(lyricsLookUsable('锟斤拷锟斤拷').ok).toBe(false)
    expect(lyricsLookUsable('只有一句').ok).toBe(false)
  })

  it('accepts synced lyrics within the song duration', () => {
    const lyrics = '[00:01.00]第一句\n[00:05.00]第二句\n[00:09.00]第三句'
    const result = lyricsLookUsable(lyrics, 240)
    expect(result.ok).toBe(true)
    expect(result.synced).toBe(true)
  })
})
