import { prisma } from '../db'
import { batchToDto, type BatchDownloadInfo, type BatchWithItems } from './dto'

async function downloadMap(batches: BatchWithItems[]) {
  const ids = [
    ...new Set(
      batches.flatMap((batch) =>
        batch.items.map((item) => item.downloadJobId).filter((id): id is string => !!id)
      )
    ),
  ]
  if (!ids.length) return new Map<string, BatchDownloadInfo>()
  const jobs = await prisma.downloadJob.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      status: true,
      progress: true,
      bytesDone: true,
      bytesTotal: true,
      error: true,
    },
  })
  return new Map<string, BatchDownloadInfo>(jobs.map((job) => [job.id, job]))
}

export async function batchesToDto(batches: BatchWithItems[]) {
  const downloads = await downloadMap(batches)
  return batches.map((batch) => batchToDto(batch, downloads))
}

export async function getBatchDto(id: string) {
  const batch = await prisma.batchJob.findUnique({
    where: { id },
    include: { items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  })
  if (!batch) return null
  return (await batchesToDto([batch]))[0]
}
