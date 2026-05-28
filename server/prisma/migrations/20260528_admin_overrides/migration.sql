-- Admin-overridable fields on TerritoryState.
-- All nullable; NULL = use the def/default value (no override).
ALTER TABLE "TerritoryState" ADD COLUMN "culturalFamily" TEXT;
