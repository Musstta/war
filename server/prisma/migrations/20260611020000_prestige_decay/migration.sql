-- v0.40: Prestige decay fields + population transfer compat-scaling fix.
-- Adds warsLost, territoriesLost to Nation (for Prestige decay formula).
-- Adds populationTransferShockMagnitude to TerritoryState (per-territory compat-scaled shock).

ALTER TABLE "Nation" ADD COLUMN "warsLost" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Nation" ADD COLUMN "territoriesLost" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TerritoryState" ADD COLUMN "populationTransferShockMagnitude" DOUBLE PRECISION NOT NULL DEFAULT 0;
