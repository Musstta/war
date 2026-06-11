/**
 * Caretaker AI + activity-tier management — Phase 6 Prompt 1.
 *
 * Runs inside the tick transaction after resolveTick. Responsible for:
 *   1. Tier transitions (active → dormant → autopilot → abandoned → dissolved)
 *   2. Caretaker action queuing for Dormant + Autopilot nations
 *   3. Abandoned fragmentation (territories break away, independent AI spawned)
 *   4. Nation dissolution when all territories are lost
 *
 * All constants are [PLACEHOLDER] — tune once real play data exists.
 */
import { Prisma } from '@prisma/client';
import type { TerritoryDef } from '@war/engine';
import { deriveDoctrineBlend } from '@war/engine';

type TxClient = Prisma.TransactionClient;

// ── Tier transition thresholds ────────────────────────────────────────────────
// Days of inactivity before advancing to the next tier. [PLACEHOLDER]
export const TIER_ACTIVE_TO_DORMANT_DAYS   = 3;   // [PLACEHOLDER]
export const TIER_DORMANT_TO_AUTOPILOT_DAYS = 7;   // [PLACEHOLDER]
export const TIER_AUTOPILOT_TO_ABANDONED_DAYS = 14; // [PLACEHOLDER]

// ── Caretaker build thresholds ────────────────────────────────────────────────
/** Minimum wealth stockpile before Autopilot queues an infrastructure upgrade. [PLACEHOLDER] */
export const CARETAKER_INFRA_WEALTH_FLOOR = 20;
/** Maximum average unrest before Autopilot attempts expansion. [PLACEHOLDER] */
export const CARETAKER_EXPANSION_UNREST_CAP = 0.4;

// ── Fragmentation constants ───────────────────────────────────────────────────
/** Weight of territory unrest in the fragmentation risk formula. [PLACEHOLDER] */
export const ABANDON_UNREST_WEIGHT    = 0.6;
/** Weight of time-since-abandoned in fragmentation risk formula. [PLACEHOLDER] */
export const ABANDON_TIME_WEIGHT      = 0.4;
/** Divisor for days-since-abandoned in the time component. [PLACEHOLDER] */
export const ABANDON_TIME_SCALE_DAYS  = 30;
/** Risk above which a territory breaks away. [PLACEHOLDER] */
export const ABANDON_FRAGMENT_THRESHOLD = 0.8;

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysSince(date: Date | null): number {
  if (!date) return 0;
  return (Date.now() - date.getTime()) / 86_400_000;
}

/** Compute fragmentation risk for one territory of an abandoned nation. */
export function fragmentationRisk(
  unrest: number,
  abandonedAt: Date,
): number {
  const days = daysSince(abandonedAt);
  return unrest * ABANDON_UNREST_WEIGHT + (days / ABANDON_TIME_SCALE_DAYS) * ABANDON_TIME_WEIGHT;
}

// ── Main caretaker entry point ────────────────────────────────────────────────

/**
 * Called once per tick inside the runTick transaction, after saveWorldState.
 * Handles tier transitions, caretaker queuing, and abandoned fragmentation.
 * `currentTick` is the NEW tick number (world.tick after resolveTick).
 * `defs` is the territory def map for adjacency/geography lookups.
 */
