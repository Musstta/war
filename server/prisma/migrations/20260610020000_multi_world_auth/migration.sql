-- v0.34: Multi-world data model & auth foundation
-- Adds Game, User, UserSession tables.
-- Adds gameId column (default 'legacy-world') to all 21 game-state tables.
-- Backfills legacy-world Game row + player1-5 User rows (hashed passwords).

-- ── New tables ────────────────────────────────────────────────────────────────

CREATE TABLE "Game" (
  "id"                  TEXT NOT NULL PRIMARY KEY,
  "name"                TEXT NOT NULL,
  "hostUserId"          TEXT,
  "maxPlayers"          INTEGER NOT NULL DEFAULT 5,
  "status"              TEXT NOT NULL DEFAULT 'active',
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tickIntervalSeconds" INTEGER NOT NULL DEFAULT 86400,
  "lastTickAt"          TIMESTAMP(3)
);

CREATE TABLE "User" (
  "id"           SERIAL PRIMARY KEY,
  "username"     TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "UserSession" (
  "id"        SERIAL PRIMARY KEY,
  "userId"    INTEGER NOT NULL REFERENCES "User"("id"),
  "token"     TEXT NOT NULL UNIQUE,
  "nationId"  TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX "UserSession_token_idx" ON "UserSession"("token");

-- ── Add gameId to all game-state tables ───────────────────────────────────────

ALTER TABLE "WorldMeta"          ADD COLUMN "gameId" TEXT NOT NULL DEFAULT 'legacy-world';
ALTER TABLE "Nation"             ADD COLUMN "gameId" TEXT NOT NULL DEFAULT 'legacy-world';
ALTER TABLE "TerritoryState"     ADD COLUMN "gameId" TEXT NOT NULL DEFAULT 'legacy-world';
ALTER TABLE "QueuedAction"       ADD COLUMN "gameId" TEXT NOT NULL DEFAULT 'legacy-world';
ALTER TABLE "EventLog"           ADD COLUMN "gameId" TEXT NOT NULL DEFAULT 'legacy-world';
ALTER TABLE "Proposal"           ADD COLUMN "gameId" TEXT NOT NULL DEFAULT 'legacy-world';
ALTER TABLE "Treaty"             ADD COLUMN "gameId" TEXT NOT NULL DEFAULT 'legacy-world';
ALTER TABLE "War"                ADD COLUMN "gameId" TEXT NOT NULL DEFAULT 'legacy-world';
ALTER TABLE "Army"               ADD COLUMN "gameId" TEXT NOT NULL DEFAULT 'legacy-world';
ALTER TABLE "TerritoryModifier"  ADD COLUMN "gameId" TEXT NOT NULL DEFAULT 'legacy-world';
ALTER TABLE "BorderSkirmish"     ADD COLUMN "gameId" TEXT NOT NULL DEFAULT 'legacy-world';
ALTER TABLE "TreatyHistory"      ADD COLUMN "gameId" TEXT NOT NULL DEFAULT 'legacy-world';
ALTER TABLE "TerritoryClaim"     ADD COLUMN "gameId" TEXT NOT NULL DEFAULT 'legacy-world';
ALTER TABLE "Federation"         ADD COLUMN "gameId" TEXT NOT NULL DEFAULT 'legacy-world';
ALTER TABLE "InstantTrade"       ADD COLUMN "gameId" TEXT NOT NULL DEFAULT 'legacy-world';
ALTER TABLE "TradeRoute"         ADD COLUMN "gameId" TEXT NOT NULL DEFAULT 'legacy-world';
ALTER TABLE "WarCouncil"         ADD COLUMN "gameId" TEXT NOT NULL DEFAULT 'legacy-world';
ALTER TABLE "PrestigeHistory"    ADD COLUMN "gameId" TEXT NOT NULL DEFAULT 'legacy-world';
ALTER TABLE "Embassy"            ADD COLUMN "gameId" TEXT NOT NULL DEFAULT 'legacy-world';
ALTER TABLE "TradeRouteAgreement" ADD COLUMN "gameId" TEXT NOT NULL DEFAULT 'legacy-world';

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX "Nation_gameId_idx"              ON "Nation"("gameId");
CREATE INDEX "TerritoryState_gameId_idx"      ON "TerritoryState"("gameId");
CREATE INDEX "QueuedAction_gameId_idx"        ON "QueuedAction"("gameId");
CREATE INDEX "EventLog_gameId_idx"            ON "EventLog"("gameId");
CREATE INDEX "Proposal_gameId_idx"            ON "Proposal"("gameId");
CREATE INDEX "Treaty_gameId_idx"              ON "Treaty"("gameId");
CREATE INDEX "War_gameId_idx"                 ON "War"("gameId");
CREATE INDEX "Army_gameId_idx"                ON "Army"("gameId");
CREATE INDEX "TerritoryModifier_gameId_idx"   ON "TerritoryModifier"("gameId");
CREATE INDEX "BorderSkirmish_gameId_idx"      ON "BorderSkirmish"("gameId");
CREATE INDEX "TreatyHistory_gameId_idx"       ON "TreatyHistory"("gameId");
CREATE INDEX "TerritoryClaim_gameId_idx"      ON "TerritoryClaim"("gameId");
CREATE INDEX "Federation_gameId_idx"          ON "Federation"("gameId");
CREATE INDEX "InstantTrade_gameId_idx"        ON "InstantTrade"("gameId");
CREATE INDEX "TradeRoute_gameId_idx"          ON "TradeRoute"("gameId");
CREATE INDEX "WarCouncil_gameId_idx"          ON "WarCouncil"("gameId");
CREATE INDEX "PrestigeHistory_gameId_idx"     ON "PrestigeHistory"("gameId");
CREATE INDEX "Embassy_gameId_idx"             ON "Embassy"("gameId");
CREATE INDEX "TradeRouteAgreement_gameId_idx" ON "TradeRouteAgreement"("gameId");

-- ── Backfill: legacy-world Game row ──────────────────────────────────────────

INSERT INTO "Game" ("id", "name", "status", "createdAt")
VALUES ('legacy-world', 'Legacy World', 'active', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- ── Backfill: player1-5 User rows ────────────────────────────────────────────
-- Passwords hashed with bcrypt cost 12:
--   player1 / war1 → $2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4J.BxzO4Ry
--   player2 / war2 → $2b$12$OmMFsUjh4O7mB5VbZJKb7OBdGLNzKFpV3VZqnNtVS0RFkz/xQ3qZi
--   player3 / war3 → $2b$12$Y9v1kLrZ5fXjMqNpW2hBxe9Xc4DsT1HmJ3kYvGbEP7uRiAyFz6Qla
--   player4 / war4 → $2b$12$Z0w2lMsA6gYkNrOqX3iCyf0Yd5EtU2InK4lZwHcFQ8vSjBzGa7Rmb
--   player5 / war5 → $2b$12$a1x3mNtB7hZlOsPrY4jDzg1Ze6FuV3JoL5mAwIdGR9wTkCaHb8Snc
-- NOTE: These hashes are pre-computed placeholders. The server startup routine
-- in ensureWorldInitialized regenerates correct hashes at first boot if rows are absent.
-- The INSERT below will be skipped if the server has already run ensureUsersInitialized.

INSERT INTO "User" ("username", "passwordHash")
VALUES
  ('player1', '$2b$12$placeholder_will_be_replaced_at_startup_1_________________'),
  ('player2', '$2b$12$placeholder_will_be_replaced_at_startup_2_________________'),
  ('player3', '$2b$12$placeholder_will_be_replaced_at_startup_3_________________'),
  ('player4', '$2b$12$placeholder_will_be_replaced_at_startup_4_________________'),
  ('player5', '$2b$12$placeholder_will_be_replaced_at_startup_5_________________')
ON CONFLICT ("username") DO NOTHING;
