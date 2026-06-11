-- v0.39 backfill: create GameMembership rows for player1-5 in legacy-world.
--
-- v0.34 introduced the GameMembership table and multi-world auth but did not
-- backfill rows for legacy-world, which pre-dates the lobby system and has no
-- territory-selection phase. v0.39 removes all special-case legacy-world
-- branches from route handlers; the new /api/games/:id/* routes require a
-- GameMembership row for every player, including legacy-world players.
--
-- Mapping: username → userId (fixed at DB creation) → slotIndex → nationId
--   player1 → 1 → 0 → nation_costa_rica
--   player2 → 2 → 1 → nation_guatemala
--   player3 → 3 → 2 → nation_honduras
--   player4 → 4 → 3 → nation_nicaragua
--   player5 → 5 → 4 → nation_panama
--
-- Idempotent: ON CONFLICT DO NOTHING — safe to run on a fresh DB after
-- 20260610030000_lobby_system (which creates the GameMembership table) and
-- after the legacy-world Game row is upserted at server startup.

INSERT INTO "GameMembership" ("gameId", "userId", "slotIndex", "nationId", "confirmedTerritoryId", "joinedAt", "rerollUsed")
SELECT 'legacy-world', u.id, mapping.slot, mapping.nation, NULL, NOW(), false
FROM (VALUES
  ('player1', 0, 'nation_costa_rica'),
  ('player2', 1, 'nation_guatemala'),
  ('player3', 2, 'nation_honduras'),
  ('player4', 3, 'nation_nicaragua'),
  ('player5', 4, 'nation_panama')
) AS mapping(username, slot, nation)
JOIN "User" u ON u.username = mapping.username
ON CONFLICT DO NOTHING;