export async function runCaretaker(
  tx: TxClient,
  currentTick: number,
  defs: TerritoryDef[],
): Promise<void> {
  const defById = new Map(defs.map((d) => [d.id, d]));

  // Load all human (non-AI) nations that are not already dissolved.
  const nations = await tx.nation.findMany({
    where: { isAI: false, activityTier: { not: 'dissolved' } },
  });

  for (const nation of nations) {
    const tier = nation.activityTier;
    const lastActive = (nation as any).lastActiveAt as Date | null;
    const abandonedAt = (nation as any).abandonedAt as Date | null;
    const days = daysSince(lastActive);

    // ── 1. Tier transition ──────────────────────────────────────────────────
    let newTier = tier;
    if (tier === 'active' && days >= TIER_ACTIVE_TO_DORMANT_DAYS) {
      newTier = 'dormant';
    } else if (tier === 'dormant' && days >= TIER_DORMANT_TO_AUTOPILOT_DAYS) {
      newTier = 'autopilot';
    } else if (tier === 'autopilot' && days >= TIER_AUTOPILOT_TO_ABANDONED_DAYS) {
      newTier = 'abandoned';
    }

    if (newTier !== tier) {
      const updateData: Record<string, unknown> = { activityTier: newTier };
      if (newTier === 'abandoned') updateData['abandonedAt'] = new Date();

      await tx.nation.update({ where: { id: nation.id }, data: updateData });
      await tx.eventLog.create({
        data: {
          tick: currentTick,
          message: tierTransitionMessage(nation.name, newTier),
        },
      });

      // Dormant: trigger treaty degradation.
      if (newTier === 'dormant') {
        await applyDormantDegradation(tx, nation.id, currentTick);
      }
    }

    const effectiveTier = newTier;

    // ── 2. Abandoned fragmentation ──────────────────────────────────────────
    if (effectiveTier === 'abandoned') {
      const effectiveAbandonedAt = abandonedAt ?? new Date();
      await runFragmentation(tx, nation, effectiveAbandonedAt, currentTick, defById);
      continue; // no caretaker queuing for abandoned nations
    }

    // ── 3. Caretaker queuing (Dormant + Autopilot) ──────────────────────────
    if (effectiveTier !== 'dormant' && effectiveTier !== 'autopilot') continue;

    // Harness guard: lastActiveAt is null for harness nations → skip caretaker.
    if (lastActive === null && !nation.isAI) {
      // Harness nations have no lastActiveAt — treat as always-active, no caretaker.
      continue;
    }

    await runCaretakerActions(tx, nation, effectiveTier, currentTick, defById);
  }
}

// ── Tier transition messages ──────────────────────────────────────────────────

function tierTransitionMessage(nationName: string, newTier: string): string {
  switch (newTier) {
    case 'dormant':    return `${nationName} has become Dormant.`;
    case 'autopilot':  return `${nationName} has entered Autopilot.`;
    case 'abandoned':  return `${nationName} has been Abandoned.`;
    default:           return `${nationName} transitioned to ${newTier}.`;
  }
}

// ── Treaty degradation on Dormant transition ──────────────────────────────────

async function applyDormantDegradation(tx: TxClient, nationId: string, currentTick: number): Promise<void> {
  // Mirror the existing harness set_nation_tier='dormant' path:
  // defense_pact → non_aggression (degrade), military_access → degrade.
  // Collateral: inactive party's deposit moves to escrow; active partner's begins refund.
  const treaties = await tx.treaty.findMany({
    where: { status: 'active', parties: { some: { nationId } } },
    include: { parties: true, clauses: true },
  });

  for (const treaty of treaties) {
    const activePartnerId = treaty.parties.find((p) => p.nationId !== nationId)?.nationId;
    if (!activePartnerId) continue;

    const inactiveParty = treaty.parties.find((p) => p.nationId === nationId)!;
    const activeParty   = treaty.parties.find((p) => p.nationId === activePartnerId)!;

    await tx.treaty.update({
      where: { id: treaty.id },
      data: { status: 'degraded' },
    });
    await tx.treatyParty.update({
      where: { id: inactiveParty.id },
      data: {
        escrowAmount:     inactiveParty.collateralDeposited,
        escrowStartTick:  currentTick,
        collateralDeposited: 0,
      },
    });
    await tx.treatyParty.update({
      where: { id: activeParty.id },
      data: {
        refundRemaining:  activeParty.collateralDeposited,
        refundStartTick:  currentTick,
        collateralDeposited: 0,
      },
    });
  }
}

// ── Caretaker action queuing ──────────────────────────────────────────────────

