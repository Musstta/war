-- Migration: add hasMarket to TerritoryState (v0.32)
ALTER TABLE "TerritoryState" ADD COLUMN "hasMarket" BOOLEAN NOT NULL DEFAULT false;
