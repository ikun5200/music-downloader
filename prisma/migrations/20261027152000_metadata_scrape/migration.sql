-- 下载完成后自动刮削元数据（iTunes / QQ 音乐）
ALTER TABLE "DownloadJob" ADD COLUMN "metadataStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "DownloadJob" ADD COLUMN "metadataSource" TEXT;
ALTER TABLE "DownloadJob" ADD COLUMN "metadataTitle" TEXT;
ALTER TABLE "DownloadJob" ADD COLUMN "metadataArtist" TEXT;
ALTER TABLE "DownloadJob" ADD COLUMN "metadataAlbum" TEXT;
ALTER TABLE "DownloadJob" ADD COLUMN "metadataNote" TEXT;
ALTER TABLE "DownloadJob" ADD COLUMN "metadataAt" DATETIME;

CREATE INDEX "DownloadJob_metadataStatus_idx" ON "DownloadJob"("metadataStatus");
