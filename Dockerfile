# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=file:/tmp/build.db
RUN npm run build

# Prisma CLI only needs these packages at runtime for `migrate deploy`.
# The Next standalone output already carries @prisma/client and .prisma/client.
RUN tar -cf /prisma-cli.tar \
  node_modules/prisma \
  node_modules/@prisma/config \
  node_modules/@prisma/debug \
  node_modules/@prisma/engines \
  node_modules/@prisma/engines-version \
  node_modules/@prisma/fetch-engine \
  node_modules/@prisma/get-platform \
  node_modules/@standard-schema/spec \
  node_modules/c12 \
  node_modules/chokidar \
  node_modules/citty \
  node_modules/confbox \
  node_modules/consola \
  node_modules/deepmerge-ts \
  node_modules/defu \
  node_modules/destr \
  node_modules/dotenv \
  node_modules/effect \
  node_modules/empathic \
  node_modules/exsolve \
  node_modules/fast-check \
  node_modules/giget \
  node_modules/jiti \
  node_modules/node-fetch-native \
  node_modules/nypm \
  node_modules/ohash \
  node_modules/pathe \
  node_modules/perfect-debounce \
  node_modules/pkg-types \
  node_modules/pure-rand \
  node_modules/rc9 \
  node_modules/readdirp \
  node_modules/tinyexec

FROM node:22-bookworm-slim AS runner

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates tini gosu passwd \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DOWNLOAD_DIR=/downloads \
    DATABASE_URL=file:/app/data/app.db

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/worker ./worker
COPY --from=builder /prisma-cli.tar /tmp/prisma-cli.tar

RUN tar -xf /tmp/prisma-cli.tar -C /app \
  && rm /tmp/prisma-cli.tar \
  && mkdir -p /app/data /downloads \
  && chown -R node:node /app/data /downloads

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
