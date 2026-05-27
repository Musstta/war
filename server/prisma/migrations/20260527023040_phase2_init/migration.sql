-- CreateTable
CREATE TABLE "WorldMeta" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "tick" INTEGER NOT NULL DEFAULT 0,
    "rngSeed" INTEGER NOT NULL DEFAULT 42,

    CONSTRAINT "WorldMeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Nation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isAI" BOOLEAN NOT NULL,
    "armySize" INTEGER NOT NULL DEFAULT 0,
    "trust" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "prestige" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "popStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "indStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wealthStock" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Nation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerritoryState" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "fortificationLevel" INTEGER NOT NULL DEFAULT 0,
    "hasRoad" BOOLEAN NOT NULL DEFAULT false,
    "hasPort" BOOLEAN NOT NULL DEFAULT false,
    "unrest" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "individualist" DOUBLE PRECISION NOT NULL,
    "progressive" DOUBLE PRECISION NOT NULL,
    "militaristic" DOUBLE PRECISION NOT NULL,
    "expansionist" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "TerritoryState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueuedAction" (
    "id" SERIAL NOT NULL,
    "nationId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "tickQueued" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueuedAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLog" (
    "id" SERIAL NOT NULL,
    "tick" INTEGER NOT NULL,
    "message" TEXT NOT NULL,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventLog_tick_idx" ON "EventLog"("tick");

-- AddForeignKey
ALTER TABLE "TerritoryState" ADD CONSTRAINT "TerritoryState_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Nation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueuedAction" ADD CONSTRAINT "QueuedAction_nationId_fkey" FOREIGN KEY ("nationId") REFERENCES "Nation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
