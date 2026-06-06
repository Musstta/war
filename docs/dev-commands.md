# Dev Commands & Verification Reference

Quick-reference for local development and verification of the running stack. All commands assume you're in the project root (`~/war`) unless noted.

Admin endpoints require the header:

```
-H "X-Admin-Key: dev-only-insecure-key"
```

> **Security note:** `dev-only-insecure-key` is a development placeholder. Replace with an env-var-driven secret before exposing anything beyond local + tunnel testing. See `docs/persistent-world-tech-stack.md` §11.

---

## 1. Health check

Confirms the server is up and shows the current tick.

```bash
curl http://localhost:3001/health
# → {"ok":true,"tick":3}
```

---

## 2. Manual tick

Advances the world by one tick on demand (instead of waiting for midnight).

```bash
curl -X POST http://localhost:3001/admin/tick \
  -H "X-Admin-Key: dev-only-insecure-key"
# → {"ok":true,"tick":4}
```

---

## 3. Inspect DB state

Confirm the tick advanced and resource stockpiles updated.

```bash
docker compose exec postgres psql -U war -d war \
  -c 'SELECT id, tick FROM "WorldMeta";'

docker compose exec postgres psql -U war -d war \
  -c 'SELECT id, name, "popStock", "indStock", "wealthStock" FROM "Nation";'
```

For a given tick number, stockpile values should match the Phase 1 harness output exactly.

---

## 4. Transaction safety / concurrent-tick protection

Fire two ticks simultaneously. The second is rejected immediately, and the tick counter advances by exactly 1.

```bash
curl -X POST http://localhost:3001/admin/tick -H "X-Admin-Key: dev-only-insecure-key" &
curl -X POST http://localhost:3001/admin/tick -H "X-Admin-Key: dev-only-insecure-key" &
wait
```

Expected: one `{"ok":true,"tick":N}` and one `{"error":"Tick already in progress..."}`.

**Why this is safe:** every tick runs inside a single `prisma.$transaction()`. Every write to `WorldMeta`, `Nation`, and `TerritoryState` is in one Postgres transaction. If any step throws or the process dies, Postgres rolls everything back. The tick counter is the first thing saved and the last thing visible — if the commit never happens, the number doesn't change.

---

## 5. Backups

```bash
ls -lh backups/                 # war_YYYYMMDD_HHMMSS.sql.gz files
zcat backups/*.sql.gz | head -3 # confirm valid SQL dump
```

Runs hourly, keeps 7 days, prunes automatically. `backups/` is bind-mounted from the host — files survive container restart or rebuild.

---

## 6. Force day phase (dev override)

Phase boundaries are normally tied to the real wall clock (Main 00:00–18:59 CR / Prep 19:00–23:59 CR). These endpoints override that for testing.

> **Note:** forcing a phase changes the *label* and the queue-validation behavior. It does **not** advance the tick. To see queued actions resolve, force the phase, queue the action, then call `/admin/tick`.

```bash
# Force Main Phase
curl -X POST "http://localhost:3001/admin/set-phase?phase=main" \
  -H "X-Admin-Key: dev-only-insecure-key"

# Force Prep Phase
curl -X POST "http://localhost:3001/admin/set-phase?phase=prep" \
  -H "X-Admin-Key: dev-only-insecure-key"

# Clear override — return to real clock
curl -X POST "http://localhost:3001/admin/set-phase" \
  -H "X-Admin-Key: dev-only-insecure-key"
```

---

## 7. Reset world

Wipes and reinitializes the world with the 5 starting nations.

```bash
curl -X POST http://localhost:3001/admin/reset-world \
  -H "X-Admin-Key: dev-only-insecure-key"
```

---

## 8. End-to-end action loop (verifying Phase 3)

Full loop to confirm an action queues, resolves, and updates state:

```bash
# 1. Force Main Phase (so queueing is allowed)
curl -X POST "http://localhost:3001/admin/set-phase?phase=main" \
  -H "X-Admin-Key: dev-only-insecure-key"

# 2. Log in via the web UI and queue a build_road action on one of your territories.
#    (Or POST /api/action directly if testing without the UI.)

# 3. Resolve it
curl -X POST http://localhost:3001/admin/tick \
  -H "X-Admin-Key: dev-only-insecure-key"

# 4. Confirm: the territory's hasRoad flips to true, recentEvents shows the build,
#    and the map reflects on the next /api/world poll.
```

---

