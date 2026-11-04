CREATE TABLE "LibraryScanCache" (
    "path" TEXT NOT NULL PRIMARY KEY,
    "size" INTEGER NOT NULL,
    "mtimeMs" REAL NOT NULL,
    "coverChecked" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "LyricsLookup" (
    "path" TEXT NOT NULL PRIMARY KEY,
    "signature" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" DATETIME NOT NULL
);
