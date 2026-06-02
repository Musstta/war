-- Phase 6 Activity Tiers: add player inactivity tracking fields to Nation.

ALTER TABLE "Nation"
  ADD COLUMN "lastActiveAt"        TIMESTAMP(3),
  ADD COLUMN "activityTier"        TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "abandonedAt"         TIMESTAMP(3),
  ADD COLUMN "caretakerPriorities" JSONB NOT NULL DEFAULT '["defense","roads","industry","expansion"]';