async function runCaretakerActions(
  tx: TxClient,
  nation: { id: string; name: string; mandateUsed: number; caretakerPriorities: unknown },
  tier: string,
  currentTick: number,
  defById: Map<string, TerritoryDef>,
): Promise<void> {
  // Load current mandate budget.
  const [devCount, fullCount] = await Promise.all([
    tx.territoryState.count({ where: { ownerId: nation.id, hasRoad: true, OR: [{ hasPort: true }, { hasMarket: true }], fortificationLevel: { gte: 1 } } }),
    tx.territoryState.count({ where: { ownerId: nation.id, hasRoad: true, OR: [{ hasPort: true }, { hasMarket: true }], fortificationLevel: 3 } }),
  ]);
  const budget = 3 + devCount + fullCount; // mandateBudget formula
  let mandateUsed: number = nation.mandateUsed;

  const priorities = Array.isArray(nation.caretakerPriorities)
    ? (nation.caretakerPriorities as string[])
    : ['defense', 'roads', 'industry', 'expansion'];

  const ownedTerritories = await tx.territoryState.findMany({ where: { ownerId: nation.id } });

  for (const priority of priorities) {
    if (mandateUsed >= budget) break;

    if (priority === 'defense') {
      const queued = await tryDefense(tx, nation.id, ownedTerritories, currentTick, defById, budget, mandateUsed);
      mandateUsed += queued;

    } else if (priority === 'roads') {
      const queued = await tryRoads(tx, nation.id, ownedTerritories, currentTick, budget, mandateUsed);
      mandateUsed += queued;

    } else if (priority === 'industry' && tier === 'autopilot') {
      const queued = await tryIndustry(tx, nation, ownedTerritories, currentTick, budget, mandateUsed);
      mandateUsed += queued;

    } else if (priority === 'expansion' && tier === 'autopilot') {
      const queued = await tryExpansion(tx, nation.id, ownedTerritories, currentTick, defById, budget, mandateUsed);
      mandateUsed += queued;
    }
  }
}

// ── Defense ───────────────────────────────────────────────────────────────────

async function tryDefense(
  tx: TxClient,
  nationId: string,
  ownedTerritories: Array<{ id: string; unrest: number }>,
  tick: number,
  defById: Map<string, TerritoryDef>,
  budget: number,
  mandateUsed: number,
): Promise<number> {
  const MOVE_COST = 1; // [PLACEHOLDER] matches ACTION_COSTS['move_army']
  if (mandateUsed + MOVE_COST > budget) return 0;

  // Find any owned territories currently under siege by an enemy.
  const activeWars = await tx.war.findMany({
    where: {
      status: { in: ['active', 'peace_negotiation'] },
      OR: [{ attackerId: nationId }, { defenderId: nationId }],
    },
  });

  const ownedIds = new Set(ownedTerritories.map((t) => t.id));
  let siegedTerritoryId: string | null = null;

  for (const war of activeWars) {
    const enemyId = war.attackerId === nationId ? war.defenderId : war.attackerId;
    const occupied = (war.occupiedTerritories as Array<{ territoryId: string; occupyingNationId: string }>) ?? [];
    const underSiege = occupied.find(
      (o) => ownedIds.has(o.territoryId) && o.occupyingNationId === enemyId,
    );
    if (underSiege) { siegedTerritoryId = underSiege.territoryId; break; }
  }
  if (!siegedTerritoryId) return 0;

  // Find the largest available (non-besieging) army for this nation.
  const armies = await tx.army.findMany({ where: { nationId, status: { not: 'besieging' } } });
  if (armies.length === 0) return 0;
  const army = armies.reduce((best, a) => (a.size > best.size ? a : best));

  // Already at or adjacent to the besieged territory?
  if (army.territoryId === siegedTerritoryId) return 0;

  // BFS: find the next step toward the besieged territory.
  const nextStep = bfsNextStep(defById, army.territoryId, siegedTerritoryId);
  if (!nextStep) return 0;

  // Check not already queued a move for this army.
  const alreadyQueued = await tx.queuedAction.findFirst({
    where: { nationId, type: 'move_army', payload: { path: ['armyId'], equals: army.id } },
  });
  if (alreadyQueued) return 0;

  await tx.queuedAction.create({
    data: {
      nationId,
      phase: 'main',
      type: 'move_army',
      payload: { armyId: army.id, toTerritoryId: nextStep, caretaker: true } as Prisma.InputJsonValue,
      tickQueued: tick,
    },
  });
  await tx.nation.update({ where: { id: nationId }, data: { mandateUsed: { increment: MOVE_COST } } });
  return MOVE_COST;
}

/** BFS to find the territory adjacent to `from` that is one step closer to `to`. */
function bfsNextStep(
  defById: Map<string, TerritoryDef>,
  from: string,
  to: string,
): string | null {
  if (from === to) return null;
  // BFS from `to` backwards — gives distance-from-destination for every reachable node.
  const dist = new Map<string, number>();
  const queue: string[] = [to];
  dist.set(to, 0);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curDist = dist.get(cur)!;
    for (const adj of defById.get(cur)?.adjacentIds ?? []) {
      if (!dist.has(adj)) {
        dist.set(adj, curDist + 1);
        queue.push(adj);
      }
    }
  }
  // From `from`, pick the adjacent territory with the smallest distance to `to`.
  let best: string | null = null;
  let bestDist = Infinity;
  for (const adj of defById.get(from)?.adjacentIds ?? []) {
    const d = dist.get(adj) ?? Infinity;
    if (d < bestDist) { bestDist = d; best = adj; }
  }
  return best;
}

