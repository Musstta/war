-- v0.37: Territory selection phase
-- Adds territory_selection status support, TerritoryCandidate table,
-- and per-player rerollUsed + confirmedTerritoryId on GameMembership.

-- Game: add territorySelectionStartedAt
ALTER TABLE "Game" ADD COLUMN IF NOT EXISTS "territorySelectionStartedAt" TIMESTAMP(3);

-- GameMembership: v0.37 territory selection state
ALTER TABLE "GameMembership" ADD COLUMN IF NOT EXISTS "rerollUsed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GameMembership" ADD COLUMN IF NOT EXISTS "confirmedTerritoryId" TEXT;

-- TerritoryCandidate: per-player candidate pool
CREATE TABLE IF NOT EXISTS "TerritoryCandidate" (
    "id"          SERIAL PRIMARY KEY,
    "gameId"      TEXT NOT NULL,
    "userId"      INTEGER NOT NULL,
    "slotIndex"   INTEGER NOT NULL,
    "territoryId" TEXT NOT NULL,
    "confirmed"   BOOLEAN NOT NULL DEFAULT false,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TerritoryCandidate_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "TerritoryCandidate_gameId_idx" ON "TerritoryCandidate"("gameId");
CREATE INDEX IF NOT EXISTS "TerritoryCandidate_gameId_userId_idx" ON "TerritoryCandidate"("gameId", "userId");
