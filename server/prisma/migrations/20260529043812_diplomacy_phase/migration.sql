-- AlterTable
ALTER TABLE "Nation" ADD COLUMN     "inactivityTier" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "lastBrokenPromiseTick" INTEGER;

-- CreateTable
CREATE TABLE "Proposal" (
    "id" SERIAL NOT NULL,
    "proposerId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "termTicks" INTEGER NOT NULL,
    "proposerCollateral" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "targetCollateral" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tickProposed" INTEGER NOT NULL,
    "expiresAtTick" INTEGER NOT NULL,
    "parentProposalId" INTEGER,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalClause" (
    "id" SERIAL NOT NULL,
    "proposalId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "collateral" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ProposalClause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Treaty" (
    "id" SERIAL NOT NULL,
    "proposalId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "termTicks" INTEGER NOT NULL,
    "tickStarted" INTEGER NOT NULL,
    "tickEnds" INTEGER NOT NULL,
    "totalCollateral" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "breakerNationId" TEXT,

    CONSTRAINT "Treaty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreatyParty" (
    "id" SERIAL NOT NULL,
    "treatyId" INTEGER NOT NULL,
    "nationId" TEXT NOT NULL,
    "collateralDeposited" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "escrowAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "escrowStartTick" INTEGER,
    "refundRemaining" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "refundStartTick" INTEGER,

    CONSTRAINT "TreatyParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreatyClause" (
    "id" SERIAL NOT NULL,
    "treatyId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "collateral" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "TreatyClause_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Treaty_proposalId_key" ON "Treaty"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "TreatyParty_treatyId_nationId_key" ON "TreatyParty"("treatyId", "nationId");

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "Nation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Nation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalClause" ADD CONSTRAINT "ProposalClause_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Treaty" ADD CONSTRAINT "Treaty_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatyParty" ADD CONSTRAINT "TreatyParty_treatyId_fkey" FOREIGN KEY ("treatyId") REFERENCES "Treaty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatyParty" ADD CONSTRAINT "TreatyParty_nationId_fkey" FOREIGN KEY ("nationId") REFERENCES "Nation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatyClause" ADD CONSTRAINT "TreatyClause_treatyId_fkey" FOREIGN KEY ("treatyId") REFERENCES "Treaty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
