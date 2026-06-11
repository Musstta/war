-- Migration: v0.33 trade routes
-- Adds portLevel to TerritoryState and creates TradeRouteAgreement + TradeShipment tables.

-- Step 1: Add portLevel to TerritoryState
ALTER TABLE "TerritoryState" ADD COLUMN "portLevel" INTEGER NOT NULL DEFAULT 1;

-- Step 2: Create TradeRouteAgreement table
CREATE TABLE "TradeRouteAgreement" (
    "id"                     SERIAL PRIMARY KEY,
    "treatyClauseId"         INTEGER UNIQUE,
    "ownerNationId"          TEXT NOT NULL,
    "partnerNationId"        TEXT,
    "type"                   TEXT NOT NULL,
    "sourceTerritoryId"      TEXT NOT NULL,
    "destinationTerritoryId" TEXT NOT NULL,
    "path"                   JSONB NOT NULL DEFAULT '[]',
    "pathComputedAtTick"     INTEGER NOT NULL,
    "portLevel"              INTEGER NOT NULL DEFAULT 1,
    "baseCapacity"           DOUBLE PRECISION NOT NULL,
    "currentCapacity"        DOUBLE PRECISION NOT NULL,
    "growthCap"              DOUBLE PRECISION NOT NULL,
    "cyclesCompleted"        INTEGER NOT NULL DEFAULT 0,
    "profitMultiplier"       DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "upkeepRate"             DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "status"                 TEXT NOT NULL DEFAULT 'active',
    "startedAtTick"          INTEGER NOT NULL
);

-- FK constraint for treatyClauseId
ALTER TABLE "TradeRouteAgreement"
    ADD CONSTRAINT "TradeRouteAgreement_treatyClauseId_fkey"
    FOREIGN KEY ("treatyClauseId") REFERENCES "TreatyClause"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "TradeRouteAgreement_ownerNationId_idx"          ON "TradeRouteAgreement"("ownerNationId");
CREATE INDEX "TradeRouteAgreement_partnerNationId_idx"         ON "TradeRouteAgreement"("partnerNationId");
CREATE INDEX "TradeRouteAgreement_sourceTerritoryId_idx"       ON "TradeRouteAgreement"("sourceTerritoryId");
CREATE INDEX "TradeRouteAgreement_destinationTerritoryId_idx"  ON "TradeRouteAgreement"("destinationTerritoryId");

-- Step 3: Create TradeShipment table
CREATE TABLE "TradeShipment" (
    "id"                    SERIAL PRIMARY KEY,
    "routeId"               INTEGER NOT NULL,
    "path"                  JSONB NOT NULL DEFAULT '[]',
    "transitTicksRemaining" INTEGER NOT NULL DEFAULT 1,
    "cargoAmount"           DOUBLE PRECISION NOT NULL,
    "cargoResource"         TEXT NOT NULL DEFAULT 'wealth',
    "direction"             TEXT NOT NULL DEFAULT 'forward',
    "departedAtTick"        INTEGER NOT NULL,

    CONSTRAINT "TradeShipment_routeId_fkey"
        FOREIGN KEY ("routeId") REFERENCES "TradeRouteAgreement"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TradeShipment_routeId_idx" ON "TradeShipment"("routeId");
