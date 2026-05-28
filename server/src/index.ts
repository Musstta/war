import Fastify from 'fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { loadTerritoryDefs, BUILD_INDUSTRY, computeNationCulture, computeCompatibility, computeUnrestEquilibrium, bfsDistance } from '@war/engine';
import type { TerritoryDef, TerritoryState } from '@war/engine';
import { prisma } from './db';
import { ensureWorldInitialized } from './world';
import { runTick, startScheduler } from './tick';
import { ADMIN_KEY, DATA_FILE, PORT, SESSION_SECRET } from './config';
import { authenticate } from './auth';
import { currentPhase, getPhaseOverride, setPhaseOverride, mandateBudget, ACTION_COSTS, ACTION_PHASE, FORT_MANDATE_COSTS } from './phase';

/** Mandate refunded when a pending construction is cancelled. Must stay in sync
 *  with the costs charged in the /api/action deferred paths below. */
const PENDING_MANDATE_COST: Record<string, number> = {
  road: ACTION_COSTS['build_road']!,
  port: ACTION_COSTS['build_port']!,
  fort_l1: FORT_MANDATE_COSTS[1],
  fort_l2: FORT_MANDATE_COSTS[2],
  fort_l3: FORT_MANDATE_COSTS[3],
};

const app = Fastify({ logger: true });

// [DEFERRED SECURITY] Signed cookie — not encrypted. Fine for the private 5-player
// dev game; must move to HTTPS + encrypted session before any wider exposure.
void app.register(fastifyCookie, { secret: SESSION_SECRET });

function getSession(request: FastifyRequest): string | null {
  const raw = request.cookies['war_session'];
  if (!raw) return null;
  const result = request.unsignCookie(raw);
  return result.valid ? result.value : null;
}

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', async () => {
  const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
  return { ok: true, tick: meta?.tick ?? null };
});

// ── Auth endpoints ────────────────────────────────────────────────────────────

app.post('/api/login', async (request, reply) => {
  const body = request.body as { username?: string; password?: string };
  const player = authenticate(body.username ?? '', body.password ?? '');
  if (!player) return reply.code(401).send({ error: 'Invalid credentials' });
  reply.setCookie('war_session', player.nationId, {
    signed: true, httpOnly: true, path: '/', sameSite: 'strict',
  });
  return { ok: true, nationId: player.nationId };
});

app.post('/api/logout', async (_request, reply) => {
  reply.clearCookie('war_session', { path: '/' });
  return { ok: true };
});

app.get('/api/me', async (request, reply) => {
  const nationId = getSession(request);
  if (!nationId) return reply.code(401).send({ error: 'Not logged in' });
  const [nation, tcount] = await Promise.all([
    prisma.nation.findUnique({ where: { id: nationId } }),
    prisma.territoryState.count({ where: { ownerId: nationId } }),
  ]);
  if (!nation) return reply.code(404).send({ error: 'Nation not found' });
  return {
    nationId,
    name: nation.name,
    phase: currentPhase(),
    mandateBudget: mandateBudget(tcount),
    mandateUsed: nation.mandateUsed,
  };
});

