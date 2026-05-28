-- Phase 4 Culture & Unrest sub-phase
-- Adds: revolt state per territory, capital territory reference per nation.
-- Trait values (individualist, progressive, militaristic, expansionist) are
-- NOT migrated in-place — their scale changes from [0,1] to [-1,+1].
-- Run POST /api/dev/reset-world after deploying to reinitialize with new seed data.

ALTER TABLE "TerritoryState" ADD COLUMN "isInRevolt" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Nation" ADD COLUMN "capitalTerritoryId" TEXT;
