-- Phase 6 Prompt 2: add doctrineBlend to Nation.
-- Null for human nations; JSON object for AI nations.

ALTER TABLE "Nation" ADD COLUMN "doctrineBlend" JSONB;
