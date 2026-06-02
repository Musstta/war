-- AlterTable
ALTER TABLE "TerritoryState" ADD COLUMN     "localIndStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "localPopStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "localWltStock" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TreatyClause" ADD COLUMN     "clauseIndex" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "clauseStatus" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "missedPayments" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "InstantTrade" (
    "id" SERIAL NOT NULL,
    "proposerNationId" TEXT NOT NULL,
    "targetNationId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "sourceTerritoryId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tickProposed" INTEGER NOT NULL,
    "expiresAtTick" INTEGER NOT NULL,

    CONSTRAINT "InstantTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeRoute" (
    "id" SERIAL NOT NULL,
    "treatyClauseId" INTEGER NOT NULL,
    "sourceTerritoryId" TEXT NOT NULL,
    "destinationNationId" TEXT NOT NULL,
    "path" JSONB NOT NULL DEFAULT '[]',
    "pathComputedAtTick" INTEGER NOT NULL,
    "pathStale" BOOLEAN NOT NULL DEFAULT false,
    "capacity" DOUBLE PRECISION,
    "friction" DOUBLE PRECISION,
    "isSeaRoute" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TradeRoute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TradeRoute_treatyClauseId_key" ON "TradeRoute"("treatyClauseId");

-- AddForeignKey
ALTER TABLE "TradeRoute" ADD CONSTRAINT "TradeRoute_treatyClauseId_fkey" FOREIGN KEY ("treatyClauseId") REFERENCES "TreatyClause"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
