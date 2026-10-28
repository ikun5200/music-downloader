import { describe, expect, it } from 'vitest'
import { isRetryableBatchItem, recountBatchItems } from '../lib/batch/retry'

const jobStatus = new Map([
  ['failed-job', 'failed'],
  ['done-job', 'completed'],
  ['active-job', 'downloading'],
])

describe('batch retry helpers', () => {
  it('retries selection failures and stuck searching items', () => {
    expect(isRetryableBatchItem({ id: '1', status: 'failed', downloadJobId: null }, jobStatus)).toBe(true)
    expect(isRetryableBatchItem({ id: '2', status: 'searching', downloadJobId: null }, jobStatus)).toBe(true)
  })

  it('retries failed downloads but not completed or active downloads', () => {
    expect(
      isRetryableBatchItem({ id: '1', status: 'queued', downloadJobId: 'failed-job' }, jobStatus)
    ).toBe(true)
    expect(
      isRetryableBatchItem({ id: '2', status: 'queued', downloadJobId: 'missing-job' }, jobStatus)
    ).toBe(true)
    expect(
      isRetryableBatchItem({ id: '3', status: 'queued', downloadJobId: 'done-job' }, jobStatus)
    ).toBe(false)
    expect(
      isRetryableBatchItem({ id: '4', status: 'queued', downloadJobId: 'active-job' }, jobStatus)
    ).toBe(false)
  })

  it('does not retry pending or canceled items', () => {
    expect(isRetryableBatchItem({ id: '1', status: 'pending', downloadJobId: null }, jobStatus)).toBe(false)
    expect(isRetryableBatchItem({ id: '2', status: 'canceled', downloadJobId: null }, jobStatus)).toBe(false)
  })

  it('recounts processed/succeeded/failed after resetting items', () => {
    expect(
      recountBatchItems([
        { status: 'queued' },
        { status: 'queued' },
        { status: 'failed' },
        { status: 'pending' },
        { status: 'canceled' },
      ])
    ).toEqual({ processed: 3, succeeded: 2, failed: 1 })
  })
})
