import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: projectRoot,
  serverExternalPackages: ['@prisma/client', 'prisma', 'bcryptjs'],
  experimental: {
    serverActions: { bodySizeLimit: '3mb' },
  },
}
export default nextConfig
