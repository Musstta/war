-- v0.36 Lobby system: extend Game, add GameMembership, FastForwardVote

-- Extend Game table: new columns for lobby lifecycle
ALTER TABLE "Game" ADD COLUMN IF NOT EXISTS "endedAt" TIMESTAMP(3);
ALTER TABLE "Game" ADD COLUMN IF NOT EXISTS "endReason" TEXT;
ALTER TABLE "Game" ADD COLUMN IF NOT EXISTS "removedSlots" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Game" ADD COLUMN IF NOT EXISTS "aiSlots" JSONB NOT NULL DEFAULT '[]';

-- Change status default to 'lobby' for new games; existing legacy-world row stays 'active'
-- (no ALTER DEFAULT needed — the default is only used for new INSERT rows)

-- Change hostUserId type from String? to Int?
-- The legacy-world row has NULL hostUserId, so this is safe
ALTER TABLE "Game" ALTER COLUMN "hostUserId" TYPE INTEGER USING ("hostUserId"::INTEGER);

-- GameMembership: one row per player slot in a game
CREATE TABLE IF NOT EXISTS "GameMembership" (
    "id"        SERIAL PRIMARY KEY,
    "gameId"    TEXT NOT NULL,
    "userId"    INTEGER NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "nationId"  TEXT,
    "joinedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameMembership_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GameMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GameMembership_gameId_userId_key" UNIQUE ("gameId", "userId"),
    CONSTRAINT "GameMembership_gameId_slotIndex_key" UNIQUE ("gameId", "slotIndex")
);

CREATE INDEX IF NOT EXISTS "GameMembership_gameId_idx" ON "GameMembership"("gameId");
CREATE INDEX IF NOT EXISTS "GameMembership_userId_idx" ON "GameMembership"("userId");

-- FastForwardVote: one row per player vote per tick
CREATE TABLE IF NOT EXISTS "FastForwardVote" (
    "id"         SERIAL PRIMARY KEY,
    "gameId"     TEXT NOT NULL,
    "userId"     INTEGER NOT NULL,
    "tickNumber" INTEGER NOT NULL,
    "votedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FastForwardVote_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FastForwardVote_gameId_userId_key" UNIQUE ("gameId", "userId")
);

CREATE INDEX IF NOT EXISTS "FastForwardVote_gameId_idx" ON "FastForwardVote"("gameId");
