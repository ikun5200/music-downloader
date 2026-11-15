-- CreateTable
CREATE TABLE "DownloadedTrack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "path" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "album" TEXT,
    "titleKey" TEXT NOT NULL,
    "artistKey" TEXT NOT NULL,
    "versionKey" TEXT NOT NULL DEFAULT '',
    "duration" REAL,
    "size" INTEGER NOT NULL,
    "mtimeMs" REAL NOT NULL,
    "downloadJobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BatchJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "quality" TEXT,
    "total" INTEGER NOT NULL,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME
);
INSERT INTO "new_BatchJob" ("createdAt", "error", "failed", "finishedAt", "id", "processed", "quality", "startedAt", "status", "succeeded", "total") SELECT "createdAt", "error", "failed", "finishedAt", "id", "processed", "quality", "startedAt", "status", "succeeded", "total" FROM "BatchJob";
DROP TABLE "BatchJob";
ALTER TABLE "new_BatchJob" RENAME TO "BatchJob";
CREATE INDEX "BatchJob_status_idx" ON "BatchJob"("status");
CREATE INDEX "BatchJob_createdAt_idx" ON "BatchJob"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "DownloadedTrack_path_key" ON "DownloadedTrack"("path");

-- CreateIndex
CREATE INDEX "DownloadedTrack_titleKey_artistKey_idx" ON "DownloadedTrack"("titleKey", "artistKey");

-- CreateIndex
CREATE INDEX "DownloadedTrack_titleKey_idx" ON "DownloadedTrack"("titleKey");

-- CreateIndex
CREATE INDEX "DownloadedTrack_artistKey_idx" ON "DownloadedTrack"("artistKey");

-- CreateIndex
CREATE INDEX "DownloadedTrack_versionKey_idx" ON "DownloadedTrack"("versionKey");

-- CreateIndex
CREATE INDEX "DownloadedTrack_lastSeenAt_idx" ON "DownloadedTrack"("lastSeenAt");
