-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "platforms" TEXT NOT NULL DEFAULT '[]',
    "qualities" TEXT NOT NULL DEFAULT '{}',
    "lastInitAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SourceStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "successes" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "cooldownUntil" DATETIME,
    "avgLatencyMs" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" DATETIME,
    "lastError" TEXT,
    CONSTRAINT "SourceStat_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DownloadJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "songId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "album" TEXT,
    "coverUrl" TEXT,
    "musicInfo" TEXT NOT NULL,
    "requestedQuality" TEXT,
    "actualQuality" TEXT,
    "qualityVerdict" TEXT,
    "channelId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" REAL NOT NULL DEFAULT 0,
    "bytesDone" INTEGER NOT NULL DEFAULT 0,
    "bytesTotal" INTEGER,
    "filePath" TEXT,
    "urlHost" TEXT,
    "attempts" TEXT NOT NULL DEFAULT '[]',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "reviewNote" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "DownloadJob_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Source" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SourceStat_sourceId_idx" ON "SourceStat"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceStat_sourceId_platform_key" ON "SourceStat"("sourceId", "platform");

-- CreateIndex
CREATE INDEX "DownloadJob_status_idx" ON "DownloadJob"("status");

-- CreateIndex
CREATE INDEX "DownloadJob_createdAt_idx" ON "DownloadJob"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");
