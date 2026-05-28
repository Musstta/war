-- Adds pre-queued next construction slot.
-- Mandate + industry are deducted at queue time; this column just stores the intent.
ALTER TABLE "TerritoryState" ADD COLUMN "pendingConstructionType" TEXT;
