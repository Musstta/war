import Fastify from 'fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { loadTerritoryDefs, computeNationCulture, computeCompatibility, computeUnrestEquilibrium, computeConquestShock, bfsDistance, CONQUEST_SHOCK_MIN, RECENT_ACQUISITION_WINDOW, computeVisibility, VisibilityTier, deriveTerritoryTraits, deterministicSeed, computeClauseWealthValue, computeClauseDiplomaticWeight, computeMinCollateral, maintainPeaceTrustMultiplier } from '@war/engine';
import type { TerritoryDef, TerritoryState, ComputeVisibilityInput, VisTreatyInput, VisEmbassyInput } from '@war/engine';
import { prisma } from './db';
import { ensureWorldInitialized, ensureGameWorldInitialized } from './world';
import { runTick, startScheduler } from './tick';
import { scheduleGameTick, deregisterGame, runGameTick, resumeActiveGames, scheduleSelectionDeadline } from './scheduler';
import { rollCandidates, getCandidateViews, confirmCandidate, autoAssignUnconfirmed } from './territorySelection';
import { fragmentationRisk } from './caretaker';
import { ADMIN_KEY, DATA_FILE, PORT, SESSION_SECRET } from './config';
import { loginUser, logoutUser, registerUser, getSessionNationId, PLAYER_NATION_MAP } from './auth';
import { currentPhase, getPhaseOverride, setPhaseOverride, mandateBudget, ACTION_COSTS, ACTION_PHASE } from './phase';
import { actionRegistry } from './actions';

const app = Fastify({ logger: true });

// [DEFERRED SECURITY] Signed cookie — not encrypted. Fine for the private 5-player
// dev game; must move to HTTPS + encrypted session before any wider exposure.
void app.register(fastifyCookie, { secret: SESSION_SECRET });

function getSessionToken(request: FastifyRequest): string | null {
  const raw = request.cookies['war_session'];
  if (!raw) return null;
  const result = request.unsignCookie(raw);
  return result.valid ? result.value : null;
}

async function getSession(request: FastifyRequest): Promise<string | null> {
  const token = getSessionToken(request);
  if (!token) return null;
  return getSessionNationId(token);
}

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', async () => {
  const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
  return { ok: true, tick: meta?.tick ?? null };
});

// ── Auth endpoints ────────────────────────────────────────────────────────────

// Legacy login endpoint — kept for compatibility with existing web UI.
// Now delegates to DB-backed loginUser. Sets token in signed cookie.
app.post('/api/login', async (request, reply) => {
  const body = request.body as { username?: string; password?: string };
  const result = await loginUser(body.username ?? '', body.password ?? '');
  if (!result.ok) return reply.code(401).send({ error: result.error });
  reply.setCookie('war_session', result.token, {
    signed: true, httpOnly: true, path: '/', sameSite: 'strict',
  });
  if (result.nationId) {
    await prisma.nation.update({
      where: { id: result.nationId },
      data: { lastActiveAt: new Date(), activityTier: 'active' } as any,
    });
  }
  return { ok: true, nationId: result.nationId };
});

app.post('/api/logout', async (request, reply) => {
  const token = getSessionToken(request);
  if (token) await logoutUser(token);
  reply.clearCookie('war_session', { path: '/' });
  return { ok: true };
});

// New auth endpoints — same semantics as /api/login but under /api/auth/* namespace.
app.post('/api/auth/register', async (request, reply) => {
  const body = request.body as { username?: string; password?: string };
  const { username, password } = body;
  if (!username || !password) return reply.code(400).send({ error: 'username and password required' });
  if (username.length < 3 || username.length > 32) return reply.code(400).send({ error: 'username must be 3–32 characters' });
  if (password.length < 4) return reply.code(400).send({ error: 'password must be at least 4 characters' });
  const result = await registerUser(username, password);
  if (!result.ok) return reply.code(409).send({ error: result.error });
  return { ok: true, userId: result.userId };
});

app.post('/api/auth/login', async (request, reply) => {
  const body = request.body as { username?: string; password?: string };
  const result = await loginUser(body.username ?? '', body.password ?? '');
  if (!result.ok) return reply.code(401).send({ error: result.error });
  reply.setCookie('war_session', result.token, {
    signed: true, httpOnly: true, path: '/', sameSite: 'strict',
  });
  if (result.nationId) {
    await prisma.nation.update({
      where: { id: result.nationId },
      data: { lastActiveAt: new Date(), activityTier: 'active' } as any,
    });
  }
  return { ok: true, nationId: result.nationId };
});

app.post('/api/auth/logout', async (request, reply) => {
  const token = getSessionToken(request);
  if (token) await logoutUser(token);
  reply.clearCookie('war_session', { path: '/' });
  return { ok: true };
});

