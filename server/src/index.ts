import Fastify from 'fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { loadTerritoryDefs, computeNationCulture, computeCompatibility, computeUnrestEquilibrium, computeConquestShock, bfsDistance, CONQUEST_SHOCK_MIN, RECENT_ACQUISITION_WINDOW } from '@war/engine';
import type { TerritoryDef, TerritoryState } from '@war/engine';
import { prisma } from './db';
import { ensureWorldInitialized } from './world';
import { runTick, startScheduler } from './tick';
import { ADMIN_KEY, DATA_FILE, PORT, SESSION_SECRET } from './config';
import { authenticate } from './auth';
import { currentPhase, getPhaseOverride, setPhaseOverride, mandateBudget, ACTION_COSTS, ACTION_PHASE } from './phase';
import { actionRegistry } from './actions';

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
  const [nation, devCount, fullCount] = await Promise.all([
    prisma.nation.findUnique({ where: { id: nationId } }),
    prisma.territoryState.count({ where: { ownerId: nationId, hasRoad: true, hasPort: true, fortificationLevel: { gte: 1 } } }),
    prisma.territoryState.count({ where: { ownerId: nationId, hasRoad: true, hasPort: true, fortificationLevel: 3 } }),
  ]);
  if (!nation) return reply.code(404).send({ error: 'Nation not found' });
  return {
    nationId,
    name: nation.name,
    phase: currentPhase(),
    mandateBudget: mandateBudget(devCount, fullCount),
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
        def: row.culturalFamily ? { ...def, culturalFamily: row.culturalFamily as import('@war/engine').CulturalFamily } : def,
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
          ownershipShock: row.ownershipShock,
          acquiredTick: row.acquiredTick ?? null,
          localPopStock: row.localPopStock,
          localIndStock: row.localIndStock,
          localWltStock: row.localWltStock,
        },
      };
    }

    // Compute nation cultures. Pass capital so it gets extra weight. [PLACEHOLDER — fog-of-war TBD]
    const nationCultures: Record<string, ReturnType<typeof computeNationCulture>> = {};
    const capitalMap = Object.fromEntries(nationRows.map((n) => [n.id, n.capitalTerritoryId ?? null]));
    for (const n of nationRows) {
      nationCultures[n.id] = computeNationCulture(n.id, allTerritories, capitalMap[n.id]);
    }

    // Territory counts + developed/fortified counts per nation.
    const territoryCounts: Record<string, number> = {};
    const recentAcquiredCounts: Record<string, number> = {};
    const developedCounts: Record<string, number> = {};   // road+port+fort≥1
    const fullyFortCounts: Record<string, number> = {};   // road+port+fort=3
    for (const row of territoryRows) {
      if (!row.ownerId) continue;
      territoryCounts[row.ownerId] = (territoryCounts[row.ownerId] ?? 0) + 1;
      if (row.acquiredTick !== null) {
        const age = meta.tick - row.acquiredTick;
        if (age <= RECENT_ACQUISITION_WINDOW) {
          const weight = Math.max(0, 1 - age / RECENT_ACQUISITION_WINDOW);
          recentAcquiredCounts[row.ownerId] = (recentAcquiredCounts[row.ownerId] ?? 0) + weight;
        }
      }
      if (row.hasRoad && row.hasPort && row.fortificationLevel >= 1) {
        developedCounts[row.ownerId] = (developedCounts[row.ownerId] ?? 0) + 1;
      }
      if (row.hasRoad && row.hasPort && row.fortificationLevel >= 3) {
        fullyFortCounts[row.ownerId] = (fullyFortCounts[row.ownerId] ?? 0) + 1;
      }
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
        // Local stockpiles shown for own territories (trade source selection).
        if (t.ownerId === nationId) {
          entry.localPopStock = t.localPopStock;
          entry.localIndStock = t.localIndStock;
          entry.localWltStock = t.localWltStock;
        }

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
          const causes = computeUnrestEquilibrium(
            compat, hops, t.hasRoad, t.hasPort, t.fortificationLevel,
            tcount, t.ownershipShock, recentAcquiredCounts[t.ownerId] ?? 0,
          );

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
      mandateBudget: mandateBudget(developedCounts[nationId] ?? 0, fullyFortCounts[nationId] ?? 0),
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

    const handler = actionRegistry[type];
    if (!handler) return reply.code(400).send({ error: `Unknown action type: ${type}` });

    const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
    if (!meta) return reply.code(503).send({ error: 'World not initialized' });

    const allowedPhase = ACTION_PHASE[type];
    if (allowedPhase && currentPhase() !== allowedPhase) {
      return reply.code(400).send({ error: `${type} can only be queued during ${allowedPhase} phase` });
    }

    const [nation, myDevCount, myFullCount] = await Promise.all([
      prisma.nation.findUnique({ where: { id: nationId } }),
      prisma.territoryState.count({ where: { ownerId: nationId, hasRoad: true, hasPort: true, fortificationLevel: { gte: 1 } } }),
      prisma.territoryState.count({ where: { ownerId: nationId, hasRoad: true, hasPort: true, fortificationLevel: 3 } }),
    ]);
    if (!nation) return reply.code(404).send({ error: 'Nation not found' });
    const myBudget = mandateBudget(myDevCount, myFullCount);

    const ctx = {
      nationId,
      payload,
      prisma,
      defById,
      allDefs: defs,
      nation: { id: nation.id, mandateUsed: nation.mandateUsed, indStock: nation.indStock, popStock: nation.popStock, wealthStock: nation.wealthStock },
      myBudget,
      currentTick: meta.tick,
      currentPhase: currentPhase(),
    };

    const result = await handler.validate(ctx);

    if (result.ok === 'queued') return { ok: true };

    if (result.ok === 'error') return reply.code(result.status).send({ error: result.reason });

    // result.ok === 'ready' — normal path: mandate check then queue
    const { cost, finalPayload } = result;
    if (nation.mandateUsed + cost > myBudget) {
      return reply.code(400).send({ error: 'Insufficient mandates' });
    }

    await handler.queue(ctx, cost, finalPayload);
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
        def: row.culturalFamily ? { ...def, culturalFamily: row.culturalFamily as import('@war/engine').CulturalFamily } : def,
        state: {
          ownerId: row.ownerId, fortificationLevel: row.fortificationLevel,
          hasRoad: row.hasRoad, hasPort: row.hasPort, unrest: row.unrest,
          isInRevolt: row.isInRevolt,
          valueTraits: { individualist: row.individualist, progressive: row.progressive, militaristic: row.militaristic, expansionist: row.expansionist },
          constructionType: (row.constructionType ?? null) as TerritoryState['constructionType'],
          constructionTicksLeft: row.constructionTicksLeft ?? null,
          pendingConstructionType: (row.pendingConstructionType ?? null) as TerritoryState['pendingConstructionType'],
          ownershipShock: row.ownershipShock,
          acquiredTick: row.acquiredTick ?? null,
          localPopStock: row.localPopStock,
          localIndStock: row.localIndStock,
          localWltStock: row.localWltStock,
        },
      };
    }
    const adminCapitalMap = Object.fromEntries(nationRows.map((n) => [n.id, n.capitalTerritoryId ?? null]));
    const nationCultures: Record<string, ReturnType<typeof computeNationCulture>> = {};
    for (const n of nationRows) nationCultures[n.id] = computeNationCulture(n.id, allTerritories, adminCapitalMap[n.id]);
    const territoryCounts: Record<string, number> = {};
    const adminRecentAcquired: Record<string, number> = {};
    const adminDevCounts: Record<string, number> = {};
    const adminFullCounts: Record<string, number> = {};
    for (const row of territoryRows) {
      if (!row.ownerId) continue;
      territoryCounts[row.ownerId] = (territoryCounts[row.ownerId] ?? 0) + 1;
      if (row.acquiredTick !== null) {
        const age = meta.tick - row.acquiredTick;
        if (age <= RECENT_ACQUISITION_WINDOW) {
          const weight = Math.max(0, 1 - age / RECENT_ACQUISITION_WINDOW);
          adminRecentAcquired[row.ownerId] = (adminRecentAcquired[row.ownerId] ?? 0) + weight;
        }
      }
      if (row.hasRoad && row.hasPort && row.fortificationLevel >= 1)
        adminDevCounts[row.ownerId] = (adminDevCounts[row.ownerId] ?? 0) + 1;
      if (row.hasRoad && row.hasPort && row.fortificationLevel >= 3)
        adminFullCounts[row.ownerId] = (adminFullCounts[row.ownerId] ?? 0) + 1;
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
        unrestCauses = computeUnrestEquilibrium(
          compatibility, hops, t.hasRoad, t.hasPort, t.fortificationLevel,
          territoryCounts[t.ownerId!] ?? 1, t.ownershipShock, adminRecentAcquired[t.ownerId!] ?? 0,
        );
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
      armySize: n.armySize, mandateBudget: mandateBudget(adminDevCounts[n.id] ?? 0, adminFullCounts[n.id] ?? 0), mandateUsed: n.mandateUsed,
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
    const worldMeta = await prisma.worldMeta.findUnique({ where: { id: 1 } });

    // Compute compat-scaled shock: worse cultural match → larger shock.
    let shockVal = 0;
    if (ownerId != null) {
      const [terrRow, ownedRows, nationRow] = await Promise.all([
        prisma.territoryState.findUnique({ where: { id } }),
        prisma.territoryState.findMany({ where: { ownerId } }),
        prisma.nation.findUnique({ where: { id: ownerId } }),
      ]);
      const def = defById.get(id);
      if (terrRow && def) {
        // Build territory map from the new owner's existing holdings (not including the one being assigned).
        const ownedTerritories: Record<string, { def: TerritoryDef; state: TerritoryState }> = {};
        for (const row of ownedRows) {
          const d = defById.get(row.id);
          if (!d) continue;
          ownedTerritories[row.id] = {
            def: row.culturalFamily ? { ...d, culturalFamily: row.culturalFamily as import('@war/engine').CulturalFamily } : d,
            state: {
              ownerId: row.ownerId, fortificationLevel: row.fortificationLevel,
              hasRoad: row.hasRoad, hasPort: row.hasPort, unrest: row.unrest,
              isInRevolt: row.isInRevolt,
              valueTraits: { individualist: row.individualist, progressive: row.progressive, militaristic: row.militaristic, expansionist: row.expansionist },
              constructionType: (row.constructionType ?? null) as TerritoryState['constructionType'],
              constructionTicksLeft: row.constructionTicksLeft ?? null,
              pendingConstructionType: (row.pendingConstructionType ?? null) as TerritoryState['pendingConstructionType'],
              ownershipShock: row.ownershipShock, acquiredTick: row.acquiredTick ?? null,
              localPopStock: row.localPopStock, localIndStock: row.localIndStock, localWltStock: row.localWltStock,
            },
          };
        }
        const nc = computeNationCulture(ownerId, ownedTerritories, nationRow?.capitalTerritoryId ?? null);
        const terrTraits = { individualist: terrRow.individualist, progressive: terrRow.progressive, militaristic: terrRow.militaristic, expansionist: terrRow.expansionist };
        const family = (terrRow.culturalFamily ?? def.culturalFamily) as import('@war/engine').CulturalFamily;
        const compat = computeCompatibility(terrTraits, family, nc);
        shockVal = computeConquestShock(compat);
      } else {
        shockVal = (CONQUEST_SHOCK_MIN + 0.70) / 2; // fallback if data missing
      }
    }

    const acquiredTickVal = ownerId != null ? (worldMeta?.tick ?? 0) : null;
    await prisma.territoryState.update({
      where: { id },
      data: { ownerId: ownerId ?? null, ownershipShock: shockVal, acquiredTick: acquiredTickVal },
    });
    return { ok: true, ownerId: ownerId ?? null, ownershipShock: shockVal };
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

  // ── Diplomacy API ──────────────────────────────────────────────────────────

  // GET /api/diplomacy — returns the calling nation's diplomacy state:
  // active treaties, incoming/outgoing proposals, their Trust, partner Trust values.
  app.get('/api/diplomacy', async (request, reply) => {
    const nationId = getSession(request);
    if (!nationId) return reply.code(401).send({ error: 'Not logged in' });

    const [
      myNation,
      activeTreaties,
      incomingProposals,
      outgoingProposals,
      allNations,
      incomingInstantTrades,
      outgoingInstantTrades,
    ] = await Promise.all([
      prisma.nation.findUnique({ where: { id: nationId } }),
      prisma.treaty.findMany({
        where: { status: { in: ['active', 'degraded'] }, parties: { some: { nationId } } },
        include: { parties: true, clauses: { include: { tradeRoute: true, objectiveClause: true } }, proposal: { select: { proposerId: true, targetId: true } } },
      }),
      prisma.proposal.findMany({
        where: { targetId: nationId, status: 'pending' },
        include: { clauses: true },
      }),
      prisma.proposal.findMany({
        where: { proposerId: nationId, status: 'pending' },
        include: { clauses: true },
      }),
      prisma.nation.findMany({ select: { id: true, name: true, trust: true } }),
      prisma.instantTrade.findMany({ where: { targetNationId: nationId, status: 'pending' } }),
      prisma.instantTrade.findMany({ where: { proposerNationId: nationId, status: 'pending' } }),
    ]);

    if (!myNation) return reply.code(404).send({ error: 'Nation not found' });

    const nationNameMap = Object.fromEntries(allNations.map((n) => [n.id, n.name]));
    const nationTrustMap = Object.fromEntries(allNations.map((n) => [n.id, n.trust]));

    return {
      myTrust: myNation.trust,
      inactivityTier: myNation.inactivityTier,
      treaties: activeTreaties.map((t) => ({
        id: t.id,
        status: t.status,
        termTicks: t.termTicks,
        tickStarted: t.tickStarted,
        tickEnds: t.tickEnds,
        totalCollateral: t.totalCollateral,
        parties: t.parties.map((p) => ({
          nationId: p.nationId,
          nationName: nationNameMap[p.nationId] ?? p.nationId,
          collateralDeposited: p.collateralDeposited,
          escrowAmount: p.escrowAmount,
          refundRemaining: p.refundRemaining,
        })),
        clauses: t.clauses.map((c) => ({
          id: c.id,
          clauseIndex: c.clauseIndex,
          type: c.type,
          collateral: c.collateral,
          payload: c.payload,
          clauseStatus: c.clauseStatus,
          missedPayments: c.missedPayments,
          tradeRoute: (c as any).tradeRoute ? {
            path: (c as any).tradeRoute.path,
            isSeaRoute: (c as any).tradeRoute.isSeaRoute,
            pathStale: (c as any).tradeRoute.pathStale,
            capacity: (c as any).tradeRoute.capacity,
            friction: (c as any).tradeRoute.friction,
          } : null,
          objectiveClause: (c as any).objectiveClause ?? null,
        })),
        partnerTrust: t.parties
          .filter((p) => p.nationId !== nationId)
          .map((p) => ({ nationId: p.nationId, trust: nationTrustMap[p.nationId] ?? 50 })),
      })),
      incomingProposals: incomingProposals.map((p) => ({
        id: p.id,
        proposerId: p.proposerId,
        proposerName: nationNameMap[p.proposerId] ?? p.proposerId,
        proposerTrust: nationTrustMap[p.proposerId] ?? 50,
        termTicks: p.termTicks,
        proposerCollateral: p.proposerCollateral,
        targetCollateral: p.targetCollateral,
        tickProposed: p.tickProposed,
        expiresAtTick: p.expiresAtTick,
        clauses: p.clauses.map((c) => ({ type: c.type, collateral: c.collateral, payload: c.payload })),
      })),
      outgoingProposals: outgoingProposals.map((p) => ({
        id: p.id,
        targetId: p.targetId,
        targetName: nationNameMap[p.targetId] ?? p.targetId,
        termTicks: p.termTicks,
        proposerCollateral: p.proposerCollateral,
        targetCollateral: p.targetCollateral,
        tickProposed: p.tickProposed,
        expiresAtTick: p.expiresAtTick,
        clauses: p.clauses.map((c) => ({ type: c.type, collateral: c.collateral, payload: c.payload })),
      })),
      nationTrust: Object.fromEntries(allNations.map((n) => [n.id, { name: n.name, trust: n.trust }])),
      incomingInstantTrades: incomingInstantTrades.map((t) => ({
        id: t.id,
        proposerNationId: t.proposerNationId,
        proposerName: allNations.find((n) => n.id === t.proposerNationId)?.name ?? t.proposerNationId,
        resource: t.resource,
        amount: t.amount,
        sourceTerritoryId: t.sourceTerritoryId,
        tickProposed: t.tickProposed,
        expiresAtTick: t.expiresAtTick,
      })),
      outgoingInstantTrades: outgoingInstantTrades.map((t) => ({
        id: t.id,
        targetNationId: t.targetNationId,
        targetName: allNations.find((n) => n.id === t.targetNationId)?.name ?? t.targetNationId,
        resource: t.resource,
        amount: t.amount,
        sourceTerritoryId: t.sourceTerritoryId,
        tickProposed: t.tickProposed,
        expiresAtTick: t.expiresAtTick,
      })),
    };
  });

  // ── Admin diplomacy endpoints ──────────────────────────────────────────────

  // GET /api/admin/diplomacy — full treaty + trade inspector (god's-eye view)
  app.get('/api/admin/diplomacy', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const [treaties, proposals, nations, instantTrades, tradeRoutes] = await Promise.all([
      prisma.treaty.findMany({ include: { parties: true, clauses: { include: { tradeRoute: true, objectiveClause: true } } } }),
      prisma.proposal.findMany({ include: { clauses: true } }),
      prisma.nation.findMany({ select: { id: true, name: true, trust: true, inactivityTier: true, lastBrokenPromiseTick: true } }),
      prisma.instantTrade.findMany({ orderBy: { id: 'desc' }, take: 50 }),
      prisma.tradeRoute.findMany({ include: { treatyClause: { select: { treatyId: true, type: true, clauseIndex: true } } } }),
    ]);
    return { treaties, proposals, nations, instantTrades, tradeRoutes };
  });

  // POST /api/admin/nation/:id/set-trust — force-set a nation's Trust
  app.post('/api/admin/nation/:id/set-trust', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    const { value } = request.body as { value?: number };
    if (typeof value !== 'number' || value < 0 || value > 100) {
      return reply.code(400).send({ error: 'value must be 0–100' });
    }
    await prisma.nation.update({ where: { id }, data: { trust: value } });
    return { ok: true };
  });

  // POST /api/admin/nation/:id/set-tier — force-set inactivity tier (for testing degradation)
  app.post('/api/admin/nation/:id/set-tier', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    const { tier } = request.body as { tier?: string };
    const validTiers = ['active', 'dormant', 'autopilot', 'abandoned'];
    if (!tier || !validTiers.includes(tier)) {
      return reply.code(400).send({ error: `tier must be one of: ${validTiers.join(', ')}` });
    }

    // When setting Dormant: trigger treaty degradation — escrow inactive party's collateral
    // and start active partner's refund. Mirror of the design doc §8.5 mechanic.
    if (tier === 'dormant') {
      const nation = await prisma.nation.findUnique({ where: { id } });
      if (!nation) return reply.code(404).send({ error: 'Nation not found' });
      const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
      const currentTick = meta?.tick ?? 0;

      const activeTreaties = await prisma.treaty.findMany({
        where: { status: 'active', parties: { some: { nationId: id } } },
        include: { parties: true },
      });

      for (const treaty of activeTreaties) {
        const inactiveParty = treaty.parties.find((p) => p.nationId === id)!;
        const activeParty   = treaty.parties.find((p) => p.nationId !== id)!;

        // Move inactive party's collateral to escrow.
        await prisma.treatyParty.update({
          where: { id: inactiveParty.id },
          data: { escrowAmount: inactiveParty.collateralDeposited, escrowStartTick: currentTick, collateralDeposited: 0 },
        });

        // Begin active partner's refund over DEGRADATION_REFUND_TICKS.
        await prisma.treatyParty.update({
          where: { id: activeParty.id },
          data: { refundRemaining: activeParty.collateralDeposited, refundStartTick: currentTick },
        });

        // Degrade treaty status.
        await prisma.treaty.update({ where: { id: treaty.id }, data: { status: 'degraded' } });

        await prisma.eventLog.create({
          data: {
            tick: currentTick,
            message: `${nation.name} went Dormant. Treaty #${treaty.id} degraded. Active partner's collateral refund started.`,
          },
        });
      }
    }

    // If returning to active from dormant: auto-upgrade degraded treaties, apply escrow skim.
    if (tier === 'active') {
      const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
      const currentTick = meta?.tick ?? 0;
      const { ESCROW_SKIM_RATE } = await import('@war/engine');

      const degradedTreaties = await prisma.treaty.findMany({
        where: { status: 'degraded', parties: { some: { nationId: id } } },
        include: { parties: true },
      });

      for (const treaty of degradedTreaties) {
        const returningParty = treaty.parties.find((p) => p.nationId === id)!;
        const escrow = returningParty.escrowAmount;
        const skim = escrow * ESCROW_SKIM_RATE;
        const refund = escrow - skim;

        if (refund > 0) {
          await prisma.nation.update({ where: { id }, data: { wealthStock: { increment: refund } } });
        }

        await prisma.treatyParty.update({
          where: { id: returningParty.id },
          data: { escrowAmount: 0, escrowStartTick: null, collateralDeposited: refund },
        });

        await prisma.treaty.update({ where: { id: treaty.id }, data: { status: 'active' } });

        await prisma.eventLog.create({
          data: {
            tick: currentTick,
            message: `Nation returned from Dormant. Treaty #${treaty.id} upgraded. Escrow skim: ${skim.toFixed(2)} Wealth.`,
          },
        });
      }
    }

    await prisma.nation.update({ where: { id }, data: { inactivityTier: tier } });
    return { ok: true, tier };
  });

  // POST /api/admin/treaty/:id/force-break — admin force-breaks a treaty (no Trust penalty)
  app.post('/api/admin/treaty/:id/force-break', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    const treatyId = parseInt(id, 10);
    if (isNaN(treatyId)) return reply.code(400).send({ error: 'Invalid treaty id' });
    const treaty = await prisma.treaty.findUnique({ where: { id: treatyId } });
    if (!treaty) return reply.code(404).send({ error: 'Treaty not found' });
    await prisma.treaty.update({ where: { id: treatyId }, data: { status: 'broken' } });
    return { ok: true };
  });

  // POST /api/admin/objective/:id/force-meet — force an objective clause to 'met' status
  // Used for testing without building the real infrastructure.
  // curl -X POST http://localhost:3001/api/admin/objective/1/force-meet -H "X-Admin-Key: dev-only-insecure-key"
  app.post('/api/admin/objective/:id/force-meet', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    const objId = parseInt(id, 10);
    if (isNaN(objId)) return reply.code(400).send({ error: 'Invalid objective clause id' });
    const obj = await prisma.objectiveClause.findUnique({ where: { id: objId } });
    if (!obj) return reply.code(404).send({ error: 'Objective clause not found' });
    if (obj.status !== 'pending') return reply.code(400).send({ error: `Objective clause is already ${obj.status}` });
    await prisma.objectiveClause.update({ where: { id: objId }, data: { status: 'met' } });
    const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
    await prisma.eventLog.create({
      data: { tick: meta?.tick ?? 0, message: `[admin] Objective clause #${objId} (${obj.objectiveType}) force-set to met.` },
    });
    return { ok: true, id: objId, status: 'met' };
  });

  // POST /api/admin/objective/:id/force-fail — force an objective clause to 'failed' status
  // curl -X POST http://localhost:3001/api/admin/objective/1/force-fail -H "X-Admin-Key: dev-only-insecure-key"
  app.post('/api/admin/objective/:id/force-fail', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    const objId = parseInt(id, 10);
    if (isNaN(objId)) return reply.code(400).send({ error: 'Invalid objective clause id' });
    const obj = await prisma.objectiveClause.findUnique({ where: { id: objId } });
    if (!obj) return reply.code(404).send({ error: 'Objective clause not found' });
    if (obj.status !== 'pending') return reply.code(400).send({ error: `Objective clause is already ${obj.status}` });
    await prisma.objectiveClause.update({ where: { id: objId }, data: { status: 'failed' } });
    const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
    await prisma.eventLog.create({
      data: { tick: meta?.tick ?? 0, message: `[admin] Objective clause #${objId} (${obj.objectiveType}) force-set to failed.` },
    });
    return { ok: true, id: objId, status: 'failed' };
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
