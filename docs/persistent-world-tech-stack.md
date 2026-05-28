# Persistent World Strategy Game — Tech Stack & Build Plan

**Companion to:** `persistent-world-design.md` (the game design doc — the source of truth for *what* to build). This document covers *how* to build it and in *what order*. Hand both documents to Claude Code together.

**Operator profile:** Solo developer, comfortable coding, Docker, and databases; wants Claude Code to manage day-to-day implementation while retaining a supervisor role and the ability to intervene manually. Priority: a **boring, single-language, well-documented stack** with nothing clever to relearn when something breaks at 11pm.

**Deployment target:** Self-hosted on a home server (Lenovo M170Q), exposed via a Cloudflare Tunnel at a subdomain such as `war.musstta.cc`. The app is a long-running web service — it must run 24/7 and never spin down (the midnight tick depends on it).

**Players:** ~5 to start. One responsive website, usable well on **both mobile and desktop**. No native apps. Sessions are short (~10–15 min/day).

---

## 1. Guiding Principles

1. **This is a database + a tick function, not a graphics problem.** Do NOT use a game engine (Unity, Godot, etc.). The right tools are a normal backend language, a normal database, and a normal web frontend.
2. **One language end to end** where possible — reduces context-switching for a solo dev. **TypeScript** is the recommendation: it runs the backend, the frontend, and the headless simulation, all in one language with one toolchain.
3. **Boring and well-documented beats clever.** Every library chosen below is mainstream with large communities — troubleshooting answers exist.
4. **The simulation engine is the product.** Build it first, build it headless, build it testable. See Section 6 and the build order in Section 8.
5. **Territories are data, not code.** The engine loads the world (territories, attributes, adjacency) from a data file at startup. The game works the same with 40 territories or 500. See Section 5.
6. **Architect for the deferred features now.** The design doc defers route interdiction and several other features but mandates that the data model support them. Respect those notes — they are cheap now and expensive later.

---

## 2. Recommended Stack

| Layer | Recommendation | Why |
|---|---|---|
| Language | **TypeScript** everywhere | One language for backend, frontend, and simulation. Strong typing matters a lot for a rules-heavy game with complex state. |
| Runtime | **Node.js** (LTS) | Boring, universal, runs fine on the M170Q. |
| Backend framework | **Fastify** (or Express if preferred) | Lightweight HTTP API. Fastify is fast and well-documented; Express is even more universally documented if that matters more than speed. |
| Database | **PostgreSQL** | The world state is relational (nations, territories, treaties, routes, armies). Postgres is rock-solid, transactional (critical for atomic tick resolution), and self-hosts trivially in Docker. |
| DB access | **Prisma** (ORM) | Type-safe queries, schema migrations, readable. Good fit for a solo dev who wants Claude Code to manage schema changes safely. |
| Frontend framework | **React** | Largest ecosystem, best map-library support, Claude Code is strongest here. |
| Frontend build/tooling | **Vite** | Fast, simple, the current default. |
| Styling | **Tailwind CSS** | Fast to iterate, responsive utilities make mobile+desktop straightforward. |
| Map rendering | **MapLibre GL JS** (see Section 4) | Open-source, no API keys, renders real geographic vector data, pans/zooms, mobile-friendly. |
| Scheduled tick | **node-cron** inside the backend process, OR a system cron calling an endpoint | Runs the midnight tick. See Section 6. |
| Auth | **Lucia** or a simple session-cookie scheme | 5 known players — auth can be minimal. Do not over-build this. |
| Containerization | **Docker + Docker Compose** | One `docker-compose.yml` runs the app + Postgres. Matches the operator's existing workflow. |
| Process management | Docker's restart policy (`restart: unless-stopped`) | Ensures the service comes back after a reboot — essential for a 24/7 tick. |

**Repo shape:** a single monorepo with three packages — `engine/` (pure simulation, no HTTP, no DB-specific code), `server/` (HTTP API + DB + tick scheduler, depends on `engine/`), `web/` (React frontend). The engine being a standalone package is what makes headless simulation possible (Section 6).

---

## 3. Why NOT certain tempting choices

- **No game engine.** Unity/Godot solve rendering and physics. This game has neither. They would add enormous complexity for zero benefit.
- **No NoSQL / document DB as the primary store.** The world is highly relational and the tick must be transactional. Postgres is the correct call. (A document store could *supplement* later, e.g. for the Event Log, but is not needed.)
- **No serverless / edge functions.** A persistent ticking world needs a long-running process. Serverless spins down. The home server is the right model.
- **No 3D globe.** The design calls for a real geographic map, not a globe. A 2D vector map (MapLibre) is the correct, far cheaper choice.

