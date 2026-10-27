import fs from 'fs/promises'
import path from 'path'
import { PLATFORMS, type Platform } from '../constants'
import { prisma } from '../db'
import { defaultPlatformRank } from './priority'
import { SourceWorkerClient } from './worker-client'

export interface LoadedSource {
  id: string
  name: string
  version: string
  priority: number
  platforms: Platform[]
  qualities: Record<string, string[]>
  logs: string[]
}

export function getSourcesDir(): string {
  return path.join(process.cwd(), 'data', 'sources')
}

export function resolveSourcePath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath)
}

function normalizeManifest(
  raw: Record<string, { name?: string; actions?: string[]; qualitys?: string[] }> | undefined
): { platforms: Platform[]; qualities: Record<string, string[]> } {
  const platforms: Platform[] = []
  const qualities: Record<string, string[]> = {}
  if (!raw) return { platforms, qualities }

  for (const platform of PLATFORMS) {
    const info = raw[platform]
    if (!info) continue
    if (!Array.isArray(info.actions) || !info.actions.includes('musicUrl')) continue
    const qs = Array.isArray(info.qualitys)
      ? info.qualitys.filter((q): q is string => typeof q === 'string' && q.length > 0)
      : []
    if (!qs.length) continue
    platforms.push(platform)
    qualities[platform] = [...new Set(qs)]
  }
  return { platforms, qualities }
}

class SourceManager {
  private clients = new Map<string, SourceWorkerClient>()
  private manifests = new Map<string, LoadedSource>()
  private loading = new Map<string, Promise<LoadedSource>>()
  private manifestCache: LoadedSource[] | null = null
  private manifestAt = 0

  async ensureLoaded(sourceId: string, opts: { allowDisabled?: boolean } = {}): Promise<LoadedSource> {
    const cached = this.manifests.get(sourceId)
    if (cached) return cached

    const inFlight = this.loading.get(sourceId)
    if (inFlight) return inFlight

    const task = (async () => {
      const source = await prisma.source.findUnique({ where: { id: sourceId } })
      if (!source) throw new Error('音源不存在')
      if (!source.enabled && !opts.allowDisabled) throw new Error('音源已禁用')

      const filePath = resolveSourcePath(source.filePath)
      const code = await fs.readFile(filePath, 'utf8')
      const client = new SourceWorkerClient(filePath)
      const init = await client.init(code)

      if (!init.ok) {
        await prisma.source.update({
          where: { id: sourceId },
          data: { lastError: init.error || '初始化失败', lastInitAt: new Date() },
        })
        await client.dispose()
        throw new Error(init.error || '音源初始化失败')
      }

      const { platforms, qualities } = normalizeManifest(init.sources)
      if (!platforms.length) {
        const msg = '初始化成功，但未声明可用的 musicUrl 平台/音质'
        await prisma.source.update({
          where: { id: sourceId },
          data: {
            platforms: '[]',
            qualities: '{}',
            lastError: msg,
            lastInitAt: new Date(),
          },
        })
        await client.dispose()
        throw new Error(msg)
      }

      const loaded: LoadedSource = {
        id: sourceId,
        name: source.name,
        version: source.version || '',
        priority: source.priority,
        platforms,
        qualities,
        logs: client.getLogs(),
      }

      this.clients.set(sourceId, client)
      this.manifests.set(sourceId, loaded)
      this.manifestCache = null

      await prisma.source.update({
        where: { id: sourceId },
        data: {
          platforms: JSON.stringify(platforms),
          qualities: JSON.stringify(qualities),
          lastInitAt: new Date(),
          lastError: null,
        },
      })

      return loaded
    })()

    this.loading.set(sourceId, task)
    try {
      return await task
    } finally {
      this.loading.delete(sourceId)
    }
  }

  async loadAllEnabled(): Promise<LoadedSource[]> {
    const sources = await prisma.source.findMany({
      where: { enabled: true },
      orderBy: { priority: 'asc' },
    })
    for (const source of sources) {
      const cached = this.manifests.get(source.id)
      if (cached) cached.priority = source.priority
    }

    const loaded: LoadedSource[] = []
    const queue = [...sources]
    const workers = new Array(Math.min(3, queue.length)).fill(0).map(async () => {
      while (queue.length) {
        const source = queue.shift()
        if (!source) break
        try {
          loaded.push(await this.ensureLoaded(source.id))
        } catch {
          // 单个音源失败不影响其它音源
        }
      }
    })
    await Promise.all(workers)
    loaded.sort((a, b) => a.priority - b.priority)
    this.manifestCache = loaded
    this.manifestAt = Date.now()
    return loaded
  }

  async getManifest(force = false): Promise<LoadedSource[]> {
    if (!force && this.manifestCache && Date.now() - this.manifestAt < 15_000) {
      return this.manifestCache
    }
    return this.loadAllEnabled()
  }

  async getChannelsForPlatform(platform: Platform): Promise<LoadedSource[]> {
    const manifest = await this.getManifest()
    return manifest
      .filter((s) => s.platforms.includes(platform))
      .sort((a, b) => {
        const rankA = defaultPlatformRank(platform, a.name)
        const rankB = defaultPlatformRank(platform, b.name)
        if (rankA !== rankB) return rankA - rankB
        return a.priority - b.priority
      })
  }

  async resolve(
    sourceId: string,
    platform: Platform,
    quality: string,
    musicInfo: Record<string, unknown>
  ): Promise<{ url: string; sourceId: string; elapsedMs: number }> {
    const loaded = await this.ensureLoaded(sourceId)
    if (!loaded.platforms.includes(platform)) {
      throw new Error(`${loaded.name} 不支持平台 ${platform}`)
    }
    if (!loaded.qualities[platform]?.includes(quality)) {
      throw new Error(`${loaded.name} 在 ${platform} 不支持音质 ${quality}`)
    }

    const client = this.clients.get(sourceId)
    if (!client) throw new Error('音源 worker 不可用')

    const started = Date.now()
    const result = await client.call({
      source: platform,
      action: 'musicUrl',
      info: { type: quality, musicInfo: JSON.parse(JSON.stringify(musicInfo)) },
    })

    const url =
      typeof result === 'string'
        ? result
        : result && typeof result === 'object' && typeof (result as { url?: unknown }).url === 'string'
          ? (result as { url: string }).url
          : ''

    if (!url) throw new Error('音源返回空链接')
    return { url, sourceId, elapsedMs: Date.now() - started }
  }

  async reload(sourceId: string): Promise<LoadedSource> {
    await this.dispose(sourceId)
    return this.ensureLoaded(sourceId, { allowDisabled: true })
  }

  async dispose(sourceId: string) {
    const client = this.clients.get(sourceId)
    this.clients.delete(sourceId)
    this.manifests.delete(sourceId)
    this.manifestCache = null
    if (client) await client.dispose()
  }

  getStatus(sourceId: string) {
    return {
      loaded: this.manifests.get(sourceId) || null,
      logs: this.clients.get(sourceId)?.getLogs() || [],
    }
  }

  invalidate() {
    this.manifestCache = null
  }
}

const globalForManager = globalThis as unknown as { __sourceManager?: SourceManager }

export const sourceManager: SourceManager =
  globalForManager.__sourceManager ?? (globalForManager.__sourceManager = new SourceManager())
