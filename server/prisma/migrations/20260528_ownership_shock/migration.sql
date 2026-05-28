-- Conquest shock: decaying unrest spike applied when a territory changes owner (design doc §12.1).
ALTER TABLE "TerritoryState" ADD COLUMN "ownershipShock" DOUBLE PRECISION NOT NULL DEFAULT 0;
-- Tick when this territory last changed owner (null = native, never conquered).
ALTER TABLE "TerritoryState" ADD COLUMN "acquiredTick" INTEGER;
