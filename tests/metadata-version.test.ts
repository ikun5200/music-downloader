import { describe, expect, it } from 'vitest'
import { scoreCandidate } from '../lib/metadata/normalize'
import type { MetadataCandidate, MetadataQuery } from '../lib/metadata/types'
import type { MetadataSourceId } from '../lib/metadata/types'

const order: MetadataSourceId[] = ['itunes', 'netease', 'kugou', 'kuwo', 'qqmusic']

function candidate(partial: Partial<MetadataCandidate>): MetadataCandidate {
  return {
    source: 'itunes',
    sourceLabel: 'iTunes',
    title: 'K歌之王',
    artist: '陈奕迅',
    album: '打得火热',
    date: '2000-01-01',
    genre: 'Pop',
    duration: 222,
    score: 0,
    acceptable: false,
    variantFlags: 0,
    reasons: [],
    ...partial,
  }
}

const baseQuery: MetadataQuery = { title: 'K歌之王', artist: '陈奕迅' }

describe('metadata version intent', () => {
  it('defaults to the studio version and rejects live albums', () => {
    const studio = scoreCandidate(candidate({}), baseQuery, order)
    const live = scoreCandidate(
      candidate({
        title: 'K歌之王',
        album: 'Eason Third Encounter Concert Live 2003',
        duration: 232,
      }),
      baseQuery,
      order
    )
    expect(studio.acceptable).toBe(true)
    expect(live.acceptable).toBe(false)
    expect(live.reasons).toContain('专辑含版本标记')
  })

  it('accepts a live version when live was requested', () => {
    const query: MetadataQuery = { ...baseQuery, versionTags: ['live'] }
    const studio = scoreCandidate(candidate({}), query, order)
    const live = scoreCandidate(
      candidate({
        title: 'K歌之王 (Live)',
        album: 'Third Encounter Live',
        duration: 232,
      }),
      query,
      order
    )
    expect(live.acceptable).toBe(true)
    expect(live.versionTags).toContain('live')
    expect(studio.acceptable).toBe(false)
    expect(studio.reasons).toContain('版本不符')
  })

  it('accepts a live album track even when the title has no Live suffix', () => {
    const query: MetadataQuery = { ...baseQuery, versionTags: ['live'] }
    const live = scoreCandidate(
      candidate({
        title: 'K歌之王',
        album: 'Eason Third Encounter Concert Live 2003',
        duration: 232,
      }),
      query,
      order
    )
    expect(live.acceptable).toBe(true)
    expect(live.versionTags).toContain('live')
  })

  it('accepts a requested language version and rejects the other language', () => {
    const query: MetadataQuery = { ...baseQuery, languageTags: ['cantonese'] }
    const cantonese = scoreCandidate(
      candidate({ title: 'K歌之王 (粤语)', album: '打得火热' }),
      query,
      order
    )
    const mandarin = scoreCandidate(
      candidate({ title: 'K歌之王 (国语)', album: '反正是我', duration: 218 }),
      query,
      order
    )
    expect(cantonese.acceptable).toBe(true)
    expect(cantonese.languageTags).toContain('cantonese')
    expect(mandarin.acceptable).toBe(false)
  })

  it('accepts a requested piano version', () => {
    const query: MetadataQuery = { ...baseQuery, versionTags: ['instrumental', 'piano'] }
    const piano = scoreCandidate(
      candidate({ title: 'K歌之王 (钢琴版)', album: '钢琴精选', duration: 221 }),
      query,
      order
    )
    expect(piano.acceptable).toBe(true)
    expect(piano.versionTags).toEqual(expect.arrayContaining(['instrumental', 'piano']))
  })

  it('penalizes candidates without album metadata', () => {
    const query: MetadataQuery = { ...baseQuery, album: 'Nine Track Mind' }
    const withAlbum = scoreCandidate(
      candidate({ title: "We Don't Talk Anymore", album: 'Nine Track Mind' }),
      query,
      order
    )
    const withoutAlbum = scoreCandidate(
      candidate({ title: "We Don't Talk Anymore", album: '' }),
      query,
      order
    )
    expect(withAlbum.score).toBeGreaterThan(withoutAlbum.score)
  })

  it('rejects trial and vinyl-edition metadata', () => {
    const trial = scoreCandidate(
      candidate({ title: 'K歌之王 (体验版)', album: '÷ (Deluxe)' }),
      baseQuery,
      order
    )
    const vinyl = scoreCandidate(
      candidate({ title: 'K歌之王 (黑胶版)', album: '21（黑胶版）' }),
      baseQuery,
      order
    )
    expect(trial.acceptable).toBe(false)
    expect(vinyl.acceptable).toBe(false)
  })
})