## 9. Rebuilding after engine changes

The `engine/` directory is baked into the server container at build time — it is **not** bind-mounted. Any change to `engine/src/` requires a container rebuild before it is visible to the running server:

```bash
docker compose build server
docker compose up -d server
```

Only `server/src/` and `server/prisma/` are live-mounted and picked up on `docker compose restart server`.

---

## 10. Phase 4 — Port & Fort construction

Full loop to verify multi-tick construction:

```bash
# 1. Force Main Phase
curl -X POST "http://localhost:3001/admin/set-phase?phase=main" \
  -H "X-Admin-Key: dev-only-insecure-key"

# 2. Accumulate some industry (6 ticks × 5 industry/tick = 30)
for i in $(seq 6); do
  curl -s -X POST http://localhost:3001/admin/tick \
    -H "X-Admin-Key: dev-only-insecure-key" > /dev/null
done

# 3. Queue build_port on a coastal territory (costa_rica is coastal)
curl -X POST http://localhost:3001/api/action \
  -H "Content-Type: application/json" \
  -b <session-cookie> \
  -d '{"type":"build_port","payload":{"territoryId":"costa_rica"}}'
# → {"ok":true}

# 4. Try to double-queue (should be rejected)
curl -X POST http://localhost:3001/api/action \
  -H "Content-Type: application/json" \
  -b <session-cookie> \
  -d '{"type":"build_fort","payload":{"territoryId":"costa_rica"}}'
# → {"error":"Construction already queued for this territory"}

# 5. Tick — construction starts (ticksLeft set to BUILD_TICKS - 1 after first tick)
curl -X POST http://localhost:3001/admin/tick \
  -H "X-Admin-Key: dev-only-insecure-key"
# /api/world → constructionType=port, constructionTicksLeft=2

# 6. Run 2 more ticks — construction completes
for i in 1 2; do
  curl -s -X POST http://localhost:3001/admin/tick \
    -H "X-Admin-Key: dev-only-insecure-key" > /dev/null
done
# /api/world → constructionType=null, hasPort=true
# recentEvents → "... completed a port in ..."
```

**Fort costs:** L1 = 2 mandates + 3 industry (3 ticks), L2 = 3 mandates + 6 industry (7 ticks), L3 = 4 mandates + 10 industry (14 ticks). All placeholder values tagged `[PLACEHOLDER]`.

---

## 11. Admin functions

All dev and admin functions now live at `/admin` behind the admin key. The DevToolbar and InfoPanel dev section were removed from the player view. See §12 for the admin panel and its curl equivalents.

The `/api/dev/*` session-cookie endpoints below remain valid for scripting (session-gated to `nation_costa_rica`):

```bash
# First log in to get a session cookie
curl -c /tmp/war.cookies -X POST http://localhost:3001/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"player1","password":"war1"}'

# Force phase
curl -b /tmp/war.cookies -X POST "http://localhost:3001/api/dev/set-phase?phase=main"
curl -b /tmp/war.cookies -X POST "http://localhost:3001/api/dev/set-phase?phase=prep"
curl -b /tmp/war.cookies -X POST "http://localhost:3001/api/dev/set-phase"  # clear

# Manual tick
curl -b /tmp/war.cookies -X POST http://localhost:3001/api/dev/tick
# → {"ok":true,"tick":N}

# Reset world
curl -b /tmp/war.cookies -X POST http://localhost:3001/api/dev/reset-world

# Inspect territory state (unrest + culture traits + construction)
curl -b /tmp/war.cookies http://localhost:3001/api/dev/territory/costa_rica

# Set unrest on a territory
curl -b /tmp/war.cookies -X POST http://localhost:3001/api/dev/territory/costa_rica/set-unrest \
  -H "Content-Type: application/json" -d '{"value":0.8}'

# Set a culture trait (range: −1.00 to +1.00)
curl -b /tmp/war.cookies -X POST http://localhost:3001/api/dev/territory/costa_rica/set-trait \
  -H "Content-Type: application/json" -d '{"trait":"militaristic","value":0.9}'
# trait: individualist | progressive | militaristic | expansionist
```

> **Security note:** `/api/dev/*` endpoints are session-gated to `nation_costa_rica`. They must be removed or replaced with real RBAC before the game goes beyond local + tunnel testing. See `docs/persistent-world-tech-stack.md` §11.

---

## 12. Admin Panel (web UI)

The admin panel is a separate view of the same web bundle. Navigate to:

```
http://localhost:42069/admin
```

Enter the admin key (`dev-only-insecure-key`) when prompted. The key is stored only in React state — never persisted. You will be asked again on each page load.

**Panel controls:**

| Control | Action |
|---------|--------|
| → Main / → Prep | Force phase |
| → Clock | Clear phase override |
| ⚡ Tick | Advance one tick |
| Run N ticks | Sequential tick loop (useful for watching drift/revolt converge) |
| ↺ Reset | Wipe world and restart at tick 0 |

**Territory table:** click any **Unrest** cell to set a value; click the **Culture** cell (I column) to nudge a specific axis; click the **Revolt** cell to toggle revolt state.

**Nations table:** stockpiles, mandate used/budget, culture axes, capital.

**Event log:** last 50 entries, most recent first, tagged with tick number.

The panel auto-refreshes every 5 seconds.

### Equivalent curl commands (admin-key auth)

```bash
# God's-eye world view
curl http://localhost:3001/api/admin/world-full \
  -H "X-Admin-Key: dev-only-insecure-key" | jq .

# Advance tick
curl -X POST http://localhost:3001/api/admin/tick \
  -H "X-Admin-Key: dev-only-insecure-key"

# Run 10 ticks
for i in $(seq 10); do
  curl -s -X POST http://localhost:3001/api/admin/tick \
    -H "X-Admin-Key: dev-only-insecure-key" > /dev/null
done

# Set phase
curl -X POST "http://localhost:3001/api/admin/set-phase?phase=main" \
  -H "X-Admin-Key: dev-only-insecure-key"

# Reset world
curl -X POST http://localhost:3001/api/admin/reset-world \
  -H "X-Admin-Key: dev-only-insecure-key"

# Set unrest
curl -X POST http://localhost:3001/api/admin/territory/costa_rica/set-unrest \
  -H "X-Admin-Key: dev-only-insecure-key" \
  -H "Content-Type: application/json" -d '{"value":0.85}'

# Nudge culture trait
curl -X POST http://localhost:3001/api/admin/territory/costa_rica/set-trait \
  -H "X-Admin-Key: dev-only-insecure-key" \
  -H "Content-Type: application/json" -d '{"trait":"militaristic","value":0.5}'

# Toggle revolt
curl -X POST http://localhost:3001/api/admin/territory/costa_rica/toggle-revolt \
  -H "X-Admin-Key: dev-only-insecure-key"
```

> **Security note:** The admin panel and `/api/admin/*` endpoints must be disabled before public deployment. See `docs/persistent-world-tech-stack.md` §11.

---

## 13. War admin commands

### Declare a war (for testing)

```bash
curl -X POST http://localhost:3001/api/admin/declare-war \
  -H "X-Admin-Key: dev-only-insecure-key" \
  -H "Content-Type: application/json" \
  -d '{"attackerId":"nation_costa_rica","defenderId":"nation_guatemala","casusBelli":true}'
# → {"ok":true,"warId":1}
```

`casusBelli: false` applies the no-CB Trust penalty (−10 Trust) and queues the no-CB unrest spike (+0.05 equilibrium for 5 ticks) on the attacker's Peaceful/Isolationist territories via the next tick.

### Force-accept a peace deal (testing)

```bash
curl -X POST http://localhost:3001/api/admin/force-peace \
  -H "X-Admin-Key: dev-only-insecure-key" \
  -H "Content-Type: application/json" \
  -d '{
    "warId": 1,
    "terms": {
      "warType": "negotiated",
      "territoryCessions": [
        { "territoryId": "guatemala", "fromNationId": "nation_guatemala", "toNationId": "nation_costa_rica" }
      ],
      "tributeWealth": 0,
      "tributeTicks": 0
    }
  }'
# → {"ok":true}
```

- Immediately ends the war, transfers all ceded territories with conquest shock (`ownershipShock=0.50`), returns unceded occupied territories to original owners.
- If `tributeWealth > 0` and `tributeTicks > 0`: creates a tribute treaty using the same treaty machinery.
- Both parties receive the `+5` Trust bonus for peaceful war end.
- Raid wars: `territoryCessions` must be `[]`.
- White peace: set `territoryCessions: []` and `tributeWealth: 0`.

### Force-end a war (no peace deal)

```bash
curl -X POST http://localhost:3001/api/admin/end-war \
  -H "X-Admin-Key: dev-only-insecure-key" \
  -H "Content-Type: application/json" \
  -d '{"warId":1}'
# → {"ok":true}
```