// ── Roads ─────────────────────────────────────────────────────────────────────

async function tryRoads(
  tx: TxClient,
  nationId: string,
  ownedTerritories: Array<{ id: string; unrest: number; hasRoad: boolean }>,
  tick: number,
  budget: number,
  mandateUsed: number,
): Promise<number> {
  const ROAD_COST = 1;
  if (mandateUsed + ROAD_COST > budget) return 0;

  // Highest-unrest territory without a road.
  const unroaded = (ownedTerritories as Array<{ id: string; unrest: number; hasRoad: boolean }>)
    .filter((t) => !t.hasRoad)
    .sort((a, b) => b.unrest - a.unrest);

  if (unroaded.length === 0) return 0;
  const target = unroaded[0]!;

  // Check not already under construction or queued.
  const state = await tx.territoryState.findUnique({ where: { id: target.id } });
  if (!state || state.constructionType !== null || state.hasRoad) return 0;

  const alreadyQueued = await tx.queuedAction.findFirst({
    where: { nationId, type: 'build_road', payload: { path: ['territoryId'], equals: target.id } },
  });
  if (alreadyQueued) return 0;

  await tx.queuedAction.create({
    data: {
      nationId,
      phase: 'main',
      type: 'build_road',
      payload: { territoryId: target.id, caretaker: true } as Prisma.InputJsonValue,
      tickQueued: tick,
    },
  });
  await tx.nation.update({ where: { id: nationId }, data: { mandateUsed: { increment: ROAD_COST } } });
  return ROAD_COST;
}

// ── Industry ──────────────────────────────────────────────────────────────────

async function tryIndustry(
  tx: TxClient,
  nation: { id: string; wealthStock?: number | null },
  ownedTerritories: Array<{ id: string }>,
  tick: number,
  budget: number,
  mandateUsed: number,
): Promise<number> {
  const fullNation = await tx.nation.findUnique({ where: { id: nation.id } });
  if (!fullNation || fullNation.wealthStock < CARETAKER_INFRA_WEALTH_FLOOR) return 0;

  // Find the most developed territory (road+port+fort≥1) without a pending upgrade.
  const candidates = await tx.territoryState.findMany({
    where: {
      ownerId: nation.id,
      hasRoad: true,
      hasPort: true,
      constructionType: null,
      pendingConstructionType: null,
    },
  });
  if (candidates.length === 0) return 0;

  // Pick the one with the highest fortLevel < 3 for upgrade.
  const upgradeable = candidates
    .filter((t) => t.fortificationLevel < 3)
    .sort((a, b) => b.fortificationLevel - a.fortificationLevel);

  if (upgradeable.length === 0) return 0;
  const target = upgradeable[0]!;
  const targetLevel = (target.fortificationLevel + 1) as 1 | 2 | 3;

  const FORT_COSTS: Record<number, number> = { 1: 2, 2: 3, 3: 4 };
  const FORT_IND:   Record<number, number> = { 1: 3, 2: 6, 3: 10 };
  const mandateCost = FORT_COSTS[targetLevel] ?? 4;
  const indCost     = FORT_IND[targetLevel]  ?? 10;

  if (mandateUsed + mandateCost > budget) return 0;
  if (fullNation.indStock < indCost) return 0;

  const alreadyQueued = await tx.queuedAction.findFirst({
    where: { nationId: nation.id, type: 'build_fort' },
  });
  if (alreadyQueued) return 0;

  await tx.queuedAction.create({
    data: {
      nationId: nation.id,
      phase: 'main',
      type: 'build_fort',
      payload: { territoryId: target.id, targetLevel, caretaker: true } as Prisma.InputJsonValue,
      tickQueued: tick,
    },
  });
  await tx.nation.update({
    where: { id: nation.id },
    data: { mandateUsed: { increment: mandateCost }, indStock: { decrement: indCost } },
  });
  return mandateCost;
}

// ── Expansion ─────────────────────────────────────────────────────────────────

