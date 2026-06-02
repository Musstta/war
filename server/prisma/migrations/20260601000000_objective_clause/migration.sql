-- CreateTable: ObjectiveClause
-- One row per TreatyClause where type = 'objective'.
-- Stores the structured objective data used by the engine evaluator each tick.
CREATE TABLE "ObjectiveClause" (
    "id"                SERIAL PRIMARY KEY,
    "treatyClauseId"    INTEGER NOT NULL UNIQUE,
    "objectiveType"     TEXT NOT NULL,
    "targetNationId"    TEXT,
    "targetTerritoryId" TEXT,
    "deadlineTicks"     INTEGER NOT NULL,
    "status"            TEXT NOT NULL DEFAULT 'pending',
    "responsibleParty"  TEXT NOT NULL DEFAULT 'partyA',
    CONSTRAINT "ObjectiveClause_treatyClauseId_fkey"
        FOREIGN KEY ("treatyClauseId")
        REFERENCES "TreatyClause"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