---

## 4. The Map — Approach

The design calls for a real-world geographic map (real coastlines and borders) with **modest** detail — it should *read* as Earth; perfect fidelity (gulfs, tiny inlets) is explicitly not required.

**Rendering:** **MapLibre GL JS** — open-source, no API key, no usage limits, renders vector polygons, supports pan/zoom and click-to-select, works on mobile. Territories are rendered as colored polygons (fill = owner nation); selection and fog-of-war are styling layers on top.

**Boundary data:** **Natural Earth** (naturalearthdata.com) — public domain, free, the standard source for country and state/province boundaries at multiple detail levels. Use a **low or medium detail tier** — it matches the "looks like Earth, doesn't need gulfs" requirement and renders fast on mobile. Admin-0 (countries) and Admin-1 (states/provinces) layers together cover the territory model in Section 5.

**Polygon simplification:** raw boundary data is high-resolution. Simplify the polygons (e.g. with `mapshaper`, a free tool) so the map loads fast — especially important on mobile. This is a one-time content step.

**What you build vs. get for free:** map *rendering*, *pan/zoom*, and *boundary data* are free/prebuilt. The *territory definitions*, *adjacency graph*, and all *game logic* are yours to build — correctly, because that is the game.

---

## 5. The Territory Model — Build as Data, Not Code

The design wants real countries and regions, with a curation rule: **subdivide the giants** (US, Canada, Russia, China → administrative regions), **keep mid-size countries whole** (e.g. Costa Rica = one territory), **absorb micro-states** into a regional territory (e.g. Liechtenstein folds into a surrounding European territory). This is standard, sound game-map curation — not too complex to reason about. The only genuinely tedious part is the **adjacency data**: for every territory, which territories border it, and whether it is coastal.

**Principle: the world is a data file the engine loads at startup.** The engine must not hardcode territory count or identities. It reads a structured file (JSON) describing every territory: id, name, attributes (Population, Industry, Wealth, Geography, Culture per the design doc), the list of adjacent territory ids, and coastal flag. The map frontend reads the same ids to color the right polygons.

**Consequence — the build order this unlocks:** the first playable build uses a **deliberately small, hand-curated territory set** (~40–60 territories, the curation rules applied to one or two continents). The full 200–500 real-world world is built **later, as content**, by editing the data file — *with no engine changes*. This is not "simple territories vs. real world"; it is building the real-world map in the correct order: **after the engine works.**

