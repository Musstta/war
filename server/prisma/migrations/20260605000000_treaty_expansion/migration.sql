-- Migration: v0.27 treaty system expansion
-- Add new TerritoryState columns for embassy stub and population transfer shock.

ALTER TABLE "TerritoryState"
  ADD COLUMN IF NOT EXISTS "hasEmbassy" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "populationTransferShockTicksLeft" INTEGER NOT NULL DEFAULT 0;
