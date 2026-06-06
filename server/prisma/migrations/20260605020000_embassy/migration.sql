-- Migration: v0.29 embassy system (§1.6)

-- Embassy table: one row per bilateral (ownerNationId, hostTerritoryId) pair.
-- status: 'proposed' | 'under_construction' | 'active' | 'expelled' | 'destroyed'
CREATE TABLE IF NOT EXISTS "Embassy" (
  "id"                    SERIAL PRIMARY KEY,
  "ownerNationId"         TEXT NOT NULL,
  "hostTerritoryId"       TEXT NOT NULL,
  "status"                TEXT NOT NULL DEFAULT 'proposed',
  "constructionTicksLeft" INTEGER NOT NULL DEFAULT 0,
  "startedAtTick"         INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "Embassy_owner_host_unique" UNIQUE ("ownerNationId", "hostTerritoryId")
);
CREATE INDEX IF NOT EXISTS "Embassy_hostTerritoryId_idx" ON "Embassy"("hostTerritoryId");
CREATE INDEX IF NOT EXISTS "Embassy_ownerNationId_idx" ON "Embassy"("ownerNationId");
