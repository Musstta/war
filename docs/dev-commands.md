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

## Player credentials (dev)

| Username | Password | Nation     |
|----------|----------|------------|
| player1  | war1     | Costa Rica |
| player2  | war2     | Guatemala  |
| player3  | war3     | Honduras   |
| player4  | war4     | Nicaragua  |
| player5  | war5     | Panamá     |

Plaintext, dev-only. See `docs/persistent-world-tech-stack.md` §11 hardening checklist before wider use.