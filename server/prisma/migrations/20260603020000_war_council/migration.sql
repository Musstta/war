-- Phase 9: War council coordination layer.
-- WarCouncil: one per side per war, created at war start.
-- CouncilQueuedAction: read-only mirror of military actions, cleared after tick.

CREATE TABLE "WarCouncil" (
    "id"              SERIAL PRIMARY KEY,
    "warId"           INTEGER NOT NULL,
    "side"            TEXT NOT NULL,         -- 'attacker' | 'defender'
    "memberNationIds" JSONB NOT NULL DEFAULT '[]'
);

CREATE INDEX "WarCouncil_warId_idx" ON "WarCouncil"("warId");

CREATE TABLE "CouncilQueuedAction" (
    "id"                SERIAL PRIMARY KEY,
    "councilId"         INTEGER NOT NULL,
    "nationId"          TEXT NOT NULL,
    "actionType"        TEXT NOT NULL,       -- 'attack_territory' | 'move_army' | 'retreat_army'
    "targetTerritoryId" TEXT,
    "tick"              INTEGER NOT NULL,
    CONSTRAINT "CouncilQueuedAction_councilId_fkey"
        FOREIGN KEY ("councilId") REFERENCES "WarCouncil"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CouncilQueuedAction_councilId_idx"
    ON "CouncilQueuedAction"("councilId");