Immediately sets `status: ended`, clears occupied territories, logs the event. Use this to clean up test wars or test unrest recovery after a war ends.

### Full test loop — declare war, queue attack, resolve tick

```bash
# 1. Force Main Phase
curl -X POST "http://localhost:3001/api/admin/set-phase?phase=main" \
  -H "X-Admin-Key: dev-only-insecure-key"

# 2. Declare war (admin shortcut — no mandate cost)
curl -X POST http://localhost:3001/api/admin/declare-war \
  -H "X-Admin-Key: dev-only-insecure-key" \
  -H "Content-Type: application/json" \
  -d '{"attackerId":"nation_costa_rica","defenderId":"nation_guatemala","casusBelli":true}'

# 3. Log in as Costa Rica and queue an attack
#    (guatemala is adjacent to costa_rica — land adjacency satisfied)
curl -c /tmp/war.cookies -X POST http://localhost:3001/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"player1","password":"war1"}'

curl -b /tmp/war.cookies -X POST http://localhost:3001/api/action \
  -H "Content-Type: application/json" \
  -d '{"type":"attack_territory","payload":{"targetTerritoryId":"guatemala"}}'
# → {"ok":true}

# 4. Resolve tick — battle fires, event log shows outcome
curl -X POST http://localhost:3001/api/admin/tick \
  -H "X-Admin-Key: dev-only-insecure-key"

# 5. Check event log
curl http://localhost:3001/api/admin/world-full \
  -H "X-Admin-Key: dev-only-insecure-key" | jq '.recentEvents[:5]'
```

---

## 14. Activity tier admin commands

### Force-set a nation's activity tier (for testing)

```bash
# Force Costa Rica to Dormant (triggers treaty degradation next tick)
curl -X POST http://localhost:3001/api/admin/nation/nation_costa_rica/set-tier \
  -H "X-Admin-Key: dev-only-insecure-key" \
  -H "Content-Type: application/json" \
  -d '{"tier":"dormant"}'
# → {"ok":true,"nationId":"nation_costa_rica","tier":"dormant"}

# Force to Autopilot (caretaker AI begins acting each tick)
curl -X POST http://localhost:3001/api/admin/nation/nation_costa_rica/set-tier \
  -H "X-Admin-Key: dev-only-insecure-key" \
  -H "Content-Type: application/json" \
  -d '{"tier":"autopilot"}'

# Force to Abandoned (fragmentation risk starts accumulating)
curl -X POST http://localhost:3001/api/admin/nation/nation_costa_rica/set-tier \
  -H "X-Admin-Key: dev-only-insecure-key" \
  -H "Content-Type: application/json" \
  -d '{"tier":"abandoned"}'

# Return to Active (resets inactivity clock)
curl -X POST http://localhost:3001/api/admin/nation/nation_costa_rica/set-tier \
  -H "X-Admin-Key: dev-only-insecure-key" \
  -H "Content-Type: application/json" \
  -d '{"tier":"active"}'
```

Valid tiers: `active`, `dormant`, `autopilot`, `abandoned`, `dissolved`.

### Convert an Abandoned nation to AI control

```bash
curl -X POST http://localhost:3001/api/admin/nation/nation_costa_rica/convert-to-ai \
  -H "X-Admin-Key: dev-only-insecure-key"
# → {"ok":true,"nationId":"nation_costa_rica"}
```

Sets `isAI = true`, clears `abandonedAt`. The nation enters full AI behavior and is no longer recoverable by the original player. Event Log: `"The Costa Rican empire has fallen under AI control."`

### Full tier-transition test loop

```bash
# 1. Force to Abandoned
curl -X POST http://localhost:3001/api/admin/nation/nation_costa_rica/set-tier \
  -H "X-Admin-Key: dev-only-insecure-key" \
  -H "Content-Type: application/json" \
  -d '{"tier":"abandoned"}'

# 2. Run a few ticks — fragmentation risk climbs as unrest accumulates
for i in $(seq 5); do
  curl -s -X POST http://localhost:3001/api/admin/tick \
    -H "X-Admin-Key: dev-only-insecure-key" > /dev/null
done

# 3. Check fragmentation risk per territory in world-full
curl http://localhost:3001/api/admin/world-full \
  -H "X-Admin-Key: dev-only-insecure-key" | jq '.territories[] | select(.fragmentationRisk != null) | {id, fragmentationRisk}'

# 4. Convert to AI if desired
curl -X POST http://localhost:3001/api/admin/nation/nation_costa_rica/convert-to-ai \
  -H "X-Admin-Key: dev-only-insecure-key"
```