app.get('/api/me', async (request, reply) => {
  const nationId = await getSession(request);
  if (!nationId) return reply.code(401).send({ error: 'Not logged in' });
  const [nation, devCount, fullCount] = await Promise.all([
    prisma.nation.findUnique({ where: { id: nationId } }),
    prisma.territoryState.count({ where: { ownerId: nationId, hasRoad: true, OR: [{ hasPort: true }, { hasMarket: true }], fortificationLevel: { gte: 1 } } }),
    prisma.territoryState.count({ where: { ownerId: nationId, hasRoad: true, OR: [{ hasPort: true }, { hasMarket: true }], fortificationLevel: 3 } }),
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
    const nationId = await getSession(request);
    if (!nationId) return reply.code(401).send({ error: 'Not logged in' });

    const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
    if (!meta) return reply.code(503).send({ error: 'World not initialized' });

    const prisma_any = prisma as any;
    const [nationRows, territoryRows, events, myQueued, armyRows, treatyRows, federationRows, prestigeHistoryRows, embassyRows] = await Promise.all([
      prisma.nation.findMany(),
      prisma.territoryState.findMany(),
      prisma.eventLog.findMany({ orderBy: { id: 'desc' }, take: 10 }),
      prisma.queuedAction.findMany({ where: { nationId } }),
      prisma.army.findMany(),
      prisma.treaty.findMany({
        where: { status: { in: ['active', 'degraded'] } },
        include: { parties: true, clauses: { select: { type: true, clauseStatus: true } } },
      }),
      prisma.federationMember.findMany({
        where: { federation: { status: 'active' } },
        include: { federation: { include: { members: { select: { nationId: true } } } } },
      }),
      // Last 20 ticks of history per nation for sparklines.
      prisma.prestigeHistory.findMany({
        where: { tick: { gte: meta.tick - 19 } },
        orderBy: { tick: 'asc' },
      }),
      // §1.6 Active embassies for visibility grants.
      prisma_any.embassy ? prisma_any.embassy.findMany({ where: { status: 'active' } }) : Promise.resolve([]),
    ]);

    // ── Build computeVisibility input ──────────────────────────────────────

    const visTerritories = territoryRows.map((t) => ({
      id: t.id,
      ownerId: t.ownerId,
      adjacentIds: defById.get(t.id)?.adjacentIds ?? [],
    }));

    const visArmies = armyRows.map((a) => ({ nationId: a.nationId, territoryId: a.territoryId }));

    // Deduplicate treaties by partner pair; collect outpost grants.
    const seenTreatyPairs = new Set<string>();
    const visTreaties: VisTreatyInput[] = [];
    for (const treaty of treatyRows) {
      const partyIds = treaty.parties.map((p) => p.nationId) as [string, string];
      if (!partyIds.includes(nationId)) continue;
      const partnerId = partyIds[0] === nationId ? partyIds[1] : partyIds[0];
      const pairKey = [nationId, partnerId].sort().join(':');
      const hasAccess = treaty.clauses.some(
        (c) => c.type === 'military_access' && c.clauseStatus === 'active',
      );
      // §1.11 Collect outpost/sentry grants from active outpost clauses.
      const outpostGrants: Array<{ targetTerritoryId: string; type: 'sentry' | 'outpost'; grantedToNationId: string }> = [];
      for (const clause of treaty.clauses) {
        if (clause.type !== 'outpost' || clause.clauseStatus !== 'active') continue;
        const op = clause.payload as { targetTerritoryId?: string; type?: string; grantedToNationId?: string };
        if (!op.targetTerritoryId || !op.grantedToNationId) continue;
        const outpostType = op.type === 'outpost' ? 'outpost' : 'sentry';
        outpostGrants.push({ targetTerritoryId: op.targetTerritoryId, type: outpostType, grantedToNationId: op.grantedToNationId });
      }
      if (!seenTreatyPairs.has(pairKey)) {
        seenTreatyPairs.add(pairKey);
        visTreaties.push({ partyIds, hasActiveMilitaryAccess: hasAccess, outpostGrants: outpostGrants.length > 0 ? outpostGrants : undefined });
      } else {
        const existing = visTreaties.find((v) => v.partyIds.includes(partnerId));
        if (existing) {
          if (hasAccess && !existing.hasActiveMilitaryAccess) {
            (existing as { hasActiveMilitaryAccess: boolean }).hasActiveMilitaryAccess = true;
          }
          // Merge outpost grants.
          if (outpostGrants.length > 0) {
            const merged = [...(existing.outpostGrants ?? []), ...outpostGrants];
            (existing as { outpostGrants?: typeof outpostGrants }).outpostGrants = merged;
          }
        }
      }
    }

    // Build federation inputs: each unique federation the requesting nation belongs to.
    const seenFedIds = new Set<number>();
    const visFederations: Array<{ memberNationIds: readonly string[] }> = [];
    for (const membership of federationRows) {
      if (membership.nationId !== nationId) continue;
      if (seenFedIds.has(membership.federationId)) continue;
      seenFedIds.add(membership.federationId);
      const memberIds = membership.federation.members.map((m) => m.nationId);
      visFederations.push({ memberNationIds: memberIds });
    }

    // §1.6 Embassy visibility grants.
    const visEmbassies: VisEmbassyInput[] = (embassyRows as any[]).map((e) => ({
      ownerNationId: e.ownerNationId,
      hostTerritoryId: e.hostTerritoryId,
    }));

    const visInput: ComputeVisibilityInput = {
      nationId,
      territories: visTerritories,
      armies: visArmies,
      treaties: visTreaties,
      federations: visFederations,
      embassies: visEmbassies,
    };

    const visMap = computeVisibility(visInput);

    // ── Build lightweight Territory objects for culture computation ────────

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
          hasMarket: row.hasMarket,
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

    // Compute nation cultures.
    const nationCultures: Record<string, ReturnType<typeof computeNationCulture>> = {};
    const capitalMap = Object.fromEntries(nationRows.map((n) => [n.id, n.capitalTerritoryId ?? null]));
    for (const n of nationRows) {
      nationCultures[n.id] = computeNationCulture(n.id, allTerritories, capitalMap[n.id]);
    }

    // Territory counts + developed/fortified counts per nation (needed for mandate budget + unrest).
    const territoryCounts: Record<string, number> = {};
    const recentAcquiredCounts: Record<string, number> = {};
    const developedCounts: Record<string, number> = {};
    const fullyFortCounts: Record<string, number> = {};
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
      if (row.hasRoad && (row.hasPort || row.hasMarket) && row.fortificationLevel >= 1) {
        developedCounts[row.ownerId] = (developedCounts[row.ownerId] ?? 0) + 1;
      }
      if (row.hasRoad && (row.hasPort || row.hasMarket) && row.fortificationLevel >= 3) {
        fullyFortCounts[row.ownerId] = (fullyFortCounts[row.ownerId] ?? 0) + 1;
      }
    }

    // Armies grouped by territory (for Clear territory responses).
    const armiesByTerritory: Record<string, Array<{ id: number; nationId: string; size: number; status: string }>> = {};
    for (const a of armyRows) {
      if (!armiesByTerritory[a.territoryId]) armiesByTerritory[a.territoryId] = [];
      armiesByTerritory[a.territoryId]!.push({ id: a.id, nationId: a.nationId, size: a.size, status: a.status });
    }

    // ── Build filtered territory responses by tier ─────────────────────────
    const territories: Record<string, object> = {};
    for (const t of territoryRows) {
      const def = defById.get(t.id);
      const tier = visMap.get(t.id) ?? VisibilityTier.TrueFog;

      // TrueFog: only geography (static def data — no political info).
      if (tier === VisibilityTier.TrueFog) {
        territories[t.id] = {
          id: t.id,
          visibilityTier: VisibilityTier.TrueFog,
          geography: def?.geography ?? null,
          name: def?.name ?? t.id,
        };
        continue;
      }

      // LightFog: owner identity only.
      if (tier === VisibilityTier.LightFog) {
        const ownerRow = t.ownerId ? nationRows.find((n) => n.id === t.ownerId) : null;
        territories[t.id] = {
          id: t.id,
          visibilityTier: VisibilityTier.LightFog,
          geography: def?.geography ?? null,
          name: def?.name ?? t.id,
          ownerId: t.ownerId,
          ownerName: ownerRow?.name ?? null,
          isCoastal: def?.isCoastal ?? false,
        };
        continue;
      }

      // Clear: full state.
      const entry: Record<string, unknown> = {
        id: t.id,
        visibilityTier: VisibilityTier.Clear,
        geography: def?.geography ?? null,
        name: def?.name ?? t.id,
        ownerId: t.ownerId,
        isCoastal: def?.isCoastal ?? false,
        hasRoad: t.hasRoad,
        hasPort: t.hasPort,
        hasMarket: t.hasMarket,
        isInRevolt: t.isInRevolt,
        fortificationLevel: t.fortificationLevel,
        unrest: t.unrest,
        constructionType: t.constructionType ?? null,
        constructionTicksLeft: t.constructionTicksLeft ?? null,
        pendingConstructionType: t.pendingConstructionType ?? null,
        armies: armiesByTerritory[t.id] ?? [],
      };

      // Own territory extras: local stockpiles (trade source selection).
      if (t.ownerId === nationId) {
        entry.localPopStock = t.localPopStock;
        entry.localIndStock = t.localIndStock;
        entry.localWltStock = t.localWltStock;
      }

      // Culture breakdown (Clear only — meaningful when territory has an owner).
      if (t.ownerId && nationCultures[t.ownerId] && def) {
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

      territories[t.id] = entry;
    }

    // Build prestige history lookup: nationId → sorted array of { tick, prestige }.
    const prestigeHistoryByNation: Record<string, Array<{ tick: number; prestige: number }>> = {};
    for (const row of prestigeHistoryRows) {
      if (!prestigeHistoryByNation[row.nationId]) prestigeHistoryByNation[row.nationId] = [];
      prestigeHistoryByNation[row.nationId]!.push({ tick: row.tick, prestige: row.prestige });
    }

    // All nations show name + culture + prestige + dominant status (public leaderboard).
    // Own nation also shows stockpiles + secondary stats.
    const nations: Record<string, object> = {};
    const myNationRow = nationRows.find((n) => n.id === nationId);
    for (const n of nationRows) {
      const history = prestigeHistoryByNation[n.id] ?? [];
      // Delta vs previous tick (one tick back from current).
      const prevEntry = history.length >= 2 ? history[history.length - 2] : null;
      const prestigeDelta = prevEntry != null ? n.prestige - prevEntry.prestige : 0;

      // Secondary stats.
      const completedTreatiesKept = (n as any).completedTreatiesKept ?? 0;
      const warsWon = (n as any).warsWon ?? 0;
      const isDominant = (n as any).isDominant ?? false;

      // Longest time at #1: count consecutive ticks from the end of history where this nation was top.
      // Simplified: count ticks in the last 7 where prestige was highest among all nations (server would need all histories).
      // For now we expose the raw history and let the client compute secondary stats from it.

      const entry: Record<string, unknown> = {
        id: n.id,
        name: n.name,
        culture: nationCultures[n.id],
        prestige: n.prestige,
        prestigeDelta,
        isDominant,
        prestigeHistory: history,
        completedTreatiesKept,
        warsWon,
      };
      if (n.id === nationId) {
        entry.stockpiles = { population: n.popStock, industry: n.indStock, wealth: n.wealthStock };
        entry.armySize = n.armySize;
        entry.debtBalance = (n as any).debtBalance ?? 0;
        entry.isInsolvent = n.wealthStock < 0 || ((n as any).debtBalance ?? 0) > 0;
      }
      nations[n.id] = entry;
    }

    // Expose active war IDs involving this nation for the War Council panel.
    const myActiveWarRows = await prisma.war.findMany({
      where: {
        status: { in: ['active', 'peace_negotiation'] },
        OR: [{ attackerId: nationId }, { defenderId: nationId }],
      },
      select: { id: true },
    });
    const myActiveWarIds = myActiveWarRows.map((w) => w.id);

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
      myActiveWarIds,
    };
  });

  // ── Queue action ───────────────────────────────────────────────────────────

  app.post('/api/action', async (request, reply) => {
    const nationId = await getSession(request);
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
      prisma.territoryState.count({ where: { ownerId: nationId, hasRoad: true, OR: [{ hasPort: true }, { hasMarket: true }], fortificationLevel: { gte: 1 } } }),
      prisma.territoryState.count({ where: { ownerId: nationId, hasRoad: true, OR: [{ hasPort: true }, { hasMarket: true }], fortificationLevel: 3 } }),
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
    let { cost, finalPayload } = result;
    // Insolvency mandate surcharge: +1 Mandate on actions costing 2+ while wealthStock < 0 or debtBalance > 0.
    // [PLACEHOLDER] revisit if this makes diplomacy during war too punishing.
    const isInsolvent = nation.wealthStock < 0 || (nation as any).debtBalance > 0;
    if (isInsolvent && cost >= 2) cost += 1;

    // §1.6 Embassy Mandate discount: −1 (min 1) on diplomatic actions toward nations
    // where there is an active embassy between the two parties. [PLACEHOLDER]
    if (cost >= 2) {
      const prisma_action_any = prisma as any;
      // Determine the target nation from the payload (treaty/instant-trade actions have targetId or targetNationId).
      const actionPayload = payload as Record<string, unknown>;
      const targetNationIdForDiscount: string | null =
        (actionPayload.targetNationId as string | null) ??
        (actionPayload.targetId as string | null) ??
        null;
      if (targetNationIdForDiscount && prisma_action_any.embassy) {
        const embassyExists = await prisma_action_any.embassy.findFirst({
          where: {
            status: 'active',
            OR: [
              { ownerNationId: nationId, hostTerritoryId: { in: await prisma.territoryState.findMany({ where: { ownerId: targetNationIdForDiscount }, select: { id: true } }).then((rows) => rows.map((r) => r.id)) } },
              { ownerNationId: targetNationIdForDiscount, hostTerritoryId: { in: await prisma.territoryState.findMany({ where: { ownerId: nationId }, select: { id: true } }).then((rows) => rows.map((r) => r.id)) } },
            ],
          },
        });
        if (embassyExists) cost = Math.max(1, cost - 1);
      }
    }

    if (nation.mandateUsed + cost > myBudget) {
      return reply.code(400).send({ error: isInsolvent && cost > result.cost ? 'Insufficient mandates (insolvency surcharge +1 Mandate applied)' : 'Insufficient mandates' });
    }

    await handler.queue(ctx, cost, finalPayload);
    // Stamp lastActiveAt on any queued action — resets inactivity clock.
    await prisma.nation.update({
      where: { id: nationId },
      data: { lastActiveAt: new Date(), activityTier: 'active' } as any,
    });
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
      prisma.councilQueuedAction.deleteMany(),
      prisma.warCouncil.deleteMany(),
      prisma.queuedAction.deleteMany(),
      prisma.eventLog.deleteMany(),
      prisma.instantTrade.deleteMany(),
      prisma.tradeRoute.deleteMany(),
      prisma.objectiveClause.deleteMany(),
      prisma.treatyClause.deleteMany(),
      prisma.treatyParty.deleteMany(),
      prisma.treatyHistory.deleteMany(),
      prisma.treaty.deleteMany(),
      prisma.proposalClause.deleteMany(),
      prisma.proposal.deleteMany(),
      prisma.war.deleteMany(),
      prisma.embassy.deleteMany(),
      prisma.army.deleteMany(),
      prisma.territoryModifier.deleteMany(),
      prisma.borderSkirmish.deleteMany(),
      prisma.territoryClaim.deleteMany(),
      prisma.federationMember.deleteMany(),
      prisma.federation.deleteMany(),
      prisma.prestigeHistory.deleteMany(),
      prisma.territoryState.deleteMany(),
      prisma.nation.deleteMany(),
      prisma.worldMeta.deleteMany(),
    ]);
    await ensureWorldInitialized(defs);
    return { ok: true, message: 'World reset to tick 0.' };
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
    // Delete leaf tables first, then parents, to satisfy FK constraints.
    await prisma.$transaction([
      prisma.councilQueuedAction.deleteMany(),
      prisma.warCouncil.deleteMany(),
      prisma.queuedAction.deleteMany(),
      prisma.eventLog.deleteMany(),
      prisma.instantTrade.deleteMany(),
      prisma.tradeRoute.deleteMany(),
      prisma.objectiveClause.deleteMany(),
      prisma.treatyClause.deleteMany(),
      prisma.treatyParty.deleteMany(),
      prisma.treatyHistory.deleteMany(),
      prisma.treaty.deleteMany(),
      prisma.proposalClause.deleteMany(),
      prisma.proposal.deleteMany(),
      prisma.war.deleteMany(),
      prisma.embassy.deleteMany(),
      prisma.army.deleteMany(),
      prisma.territoryModifier.deleteMany(),
      prisma.borderSkirmish.deleteMany(),
      prisma.territoryClaim.deleteMany(),
      prisma.federationMember.deleteMany(),
      prisma.federation.deleteMany(),
      prisma.prestigeHistory.deleteMany(),
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
          hasRoad: row.hasRoad, hasPort: row.hasPort, hasMarket: row.hasMarket, unrest: row.unrest,
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
      if (row.hasRoad && (row.hasPort || row.hasMarket) && row.fortificationLevel >= 1)
        adminDevCounts[row.ownerId] = (adminDevCounts[row.ownerId] ?? 0) + 1;
      if (row.hasRoad && (row.hasPort || row.hasMarket) && row.fortificationLevel >= 3)
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
        fortificationLevel: t.fortificationLevel, hasRoad: t.hasRoad, hasPort: t.hasPort, hasMarket: t.hasMarket,
        portLevel: (t as any).portLevel ?? 1,
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
        // Fragmentation risk — only non-null for territories of Abandoned nations.
        fragmentationRisk: (() => {
          if (!t.ownerId) return null;
          const ownerNation = nationRows.find((n) => n.id === t.ownerId);
          if (!ownerNation || (ownerNation as any).activityTier !== 'abandoned') return null;
          const aAt = (ownerNation as any).abandonedAt as Date | null;
          if (!aAt) return null;
          return fragmentationRisk(t.unrest, aAt);
        })(),
      };
    });
    const nations = nationRows.map((n) => ({
      id: n.id, name: n.name, isAI: n.isAI,
      stockpiles: { population: n.popStock, industry: n.indStock, wealth: n.wealthStock },
      armySize: n.armySize, mandateBudget: mandateBudget(adminDevCounts[n.id] ?? 0, adminFullCounts[n.id] ?? 0), mandateUsed: n.mandateUsed,
      capital: n.capitalTerritoryId, culture: nationCultures[n.id] ?? null,
      activityTier: (n as any).activityTier ?? 'active',
      lastActiveAt: (n as any).lastActiveAt ?? null,
      abandonedAt: (n as any).abandonedAt ?? null,
    }));
    // Expose army positions for admin panel.
    const armyRows = await prisma.army.findMany();
    const armiesByNation: Record<string, Array<{ id: number; territoryId: string; size: number; status: string }>> = {};
    for (const a of armyRows) {
      if (!armiesByNation[a.nationId]) armiesByNation[a.nationId] = [];
      armiesByNation[a.nationId]!.push({ id: a.id, territoryId: a.territoryId, size: a.size, status: a.status });
    }
    const nationsWithArmies = nations.map((n) => ({ ...n, armies: armiesByNation[n.id] ?? [] }));
    // Load active trade route agreements for admin panel.
    const routeRows = await (prisma as any).tradeRouteAgreement?.findMany?.({
      where: { status: { in: ['active', 'suspended'] } },
      include: { shipments: true },
    }) ?? [];
    const nationNameMapForRoutes = Object.fromEntries(nationRows.map((n) => [n.id, n.name]));
    const terrNameMap = Object.fromEntries(territoryRows.map((t) => [t.id, defById.get(t.id)?.name ?? t.id]));
    const tradeRouteAgreements = routeRows.map((r: any) => ({
      id: r.id,
      treatyClauseId: r.treatyClauseId ?? null,
      ownerNationId: r.ownerNationId,
      ownerNationName: nationNameMapForRoutes[r.ownerNationId] ?? r.ownerNationId,
      partnerNationId: r.partnerNationId ?? null,
      partnerNationName: r.partnerNationId ? (nationNameMapForRoutes[r.partnerNationId] ?? r.partnerNationId) : null,
      type: r.type,
      sourceTerritoryId: r.sourceTerritoryId,
      sourceTerritoryName: terrNameMap[r.sourceTerritoryId] ?? r.sourceTerritoryId,
      destinationTerritoryId: r.destinationTerritoryId,
      destinationTerritoryName: terrNameMap[r.destinationTerritoryId] ?? r.destinationTerritoryId,
      portLevel: r.portLevel,
      baseCapacity: r.baseCapacity,
      currentCapacity: r.currentCapacity,
      growthCap: r.growthCap,
      cyclesCompleted: r.cyclesCompleted,
      profitMultiplier: r.profitMultiplier,
      upkeepPerTick: r.currentCapacity * r.upkeepRate,
      status: r.status,
      startedAtTick: r.startedAtTick,
      shipments: (r.shipments ?? []).map((s: any) => ({
        id: s.id, routeId: s.routeId,
        transitTicksRemaining: s.transitTicksRemaining,
        cargoAmount: s.cargoAmount, cargoResource: s.cargoResource,
        departedAtTick: s.departedAtTick,
      })),
    }));
    return {
      tick: meta.tick, phase: currentPhase(), nations: nationsWithArmies, territories,
      recentEvents: events.map((e) => ({ tick: e.tick, message: e.message })),
      tradeRouteAgreements,
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

  app.post('/api/admin/territory/:id/toggle-market', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    const t = await prisma.territoryState.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: 'Territory not found' });
    await prisma.territoryState.update({ where: { id }, data: { hasMarket: !t.hasMarket } });
    return { ok: true, hasMarket: !t.hasMarket };
  });

  app.post('/api/admin/territory/:id/set-port-level', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    const { portLevel } = request.body as { portLevel?: number };
    if (typeof portLevel !== 'number' || portLevel < 0 || portLevel > 3) {
      return reply.code(400).send({ error: 'portLevel must be 0–3' });
    }
    const t = await prisma.territoryState.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: 'Territory not found' });
    await (prisma as any).territoryState.update({ where: { id }, data: { portLevel } });
    return { ok: true, portLevel };
  });

  // GET /api/admin/territory/:id/quality-tier
  // Returns the precomputed quality tier (1–3) from the territory def, plus supporting values.
  // Tier formula: score = pop×0.4 + ind×0.35 + wlt×0.25 + (isCoastal ? 1.5 : 0)
  //   tier 3 (high)   = score ≥ 8.0  [PLACEHOLDER threshold]
  //   tier 2 (medium) = score ≥ 5.0  [PLACEHOLDER threshold]
  //   tier 1 (low)    = score < 5.0
  app.get('/api/admin/territory/:id/quality-tier', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    const def = defById.get(id);
    if (!def) return reply.code(404).send({ error: `Territory not found: ${id}` });
    const pop = (def as any).basePopulation ?? 0;
    const ind = (def as any).baseIndustry ?? 0;
    const wlt = (def as any).baseWealth ?? 0;
    const coastal = def.isCoastal ? 1.5 : 0;
    const score = pop * 0.4 + ind * 0.35 + wlt * 0.25 + coastal;
    const tier = score >= 8.0 ? 3 : score >= 5.0 ? 2 : 1;
    return {
      territoryId: id,
      name: def.name,
      qualityTier: tier,
      score: Math.round(score * 100) / 100,
      components: {
        basePopulation: pop,
        baseIndustry: ind,
        baseWealth: wlt,
        isCoastal: def.isCoastal,
        coastalBonus: coastal,
      },
      thresholds: { tier3: 8.0, tier2: 5.0 },
    };
  });

  app.post('/api/admin/territory/:id/clear-construction', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    await prisma.territoryState.update({ where: { id }, data: { constructionType: null, constructionTicksLeft: null, pendingConstructionType: null } });
    return { ok: true };
  });

  /**
   * GET /api/admin/territory/:id/derived-traits
   * Returns what deriveTerritoryTraits would compute for this territory.
   * Useful during Phase 7 territory authoring — inspect derived values before
   * committing them to the seed file. Accepts optional ?geography= query param
   * to preview what a different geography type would produce without editing
   * the data file.
   */
  app.get('/api/admin/territory/:id/derived-traits', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    const { geography: geoOverride } = request.query as { geography?: string };

    const def = defById.get(id);
    if (!def) return reply.code(404).send({ error: `Territory not found: ${id}` });

    const validGeographies = ['coastal', 'inland', 'mountainous', 'desert', 'forest'] as const;
    type GeoType = typeof validGeographies[number];
    let effectiveGeography = def.geography as GeoType;
    if (geoOverride) {
      if (!validGeographies.includes(geoOverride as GeoType)) {
        return reply.code(400).send({ error: `geography must be one of: ${validGeographies.join(', ')}` });
      }
      effectiveGeography = geoOverride as GeoType;
    }

    const seed = deterministicSeed(def.id);
    const derived = deriveTerritoryTraits(def.culturalFamily, effectiveGeography, seed);

    // Apply traitOverrides from def if present.
    const finalTraits = {
      individualist: def.traitOverrides?.individualist ?? derived.traits.individualist,
      progressive:   def.traitOverrides?.progressive   ?? derived.traits.progressive,
      militaristic:  def.traitOverrides?.militaristic  ?? derived.traits.militaristic,
      expansionist:  def.traitOverrides?.expansionist  ?? derived.traits.expansionist,
    };

    return {
      territoryId: id,
      culturalFamily: def.culturalFamily,
      geography: effectiveGeography,
      geographyOverridden: !!geoOverride,
      traitOverridesInDef: def.traitOverrides ?? null,
      derived: {
        traits: derived.traits,
        startingPopulation: derived.startingPopulation,
        productionModifiers: derived.productionModifiers,
      },
      finalTraits,
      seed,
    };
  });

  /**
   * GET /api/admin/world-map
   * Returns all territories with their derived traits, starting population,
   * adjacency, and current ownership. Used to verify initialization correctness.
   */
  app.get('/api/admin/world-map', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const rows = await prisma.territoryState.findMany();
    const rowById = new Map(rows.map((r) => [r.id, r]));

    const territories = defs.map((def) => {
      const row = rowById.get(def.id);
      const seed = deterministicSeed(def.id);
      const derived = deriveTerritoryTraits(def.culturalFamily, def.geography, seed);
      const finalTraits = {
        individualist: def.traitOverrides?.individualist ?? derived.traits.individualist,
        progressive:   def.traitOverrides?.progressive   ?? derived.traits.progressive,
        militaristic:  def.traitOverrides?.militaristic  ?? derived.traits.militaristic,
        expansionist:  def.traitOverrides?.expansionist  ?? derived.traits.expansionist,
      };
      return {
        id: def.id,
        name: def.name,
        culturalFamily: def.culturalFamily,
        geography: def.geography,
        isCoastal: def.isCoastal,
        adjacentIds: def.adjacentIds,
        seaAdjacentIds: def.seaAdjacentIds,
        ownerId: row?.ownerId ?? null,
        derivedTraits: finalTraits,
        startingPopulation: derived.startingPopulation,
        productionModifiers: derived.productionModifiers,
        basePopulation: def.basePopulation,
        baseIndustry: def.baseIndustry,
        baseWealth: def.baseWealth,
      };
    });

    return { count: territories.length, territories };
  });

  // ── Dev endpoints (session-gated to player1 / nation_costa_rica) ───────────
  // [DEV-ONLY] Session-gated wrappers so the web UI can call admin functions
  // without the admin key ever reaching the browser.
  // [DEFERRED SECURITY] Remove or replace with real RBAC before production. §11.

  const DEV_NATION_ID = 'nation_costa_rica';
  const CULTURE_TRAITS = ['individualist', 'progressive', 'militaristic', 'expansionist'] as const;

  async function requireDev(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const nationId = await getSession(request);
    if (nationId !== DEV_NATION_ID) {
      void reply.code(403).send({ error: 'Dev endpoints require the player1 session' });
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
      prisma.warCouncil.deleteMany(),
      prisma.army.deleteMany(),
      prisma.territoryClaim.deleteMany(),
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

  // ── War Council API ────────────────────────────────────────────────────────

  // GET /api/war/:warId/council
  // Returns the requesting nation's side of the war council: members, their queued
  // military actions this tick, contested territory status, and joint_invasion objectives.
  // Strictly limited to the requesting nation's own side — never exposes enemy plans.
  app.get('/api/war/:warId/council', async (request, reply) => {
    const nationId = await getSession(request);
    if (!nationId) return reply.code(401).send({ error: 'Not logged in' });

    const { warId: warIdStr } = request.params as { warId: string };
    const warId = parseInt(warIdStr, 10);
    if (isNaN(warId)) return reply.code(400).send({ error: 'Invalid warId' });

    const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
    const currentTick = meta?.tick ?? 0;

    const war = await prisma.war.findUnique({ where: { id: warId } });
    if (!war) return reply.code(404).send({ error: 'War not found' });
    if (war.status === 'ended') return reply.code(400).send({ error: 'War has ended' });

    // Determine which side this nation is on.
    const isAttacker = war.attackerId === nationId;
    const isDefender = war.defenderId === nationId;
    // Also check if they are in a council for this war.
    const allCouncils = await prisma.warCouncil.findMany({ where: { warId } });
    const myCouncil = allCouncils.find((c) => {
      const members = (c.memberNationIds as string[]) ?? [];
      return members.includes(nationId);
    });

    if (!myCouncil && !isAttacker && !isDefender) {
      return reply.code(403).send({ error: 'You are not a party to this war' });
    }

    // Fall back to the appropriate council based on direct attacker/defender status
    // if council rows haven't been created yet (race condition: declaration same tick).
    const council = myCouncil ?? allCouncils.find((c) =>
      c.side === (isAttacker ? 'attacker' : 'defender'),
    );
    if (!council) {
      return reply.code(404).send({ error: 'Council not found — war may have just started' });
    }

    const memberNationIds = (council.memberNationIds as string[]) ?? [];

    // Load member nation names.
    const memberNations = await prisma.nation.findMany({
      where: { id: { in: memberNationIds } },
      select: { id: true, name: true },
    });

    // Load queued military actions for this tick from council mirrors.
    const councilActions = await prisma.councilQueuedAction.findMany({
      where: { councilId: council.id, tick: currentTick },
      orderBy: { id: 'asc' },
    });

    // Load armies for all council members (for "army present/moving toward" status).
    const memberArmies = await prisma.army.findMany({
      where: { nationId: { in: memberNationIds } },
    });

    // Build contested territory status: war's occupiedTerritories + besieging armies.
    const occupiedTerritories = (war.occupiedTerritories as Array<{
      territoryId: string;
      occupyingNationId: string;
      siegeProgress: number;
      siegeStartTick: number;
    }>) ?? [];

    // For each contested territory, list which council members have armies present or moving toward it.
    const contestedTerritoryIds = new Set(occupiedTerritories.map((o) => o.territoryId));
    // Also include any territory that a council member's army is besieging or moving to.
    for (const army of memberArmies) {
      if (army.status === 'besieging') contestedTerritoryIds.add(army.territoryId);
      if (army.status === 'moving' && army.destinationTerritoryId) {
        contestedTerritoryIds.add(army.destinationTerritoryId);
      }
    }

    const contestedTerritories = [...contestedTerritoryIds].map((terrId) => {
      const def = defById.get(terrId);
      const armiesPresent = memberArmies
        .filter((a) => a.territoryId === terrId || (a.status === 'moving' && a.destinationTerritoryId === terrId))
        .map((a) => ({ nationId: a.nationId, size: a.size, status: a.status }));

      const occ = occupiedTerritories.find((o) => o.territoryId === terrId);

      return {
        territoryId: terrId,
        name: def?.name ?? terrId,
        siegeProgress: occ?.siegeProgress ?? null,
        occupyingNationId: occ?.occupyingNationId ?? null,
        councilArmiesPresent: armiesPresent,
      };
    });

    // Load joint_invasion objective clauses for this council's side.
    // Find active treaties between council members and check for joint_invasion objectives.
    const activeTreaties = await prisma.treaty.findMany({
      where: {
        status: { in: ['active', 'degraded'] },
        parties: { some: { nationId: { in: memberNationIds } } },
      },
      include: {
        parties: true,
        clauses: { include: { objectiveClause: true } },
      },
    });

    const jointInvasionObjectives: Array<{
      treatyId: number;
      clauseIndex: number;
      targetTerritoryId: string | null;
      status: string;
      deadlineTicks: number;
      checklist: Array<{ nationId: string; name: string; hasQueuedAttack: boolean }>;
    }> = [];

    for (const treaty of activeTreaties) {
      for (const clause of treaty.clauses) {
        const obj = (clause as any).objectiveClause;
        if (!obj || obj.objectiveType !== 'joint_invasion') continue;
        if (obj.status !== 'pending') continue;

        // Check which council members have already queued an attack on the target this tick.
        const attacksOnTarget = councilActions.filter(
          (a) => a.actionType === 'attack_territory' && a.targetTerritoryId === obj.targetTerritoryId,
        );
        const attackingNationIds = new Set(attacksOnTarget.map((a) => a.nationId));

        // Checklist: all responsible parties (from the treaty parties on this council).
        const checklist = memberNations
          .filter((n) => {
            // Include if they are a party to the treaty.
            return treaty.parties.some((p) => p.nationId === n.id);
          })
          .map((n) => ({
            nationId: n.id,
            name: n.name,
            hasQueuedAttack: attackingNationIds.has(n.id),
          }));

        jointInvasionObjectives.push({
          treatyId: treaty.id,
          clauseIndex: clause.clauseIndex,
          targetTerritoryId: obj.targetTerritoryId ?? null,
          status: obj.status,
          deadlineTicks: obj.deadlineTicks,
          checklist,
        });
      }
    }

    // Build the members-with-actions response.
    const membersWithActions = memberNations.map((n) => {
      const actions = councilActions
        .filter((a) => a.nationId === n.id)
        .map((a) => ({ actionType: a.actionType, targetTerritoryId: a.targetTerritoryId }));
      const hasQueuedMilitary = actions.length > 0;
      return {
        nationId: n.id,
        name: n.name,
        isMe: n.id === nationId,
        hasQueuedMilitary,
        queuedActions: actions,
      };
    });

    return {
      warId,
      warStatus: war.status,
      councilSide: council.side,
      tick: currentTick,
      members: membersWithActions,
      contestedTerritories,
      jointInvasionObjectives,
    };
  });

  // ── Diplomacy API ──────────────────────────────────────────────────────────

  // GET /api/diplomacy — returns the calling nation's diplomacy state:
  // active treaties, incoming/outgoing proposals, their Trust, partner Trust values.
  app.get('/api/diplomacy', async (request, reply) => {
    const nationId = await getSession(request);
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

  // ── Treaty preview endpoint ───────────────────────────────────────────────

  /**
   * GET /api/treaty/preview
   * Accepts a proposed treaty structure (proposerId, targetId, clauses, termTicks)
   * and returns per-clause wealth values + diplomatic weights from both parties'
   * perspectives, plus minimum collateral floor.
   *
   * Does not write anything — pure read + pure function computation.
   *
   * Body (JSON):
   *   { proposerId: string, targetId: string, termTicks: number,
   *     clauses: Array<{ type: string, payload: object }> }
   */
  app.post('/api/treaty/preview', async (request, reply) => {
    const nationId = await getSession(request);
    if (!nationId) return reply.code(401).send({ error: 'Not logged in' });

    const body = request.body as {
      proposerId?: string;
      targetId?: string;
      termTicks?: number;
      clauses?: Array<{ type?: string; payload?: Record<string, unknown> }>;
    };

    const { proposerId, targetId, termTicks, clauses } = body;
    if (!proposerId || !targetId) return reply.code(400).send({ error: 'proposerId and targetId required' });
    if (!Array.isArray(clauses)) return reply.code(400).send({ error: 'clauses must be an array' });

    // Requesting nation must be one of the parties.
    if (nationId !== proposerId && nationId !== targetId) {
      return reply.code(403).send({ error: 'You must be a party to the proposed treaty' });
    }

    const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
    if (!meta) return reply.code(503).send({ error: 'World not initialized' });

    // Build a minimal WorldState snapshot (just what diplomaticValue.ts needs).
    const [nationRows, territoryRows, armyRows, skirmishRows] = await Promise.all([
      prisma.nation.findMany(),
      prisma.territoryState.findMany(),
      prisma.army.findMany(),
      (prisma as any).borderSkirmish?.findMany?.({ where: { status: 'resolved' } }) ?? Promise.resolve([]),
    ]);

    const allTerritories: Record<string, { def: import('@war/engine').TerritoryDef; state: import('@war/engine').TerritoryState }> = {};
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
          constructionType: (row.constructionType ?? null) as import('@war/engine').TerritoryState['constructionType'],
          constructionTicksLeft: row.constructionTicksLeft ?? null,
          pendingConstructionType: (row.pendingConstructionType ?? null) as import('@war/engine').TerritoryState['pendingConstructionType'],
          ownershipShock: row.ownershipShock,
          acquiredTick: row.acquiredTick ?? null,
          localPopStock: row.localPopStock,
          localIndStock: row.localIndStock,
          localWltStock: row.localWltStock,
          hasEmbassy: (row as any).hasEmbassy ?? false,
          populationTransferShockTicksLeft: (row as any).populationTransferShockTicksLeft ?? 0,
        },
      };
    }

    const nations: Record<string, import('@war/engine').NationState> = {};
    for (const n of nationRows) {
      nations[n.id] = {
        name: n.name,
        popStock: n.popStock,
        indStock: n.indStock,
        wealthStock: n.wealthStock,
        armySize: n.armySize,
        mandateUsed: n.mandateUsed,
        trust: n.trust,
        prestige: n.prestige,
        debtBalance: (n as any).debtBalance ?? 0,
        isAI: n.isAI,
        capitalTerritoryId: n.capitalTerritoryId ?? null,
      };
    }

    const armies: import('@war/engine').Army[] = armyRows.map((a) => ({
      id: a.id,
      nationId: a.nationId,
      territoryId: a.territoryId,
      size: a.size,
      status: a.status as import('@war/engine').Army['status'],
      destinationTerritoryId: a.destinationTerritoryId ?? null,
      transitPath: (a as any).transitPath ?? [],
      transitTicksRemaining: (a as any).transitTicksRemaining ?? 0,
    }));

    const previewWorld: import('@war/engine').WorldState = {
      tick: meta.tick,
      territories: allTerritories,
      nations,
      armies,
      wars: [],
      treaties: [],
      tradeRoutes: [],
      territoryModifiers: [],
      borderSkirmishes: Array.isArray(skirmishRows) ? skirmishRows.map((s: any) => ({
        id: s.id,
        nationAId: s.nationAId,
        nationBId: s.nationBId,
        territoryId: s.territoryId,
        tick: s.tick,
        status: s.status,
      })) : [],
    };

    const normalizedClauses = clauses.map((c) => ({
      type: (c.type ?? 'non_aggression') as import('@war/engine').ClauseType,
      payload: c.payload ?? {},
    }));

    const clausePreviews = normalizedClauses.map((clause, idx) => ({
      clauseIndex: idx,
      type: clause.type,
      payload: clause.payload,
      proposerPerspective: {
        wealthValue: computeClauseWealthValue(clause, previewWorld, proposerId),
        diplomaticWeight: computeClauseDiplomaticWeight(clause, previewWorld, proposerId),
      },
      targetPerspective: {
        wealthValue: computeClauseWealthValue(clause, previewWorld, targetId),
        diplomaticWeight: computeClauseDiplomaticWeight(clause, previewWorld, targetId),
      },
    }));

    const collateral = computeMinCollateral(normalizedClauses, previewWorld, proposerId, targetId);
    const trustMultiplier = maintainPeaceTrustMultiplier(proposerId, targetId, previewWorld);
    const hasMaintainPeace = normalizedClauses.some((c) => c.type === 'maintain_peace' as string);

    return {
      proposerId,
      targetId,
      termTicks: termTicks ?? null,
      clauses: clausePreviews,
      collateral,
      ...(hasMaintainPeace ? { maintainPeaceTrustMultiplier: trustMultiplier } : {}),
    };
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

  // set-tier moved to §Activity tier admin endpoints below (consolidated with activityTier support).

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

  // POST /api/admin/declare-war — force a war between two nations for testing.
  // curl -X POST http://localhost:3001/api/admin/declare-war \
  //   -H "X-Admin-Key: dev-only-insecure-key" \
  //   -H "Content-Type: application/json" \
  //   -d '{"attackerId":"nation_costa_rica","defenderId":"nation_guatemala","casusBelli":true}'
  app.post('/api/admin/declare-war', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { attackerId, defenderId, casusBelli } = request.body as {
      attackerId?: string; defenderId?: string; casusBelli?: boolean;
    };
    if (!attackerId || !defenderId) return reply.code(400).send({ error: 'attackerId and defenderId required' });
    if (attackerId === defenderId) return reply.code(400).send({ error: 'Cannot war with yourself' });

    const [attacker, defender] = await Promise.all([
      prisma.nation.findUnique({ where: { id: attackerId } }),
      prisma.nation.findUnique({ where: { id: defenderId } }),
    ]);
    if (!attacker) return reply.code(404).send({ error: `Nation not found: ${attackerId}` });
    if (!defender) return reply.code(404).send({ error: `Nation not found: ${defenderId}` });

    const existing = await prisma.war.findFirst({
      where: {
        status: { in: ['active', 'peace_negotiation'] },
        OR: [
          { attackerId, defenderId },
          { attackerId: defenderId, defenderId: attackerId },
        ],
      },
    });
    if (existing) return reply.code(400).send({ error: 'Active war already exists between these nations' });

    const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
    const tick = meta?.tick ?? 0;
    const hasCB = casusBelli !== false;

    const war = await prisma.war.create({
      data: {
        attackerId,
        defenderId,
        type: 'conquest',
        hasCasusBelli: hasCB,
        status: 'active',
        startTick: tick,
        declaredTick: tick,
        occupiedTerritories: [],
        pendingPeaceDeal: null,
      },
    });
    await prisma.eventLog.create({
      data: {
        tick,
        message: `[admin] ${attacker.name} declared war on ${defender.name}${hasCB ? '' : ' without justification'}.`,
      },
    });
    return { ok: true, warId: war.id };
  });

  // POST /api/admin/end-war — force-end a war, no peace deal.
  // curl -X POST http://localhost:3001/api/admin/end-war \
  //   -H "X-Admin-Key: dev-only-insecure-key" \
  //   -H "Content-Type: application/json" \
  //   -d '{"warId":1}'
  app.post('/api/admin/end-war', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { warId } = request.body as { warId?: number };
    if (typeof warId !== 'number') return reply.code(400).send({ error: 'warId required' });
    const war = await prisma.war.findUnique({ where: { id: warId } });
    if (!war) return reply.code(404).send({ error: 'War not found' });
    const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
    await prisma.war.update({
      where: { id: warId },
      data: { status: 'ended', endTick: meta?.tick ?? 0, occupiedTerritories: [] },
    });
    await prisma.eventLog.create({
      data: { tick: meta?.tick ?? 0, message: `[admin] War #${warId} force-ended.` },
    });
    return { ok: true };
  });

  // POST /api/admin/force-peace — force-accept a peace deal with specified terms for testing.
  // Immediately ends the war, applies cessions, and creates tribute treaty if specified.
  // curl -X POST http://localhost:3001/api/admin/force-peace \
  //   -H "X-Admin-Key: dev-only-insecure-key" \
  //   -H "Content-Type: application/json" \
  //   -d '{"warId":1,"terms":{"warType":"negotiated","territoryCessions":[{"territoryId":"guatemala","fromNationId":"nation_guatemala","toNationId":"nation_costa_rica"}],"tributeWealth":0,"tributeTicks":0}}'
  app.post('/api/admin/force-peace', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { warId, terms } = request.body as {
      warId?: number;
      terms?: {
        warType?: string;
        territoryCessions?: Array<{ territoryId: string; fromNationId: string; toNationId: string }>;
        tributeWealth?: number;
        tributeTicks?: number;
      };
    };
    if (typeof warId !== 'number') return reply.code(400).send({ error: 'warId required' });
    if (!terms) return reply.code(400).send({ error: 'terms required' });

    const war = await prisma.war.findUnique({ where: { id: warId } });
    if (!war) return reply.code(404).send({ error: 'War not found' });
    if (war.status === 'ended') return reply.code(400).send({ error: 'War already ended' });

    // Validate raid wars: no territory cessions.
    const cessions = terms.territoryCessions ?? [];
    if (war.type === 'raid' && cessions.length > 0) {
      return reply.code(400).send({ error: 'Raid wars may not include territory cessions' });
    }

    const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
    const currentTick = meta?.tick ?? 0;

    await prisma.$transaction(async (tx) => {
      // Apply territory cessions.
      for (const c of cessions) {
        await tx.territoryState.update({
          where: { id: c.territoryId },
          data: {
            ownerId: c.toNationId,
            ownershipShock: 0.50, // [PLACEHOLDER]
            acquiredTick: currentTick,
          },
        });
        const [fromN, toN] = await Promise.all([
          tx.nation.findUnique({ where: { id: c.fromNationId }, select: { name: true } }),
          tx.nation.findUnique({ where: { id: c.toNationId }, select: { name: true } }),
        ]);
        await tx.eventLog.create({
          data: {
            tick: currentTick,
            message: `[admin] ${toN?.name ?? c.toNationId} received ${c.territoryId} from ${fromN?.name ?? c.fromNationId} via force-peace.`,
          },
        });
      }

      // Return all occupied territories not in cession list.
      const cedingIds = new Set(cessions.map((c) => c.territoryId));
      const occupied = (war.occupiedTerritories as Array<{ territoryId: string; occupyingNationId: string }>) ?? [];
      for (const occ of occupied) {
        if (cedingIds.has(occ.territoryId)) continue;
        const returnToId = occ.occupyingNationId === war.attackerId ? war.defenderId : war.attackerId;
        await tx.territoryState.update({
          where: { id: occ.territoryId },
          data: { ownerId: returnToId },
        });
      }

      // Tribute treaty if specified.
      const tributeWealth = terms.tributeWealth ?? 0;
      const tributeTicks = terms.tributeTicks ?? 0;
      if (tributeWealth > 0 && tributeTicks > 0) {
        const proposal = await tx.proposal.create({
          data: {
            proposerId: war.attackerId,
            targetId: war.defenderId,
            status: 'accepted',
            termTicks: tributeTicks,
            proposerCollateral: 0,
            targetCollateral: 0,
            tickProposed: currentTick,
            expiresAtTick: currentTick,
          },
        });
        await tx.proposalClause.create({
          data: {
            proposalId: proposal.id,
            type: 'tribute',
            collateral: 0,
            payload: { amount: tributeWealth, fromNationId: war.attackerId, toNationId: war.defenderId } as Prisma.InputJsonValue,
          },
        });
        const treaty = await tx.treaty.create({
          data: {
            proposalId: proposal.id,
            status: 'active',
            termTicks: tributeTicks,
            tickStarted: currentTick,
            tickEnds: currentTick + tributeTicks,
            totalCollateral: 0,
          },
        });
        for (const nationId of [war.attackerId, war.defenderId]) {
          await tx.treatyParty.create({ data: { treatyId: treaty.id, nationId, collateralDeposited: 0 } });
        }
        await tx.treatyClause.create({
          data: {
            treatyId: treaty.id,
            clauseIndex: 0,
            type: 'tribute',
            collateral: 0,
            payload: { amount: tributeWealth, fromNationId: war.attackerId, toNationId: war.defenderId } as Prisma.InputJsonValue,
            clauseStatus: 'active',
          },
        });
      }

      // Trust bonus for peaceful end.
      for (const nationId of [war.attackerId, war.defenderId]) {
        await tx.nation.update({
          where: { id: nationId },
          data: { trust: { increment: 5 } }, // PEACE_TRUST_BONUS [PLACEHOLDER]
        });
      }

      // End the war.
      await tx.war.update({
        where: { id: warId },
        data: { status: 'ended', endTick: currentTick, occupiedTerritories: [], pendingPeaceDeal: Prisma.JsonNull },
      });

      const [attackerN, defenderN] = await Promise.all([
        tx.nation.findUnique({ where: { id: war.attackerId }, select: { name: true } }),
        tx.nation.findUnique({ where: { id: war.defenderId }, select: { name: true } }),
      ]);
      await tx.eventLog.create({
        data: {
          tick: currentTick,
          message: `[admin] Force-peace: ${attackerN?.name ?? war.attackerId} and ${defenderN?.name ?? war.defenderId} signed peace (${terms.warType ?? 'negotiated'}).`,
        },
      });
    });

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

  // ── Activity tier admin endpoints ─────────────────────────────────────────

  // POST /api/admin/nation/:id/set-tier — force-set the activity tier for testing.
  // Useful for testing tier transitions without waiting real wall-clock days.
  app.post('/api/admin/nation/:id/set-tier', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    const { tier } = request.body as { tier?: string };
    const validTiers = ['active', 'dormant', 'autopilot', 'abandoned', 'dissolved'];
    if (!tier || !validTiers.includes(tier)) {
      return reply.code(400).send({ error: `tier must be one of: ${validTiers.join(', ')}` });
    }
    const nation = await prisma.nation.findUnique({ where: { id } });
    if (!nation) return reply.code(404).send({ error: 'Nation not found' });

    const updateData: Record<string, unknown> = { activityTier: tier, inactivityTier: tier };
    if (tier === 'active') updateData['lastActiveAt'] = new Date();
    if (tier === 'abandoned' && !(nation as any).abandonedAt) updateData['abandonedAt'] = new Date();

    await prisma.nation.update({ where: { id }, data: updateData as any });
    const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
    const currentTick = meta?.tick ?? 0;

    // Dormant: trigger treaty degradation.
    if (tier === 'dormant') {
      const activeTreaties = await prisma.treaty.findMany({
        where: { status: 'active', parties: { some: { nationId: id } } },
        include: { parties: true },
      });
      for (const treaty of activeTreaties) {
        const inactiveParty = treaty.parties.find((p) => p.nationId === id)!;
        const activeParty   = treaty.parties.find((p) => p.nationId !== id)!;
        await prisma.treatyParty.update({ where: { id: inactiveParty.id }, data: { escrowAmount: inactiveParty.collateralDeposited, escrowStartTick: currentTick, collateralDeposited: 0 } });
        await prisma.treatyParty.update({ where: { id: activeParty.id }, data: { refundRemaining: activeParty.collateralDeposited, refundStartTick: currentTick } });
        await prisma.treaty.update({ where: { id: treaty.id }, data: { status: 'degraded' } });
        await prisma.eventLog.create({ data: { tick: currentTick, message: `${nation.name} went Dormant. Treaty #${treaty.id} degraded.` } });
      }
    }
    // Active: upgrade degraded treaties, apply escrow skim.
    if (tier === 'active') {
      const { ESCROW_SKIM_RATE } = await import('@war/engine');
      const degradedTreaties = await prisma.treaty.findMany({ where: { status: 'degraded', parties: { some: { nationId: id } } }, include: { parties: true } });
      for (const treaty of degradedTreaties) {
        const returningParty = treaty.parties.find((p) => p.nationId === id)!;
        const escrow = returningParty.escrowAmount;
        const refund = escrow - escrow * ESCROW_SKIM_RATE;
        if (refund > 0) await prisma.nation.update({ where: { id }, data: { wealthStock: { increment: refund } } });
        await prisma.treatyParty.update({ where: { id: returningParty.id }, data: { escrowAmount: 0, escrowStartTick: null, collateralDeposited: refund } });
        await prisma.treaty.update({ where: { id: treaty.id }, data: { status: 'active' } });
        await prisma.eventLog.create({ data: { tick: currentTick, message: `${nation.name} returned from Dormant. Treaty #${treaty.id} upgraded.` } });
      }
    }

    await prisma.eventLog.create({
      data: { tick: currentTick, message: `[admin] ${nation.name} activity tier force-set to ${tier}.` },
    });
    return { ok: true, nationId: id, tier };
  });

  // POST /api/admin/nation/:id/convert-to-ai — convert an Abandoned nation to a full AI nation.
  // The nation enters the full AI behavior system and is no longer recoverable by the original player.
  app.post('/api/admin/nation/:id/convert-to-ai', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { id } = request.params as { id: string };
    const nation = await prisma.nation.findUnique({ where: { id } });
    if (!nation) return reply.code(404).send({ error: 'Nation not found' });
    if ((nation as any).activityTier !== 'abandoned') {
      return reply.code(400).send({ error: 'Only Abandoned nations can be converted to AI' });
    }
    await prisma.nation.update({
      where: { id },
      data: {
        isAI: true,
        activityTier: 'active',
        abandonedAt: null,
        lastActiveAt: null,
      } as any,
    });
    const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
    await prisma.eventLog.create({
      data: { tick: meta?.tick ?? 0, message: `The ${nation.name} empire has fallen under AI control.` },
    });
    return { ok: true, nationId: id };
  });

  // ── Federation admin endpoint ──────────────────────────────────────────────

  // POST /api/admin/create-federation — create a federation for testing visibility grants.
  // Body: { name: string, memberNationIds: string[] }
  // Creates a Federation row + one FederationMember row per nation.
  app.post('/api/admin/create-federation', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { name, memberNationIds } = request.body as { name?: string; memberNationIds?: string[] };
    if (!name) return reply.code(400).send({ error: 'name required' });
    if (!Array.isArray(memberNationIds) || memberNationIds.length < 2) {
      return reply.code(400).send({ error: 'memberNationIds must be an array of at least 2 nation IDs' });
    }
    const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
    const currentTick = meta?.tick ?? 0;

    const federation = await prisma.federation.create({
      data: {
        name,
        foundedAtTick: currentTick,
        status: 'active',
        members: {
          create: memberNationIds.map((nId, idx) => ({
            nationId: nId,
            joinedAtTick: currentTick,
            role: idx === 0 ? 'founder' : 'member',
          })),
        },
      },
    });
    await prisma.eventLog.create({
      data: { tick: currentTick, message: `[admin] Federation "${name}" created with members: ${memberNationIds.join(', ')}.` },
    });
    return { ok: true, federationId: federation.id };
  });

  // ── Army admin endpoint ────────────────────────────────────────────────────

  // POST /api/admin/nation/:nationId/set-army — create or replace the nation's first army for testing.
  app.post('/api/admin/nation/:nationId/set-army', async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;
    const { nationId } = request.params as { nationId: string };
    const { territoryId, size } = request.body as { territoryId?: string; size?: number };
    if (!territoryId) return reply.code(400).send({ error: 'territoryId required' });
    if (typeof size !== 'number' || size < 0) return reply.code(400).send({ error: 'size must be >= 0' });

    const nation = await prisma.nation.findUnique({ where: { id: nationId } });
    if (!nation) return reply.code(404).send({ error: 'Nation not found' });

    // Delete existing armies for this nation, then create one.
    await prisma.army.deleteMany({ where: { nationId } });
    if (size > 0) {
      await prisma.army.create({
        data: { nationId, territoryId, size, status: 'stationed' },
      });
    }
    const meta = await prisma.worldMeta.findUnique({ where: { id: 1 } });
    await prisma.eventLog.create({
      data: {
        tick: meta?.tick ?? 0,
        message: `[admin] ${nation.name} army set to size=${size} at ${territoryId}.`,
      },
    });
    return { ok: true };
  });

  // ── Lobby: game lifecycle (v0.36) ─────────────────────────────────────────

  // Helper: look up the userId for the current session token.
  async function getSessionUserId(request: FastifyRequest): Promise<number | null> {
    const token = getSessionToken(request);
    if (!token) return null;
    const session = await prisma.userSession.findFirst({
      where: { token, expiresAt: { gt: new Date() } },
      select: { userId: true },
    });
    return session?.userId ?? null;
  }

  // POST /api/games — create a new game lobby.
  // Body: { name, maxPlayers?, tickIntervalSeconds? }
  app.post('/api/games', async (request, reply) => {
    const userId = await getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'Not logged in' });

    const body = request.body as { name?: string; maxPlayers?: number; tickIntervalSeconds?: number };
    if (!body.name) return reply.code(400).send({ error: 'name required' });

    const maxPlayers = Math.min(Math.max(body.maxPlayers ?? 5, 2), 10);
    const tickIntervalSeconds = Math.max(body.tickIntervalSeconds ?? 86400, 10); // min 10s for testing

    const gameId = `game_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const [game] = await prisma.$transaction([
      prisma.game.create({
        data: { id: gameId, name: body.name, hostUserId: userId, maxPlayers, tickIntervalSeconds, status: 'lobby' },
      }),
      prisma.gameMembership.create({
        data: { gameId, userId, slotIndex: 0 },
      }),
    ]);

    return { ok: true, gameId: game.id, name: game.name };
  });

  // GET /api/games — list lobby-status games with membership counts.
  app.get('/api/games', async () => {
    const games = await prisma.game.findMany({
      where: { status: 'lobby' },
      include: { _count: { select: { memberships: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return games.map((g) => ({
      id: g.id,
      name: g.name,
      maxPlayers: g.maxPlayers,
      memberCount: g._count.memberships,
      tickIntervalSeconds: g.tickIntervalSeconds,
      createdAt: g.createdAt,
      isHosted: true,
    }));
  });

  // POST /api/games/:id/join — join an open lobby slot.
  app.post('/api/games/:id/join', async (request, reply) => {
    const userId = await getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'Not logged in' });

    const { id: gameId } = request.params as { id: string };
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: { memberships: true },
    });
    if (!game) return reply.code(404).send({ error: 'Game not found' });
    if (game.status !== 'lobby') return reply.code(409).send({ error: 'Game is no longer in lobby' });

    const alreadyIn = game.memberships.find((m) => m.userId === userId);
    if (alreadyIn) return reply.code(409).send({ error: 'Already a member of this game' });

    if (game.memberships.length >= game.maxPlayers) {
      return reply.code(409).send({ error: 'Game is full' });
    }

    const usedSlots = new Set(game.memberships.map((m) => m.slotIndex));
    let slotIndex = 0;
    while (usedSlots.has(slotIndex)) slotIndex++;

    await prisma.gameMembership.create({ data: { gameId, userId, slotIndex } });
    return { ok: true, slotIndex };
  });

  // POST /api/games/:id/leave — leave a lobby (not allowed after active).
  app.post('/api/games/:id/leave', async (request, reply) => {
    const userId = await getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'Not logged in' });

    const { id: gameId } = request.params as { id: string };
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) return reply.code(404).send({ error: 'Game not found' });
    if (game.status !== 'lobby') return reply.code(409).send({ error: 'Cannot leave an active game' });

    await prisma.gameMembership.deleteMany({ where: { gameId, userId } });
    return { ok: true };
  });

  // POST /api/games/:id/start — host-only.
  // v0.37: transitions lobby → territory_selection. Does NOT init world or arm scheduler yet.
  // Body: { emptySlotPolicy: 'open' | 'removed' | 'ai', slotResolutions?: Record<number, 'ai' | 'removed'> }
  app.post('/api/games/:id/start', async (request, reply) => {
    const userId = await getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'Not logged in' });

    const { id: gameId } = request.params as { id: string };
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: { memberships: true },
    });
    if (!game) return reply.code(404).send({ error: 'Game not found' });
    if (game.hostUserId !== userId) return reply.code(403).send({ error: 'Only the host can start the game' });
    if (game.status !== 'lobby') return reply.code(409).send({ error: 'Game already started' });

    const body = request.body as {
      emptySlotPolicy?: 'open' | 'removed' | 'ai';
      slotResolutions?: Record<number, 'ai' | 'removed'>;
    };
    const policy = body.emptySlotPolicy ?? 'ai';
    const perSlot = body.slotResolutions ?? {};

    // Resolve empty slots.
    const filledSlots = new Set(game.memberships.map((m) => m.slotIndex));
    const aiSlots: number[] = [];
    const removedSlots: number[] = [];

    for (let i = 0; i < game.maxPlayers; i++) {
      if (filledSlots.has(i)) continue;
      const resolution = perSlot[i] ?? policy;
      if (resolution === 'ai') aiSlots.push(i);
      else removedSlots.push(i);
    }

    const now = new Date();
    await prisma.game.update({
      where: { id: gameId },
      data: {
        status: 'territory_selection',
        aiSlots,
        removedSlots,
        territorySelectionStartedAt: now,
        lastTickAt: now, // AFK deadline = lastTickAt + tickIntervalSeconds
      },
    });

    // Schedule the AFK deadline (fires autoAssignUnconfirmed instead of a tick).
    scheduleSelectionDeadline(gameId, defs, game.tickIntervalSeconds * 1000);

    return { ok: true, gameId, aiSlots, removedSlots, phase: 'territory_selection' };
  });

  // POST /api/games/:id/end — host-only manual game end.
  app.post('/api/games/:id/end', async (request, reply) => {
    const userId = await getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'Not logged in' });

    const { id: gameId } = request.params as { id: string };
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) return reply.code(404).send({ error: 'Game not found' });
    if (game.hostUserId !== userId) return reply.code(403).send({ error: 'Only the host can end the game' });
    if (game.status === 'ended') return reply.code(409).send({ error: 'Game already ended' });

    await prisma.game.update({
      where: { id: gameId },
      data: { status: 'ended', endedAt: new Date(), endReason: 'host_ended' },
    });

    deregisterGame(gameId);
    return { ok: true };
  });

  // ── Territory selection endpoints (v0.37) ─────────────────────────────────

  // POST /api/games/:id/territory/roll — roll 3 candidates for the calling player.
  app.post('/api/games/:id/territory/roll', async (request, reply) => {
    const userId = await getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'Not logged in' });

    const { id: gameId } = request.params as { id: string };
    const game = await prisma.game.findUnique({ where: { id: gameId }, include: { memberships: true } });
    if (!game) return reply.code(404).send({ error: 'Game not found' });
    if (game.status !== 'territory_selection') return reply.code(409).send({ error: 'Game not in territory_selection phase' });

    const membership = game.memberships.find((m) => m.userId === userId);
    if (!membership) return reply.code(403).send({ error: 'Not a member of this game' });

    // Reject if already confirmed.
    if (membership.confirmedTerritoryId) return reply.code(409).send({ error: 'Already confirmed a territory' });

    const candidates = await rollCandidates(gameId, userId, defs);
    return { ok: true, candidates };
  });

  // GET /api/games/:id/territory/candidates — get current candidates for the calling player.
  app.get('/api/games/:id/territory/candidates', async (request, reply) => {
    const userId = await getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'Not logged in' });

    const { id: gameId } = request.params as { id: string };
    const game = await prisma.game.findUnique({ where: { id: gameId }, include: { memberships: true } });
    if (!game) return reply.code(404).send({ error: 'Game not found' });
    if (game.status !== 'territory_selection') return reply.code(409).send({ error: 'Game not in territory_selection phase' });

    const membership = game.memberships.find((m) => m.userId === userId);
    if (!membership) return reply.code(403).send({ error: 'Not a member of this game' });

    const candidates = await getCandidateViews(gameId, userId, defs);
    const aiSlots = new Set<number>((game.aiSlots as number[]) ?? []);
    const humanMembers = game.memberships.filter((m) => !aiSlots.has(m.slotIndex));

    return {
      candidates,
      confirmedTerritoryId: membership.confirmedTerritoryId ?? null,
      rerollUsed: membership.rerollUsed,
      allConfirmed: humanMembers.every((m) => m.confirmedTerritoryId != null),
      confirmedCount: humanMembers.filter((m) => m.confirmedTerritoryId != null).length,
      totalHuman: humanMembers.length,
    };
  });

  // POST /api/games/:id/territory/reroll — use the one-time reroll.
  // Body: { slotIndex: number } — which candidate to replace.
  app.post('/api/games/:id/territory/reroll', async (request, reply) => {
    const userId = await getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'Not logged in' });

    const { id: gameId } = request.params as { id: string };
    const game = await prisma.game.findUnique({ where: { id: gameId }, include: { memberships: true } });
    if (!game) return reply.code(404).send({ error: 'Game not found' });
    if (game.status !== 'territory_selection') return reply.code(409).send({ error: 'Game not in territory_selection phase' });

    const membership = game.memberships.find((m) => m.userId === userId);
    if (!membership) return reply.code(403).send({ error: 'Not a member of this game' });
    if (membership.confirmedTerritoryId) return reply.code(409).send({ error: 'Already confirmed a territory' });
    if (membership.rerollUsed) return reply.code(409).send({ error: 'Reroll already used' });

    // Mark reroll used.
    await prisma.gameMembership.updateMany({ where: { gameId, userId }, data: { rerollUsed: true } });

    // Full re-roll of all 3 candidates.
    const candidates = await rollCandidates(gameId, userId, defs);
    return { ok: true, candidates };
  });

  // POST /api/games/:id/territory/confirm — lock in a candidate.
  // Body: { slotIndex: number }
  app.post('/api/games/:id/territory/confirm', async (request, reply) => {
    const userId = await getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'Not logged in' });

    const { id: gameId } = request.params as { id: string };
    const game = await prisma.game.findUnique({ where: { id: gameId }, include: { memberships: true } });
    if (!game) return reply.code(404).send({ error: 'Game not found' });
    if (game.status !== 'territory_selection') return reply.code(409).send({ error: 'Game not in territory_selection phase' });

    const membership = game.memberships.find((m) => m.userId === userId);
    if (!membership) return reply.code(403).send({ error: 'Not a member of this game' });
    if (membership.confirmedTerritoryId) return reply.code(409).send({ error: 'Already confirmed a territory' });

    const body = request.body as { slotIndex: number };
    if (typeof body.slotIndex !== 'number') return reply.code(400).send({ error: 'slotIndex required' });

    const result = await confirmCandidate(gameId, userId, body.slotIndex, defs);
    return result;
  });

  // POST /api/games/:id/territory/force-resolve — host-only AFK resolution.
  app.post('/api/games/:id/territory/force-resolve', async (request, reply) => {
    const userId = await getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'Not logged in' });

    const { id: gameId } = request.params as { id: string };
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) return reply.code(404).send({ error: 'Game not found' });
    if (game.hostUserId !== userId) return reply.code(403).send({ error: 'Only the host can force-resolve' });
    if (game.status !== 'territory_selection') return reply.code(409).send({ error: 'Game not in territory_selection phase' });

    deregisterGame(gameId); // Cancel the pending deadline timer.
    await autoAssignUnconfirmed(gameId, defs);
    return { ok: true };
  });

  // GET /api/games/:id — game detail with membership list.
  app.get('/api/games/:id', async (request, reply) => {
    const { id: gameId } = request.params as { id: string };
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: {
        memberships: {
          include: { user: { select: { id: true, username: true } } },
          orderBy: { slotIndex: 'asc' },
        },
      },
    });
    if (!game) return reply.code(404).send({ error: 'Game not found' });

    const meta = await prisma.worldMeta.findFirst({ where: { gameId } });

    return {
      id: game.id,
      name: game.name,
      status: game.status,
      maxPlayers: game.maxPlayers,
      tickIntervalSeconds: game.tickIntervalSeconds,
      lastTickAt: game.lastTickAt,
      endedAt: game.endedAt,
      endReason: game.endReason,
      hostUserId: game.hostUserId,
      aiSlots: game.aiSlots,
      removedSlots: game.removedSlots,
      tick: meta?.tick ?? null,
      members: game.memberships.map((m) => ({
        slotIndex: m.slotIndex,
        userId: m.userId,
        username: m.user.username,
        nationId: m.nationId,
        confirmedTerritoryId: m.confirmedTerritoryId ?? null,
      })),
    };
  });

  // ── Fast-forward voting (v0.36) ────────────────────────────────────────────

  // POST /api/games/:id/fast-forward/vote — cast a fast-forward vote.
  app.post('/api/games/:id/fast-forward/vote', async (request, reply) => {
    const userId = await getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'Not logged in' });

    const { id: gameId } = request.params as { id: string };
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) return reply.code(404).send({ error: 'Game not found' });
    if (game.status !== 'active') return reply.code(409).send({ error: 'Game is not active' });

    const membership = await prisma.gameMembership.findFirst({ where: { gameId, userId } });
    if (!membership) return reply.code(403).send({ error: 'Not a member of this game' });

    const meta = await prisma.worldMeta.findFirst({ where: { gameId } });
    const currentTick = meta?.tick ?? 0;

    // Upsert vote (replace existing vote for a new tick).
    await prisma.fastForwardVote.upsert({
      where: { gameId_userId: { gameId, userId } },
      create: { gameId, userId, tickNumber: currentTick },
      update: { tickNumber: currentTick, votedAt: new Date() },
    });

    // Count human player slots.
    const aiSlots = new Set<number>((game.aiSlots as number[]) ?? []);
    const removedSlots = new Set<number>((game.removedSlots as number[]) ?? []);
    const humanMemberships = await prisma.gameMembership.findMany({
      where: { gameId },
    });
    const humanCount = humanMemberships.filter(
      (m) => !aiSlots.has(m.slotIndex) && !removedSlots.has(m.slotIndex),
    ).length;

    const currentVotes = await prisma.fastForwardVote.count({ where: { gameId } });

    if (currentVotes >= humanCount) {
      // All human players voted — fire tick immediately.
      reply.send({ ok: true, triggered: true, votes: currentVotes, required: humanCount });
      // Fire async so reply sends first.
      setImmediate(async () => {
        try {
          await runGameTick(gameId, defs);
          const updatedGame = await prisma.game.findUnique({ where: { id: gameId }, select: { status: true, tickIntervalSeconds: true } });
          if (updatedGame?.status === 'active') {
            scheduleGameTick(gameId, defs, updatedGame.tickIntervalSeconds * 1000);
          }
        } catch (err) {
          console.error(`[fast-forward] Game ${gameId} immediate tick failed:`, err);
        }
      });
      return;
    }

    return { ok: true, triggered: false, votes: currentVotes, required: humanCount };
  });

  // GET /api/games/:id/fast-forward/status — vote status.
  app.get('/api/games/:id/fast-forward/status', async (request, reply) => {
    const { id: gameId } = request.params as { id: string };
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) return reply.code(404).send({ error: 'Game not found' });

    const aiSlots = new Set<number>((game.aiSlots as number[]) ?? []);
    const removedSlots = new Set<number>((game.removedSlots as number[]) ?? []);
    const humanMemberships = await prisma.gameMembership.findMany({ where: { gameId } });
    const humanCount = humanMemberships.filter(
      (m) => !aiSlots.has(m.slotIndex) && !removedSlots.has(m.slotIndex),
    ).length;

    const votes = await prisma.fastForwardVote.count({ where: { gameId } });
    return { votes, required: humanCount, ready: votes >= humanCount };
  });

  // ── Startup ────────────────────────────────────────────────────────────────

  await prisma.$connect();
  app.log.info('Database connected');

  await ensureWorldInitialized(defs);

  startScheduler(defs);
  await resumeActiveGames(defs);

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
