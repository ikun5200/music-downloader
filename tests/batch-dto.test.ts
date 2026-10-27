import { describe, expect, it } from 'vitest'
import type { BatchItem, BatchJob } from '@prisma/client'
import { batchToDto, type BatchDownloadInfo } from '../lib/batch/dto'

const now = new Date('2026-01-01T00:00:00Z')

function item(id: string, jobId: string | null): BatchItem {
  return {
    id,
    batchId: 'b1',
    line: `line-${id}`,
    status: jobId ? 'queued' : 'failed',
    platform: jobId ? 'kw' : null,
    songId: jobId ? id : null,
    title: jobId ? `title-${id}` : null,
    artist: jobId ? 'artist' : null,
    album: null,
    coverUrl: null,
    musicInfo: null,
    downloadJobId: jobId,
    selectionReason: null,
    aiUsed: false,
    error: jobId ? null : 'not found',
    createdAt: now,
    updatedAt: now,
  }
}

function batch(items: BatchItem[]): BatchJob & { items: BatchItem[] } {
  return {
    id: 'b1',
    status: 'completed',
    quality: '128k',
    total: items.length,
    processed: items.length,
    succeeded: items.filter((row) => row.downloadJobId).length,
    failed: items.filter((row) => !row.downloadJobId).length,
    error: null,
    createdAt: now,
    startedAt: now,
    finishedAt: now,
    items,
  }
}

function download(
  status: string,
  progress: number,
  bytesDone = 0,
  bytesTotal: number | null = null
): BatchDownloadInfo {
  return { status, progress, bytesDone, bytesTotal, error: null }
}

describe('batch progress DTO', () => {
  it('aggregates completed, downloading and paused jobs', () => {
    const dto = batchToDto(
      batch([item('1', 'j1'), item('2', 'j2'), item('3', 'j3'), item('4', null)]),
      new Map([
        ['j1', download('completed', 100, 1000, 1000)],
        ['j2', download('downloading', 50, 500, 1000)],
        ['j3', download('paused', 20, 200, 1000)],
      ])
    )
    expect(dto.downloadTotal).toBe(3)
    expect(dto.downloadCompleted).toBe(1)
    expect(dto.downloadFailed).toBe(0)
    // 分母使用批次总数：(1 + 0.5 + 0.2) / 4 = 42.5%
    expect(dto.downloadProgress).toBe(43)
    expect(dto.items[1].downloadStatus).toBe('downloading')
    expect(dto.items[2].downloadStatus).toBe('paused')
    expect(dto.items[3].downloadStatus).toBeNull()
  })

  it('does not count failed or canceled downloads as completed progress', () => {
    const dto = batchToDto(
      batch([item('1', 'j1'), item('2', 'j2')]),
      new Map([
        ['j1', download('failed', 0)],
        ['j2', download('canceled', 10)],
      ])
    )
    expect(dto.downloadTotal).toBe(2)
    expect(dto.downloadFailed).toBe(2)
    expect(dto.downloadProgress).toBe(0)
  })

  it('returns zero progress when nothing was selected', () => {
    const dto = batchToDto(batch([item('1', null)]))
    expect(dto.downloadTotal).toBe(0)
    expect(dto.downloadProgress).toBe(0)
    expect(dto.downloadCompleted).toBe(0)
  })

  it('shows the most recently updated item first', () => {
    const older = {
      ...item('1', 'j1'),
      updatedAt: new Date('2026-01-01T00:00:01Z'),
    }
    const newer = {
      ...item('2', 'j2'),
      updatedAt: new Date('2026-01-01T00:00:02Z'),
    }
    const dto = batchToDto(batch([older, newer]))
    expect(dto.items.map((row) => row.id)).toEqual(['2', '1'])
  })
})
