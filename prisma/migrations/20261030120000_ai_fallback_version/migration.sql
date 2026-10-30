ALTER TABLE "DownloadJob" ADD COLUMN "requestLine" TEXT;
ALTER TABLE "DownloadJob" ADD COLUMN "fallbackCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DownloadJob" ADD COLUMN "versionCheck" TEXT;