const start = async () => {
  const defs = loadTerritoryDefs(DATA_FILE);
  app.log.info(`Loaded ${defs.length} territory definitions from ${DATA_FILE}`);

  const defById = new Map<string, TerritoryDef>(defs.map((d) => [d.id, d]));

  // ── World state (fog-of-war filtered) ──────────────────────────────────────

  app.get('/api/world', async (request, reply) => {
    const nationId = getSession(request);
    if (!nationId) return reply.code(401).send({ error: 'Not logged in' });

    const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
    if (!meta) return reply.code(503).send({ error: 'World not initialized' });

    const [nationRows, territoryRows, events, myQueued] = await Promise.all([
      prisma.nation.findMany(),
      prisma.territoryState.findMany(),
      prisma.eventLog.findMany({ orderBy: { id: 'desc' }, take: 10 }),
      prisma.queuedAction.findMany({ where: { nationId } }),
    ]);

    // Visibility: own territories + all their adjacent territories
    const ownIds = territoryRows.filter((t) => t.ownerId === nationId).map((t) => t.id);
    const visibleIds = new Set(ownIds);
    for (const id of ownIds) {
      defById.get(id)?.adjacentIds.forEach((adj) => visibleIds.add(adj));
    }

    // Build lightweight Territory objects for culture computation.
    const adjacency: Record<string, readonly string[]> = Object.fromEntries(
      defs.map((d) => [d.id, d.adjacentIds]),
    );
    const allTerritories: Record<string, { def: TerritoryDef; state: TerritoryState }> = {};
    for (const row of territoryRows) {
      const def = defById.get(row.id);
      if (!def) continue;
      allTerritories[row.id] = {
        def,
        state: {
          ownerId: row.ownerId,
          fortificationLevel: row.fortificationLevel,
          hasRoad: row.hasRoad,
          hasPort: row.hasPort,
          unrest: row.unrest,
          isInRevolt: row.isInRevolt,
          valueTraits: { individualist: row.individualist, progressive: row.progressive, militaristic: row.militaristic, expansionist: row.expansionist },
          constructionType: (row.constructionType ?? null) as TerritoryState['constructionType'],
          constructionTicksLeft: row.constructionTicksLeft ?? null,
          pendingConstructionType: (row.pendingConstructionType ?? null) as TerritoryState['pendingConstructionType'],
        },
      };
    }

    // Compute nation cultures (emergent weighted averages). Exposed for all nations.
    // [PLACEHOLDER — fog-of-war rules for opponent nation culture TBD]
    const nationCultures: Record<string, ReturnType<typeof computeNationCulture>> = {};
    for (const n of nationRows) {
      nationCultures[n.id] = computeNationCulture(n.id, allTerritories);
    }

    // Territory counts per nation for overexpansion.
    const territoryCounts: Record<string, number> = {};
    for (const row of territoryRows) {
      if (row.ownerId) territoryCounts[row.ownerId] = (territoryCounts[row.ownerId] ?? 0) + 1;
    }

    // All territories show ownership; visible ones also show detailed stats + culture.
    const territories: Record<string, object> = {};
    for (const t of territoryRows) {
      const def = defById.get(t.id);
      const entry: Record<string, unknown> = {
        id: t.id,
        ownerId: t.ownerId,
        hasRoad: t.hasRoad,
        hasPort: t.hasPort,
        isCoastal: def?.isCoastal ?? false,
        isInRevolt: t.isInRevolt,
      };
      if (visibleIds.has(t.id) && def) {
        entry.fortificationLevel = t.fortificationLevel;
        entry.unrest = t.unrest;
        entry.constructionType = t.constructionType ?? null;
        entry.constructionTicksLeft = t.constructionTicksLeft ?? null;
        entry.pendingConstructionType = t.pendingConstructionType ?? null;

        // Culture breakdown — only meaningful when territory has an owner.
        if (t.ownerId && nationCultures[t.ownerId]) {
          const nc = nationCultures[t.ownerId]!;
          const terrTraits = { individualist: t.individualist, progressive: t.progressive, militaristic: t.militaristic, expansionist: t.expansionist };
          const effectiveFamily = (t.culturalFamily ?? def.culturalFamily) as import('@war/engine').CulturalFamily;
          const compat = computeCompatibility(terrTraits, effectiveFamily, nc);

          const ownerRow = nationRows.find((n) => n.id === t.ownerId);
          const capital = ownerRow?.capitalTerritoryId ?? null;
          const hops = capital ? bfsDistance(adjacency, capital, t.id) : 0;
          const tcount = territoryCounts[t.ownerId] ?? 1;
          const causes = computeUnrestEquilibrium(compat, hops, t.hasRoad, tcount);

          entry.compatibility = compat;
          entry.unrestCauses = causes;
        }
      }
      territories[t.id] = entry;
    }

    // All nations show name + culture; own nation also shows stockpiles.
    const nations: Record<string, object> = {};
    const myNationRow = nationRows.find((n) => n.id === nationId);
    for (const n of nationRows) {
      const entry: Record<string, unknown> = { id: n.id, name: n.name, culture: nationCultures[n.id] };
      if (n.id === nationId) {
        entry.stockpiles = { population: n.popStock, industry: n.indStock, wealth: n.wealthStock };
        entry.armySize = n.armySize;
      }
      nations[n.id] = entry;
    }

    return {
      tick: meta.tick,
      phase: currentPhase(),
      myNationId: nationId,
      mandateBudget: mandateBudget(territoryCounts[nationId] ?? 0),
      mandateUsed: myNationRow?.mandateUsed ?? 0,
      nations,
      territories,
      recentEvents: events.map((e) => ({ tick: e.tick, message: e.message })),
      myQueuedActions: myQueued.map((a) => ({ type: a.type, payload: a.payload })),
    };
  });

  // ── Queue action ───────────────────────────────────────────────────────────

  app.post('/api/action', async (request, reply) => {
    const nationId = getSession(request);
    if (!nationId) return reply.code(401).send({ error: 'Not logged in' });

    const body = request.body as { type?: string; payload?: unknown };
    const { type, payload } = body;
    if (!type) return reply.code(400).send({ error: 'Missing action type' });
    // cancel_pending_construction is handled immediately — not via QueuedAction.
    // It refunds the mandate + industry pre-paid at deferred-queue time.
    if (type === 'cancel_pending_construction') {
      const p = payload as { territoryId?: string };
      if (!p?.territoryId) return reply.code(400).send({ error: 'Missing territoryId' });
      const territory = await prisma.territoryState.findUnique({ where: { id: p.territoryId } });
      if (!territory) return reply.code(404).send({ error: 'Territory not found' });
      if (territory.ownerId !== nationId) return reply.code(403).send({ error: 'Not your territory' });
      if (!territory.pendingConstructionType) return reply.code(400).send({ error: 'No pending construction to cancel' });
      const pendingType = territory.pendingConstructionType;
      const mandateRefund = PENDING_MANDATE_COST[pendingType] ?? 0;
      const industryRefund = BUILD_INDUSTRY[pendingType] ?? 0;
      await prisma.$transaction([
        prisma.territoryState.update({ where: { id: p.territoryId }, data: { pendingConstructionType: null } }),
        prisma.nation.update({ where: { id: nationId }, data: {
          mandateUsed: { decrement: mandateRefund },
          indStock: { increment: industryRefund },
        }}),
      ]);
      return { ok: true };
    }

    if (!(type in ACTION_COSTS)) return reply.code(400).send({ error: `Unknown action type: ${type}` });

    const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
    if (!meta) return reply.code(503).send({ error: 'World not initialized' });

    const allowedPhase = ACTION_PHASE[type];
    if (allowedPhase && currentPhase() !== allowedPhase) {
      return reply.code(400).send({ error: `${type} can only be queued during ${allowedPhase} phase` });
    }

    const [nation, myTerritoryCount] = await Promise.all([
      prisma.nation.findUnique({ where: { id: nationId } }),
      prisma.territoryState.count({ where: { ownerId: nationId } }),
    ]);
    if (!nation) return reply.code(404).send({ error: 'Nation not found' });
    const myBudget = mandateBudget(myTerritoryCount);

    // cost may be overridden below for build_fort (variable per level).
    // Mandate check runs after type-specific blocks so the real cost is known.
    let cost = ACTION_COSTS[type]!;
    // finalPayload may be enriched below (e.g. build_fort adds targetLevel).
    let finalPayload: object = payload as object;

    // Each action type owns its full validity check: current DB state AND already-queued
    // actions. The construction slot is strict and per-territory: while any build is
    // in progress OR queued this tick, no other build of any type may be queued on
    // that territory. Add a matching block for every new action type in Phase 4+.
    if (type === 'build_road') {
      const p = payload as { territoryId?: string };
      if (!p?.territoryId) return reply.code(400).send({ error: 'Missing territoryId' });
      const territory = await prisma.territoryState.findUnique({ where: { id: p.territoryId } });
      if (!territory) return reply.code(404).send({ error: 'Territory not found' });
      if (territory.ownerId !== nationId) return reply.code(403).send({ error: 'Not your territory' });
      if (territory.hasRoad) return reply.code(400).send({ error: 'Territory already has a road' });
      if (territory.pendingConstructionType !== null) return reply.code(400).send({ error: 'Next construction already queued' });

      if (territory.constructionType !== null) {
        // DEFERRED PATH: queue road to fire when current construction finishes.
        if (nation.mandateUsed + cost > myBudget) return reply.code(400).send({ error: 'Insufficient mandates' });
        await prisma.$transaction([
          prisma.territoryState.update({ where: { id: p.territoryId }, data: { pendingConstructionType: 'road' } }),
          prisma.nation.update({ where: { id: nationId }, data: { mandateUsed: { increment: cost } } }),
        ]);
        return { ok: true };
      }

      const alreadyQueued = await prisma.queuedAction.findFirst({
        where: { payload: { path: ['territoryId'], equals: p.territoryId } },
      });
      if (alreadyQueued) return reply.code(400).send({ error: 'A build is already queued for this territory this tick' });
    }

    if (type === 'build_port') {
      const p = payload as { territoryId?: string };
      if (!p?.territoryId) return reply.code(400).send({ error: 'Missing territoryId' });
      const territory = await prisma.territoryState.findUnique({ where: { id: p.territoryId } });
      if (!territory) return reply.code(404).send({ error: 'Territory not found' });
      if (territory.ownerId !== nationId) return reply.code(403).send({ error: 'Not your territory' });
      if (!defById.get(p.territoryId)?.isCoastal) return reply.code(400).send({ error: 'Territory is not coastal' });
      if (territory.hasPort) return reply.code(400).send({ error: 'Territory already has a port' });
      if (territory.pendingConstructionType !== null) return reply.code(400).send({ error: 'Next construction already queued' });
      if (nation.indStock < BUILD_INDUSTRY['port']!) return reply.code(400).send({ error: 'Insufficient industry stockpile' });

      if (territory.constructionType !== null) {
        // DEFERRED PATH: queue port build to start when current construction finishes.
        if (nation.mandateUsed + cost > myBudget) return reply.code(400).send({ error: 'Insufficient mandates' });
        await prisma.$transaction([
          prisma.territoryState.update({ where: { id: p.territoryId }, data: { pendingConstructionType: 'port' } }),
          prisma.nation.update({ where: { id: nationId }, data: { mandateUsed: { increment: cost }, indStock: { decrement: BUILD_INDUSTRY['port']! } } }),
        ]);
        return { ok: true };
      }

      const alreadyQueued = await prisma.queuedAction.findFirst({
        where: { payload: { path: ['territoryId'], equals: p.territoryId } },
      });
      if (alreadyQueued) return reply.code(400).send({ error: 'A build is already queued for this territory this tick' });
    }

    if (type === 'build_fort') {
      const p = payload as { territoryId?: string };
      if (!p?.territoryId) return reply.code(400).send({ error: 'Missing territoryId' });
      const territory = await prisma.territoryState.findUnique({ where: { id: p.territoryId } });
      if (!territory) return reply.code(404).send({ error: 'Territory not found' });
      if (territory.ownerId !== nationId) return reply.code(403).send({ error: 'Not your territory' });
      if (territory.fortificationLevel >= 3) return reply.code(400).send({ error: 'Fortification already at maximum level' });
      if (territory.pendingConstructionType !== null) return reply.code(400).send({ error: 'Next construction already queued' });
      const targetLevel = (territory.fortificationLevel + 1) as 1 | 2 | 3;
      const constructionType = `fort_l${targetLevel}` as const;
      if (nation.indStock < BUILD_INDUSTRY[constructionType]!) return reply.code(400).send({ error: 'Insufficient industry stockpile' });
      cost = FORT_MANDATE_COSTS[targetLevel];
      finalPayload = { territoryId: p.territoryId, targetLevel };

      if (territory.constructionType !== null) {
        // DEFERRED PATH: queue fort build to start when current construction finishes.
        if (nation.mandateUsed + cost > myBudget) return reply.code(400).send({ error: 'Insufficient mandates' });
        await prisma.$transaction([
          prisma.territoryState.update({ where: { id: p.territoryId }, data: { pendingConstructionType: constructionType } }),
          prisma.nation.update({ where: { id: nationId }, data: { mandateUsed: { increment: cost }, indStock: { decrement: BUILD_INDUSTRY[constructionType]! } } }),
        ]);
        return { ok: true };
      }

      const alreadyQueued = await prisma.queuedAction.findFirst({
        where: { payload: { path: ['territoryId'], equals: p.territoryId } },
      });
      if (alreadyQueued) return reply.code(400).send({ error: 'A build is already queued for this territory this tick' });
    }

    if (nation.mandateUsed + cost > myBudget) {
      return reply.code(400).send({ error: 'Insufficient mandates' });
    }

    await prisma.$transaction([
      prisma.queuedAction.create({
        data: { nationId, phase: currentPhase(), type, payload: finalPayload, tickQueued: meta.tick },
      }),
      prisma.nation.update({
        where: { id: nationId },
        data: { mandateUsed: { increment: cost } },
      }),
    ]);

    return { ok: true };
  });

  // ── Admin endpoints ────────────────────────────────────────────────────────

  app.post('/admin/tick', async (request, reply) => {
    const key = (request.headers as Record<string, string>)['x-admin-key'];
    if (key !== ADMIN_KEY) return reply.code(401).send({ error: 'unauthorized' });
    try {
      return { ok: true, tick: (await runTick(defs)).tick };
    } catch (err: unknown) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // [DEV-ONLY] Override the phase the game reports, bypassing the real clock.
  // ?phase=main | ?phase=prep  — force that phase
  // (no ?phase param)          — clear override, return to real clock
  // [DEFERRED SECURITY] Remove before production. See docs §11.
  app.post('/admin/set-phase', async (request, reply) => {
    const key = (request.headers as Record<string, string>)['x-admin-key'];
    if (key !== ADMIN_KEY) return reply.code(401).send({ error: 'unauthorized' });
    const { phase } = request.query as { phase?: string };
    if (phase !== undefined && phase !== 'main' && phase !== 'prep') {
      return reply.code(400).send({ error: 'phase must be "main" or "prep" (omit to clear)' });
    }
    setPhaseOverride(phase === 'main' ? 'main' : phase === 'prep' ? 'prep' : null);
    return { ok: true, phase: currentPhase(), override: getPhaseOverride() };
  });

  // Wipes all game data and re-initializes with Phase 3 nations.
  // Use when upgrading from Phase 2 DB or for a clean restart.
  app.post('/admin/reset-world', async (request, reply) => {
    const key = (request.headers as Record<string, string>)['x-admin-key'];
    if (key !== ADMIN_KEY) return reply.code(401).send({ error: 'unauthorized' });
    await prisma.$transaction([
      prisma.queuedAction.deleteMany(),
      prisma.eventLog.deleteMany(),
      prisma.territoryState.deleteMany(),
      prisma.nation.deleteMany(),
      prisma.worldMeta.deleteMany(),
    ]);
    await ensureWorldInitialized(defs);
    return { ok: true, message: 'World reset to tick 0 with Phase 3 nations.' };
  });

  // ── Admin API via /api/admin/* (proxied through Vite /api prefix) ───────────
  // [DEFERRED SECURITY] Full god's-eye view + direct world mutation.
  // Gated by X-Admin-Key header — key never sent to player sessions.
  // Must be disabled/removed before any public deployment. See docs §11.

  function requireAdminKey(request: FastifyRequest, reply: FastifyReply): boolean {
    const key = (request.headers as Record<string, string>)['x-admin-key'];
    if (key !== ADMIN_KEY) { void reply.code(401).send({ error: 'unauthorized' }); return false; }
    return true;
  }

  app.post('/api/admin/tick', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    try { return { ok: true, tick: (await runTick(defs)).tick }; }
    catch (err: unknown) { return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) }); }
  });

  app.post('/api/admin/set-phase', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { phase } = request.query as { phase?: string };
    if (phase !== undefined && phase !== 'main' && phase !== 'prep') {
      return reply.code(400).send({ error: 'phase must be "main" or "prep" (omit to clear)' });
    }
    setPhaseOverride(phase === 'main' ? 'main' : phase === 'prep' ? 'prep' : null);
    return { ok: true, phase: currentPhase(), override: getPhaseOverride() };
  });

  app.post('/api/admin/reset-world', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    await prisma.$transaction([
      prisma.queuedAction.deleteMany(),
      prisma.eventLog.deleteMany(),
      prisma.territoryState.deleteMany(),
      prisma.nation.deleteMany(),
      prisma.worldMeta.deleteMany(),
    ]);
    await ensureWorldInitialized(defs);
    return { ok: true, message: 'World reset to tick 0.' };
  });

  app.get('/api/admin/world-full', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
    if (!meta) return reply.code(503).send({ error: 'World not initialized' });
    const [nationRows, territoryRows, events] = await Promise.all([
      prisma.nation.findMany(),
      prisma.territoryState.findMany(),
      prisma.eventLog.findMany({ orderBy: { id: 'desc' }, take: 50 }),
    ]);
    const adjacency: Record<string, readonly string[]> = Object.fromEntries(defs.map((d) => [d.id, d.adjacentIds]));
    const allTerritories: Record<string, { def: TerritoryDef; state: TerritoryState }> = {};
    for (const row of territoryRows) {
      const def = defById.get(row.id);
      if (!def) continue;
      allTerritories[row.id] = {
        def,
        state: {
          ownerId: row.ownerId, fortificationLevel: row.fortificationLevel,
          hasRoad: row.hasRoad, hasPort: row.hasPort, unrest: row.unrest,
          isInRevolt: row.isInRevolt,
          valueTraits: { individualist: row.individualist, progressive: row.progressive, militaristic: row.militaristic, expansionist: row.expansionist },
          constructionType: (row.constructionType ?? null) as TerritoryState['constructionType'],
          constructionTicksLeft: row.constructionTicksLeft ?? null,
          pendingConstructionType: (row.pendingConstructionType ?? null) as TerritoryState['pendingConstructionType'],
        },
      };
    }
    const nationCultures: Record<string, ReturnType<typeof computeNationCulture>> = {};
    for (const n of nationRows) nationCultures[n.id] = computeNationCulture(n.id, allTerritories);
    const territoryCounts: Record<string, number> = {};
    for (const row of territoryRows) {
      if (row.ownerId) territoryCounts[row.ownerId] = (territoryCounts[row.ownerId] ?? 0) + 1;
    }
    const nationNameMap = Object.fromEntries(nationRows.map((n) => [n.id, n.name]));
    const territories = territoryRows.map((t) => {
      const def = defById.get(t.id);
      const nc = t.ownerId ? nationCultures[t.ownerId] : null;
      const ownerRow = t.ownerId ? nationRows.find((n) => n.id === t.ownerId) : null;
      let compatibility = null, unrestCauses = null;
      if (t.ownerId && nc && def) {
        const terrTraits = { individualist: t.individualist, progressive: t.progressive, militaristic: t.militaristic, expansionist: t.expansionist };
        const effectiveFamily = (t.culturalFamily ?? def.culturalFamily) as import('@war/engine').CulturalFamily;
        compatibility = computeCompatibility(terrTraits, effectiveFamily, nc);
        const hops = ownerRow?.capitalTerritoryId ? bfsDistance(adjacency, ownerRow.capitalTerritoryId, t.id) : 0;
        unrestCauses = computeUnrestEquilibrium(compatibility, hops, t.hasRoad, territoryCounts[t.ownerId!] ?? 1);
      }
      return {
        id: t.id, name: def?.name ?? t.id,
        ownerId: t.ownerId, ownerName: t.ownerId ? (nationNameMap[t.ownerId] ?? null) : null,
        unrest: t.unrest, unrestCauses, isInRevolt: t.isInRevolt,
        fortificationLevel: t.fortificationLevel, hasRoad: t.hasRoad, hasPort: t.hasPort,
        isCoastal: def?.isCoastal ?? false,
        constructionType: t.constructionType ?? null,
        constructionTicksLeft: t.constructionTicksLeft ?? null,
        pendingConstructionType: t.pendingConstructionType ?? null,
        compatibility,
        culture: {
          individualist: t.individualist, progressive: t.progressive,
          militaristic: t.militaristic, expansionist: t.expansionist,
          family: t.culturalFamily ?? def?.culturalFamily ?? 'unknown',
        },
      };
    });
    const nations = nationRows.map((n) => ({
      id: n.id, name: n.name, isAI: n.isAI,
      stockpiles: { population: n.popStock, industry: n.indStock, wealth: n.wealthStock },
      armySize: n.armySize, mandateBudget: mandateBudget(territoryCounts[n.id] ?? 0), mandateUsed: n.mandateUsed,
      capital: n.capitalTerritoryId, culture: nationCultures[n.id] ?? null,
    }));
    return {
      tick: meta.tick, phase: currentPhase(), nations, territories,
      recentEvents: events.map((e) => ({ tick: e.tick, message: e.message })),
    };
  });

  app.post('/api/admin/territory/:id/set-unrest', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    const { value } = request.body as { value?: number };
    if (typeof value !== 'number' || value < 0 || value > 1) return reply.code(400).send({ error: 'value must be 0.0–1.0' });
    await prisma.territoryState.update({ where: { id }, data: { unrest: value } });
    return { ok: true };
  });

  app.post('/api/admin/territory/:id/set-trait', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    const { trait, value } = request.body as { trait?: string; value?: number };
    const validTraits = ['individualist', 'progressive', 'militaristic', 'expansionist'] as const;
    if (!trait || !validTraits.includes(trait as typeof validTraits[number])) {
      return reply.code(400).send({ error: `trait must be one of: ${validTraits.join(', ')}` });
    }
    if (typeof value !== 'number' || value < -1 || value > 1) return reply.code(400).send({ error: 'value must be −1.0–+1.0' });
    await prisma.territoryState.update({ where: { id }, data: { [trait]: value } });
    return { ok: true };
  });

  app.post('/api/admin/territory/:id/toggle-revolt', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    const t = await prisma.territoryState.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: 'Territory not found' });
    await prisma.territoryState.update({ where: { id }, data: { isInRevolt: !t.isInRevolt } });
    return { ok: true, isInRevolt: !t.isInRevolt };
  });

  app.post('/api/admin/territory/:id/set-family', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    const { family } = request.body as { family?: string | null };
    const validFamilies = ['latin', 'european', 'arab', 'slavic', 'east_asian', 'african', 'south_asian', 'indigenous'] as const;
    if (family !== null && family !== undefined && !validFamilies.includes(family as typeof validFamilies[number])) {
      return reply.code(400).send({ error: `family must be one of: ${validFamilies.join(', ')} (or null to clear override)` });
    }
    await prisma.territoryState.update({ where: { id }, data: { culturalFamily: family ?? null } });
    return { ok: true, culturalFamily: family ?? null };
  });

  app.post('/api/admin/territory/:id/set-owner', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    const { ownerId } = request.body as { ownerId?: string | null };
    if (ownerId !== null && ownerId !== undefined) {
      const nation = await prisma.nation.findUnique({ where: { id: ownerId } });
      if (!nation) return reply.code(400).send({ error: `Nation not found: ${ownerId}` });
    }
    await prisma.territoryState.update({ where: { id }, data: { ownerId: ownerId ?? null } });
    return { ok: true, ownerId: ownerId ?? null };
  });

  app.post('/api/admin/territory/:id/set-fort', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    const { level } = request.body as { level?: number };
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 0 || level > 3) {
      return reply.code(400).send({ error: 'level must be 0–3' });
    }
    await prisma.territoryState.update({ where: { id }, data: { fortificationLevel: level } });
    return { ok: true };
  });

  app.post('/api/admin/territory/:id/toggle-road', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    const t = await prisma.territoryState.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: 'Territory not found' });
    await prisma.territoryState.update({ where: { id }, data: { hasRoad: !t.hasRoad } });
    return { ok: true, hasRoad: !t.hasRoad };
  });

  app.post('/api/admin/territory/:id/toggle-port', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    const t = await prisma.territoryState.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: 'Territory not found' });
    await prisma.territoryState.update({ where: { id }, data: { hasPort: !t.hasPort } });
    return { ok: true, hasPort: !t.hasPort };
  });

  app.post('/api/admin/territory/:id/clear-construction', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    await prisma.territoryState.update({ where: { id }, data: { constructionType: null, constructionTicksLeft: null, pendingConstructionType: null } });
    return { ok: true };
  });

  // ── Dev endpoints (session-gated to player1 / nation_costa_rica) ───────────
  // [DEV-ONLY] Session-gated wrappers so the web UI can call admin functions
  // without the admin key ever reaching the browser.
  // [DEFERRED SECURITY] Remove or replace with real RBAC before production. §11.

  const DEV_NATION_ID = 'nation_costa_rica';
  const CULTURE_TRAITS = ['individualist', 'progressive', 'militaristic', 'expansionist'] as const;

  function requireDev(request: FastifyRequest, reply: FastifyReply): string | null {
    const nationId = getSession(request);
    if (nationId !== DEV_NATION_ID) {
      reply.code(403).send({ error: 'Dev endpoints require the player1 session' });
      return null;
    }
    return nationId;
  }

  app.post('/api/dev/tick', async (request, reply) => {
    if (!requireDev(request, reply)) return;
    try { return { ok: true, tick: (await runTick(defs)).tick }; }
    catch (err: unknown) { return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) }); }
  });

  app.post('/api/dev/set-phase', async (request, reply) => {
    if (!requireDev(request, reply)) return;
    const { phase } = request.query as { phase?: string };
    if (phase !== undefined && phase !== 'main' && phase !== 'prep') {
      return reply.code(400).send({ error: 'phase must be "main" or "prep" (omit to clear)' });
    }
    setPhaseOverride(phase === 'main' ? 'main' : phase === 'prep' ? 'prep' : null);
    return { ok: true, phase: currentPhase(), override: getPhaseOverride() };
  });

  app.post('/api/dev/reset-world', async (request, reply) => {
    if (!requireDev(request, reply)) return;
    await prisma.$transaction([
      prisma.queuedAction.deleteMany(),
      prisma.eventLog.deleteMany(),
      prisma.territoryState.deleteMany(),
      prisma.nation.deleteMany(),
      prisma.worldMeta.deleteMany(),
    ]);
    await ensureWorldInitialized(defs);
    return { ok: true, message: 'World reset to tick 0.' };
  });

  app.get('/api/dev/territory/:id', async (request, reply) => {
    if (!requireDev(request, reply)) return;
    const { id } = request.params as { id: string };
    const t = await prisma.territoryState.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: 'Territory not found' });
    return t;
  });

  app.post('/api/dev/territory/:id/set-unrest', async (request, reply) => {
    if (!requireDev(request, reply)) return;
    const { id } = request.params as { id: string };
    const { value } = request.body as { value?: number };
    if (typeof value !== 'number' || value < 0 || value > 1) {
      return reply.code(400).send({ error: 'value must be 0.0–1.0' });
    }
    await prisma.territoryState.update({ where: { id }, data: { unrest: value } });
    return { ok: true };
  });

  app.post('/api/dev/territory/:id/set-trait', async (request, reply) => {
    if (!requireDev(request, reply)) return;
    const { id } = request.params as { id: string };
    const { trait, value } = request.body as { trait?: string; value?: number };
    if (!trait || !CULTURE_TRAITS.includes(trait as typeof CULTURE_TRAITS[number])) {
      return reply.code(400).send({ error: `trait must be one of: ${CULTURE_TRAITS.join(', ')}` });
    }
    if (typeof value !== 'number' || value < -1 || value > 1) {
      return reply.code(400).send({ error: 'value must be −1.0–+1.0' });
    }
    await prisma.territoryState.update({ where: { id }, data: { [trait]: value } });
    return { ok: true };
  });

  // ── Startup ────────────────────────────────────────────────────────────────

  await prisma.$connect();
  app.log.info('Database connected');

  await ensureWorldInitialized(defs);

  startScheduler(defs);

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