**[OPEN] territory questions** (carry into the design doc's open list):
- Which continent(s) for the initial ~40–60 territory set.
- The exact micro-state absorption mapping.
- How adjacency is authored — by hand, or semi-derived from polygon borders then hand-corrected.

---

## 6. The Simulation Engine — The Heart of the Project

This is the single most important architectural point. From the design doc Section 17: the game is a server-state and concurrency project, and the engine must be **headless and fast-forwardable**.

**`engine/` is a pure, standalone TypeScript package.** It has no HTTP code and no direct database calls. Its core is one function, conceptually:

> `resolveTick(worldState, queuedActions) → newWorldState`

Given a world state and the set of actions queued for that tick, it deterministically produces exactly one next world state. Pure in, pure out.

**Why this shape matters:**
- **Headless simulation:** a separate script can loop `resolveTick` thousands of times over made-up actions to fast-forward 100+ game-days in seconds. This is the *only* way to tune the open numbers (Mandate formulas, friction curves, unrest rates, war exhaustion, starting-position balance). Tuning by playing the real game is impossibly slow.
- **Testability:** pure functions are trivially unit-testable. Given state X and actions Y, assert the result.
- **Determinism + seeded randomness:** all randomness (combat rolls, trait drift) draws from a seeded RNG passed into the tick. A tick can be replayed exactly for debugging.
- **Crash safety:** because the tick is atomic, the `server/` package can wrap each real tick in a single database transaction — if the process dies mid-tick, the DB rolls back to a clean prior state.

**`server/` consumes the engine:** it loads world state from Postgres, collects the actions players queued during the day, calls `resolveTick`, and writes the new state back inside one transaction. Player actions during the Main/Preparation phases are stored as **queued intents** (rows in the DB), never applied live — this is what makes two players acting on the same territory safe (resolved together at the tick) and what the design doc Section 17 requires.

**The tick scheduler:** at the configured server time (midnight, Costa Rica / UTC-6), trigger one tick. Either `node-cron` inside the backend process, or a system cron hitting a protected endpoint. Keep it simple; make sure the timezone is fixed and explicit in config.

**Build a simulation harness early.** A CLI script in the repo that spins up a fake world, runs N ticks with scripted or random actions, and prints/plots the resulting numbers. This harness is how every `[OPEN]` number in the design doc gets answered.

---

## 7. Other Architecture Notes

- **Event Log** (design doc Section 16): a simple append-only table. Every significant state change in `resolveTick` emits a log entry. First-class feature, not debug output.
- **Fog of war:** enforced **server-side**. The API must return only what a given nation is allowed to see (own + adjacent + allied territories + world events). Never send full world state to the client and hide it in the UI — that is trivially inspected.
- **Trade routes as real objects:** per design doc 14A.6, store each route as a row with an explicit path through territory ids — not an abstract nation-to-nation link. This is what makes route interdiction addable later.
- **Mutable culture traits:** per design doc 7.5, store traits as mutable numeric values with drift rules, not constants.
- **Projected-delta UI:** the API needs a "preview" capability — given a proposed action, return its projected effects (Trust/unrest/Prestige deltas) without committing it. Design the action system so preview and commit share the same logic.
- **Auth is minimal:** 5 known players. A simple invite + session cookie is plenty. Do not build OAuth, email verification, password reset flows, etc. for v1.
- **Frontend design direction** is deliberately deferred — get the game *working* first; commit to a strong visual identity later, once screens exist to style.

---

## 8. Recommended Build Order for Claude Code

Do **not** build all systems at once. Build in phases; each phase should be working and tested before the next. Tell Claude Code to follow this order explicitly.

**Phase 0 — Skeleton.** Monorepo set up (`engine/`, `server/`, `web/`). Docker Compose running an empty app + Postgres. "Hello world" page served through the Cloudflare tunnel. Confirms the whole deployment pipeline works before any game logic exists.

**Phase 1 — The engine core, headless.** The `engine/` package: world-state types, the territory data-file loader, and `resolveTick` handling only the simplest systems — resource production into stockpiles and upkeep. **Placeholder numbers everywhere.** Plus the simulation harness (Section 6) that can fast-forward N ticks. Goal: prove the tick loop works and is testable. No UI, no DB yet.

**Phase 2 — Persistence & the real tick.** Wire `server/` to Postgres (Prisma schema for world state and queued actions). Load world from DB, run a real scheduled tick in a transaction, write back. Still minimal systems.

**Phase 3 — The map & basic play.** React + MapLibre frontend showing the territory map. The small ~40–60 territory data set. Players can log in, see their nation, and queue the simplest action. Two-phase day (Main / Preparation) and the Mandate budget.

**Phase 4 — Core systems, one at a time.** Add each design-doc system individually, tuning its numbers in the harness before moving on: Infrastructure → Culture & Unrest → Diplomacy/Treaties → Trade → War. Each is a self-contained addition to `resolveTick`.

**Phase 5 — AI nations & activity tiers.** Caretaker AI (defensive-only autopilot), AI nations, the inactivity system.

**Phase 6 — Prestige, Event Log polish, fog-of-war hardening, UI design pass.**

**Phase 7 — Scale the map.** Expand the territory data file from the small set to the full 200–500 real-world world. No engine changes — pure content.

---

## 9. Open Questions for This Document

- Fastify vs. Express — **decided: Fastify** (chosen in Phase 0).
- Whether the tick scheduler lives in-process (`node-cron`) or as an external system cron — decide in Phase 2.
- Initial continent(s) for the Phase 3 small territory set.
- Backup strategy for the Postgres volume (a persistent world's DB is irreplaceable — set up a simple periodic dump early, by Phase 2).

---

## 10. Build Decisions & Port Assignments

Recorded here as decisions are made. Each entry locks a choice so it is not revisited silently.

**Phase 0 decisions:**

- **Web app port: 42069.** The Vite dev server (web container) listens on 42069. This is the port the Cloudflare Tunnel's Zero Trust config points at.
- **Server API port: 3001.** The Fastify server listens on 3001, exposed on the host at 3001 for local debugging. The web container proxies `/api/*` to `http://server:3001` internally via the Vite proxy.
- **PostgreSQL:** internal to Docker Compose only (not exposed on the host). Access via `docker compose exec postgres psql -U war -d war`.
- **Named volume `war_pgdata`** backs the Postgres data directory. Survives `docker compose down` (without `-v`). Verified in Phase 0 go/no-go.
- **Web serving in development: Vite dev server** (separate `web` container). Hot-reload over the Docker bind-mount is the priority in early development.

**Deferred task — switch web serving to static build:**
> In a future hardening step (no earlier than Phase 3, before any public deployment), replace the Vite dev server container with a production static build served directly from `server/`. The Vite proxy and separate `web` container will be retired at that point. Do not do this until explicitly decided — the current setup is intentional.

---

## 11. Deferred Security Hardening

Items **intentionally deferred** until before any real-world or wider-audience deployment. All are marked with `[DEFERRED SECURITY]` in source comments.

| Item | Current (dev) value | Required before prod |
|---|---|---|
| `ADMIN_KEY` | `dev-only-insecure-key` | Real secret in env; rotate on any exposure |
| `SESSION_SECRET` | `dev-only-session-secret-change-before-prod` | ≥32-char random secret in env; never committed |
| Player credentials | Plaintext in `server/src/auth.ts` | Hashed + salted; stored outside the repo |
| Cookie transport | HTTP (signed, not encrypted) | HTTPS-only; `secure: true` on cookie |
| `POST /admin/set-phase` | Dev-only endpoint bypasses real clock | **Remove entirely** (or gate on `NODE_ENV !== 'production'`) |

**How to harden (checklist for future session):**
1. Generate `SESSION_SECRET` with `openssl rand -hex 32`, set it in the server's env (Docker Compose or `.env` — add `.env` to `.gitignore`).
2. Change `ADMIN_KEY` to a random value, set in env.
3. Move player passwords out of `auth.ts`; load from env vars or a secrets file.
4. Enable HTTPS (Cloudflare Tunnel already terminates TLS — the issue is cookie `secure` flag + SameSite policy when behind the tunnel).

---

## 13. Deferred Architecture Tasks

Items that are explicitly **not** acted on yet. Each has a trigger condition — do not address before that trigger.

| Task | What | Trigger |
|---|---|---|
| **Action-handler registry / Command Pattern** | Extract per-action validation out of the monolithic `/api/action` endpoint into separate handler files (one per action type), registered in a map. The current inline `if (type === ...)` blocks will become unmanageable. | **Start of the Diplomacy sub-phase**, before adding treaty actions. |
| **Immer (or equivalent) for engine immutability** | The engine currently clones state with shallow spread (`{ ...v, state: { ...v.state } }`). Once state has nested arrays/objects (e.g. culture trait arrays, treaty lists), shallow spread risks accidental shared-reference bugs — hard to track down. Immer's `produce()` would make immutability structural rather than manual. | **Start of the Culture sub-phase**, when TerritoryState first gains nested structure. Watch specifically for accidental shared references in the engine's action cases, not just performance. |
| **Move heavy compute outside the tick transaction** | Currently `resolveTick` (pure CPU) runs inside the Prisma transaction, holding a DB connection and row locks for its entire duration. Fine for the current ~10-territory scale. At larger scale, this adds latency to the lock window for no benefit — the computation should happen before the transaction opens, with only the final writes inside it. | **Phase 7 (map scale-up)**, when territory count grows past ~100. |

---

## 12. Change Log

- **v0.1** — Initial tech stack and build plan. Stack: TypeScript / Node / Fastify / PostgreSQL / Prisma / React / Vite / Tailwind / MapLibre GL JS, Docker Compose, self-hosted via Cloudflare Tunnel. Established the engine-as-pure-package principle, the territory-as-data-file principle, and the 8-phase build order. Map data via Natural Earth.
- **v0.2** — Phase 0 built. Port assignments locked (web: 42069, API: 3001). Fastify chosen. Named volume `war_pgdata` established. Deferred task logged: switch web to static build served from server/ before production hardening.
- **v0.3** — Phase 3 built. MapLibre GL JS map with Natural Earth Central America geodata. 5-player auth (signed cookies). Fog-of-war API. Two-phase day (Main until 19:00 CR, Prep until midnight). Mandate budget. `build_road` action end-to-end. Deferred security hardening checklist in §11.
- **v0.4** — Phase 4 Infrastructure. `build_port` and `build_fort` actions. Strict single construction slot per territory (all build types — road, port, fort — compete for one slot; sequential only). Construction state (`constructionType`, `constructionTicksLeft`) in DB and engine. Industry cost deducted at tick time by engine; validated against snapshot at queue time. `resolveTick` now returns `{ world, actionResults }` — explicit per-action applied/discarded status with reason string; server refund logic consumes this directly instead of diffing state. Deferred architecture tasks logged in §13. All build times and costs tagged `[PLACEHOLDER]`. `engine/` is baked into server image — note in docker-compose.yml and dev-commands.md §9.
