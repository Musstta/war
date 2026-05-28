import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { loadTerritoryDefs } from '@war/engine';
import type { TerritoryDef } from '@war/engine';
import { prisma } from './db';
import { ensureWorldInitialized } from './world';
import { runTick, startScheduler } from './tick';
import { ADMIN_KEY, DATA_FILE, PORT, SESSION_SECRET } from './config';
import { authenticate } from './auth';
import { currentPhase, getPhaseOverride, setPhaseOverride, mandateBudget, ACTION_COSTS, ACTION_PHASE, FORT_MANDATE_COSTS } from './phase';
import { BUILD_INDUSTRY } from '@war/engine';

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
  const nation = await prisma.nation.findUnique({ where: { id: nationId } });
  if (!nation) return reply.code(404).send({ error: 'Nation not found' });
  return {
    nationId,
    name: nation.name,
    phase: currentPhase(),
    mandateBudget: mandateBudget(nation.wealthStock),
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

    const [nationRows, territoryRows, events] = await Promise.all([
      prisma.nation.findMany(),
      prisma.territoryState.findMany(),
      prisma.eventLog.findMany({ orderBy: { id: 'desc' }, take: 10 }),
    ]);

    // Visibility: own territories + all their adjacent territories
    const ownIds = territoryRows.filter((t) => t.ownerId === nationId).map((t) => t.id);
    const visibleIds = new Set(ownIds);
    for (const id of ownIds) {
      defById.get(id)?.adjacentIds.forEach((adj) => visibleIds.add(adj));
    }

    // All territories show ownership; visible ones also show detailed stats
    const territories: Record<string, object> = {};
    for (const t of territoryRows) {
      const def = defById.get(t.id);
      const entry: Record<string, unknown> = {
        id: t.id,
        ownerId: t.ownerId,
        hasRoad: t.hasRoad,
        hasPort: t.hasPort,
        isCoastal: def?.isCoastal ?? false,
      };
      if (visibleIds.has(t.id)) {
        entry.fortificationLevel = t.fortificationLevel;
        entry.unrest = t.unrest;
        entry.constructionType = t.constructionType ?? null;
        entry.constructionTicksLeft = t.constructionTicksLeft ?? null;
      }
      territories[t.id] = entry;
    }

    // All nations show name; own nation also shows resources
    const nations: Record<string, object> = {};
    const myNationRow = nationRows.find((n) => n.id === nationId);
    for (const n of nationRows) {
      const entry: Record<string, unknown> = { id: n.id, name: n.name };
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
      mandateBudget: myNationRow ? mandateBudget(myNationRow.wealthStock) : 0,
      mandateUsed: myNationRow?.mandateUsed ?? 0,
      nations,
      territories,
      recentEvents: events.map((e) => e.message),
    };
  });

  // ── Queue action ───────────────────────────────────────────────────────────

  app.post('/api/action', async (request, reply) => {
    const nationId = getSession(request);
    if (!nationId) return reply.code(401).send({ error: 'Not logged in' });

    const body = request.body as { type?: string; payload?: unknown };
    const { type, payload } = body;
    if (!type) return reply.code(400).send({ error: 'Missing action type' });
    if (!(type in ACTION_COSTS)) return reply.code(400).send({ error: `Unknown action type: ${type}` });

    const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
    if (!meta) return reply.code(503).send({ error: 'World not initialized' });

    const allowedPhase = ACTION_PHASE[type];
    if (allowedPhase && currentPhase() !== allowedPhase) {
      return reply.code(400).send({ error: `${type} can only be queued during ${allowedPhase} phase` });
    }

    const nation = await prisma.nation.findUnique({ where: { id: nationId } });
    if (!nation) return reply.code(404).send({ error: 'Nation not found' });

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
      if (territory.constructionType !== null) return reply.code(400).send({ error: 'Territory has construction in progress' });
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
      if (territory.constructionType !== null) return reply.code(400).send({ error: 'Territory has construction in progress' });
      if (nation.indStock < BUILD_INDUSTRY['port']!) return reply.code(400).send({ error: 'Insufficient industry stockpile' });
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
      if (territory.constructionType !== null) return reply.code(400).send({ error: 'Territory has construction in progress' });
      const targetLevel = (territory.fortificationLevel + 1) as 1 | 2 | 3;
      const constructionType = `fort_l${targetLevel}` as const;
      if (nation.indStock < BUILD_INDUSTRY[constructionType]!) return reply.code(400).send({ error: 'Insufficient industry stockpile' });
      const alreadyQueued = await prisma.queuedAction.findFirst({
        where: { payload: { path: ['territoryId'], equals: p.territoryId } },
      });
      if (alreadyQueued) return reply.code(400).send({ error: 'A build is already queued for this territory this tick' });
      cost = FORT_MANDATE_COSTS[targetLevel];
      finalPayload = { territoryId: p.territoryId, targetLevel };
    }

    if (nation.mandateUsed + cost > mandateBudget(nation.wealthStock)) {
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
