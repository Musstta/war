/**
 * AI nation behavior — Phase 6 Prompt 2.
 *
 * Runs inside the tick transaction after the caretaker pass.
 * Only acts for nations where isAI = true AND doctrineBlend is set.
 * Uses doctrine scoring from engine/src/doctrine.ts.
 *
 * AI nations respect all existing validation constraints — the scorer produces
 * candidates, but each action is still subject to the game's normal rules
 * (adjacency, mandate budget, construction slot, etc.).
 *
 * All weights are [PLACEHOLDER]. Tune via harness once AI behavior data exists.
 */
import { Prisma } from '@prisma/client';
import {
  scoreAction,
  deriveDoctrineBlend,
  AI_EFFICIENCY_PENALTY,
  OFFENSIVE_WAR_GATE,
  scoreOffensiveWar,
  OFFENSIVE_WAR_THRESHOLD,
  BALANCED_DOCTRINE,
} from '@war/engine';
import type { DoctrineBlend, TerritoryDef } from '@war/engine';

type TxClient = Prisma.TransactionClient;

/**
 * Run AI action selection for all AI nations this tick.
 * Called after saveWorldState + caretaker in runTick.
 */
export async function runAiNations(
  tx: TxClient,
  currentTick: number,
  defs: TerritoryDef[],
): Promise<void> {
  const defById = new Map(defs.map((d) => [d.id, d]));

  const aiNations = await tx.nation.findMany({
    where: { isAI: true, activityTier: { not: 'dissolved' } },
  });

  for (const nation of aiNations) {
    const doctrine = ((nation as any).doctrineBlend as DoctrineBlend | null) ?? BALANCED_DOCTRINE;
    await runAiForNation(tx, nation, doctrine, currentTick, defById);
  }
}

// ── Per-nation AI loop ────────────────────────────────────────────────────────

