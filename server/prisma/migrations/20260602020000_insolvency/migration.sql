-- Phase 5 Insolvency: add debtBalance to Nation.
-- Tracks cumulative wealth debt while wealthStock < 0.
-- Cleared via DEBT_RECOVERY_SKIM_RATE applied to incoming wealth during recovery.

ALTER TABLE "Nation" ADD COLUMN "debtBalance" DOUBLE PRECISION NOT NULL DEFAULT 0;
