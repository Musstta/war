-- Phase 8: Full Prestige formula + Dominant qualification.
-- Adds cumulative counters, foundedAtTick, isDominant to Nation.
-- Adds PrestigeHistory for sparklines and secondary stats.

ALTER TABLE "Nation"
    ADD COLUMN "completedTreatiesKept"  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "warsWon"                INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "foundedAtTick"          INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "isDominant"             BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "underdogBuffExpiresAt"  INTEGER;

-- PrestigeHistory: one row per nation per tick.
-- Used for sparklines (last 20 ticks) and secondary stat queries.
CREATE TABLE "PrestigeHistory" (
    "id"       SERIAL PRIMARY KEY,
    "nationId" TEXT NOT NULL,
    "tick"     INTEGER NOT NULL,
    "prestige" DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE INDEX "PrestigeHistory_nationId_tick_idx"
    ON "PrestigeHistory"("nationId", "tick");