async function runAiForNation(
  tx: TxClient,
  nation: { id: string; name: string; mandateUsed: number; indStock: number; wealthStock: number; armySize: number },
  doctrine: DoctrineBlend,
  tick: number,
  defById: Map<string, TerritoryDef>,
): Promise<void> {
  // Mandate budget.
  const [devCount, fullCount] = await Promise.all([
    tx.territoryState.count({ where: { ownerId: nation.id, hasRoad: true, hasPort: true, fortificationLevel: { gte: 1 } } }),
    tx.territoryState.count({ where: { ownerId: nation.id, hasRoad: true, hasPort: true, fortificationLevel: 3 } }),
  ]);
  const budget = 3 + devCount + fullCount;
  let mandateUsed: number = nation.mandateUsed;

  const ownedTerritories = await tx.territoryState.findMany({ where: { ownerId: nation.id } });
  if (ownedTerritories.length === 0) return;

  const highestOwnedUnrest = Math.max(...ownedTerritories.map((t) => t.unrest));
  const avgUnrest = ownedTerritories.reduce((s, t) => s + t.unrest, 0) / ownedTerritories.length;

  // Build scored candidate list.
  type Candidate = { type: string; score: number; act: () => Promise<number> };
  const candidates: Candidate[] = [];

  // ── Expand claim ──────────────────────────────────────────────────────────
  // Find adjacent unclaimed territories.
  const ownedIds = new Set(ownedTerritories.map((t) => t.id));
  let unclaimedAdj: string | null = null;
  for (const t of ownedTerritories) {
    const def = defById.get(t.id);
    if (!def) continue;
    for (const adjId of def.adjacentIds) {
      if (ownedIds.has(adjId)) continue;
      const adj = await tx.territoryState.findUnique({ where: { id: adjId } });
      if (adj && adj.ownerId === null) { unclaimedAdj = adjId; break; }
    }
    if (unclaimedAdj) break;
  }
  if (unclaimedAdj) {
    const adjId = unclaimedAdj;
    const score = scoreAction({ type: 'expand_claim' }, doctrine);
    candidates.push({
      type: 'expand_claim',
      score,
      act: async () => {
        await tx.territoryState.update({ where: { id: adjId }, data: { ownerId: nation.id } });
        await tx.eventLog.create({
          data: { tick, message: `[AI] ${nation.name} claimed ${adjId}.` },
        });
        return 0; // no mandate cost for direct expansion
      },
    });
  }

  // ── Build road ────────────────────────────────────────────────────────────
  const unroaded = ownedTerritories
    .filter((t) => !t.hasRoad && t.constructionType === null)
    .sort((a, b) => b.unrest - a.unrest);
  if (unroaded.length > 0) {
    const target = unroaded[0]!;
    const score = scoreAction({ type: 'build_road', context: { highestOwnedUnrest } }, doctrine);
    candidates.push({
      type: 'build_road',
      score,
      act: async () => {
        if (mandateUsed + 1 > budget) return 0;
        const already = await tx.queuedAction.findFirst({
          where: { nationId: nation.id, type: 'build_road', payload: { path: ['territoryId'], equals: target.id } },
        });
        if (already) return 0;
        await tx.queuedAction.create({
          data: {
            nationId: nation.id, phase: 'main', type: 'build_road',
            payload: { territoryId: target.id, ai: true } as Prisma.InputJsonValue,
            tickQueued: tick,
          },
        });
        await tx.nation.update({ where: { id: nation.id }, data: { mandateUsed: { increment: 1 } } });
        return 1;
      },
    });
  }

  // ── Build port ────────────────────────────────────────────────────────────
  const unported = ownedTerritories.filter(
    (t) => t.constructionType === null && !t.hasPort,
  );
  // Check coastal via def.
  const coastalUnported = unported.filter((t) => defById.get(t.id)?.isCoastal);
  if (coastalUnported.length > 0 && nation.indStock >= 5) {
    const target = coastalUnported[0]!;
    const score = scoreAction({ type: 'build_port' }, doctrine);
    candidates.push({
      type: 'build_port',
      score,
      act: async () => {
        if (mandateUsed + 2 > budget) return 0;
        if (nation.indStock < 5) return 0;
        const already = await tx.queuedAction.findFirst({
          where: { nationId: nation.id, type: 'build_port' },
        });
        if (already) return 0;
        await tx.queuedAction.create({
          data: {
            nationId: nation.id, phase: 'main', type: 'build_port',
            payload: { territoryId: target.id, ai: true } as Prisma.InputJsonValue,
            tickQueued: tick,
          },
        });
        await tx.nation.update({
          where: { id: nation.id },
          data: { mandateUsed: { increment: 2 }, indStock: { decrement: 5 } },
        });
        return 2;
      },
    });
  }

  // ── Build fort ────────────────────────────────────────────────────────────
  const fortifiable = ownedTerritories.filter(
    (t) => t.constructionType === null && t.fortificationLevel < 3,
  );
  if (fortifiable.length > 0) {
    const target = fortifiable.sort((a, b) => b.fortificationLevel - a.fortificationLevel)[0]!;
    const nextLevel = (target.fortificationLevel + 1) as 1 | 2 | 3;
    const FORT_COSTS: Record<number, number> = { 1: 2, 2: 3, 3: 4 };
    const FORT_IND:   Record<number, number> = { 1: 3, 2: 6, 3: 10 };
    const mCost = FORT_COSTS[nextLevel] ?? 4;
    const iCost = FORT_IND[nextLevel] ?? 10;
    if (nation.indStock >= iCost) {
      const score = scoreAction({ type: 'build_fort' }, doctrine);
      candidates.push({
        type: 'build_fort',
        score,
        act: async () => {
          if (mandateUsed + mCost > budget) return 0;
          const already = await tx.queuedAction.findFirst({ where: { nationId: nation.id, type: 'build_fort' } });
          if (already) return 0;
          await tx.queuedAction.create({
            data: {
              nationId: nation.id, phase: 'main', type: 'build_fort',
              payload: { territoryId: target.id, targetLevel: nextLevel, ai: true } as Prisma.InputJsonValue,
              tickQueued: tick,
            },
          });
          await tx.nation.update({
            where: { id: nation.id },
            data: { mandateUsed: { increment: mCost }, indStock: { decrement: iCost } },
          });
          return mCost;
        },
      });
    }
  }

  // ── Propose non-aggression treaty ─────────────────────────────────────────
  // Find a neighbor nation with Trust > 40 and no existing treaty.
  const neighborNationId = await findTreatyTarget(tx, nation.id, ownedIds, defById, 40);
  if (neighborNationId) {
    const targetId = neighborNationId;
    const score = scoreAction({ type: 'propose_treaty' }, doctrine);
    candidates.push({
      type: 'propose_treaty',
      score,
      act: async () => {
        if (mandateUsed + 1 > budget) return 0;
        // Check no existing pending proposal.
        const alreadyProposed = await tx.proposal.findFirst({
          where: {
            status: 'pending',
            OR: [
              { proposerId: nation.id, targetId },
              { proposerId: targetId, targetId: nation.id },
            ],
          },
        });
        if (alreadyProposed) return 0;
        // Create a non-aggression proposal (10-tick term, no collateral).
        await tx.proposal.create({
          data: {
            proposerId: nation.id,
            targetId,
            status: 'pending',
            termTicks: 10,
            proposerCollateral: 0,
            targetCollateral: 0,
            tickProposed: tick,
            expiresAtTick: tick + 5, // proposals expire after 5 ticks
            clauses: { create: [{ type: 'non_aggression', collateral: 0, payload: {} }] },
          },
        });
        await tx.nation.update({ where: { id: nation.id }, data: { mandateUsed: { increment: 1 } } });
        await tx.eventLog.create({
          data: { tick, message: `[AI] ${nation.name} proposed a non-aggression treaty with ${targetId}.` },
        });
        return 1;
      },
    });
  }

  // ── Propose trade treaty ──────────────────────────────────────────────────
  // Find a neighbor nation with Trust > 45, propose wealth trade clause.
  const tradeTargetId = await findTreatyTarget(tx, nation.id, ownedIds, defById, 45);
  if (tradeTargetId) {
    const targetId = tradeTargetId;
    // Use first owned territory as trade source.
    const sourceTerrId = ownedTerritories[0]?.id;
    if (sourceTerrId) {
      const score = scoreAction({ type: 'propose_trade' }, doctrine);
      candidates.push({
        type: 'propose_trade',
        score,
        act: async () => {
          if (mandateUsed + 1 > budget) return 0;
          const alreadyProposed = await tx.proposal.findFirst({
            where: {
              status: 'pending',
              OR: [
                { proposerId: nation.id, targetId },
                { proposerId: targetId, targetId: nation.id },
              ],
            },
          });
          if (alreadyProposed) return 0;
          // Propose a trade treaty: 3 Wealth/tick from AI to target.
          await tx.proposal.create({
            data: {
              proposerId: nation.id,
              targetId,
              status: 'pending',
              termTicks: 10,
              proposerCollateral: 0,
              targetCollateral: 0,
              tickProposed: tick,
              expiresAtTick: tick + 5,
              clauses: {
                create: [
                  { type: 'non_aggression', collateral: 0, payload: {} },
                  {
                    type: 'trade',
                    collateral: 0,
                    payload: {
                      resource: 'wealth',
                      amount: 3,
                      fromNationId: nation.id,
                      toNationId: targetId,
                      sourceTerritoryId: sourceTerrId,
                    } as Prisma.InputJsonValue,
                  },
                ],
              },
            },
          });
          await tx.nation.update({ where: { id: nation.id }, data: { mandateUsed: { increment: 1 } } });
          await tx.eventLog.create({
            data: { tick, message: `[AI] ${nation.name} proposed a trade treaty with ${targetId}.` },
          });
          return 1;
        },
      });
    }
  }

  // ── Sort by score descending, execute until budget exhausted ─────────────
  candidates.sort((a, b) => b.score - a.score);

  for (const candidate of candidates) {
    if (mandateUsed >= budget) break;
    const spent = await candidate.act();
    mandateUsed += spent;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Find the first neighboring nation (adjacent territory owner) that meets
 * the Trust threshold and has no existing active treaty with this nation.
 */
async function findTreatyTarget(
  tx: TxClient,
  nationId: string,
  ownedIds: Set<string>,
  defById: Map<string, TerritoryDef>,
  minTrust: number,
): Promise<string | null> {
  const neighborIds = new Set<string>();
  for (const tid of ownedIds) {
    const def = defById.get(tid);
    if (!def) continue;
    for (const adjId of def.adjacentIds) {
      if (ownedIds.has(adjId)) continue;
      const adj = await tx.territoryState.findUnique({ where: { id: adjId } });
      if (adj?.ownerId && adj.ownerId !== nationId) neighborIds.add(adj.ownerId);
    }
  }

  for (const nId of neighborIds) {
    const neighbor = await tx.nation.findUnique({ where: { id: nId } });
    if (!neighbor || neighbor.trust < minTrust) continue;

    // No existing active treaty.
    const existingTreaty = await tx.treaty.findFirst({
      where: {
        status: { in: ['active', 'degraded'] },
        AND: [
          { parties: { some: { nationId } } },
          { parties: { some: { nationId: nId } } },
        ],
      },
    });
    if (existingTreaty) continue;

    return nId;
  }
  return null;
}
