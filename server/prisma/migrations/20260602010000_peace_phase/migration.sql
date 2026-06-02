-- Phase 5 Peace Negotiation: add exhaustionByNation to War table.
-- Tracks ticks until exhaustion expires for nations that declined a peace proposal.

ALTER TABLE "War" ADD COLUMN "exhaustionByNation" JSONB NOT NULL DEFAULT '{}';
