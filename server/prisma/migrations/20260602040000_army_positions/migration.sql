-- Phase 6: Army positioning + territory claims.
-- Replaces flat armySize on Nation with positioned Army rows.
-- Each existing nation gets one Army at its capital with size=50 (behavior-preserving).

CREATE TABLE "Army" (
    "id"                     SERIAL PRIMARY KEY,
    "nationId"               TEXT NOT NULL,
    "territoryId"            TEXT NOT NULL,
    "size"                   INTEGER NOT NULL,
    "status"                 TEXT NOT NULL DEFAULT 'stationed',
    "destinationTerritoryId" TEXT,
    "movedThisTick"          BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Army_nationId_fkey" FOREIGN KEY ("nationId") REFERENCES "Nation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Army_nationId_idx" ON "Army"("nationId");
CREATE INDEX "Army_territoryId_idx" ON "Army"("territoryId");

CREATE TABLE "TerritoryClaim" (
    "id"                    SERIAL PRIMARY KEY,
    "nationId"              TEXT NOT NULL,
    "territoryId"           TEXT NOT NULL,
    "claimedAtTick"         INTEGER NOT NULL,
    "pacificationProgress"  DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "TerritoryClaim_nationId_fkey" FOREIGN KEY ("nationId") REFERENCES "Nation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "TerritoryClaim_nationId_idx" ON "TerritoryClaim"("nationId");
CREATE INDEX "TerritoryClaim_territoryId_idx" ON "TerritoryClaim"("territoryId");

-- Seed one Army per existing nation: size=50, stationed at capital.
-- Nations with no capital get army at their first owned territory.
INSERT INTO "Army" ("nationId", "territoryId", "size", "status")
SELECT
    n.id,
    COALESCE(n."capitalTerritoryId",
             (SELECT ts.id FROM "TerritoryState" ts WHERE ts."ownerId" = n.id LIMIT 1),
             'costa_rica'),   -- final fallback: shouldn't be needed
    50,
    'stationed'
FROM "Nation" n
WHERE n."capitalTerritoryId" IS NOT NULL
   OR EXISTS (SELECT 1 FROM "TerritoryState" ts WHERE ts."ownerId" = n.id);
