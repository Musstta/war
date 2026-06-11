-- Phase 7: Federation scaffolding for fog-of-war visibility grants.
-- No federation actions yet — tables exist so computeVisibility can query them.

CREATE TABLE "Federation" (
    "id"            SERIAL PRIMARY KEY,
    "name"          TEXT NOT NULL,
    "foundedAtTick" INTEGER NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE "FederationMember" (
    "id"           SERIAL PRIMARY KEY,
    "federationId" INTEGER NOT NULL,
    "nationId"     TEXT NOT NULL,
    "joinedAtTick" INTEGER NOT NULL,
    "role"         TEXT NOT NULL DEFAULT 'member',
    CONSTRAINT "FederationMember_federationId_fkey"
        FOREIGN KEY ("federationId") REFERENCES "Federation"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FederationMember_federationId_nationId_key"
    ON "FederationMember"("federationId", "nationId");

CREATE INDEX "FederationMember_nationId_idx"
    ON "FederationMember"("nationId");
