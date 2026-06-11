-- Migration: v0.28 movement model + TerritoryModifier + BorderSkirmish + TreatyHistory

-- Army: multi-tick transit fields
ALTER TABLE "Army"
  ADD COLUMN IF NOT EXISTS "transitPath" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "transitTicksRemaining" INTEGER NOT NULL DEFAULT 0;

-- TerritoryModifier: temporary effects on territories
CREATE TABLE IF NOT EXISTS "TerritoryModifier" (
  "id"                   SERIAL PRIMARY KEY,
  "territoryId"          TEXT NOT NULL,
  "source"               TEXT NOT NULL,
  "movementMultiplier"   DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "productionMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "unrestEquilibriumAdj" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "driftRateMultiplier"  DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "defenseBonus"         DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "startTick"            INTEGER NOT NULL,
  "durationTicks"        INTEGER,
  "expiresAtTick"        INTEGER
);
CREATE INDEX IF NOT EXISTS "TerritoryModifier_territoryId_idx" ON "TerritoryModifier"("territoryId");
CREATE INDEX IF NOT EXISTS "TerritoryModifier_expiresAtTick_idx" ON "TerritoryModifier"("expiresAtTick");

-- BorderSkirmish: skirmish event records
CREATE TABLE IF NOT EXISTS "BorderSkirmish" (
  "id"             SERIAL PRIMARY KEY,
  "tick"           INTEGER NOT NULL,
  "territoryId"    TEXT NOT NULL,
  "nationAId"      TEXT NOT NULL,
  "nationBId"      TEXT NOT NULL,
  "armySizeA"      INTEGER NOT NULL,
  "armySizeB"      INTEGER NOT NULL,
  "winnerId"       TEXT,
  "fullCasusBelli" BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS "BorderSkirmish_tick_idx" ON "BorderSkirmish"("tick");
CREATE INDEX IF NOT EXISTS "BorderSkirmish_nations_idx" ON "BorderSkirmish"("nationAId", "nationBId");

-- TreatyHistory: maintain_peace consecutive tracking
CREATE TABLE IF NOT EXISTS "TreatyHistory" (
  "id"           SERIAL PRIMARY KEY,
  "nationAId"    TEXT NOT NULL,
  "nationBId"    TEXT NOT NULL,
  "clauseType"   TEXT NOT NULL,
  "signedAtTick" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "TreatyHistory_nations_clause_idx" ON "TreatyHistory"("nationAId", "nationBId", "clauseType");
