import { fetchQqAlbum, fetchQqLyrics, qqCoverCandidates, searchQq } from './qqmusic'
import { enrichKugou, fetchKugouLyrics, searchKugou } from './kugou'
import { searchKuwo } from './kuwo'
import { enrichLrclib, searchLrclib } from './lrclib'
import { enrichNetease, fetchNeteaseLyrics, searchNetease } from './netease'
import { searchTheAudioDb, enrichTheAudioDb } from './theaudiodb'
import { searchItunes } from './itunes'
import type {
  MetadataCandidate,
  MetadataSourceAdapter,
  MetadataSourceId,
} from './types'

async function enrichQq(candidate: MetadataCandidate): Promise<void> {
  if (candidate.source !== 'qqmusic') return
  const detail = await fetchQqAlbum(candidate.albumId || '', candidate.songId || '')
  if (detail) {
    candidate.date = candidate.date || detail.date || ''
    candidate.genre = candidate.genre || detail.genre || ''
    candidate.albumArtist = candidate.albumArtist || detail.albumArtist
    candidate.publisher = candidate.publisher || detail.publisher
    candidate.language = candidate.language || detail.language
    candidate.track = candidate.track || detail.track
    candidate.trackTotal = candidate.trackTotal || detail.trackTotal
    candidate.disc = candidate.disc || detail.disc
  }
  if (!candidate.lyrics) {
    candidate.lyrics = await fetchQqLyrics(candidate.songId || '')
  }
  if (!candidate.coverUrls?.length && candidate.albumId) {
    candidate.coverUrls = qqCoverCandidates(candidate.albumId)
  }
  if (!candidate.coverUrl && candidate.coverUrls?.length) {
    candidate.coverUrl = candidate.coverUrls[0]
  }
}

const itunes: MetadataSourceAdapter = {
  id: 'itunes',
  label: 'iTunes',
  supportsLyrics: false,
  supportsCover: true,
  async search(query, limit) {
    const result = await searchItunes(query, limit)
    return { candidates: result.candidates, note: result.note }
  },
}

const netease: MetadataSourceAdapter = {
  id: 'netease',
  label: '网易云音乐',
  supportsLyrics: true,
  supportsCover: true,
  search: searchNetease,
  enrich: enrichNetease,
  lyrics: (candidate) => fetchNeteaseLyrics(candidate.songId || ''),
}

const kugou: MetadataSourceAdapter = {
  id: 'kugou',
  label: '酷狗音乐',
  supportsLyrics: true,
  supportsCover: true,
  search: searchKugou,
  enrich: enrichKugou,
  lyrics: (candidate) =>
    fetchKugouLyrics(
      candidate.rawTitle || candidate.title,
      candidate.artist,
      candidate.duration
    ),
}

const kuwo: MetadataSourceAdapter = {
  id: 'kuwo',
  label: '酷我音乐',
  supportsLyrics: false,
  supportsCover: true,
  search: searchKuwo,
}

const qqmusic: MetadataSourceAdapter = {
  id: 'qqmusic',
  label: 'QQ 音乐',
  supportsLyrics: true,
  supportsCover: true,
  search: searchQq,
  enrich: enrichQq,
  lyrics: (candidate) => fetchQqLyrics(candidate.songId || ''),
}

const lrclib: MetadataSourceAdapter = {
  id: 'lrclib',
  label: 'LRCLIB',
  supportsLyrics: true,
  supportsCover: false,
  search: searchLrclib,
  enrich: enrichLrclib,
}

const theaudiodb: MetadataSourceAdapter = {
  id: 'theaudiodb',
  label: 'TheAudioDB',
  supportsLyrics: false,
  supportsCover: true,
  search: searchTheAudioDb,
  enrich: enrichTheAudioDb,
}

export const METADATA_ADAPTERS: Record<MetadataSourceId, MetadataSourceAdapter> = {
  itunes,
  netease,
  kugou,
  kuwo,
  qqmusic,
  lrclib,
  theaudiodb,
}

export function getMetadataAdapter(id: MetadataSourceId): MetadataSourceAdapter {
  return METADATA_ADAPTERS[id]
}
