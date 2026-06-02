-- CreateTable: War
-- Tracks active and ended wars between nations.
CREATE TABLE "War" (
    "id"                  SERIAL PRIMARY KEY,
    "attackerId"          TEXT NOT NULL,
    "defenderId"          TEXT NOT NULL,
    "type"                TEXT NOT NULL DEFAULT 'conquest',
    "hasCasusBelli"       BOOLEAN NOT NULL DEFAULT true,
    "status"              TEXT NOT NULL DEFAULT 'active',
    "startTick"           INTEGER NOT NULL,
    "declaredTick"        INTEGER NOT NULL,
    "endTick"             INTEGER,
    "occupiedTerritories" JSONB NOT NULL DEFAULT '[]',
    "pendingPeaceDeal"    JSONB,
    CONSTRAINT "War_attackerId_fkey"
        FOREIGN KEY ("attackerId") REFERENCES "Nation"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "War_defenderId_fkey"
        FOREIGN KEY ("defenderId") REFERENCES "Nation"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Index for fast lookup of active wars by participant.
CREATE INDEX "War_attackerId_idx" ON "War"("attackerId");
CREATE INDEX "War_defenderId_idx" ON "War"("defenderId");
CREATE INDEX "War_status_idx"     ON "War"("status");
