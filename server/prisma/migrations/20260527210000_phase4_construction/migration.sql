-- Phase 4: add construction slot to TerritoryState
ALTER TABLE "TerritoryState" ADD COLUMN "constructionType" TEXT;
ALTER TABLE "TerritoryState" ADD COLUMN "constructionTicksLeft" INTEGER;