---

## 15. Army admin commands

### Set an army for testing (creates/replaces first army)

```bash
# Place Costa Rica's army at nicaragua with size 80
curl -X POST http://localhost:3001/api/admin/nation/nation_costa_rica/set-army \
  -H "X-Admin-Key: dev-only-insecure-key" \
  -H "Content-Type: application/json" \
  -d '{"territoryId":"nicaragua","size":80}'
# → {"ok":true}
```

`size=0` deletes all armies for the nation.

---

## 16. Federation admin commands

### Create a federation for testing visibility grants

```bash
# Create a federation between Costa Rica and Guatemala
# Both nations will now see each other's territories at Clear tier
curl -X POST http://localhost:3001/api/admin/create-federation \
  -H "X-Admin-Key: dev-only-insecure-key" \
  -H "Content-Type: application/json" \
  -d '{"name":"Central Pact","memberNationIds":["nation_costa_rica","nation_guatemala"]}'
# → {"ok":true,"federationId":1}
```

The federation grants **Clear** visibility between all member nations. No federation actions exist yet — this endpoint is for testing fog-of-war visibility grants. See `tuning-notes.md` for the placeholder note on federation visibility strength.

---

## 17. Initialization pipeline (derived-traits inspection)

Inspect what `deriveTerritoryTraits` would compute for a territory. Useful during Phase 7 territory authoring to validate derived values before they are baked into the world.

```bash
# Inspect derived traits for costa_rica (uses def's actual geography = coastal)
curl "http://localhost:3001/api/admin/territory/costa_rica/derived-traits" \
  -H "X-Admin-Key: dev-only-insecure-key" | jq .

# Preview with a different geography (mountainous) without editing the data file
curl "http://localhost:3001/api/admin/territory/costa_rica/derived-traits?geography=mountainous" \
  -H "X-Admin-Key: dev-only-insecure-key" | jq .
```

Response shape:
```json
{
  "territoryId": "costa_rica",
  "culturalFamily": "latin",
  "geography": "coastal",
  "geographyOverridden": false,
  "traitOverridesInDef": null,
  "derived": {
    "traits": { "individualist": -0.28, "progressive": 0.07, "militaristic": -0.22, "expansionist": 0.37 },
    "startingPopulation": 80,
    "productionModifiers": { "wealthMultiplier": 1.0, "industryMultiplier": 0.9, "populationMultiplier": 1.1 }
  },
  "finalTraits": { "individualist": -0.28, "progressive": 0.07, "militaristic": -0.22, "expansionist": 0.37 },
  "seed": 1234567890
}
```

`finalTraits` = derived traits after applying `traitOverrides` from the def (if any). The `?geography=` override is for inspection only — it does not persist to the DB.

---

## 18. Americas adjacency generation (Phase 7 content tooling)

One-time script that downloads Natural Earth GeoJSON, merges territory polygons, auto-detects land adjacency, and writes `scripts/data/americas-adjacency.json`.

```bash
# Run from project root
node scripts/generate-adjacency.mjs

# Output: scripts/data/americas-adjacency.json
```

Re-run after editing `scripts/data/americas-territories.json` (e.g. adding a territory or changing `neFeatures`).

NE GeoJSON files are cached in `scripts/.cache/` after the first download. Delete that directory to force a fresh download:

```bash
rm -rf scripts/.cache/
node scripts/generate-adjacency.mjs
```

The script prints a spot-check for `costa_rica`, `brazil_amazonia`, and `caribbean_west` at the end. Adjacency for the 8 hand-placement territories (Brazil sub-regions, Peru sub-regions, Argentina sub-regions, `colombia_orinoquia`) is hard-coded in `HAND_PLACED` inside the script — edit that block if you need to adjust their neighbors.

---

## Player credentials (dev)

| Username | Password | Nation     |
|----------|----------|------------|
| player1  | war1     | Costa Rica |
| player2  | war2     | Guatemala  |
| player3  | war3     | Honduras   |
| player4  | war4     | Nicaragua  |
| player5  | war5     | Panamá     |

Plaintext, dev-only. See `docs/persistent-world-tech-stack.md` §11 hardening checklist before wider use.