async function tryExpansion(
  tx: TxClient,
  nationId: string,
  ownedTerritories: Array<{ id: string; unrest: number }>,
  tick: number,
  defById: Map<string, TerritoryDef>,
  budget: number,
  mandateUsed: number,
): Promise<number> {
  // Only expand if average unrest is below the cap.
  const avgUnrest = ownedTerritories.length > 0
    ? ownedTerritories.reduce((s, t) => s + t.unrest, 0) / ownedTerritories.length
    : 1;
  if (avgUnrest >= CARETAKER_EXPANSION_UNREST_CAP) return 0;

  const ownedIds = new Set(ownedTerritories.map((t) => t.id));

  // Find adjacent unclaimed territories.
  let targetId: string | null = null;
  for (const t of ownedTerritories) {
    const def = defById.get(t.id);
    if (!def) continue;
    for (const adjId of def.adjacentIds) {
      if (ownedIds.has(adjId)) continue;
      const adjState = await tx.territoryState.findUnique({ where: { id: adjId } });
      if (adjState && adjState.ownerId === null) { targetId = adjId; break; }
    }
    if (targetId) break;
  }
  if (!targetId) return 0;

  const alreadyQueued = await tx.queuedAction.findFirst({ where: { nationId, type: 'assign_territory' } });
  if (alreadyQueued) return 0;

  // assign_territory is a harness action type — in the live server it maps to the
  // admin set-owner endpoint logic. Here we apply it directly: update the territory owner.
  await tx.territoryState.update({
    where: { id: targetId },
    data: { ownerId: nationId },
  });
  await tx.eventLog.create({
    data: {
      tick,
      message: `[caretaker] ${nationId} claimed ${targetId}.`,
    },
  });
  // No mandate cost for assign_territory (it's a harness/internal operation).
  return 0;
}

// ── Abandoned fragmentation ───────────────────────────────────────────────────

async function runFragmentation(
  tx: TxClient,
  nation: { id: string; name: string; abandonedAt?: unknown },
  effectiveAbandonedAt: Date,
  currentTick: number,
  defById: Map<string, TerritoryDef>,
): Promise<void> {
  const territories = await tx.territoryState.findMany({ where: { ownerId: nation.id } });

  if (territories.length === 0) {
    // All territories gone — dissolve the nation.
    await tx.nation.update({ where: { id: nation.id }, data: { activityTier: 'dissolved' } });
    await tx.eventLog.create({
      data: { tick: currentTick, message: `The ${nation.name} empire has dissolved.` },
    });
    return;
  }

  for (const terr of territories) {
    const risk = fragmentationRisk(terr.unrest, effectiveAbandonedAt);
    if (risk < ABANDON_FRAGMENT_THRESHOLD) continue;

    // Territory breaks away — set unclaimed.
    await tx.territoryState.update({
      where: { id: terr.id },
      data: { ownerId: null, ownershipShock: 0, acquiredTick: null },
    });

    const terrDef = defById.get(terr.id);
    const terrName = terrDef ? terr.id : terr.id;
    await tx.eventLog.create({
      data: {
        tick: currentTick,
        message: `${terrName} broke away from the abandoned ${nation.name} empire.`,
      },
    });

    // Spawn a small independent AI nation. Derive doctrine from territory cultural traits.
    const newNationId = `nation_independent_${terr.id}_${currentTick}`;
    const traits = {
      individualist: terr.individualist,
      progressive: terr.progressive,
      militaristic: terr.militaristic,
      expansionist: terr.expansionist,
    };
    const doctrine = deriveDoctrineBlend(traits);

    await tx.nation.create({
      data: {
        id: newNationId,
        name: `Independent ${terr.id}`,
        isAI: true,
        armySize: 10,
        capitalTerritoryId: terr.id,
        inactivityTier: 'active',
        activityTier: 'active',
        doctrineBlend: doctrine as unknown as Prisma.InputJsonValue,
        foundedAtTick: currentTick,
      },
    });
    // Seed army for the new AI nation. // migrated from armySize
    await tx.army.create({
      data: { nationId: newNationId, territoryId: terr.id, size: 10, status: 'stationed' },
    });
    await tx.territoryState.update({ where: { id: terr.id }, data: { ownerId: newNationId } });
  }

  // Check for dissolution after fragmentation pass.
  const remaining = await tx.territoryState.count({ where: { ownerId: nation.id } });
  if (remaining === 0) {
    await tx.nation.update({ where: { id: nation.id }, data: { activityTier: 'dissolved' } });
    await tx.eventLog.create({
      data: { tick: currentTick, message: `The ${nation.name} empire has dissolved.` },
    });
  }
}
