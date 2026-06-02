/**
 * Captures a full snapshot of world state at a given tick for metrics collection.
 * Recomputes all culture/unrest values from the pure engine functions.
 */
import type { WorldState, TerritoryDef } from '@war/engine';
import {
  computeNationCulture,
  computeCompatibility,
  computeUnrestEquilibrium,
  bfsDistance,
  RECENT_ACQUISITION_WINDOW,
} from '@war/engine';
import type { TickSnapshot } from './types';
import { harnessFragmentationRisk } from './runner';

export function captureSnapshot(
  world: WorldState,
  tick: number,
  defs: TerritoryDef[],
  abandonedAtTickByNation?: Map<string, number>,
): TickSnapshot {
  const adjacency: Record<string, readonly string[]> = Object.fromEntries(
    defs.map((d) => [d.id, d.adjacentIds]),
  );

  // Nation cultures (weighted averages with capital multiplier).
  const cultures = Object.fromEntries(
    Object.keys(world.nations).map((nid) => [
      nid,
      computeNationCulture(nid, world.territories, world.nations[nid]?.capitalTerritoryId ?? null),
    ]),
  );

  // Territory counts + recent-acquisition weights per nation.
  const territoryCounts: Record<string, number> = {};
  const recentWeights: Record<string, number> = {};
  for (const t of Object.values(world.territories)) {
    const oid = t.state.ownerId;
    if (!oid) continue;
    territoryCounts[oid] = (territoryCounts[oid] ?? 0) + 1;
    if (t.state.acquiredTick !== null) {
      const age = world.tick - t.state.acquiredTick;
      if (age <= RECENT_ACQUISITION_WINDOW) {
        const w = Math.max(0, 1 - age / RECENT_ACQUISITION_WINDOW);
        recentWeights[oid] = (recentWeights[oid] ?? 0) + w;
      }
    }
  }

  const territories: TickSnapshot['territories'] = {};
  for (const [id, t] of Object.entries(world.territories)) {
    const oid = t.state.ownerId;
    let causes = null, compatTotal = null;
    if (oid) {
      const nc = cultures[oid];
      if (nc) {
        const compat = computeCompatibility(t.state.valueTraits, t.def.culturalFamily, nc);
        compatTotal = compat.total;
        const capital = world.nations[oid]?.capitalTerritoryId ?? null;
        const hops = capital ? bfsDistance(adjacency, capital, id) : 0;
        causes = computeUnrestEquilibrium(
          compat, hops,
          t.state.hasRoad, t.state.hasPort, t.state.fortificationLevel,
          territoryCounts[oid] ?? 1,
          t.state.ownershipShock,
          recentWeights[oid] ?? 0,
        );
      }
    }
    territories[id] = {
      ownerId: oid,
      unrest: t.state.unrest,
      equilibrium: causes?.equilibrium ?? 0,
      ownershipShock: t.state.ownershipShock,
      isInRevolt: t.state.isInRevolt,
      compatTotal,
      causes,
    };
  }

  const nations: TickSnapshot['nations'] = {};
  for (const [nid, n] of Object.entries(world.nations)) {
    nations[nid] = { stockpiles: n.stockpiles, armySize: n.armySize, culture: cultures[nid] ?? null };
  }

  const wars: TickSnapshot['wars'] = world.wars
    .filter((w) => w.status !== 'ended')
    .map((w) => ({
      id: w.id,
      attackerId: w.attackerId,
      defenderId: w.defenderId,
      type: w.type,
      hasCasusBelli: w.hasCasusBelli,
      status: w.status,
      startTick: w.startTick,
      occupiedCount: w.occupiedTerritories.length,
    }));

  // Diplomacy snapshot: treaty state + per-nation Trust/tier/wealth.
  const diplomacy: TickSnapshot['diplomacy'] = {
    nationState: Object.fromEntries(
      Object.entries(world.nations).map(([nid, n]) => [nid, {
        trust: n.trust,
        inactivityTier: n.inactivityTier,
        activityTier: n.activityTier ?? n.inactivityTier,
        wealthStock: n.stockpiles.wealth,
        debtBalance: n.debtBalance,
      }]),
    ),
    treaties: world.treaties.map((t) => ({
      id: t.id,
      status: t.status,
      partyIds: t.partyIds,
      clauses: t.clauses.map((c) => c.type),
      termTicks: t.termTicks,
      tickEnds: t.tickEnds,
      totalCollateral: t.totalCollateral,
      collateralByParty: { ...t.collateralByParty },
      escrowAmountByParty: { ...t.escrowAmountByParty },
      refundRemainingByParty: { ...t.refundRemainingByParty },
      objectives: t.clauses
        .filter((c) => c.type === 'objective' && c.objective)
        .map((c) => ({
          clauseIndex: c.clauseIndex,
          objectiveType: c.objective!.objectiveType,
          status: c.objective!.status,
          deadlineTicks: c.objective!.deadlineTicks,
          responsibleParty: c.objective!.responsibleParty,
        })),
      tradeClauses: t.clauses
        .filter((c) => c.type === 'trade')
        .map((c) => {
          const p = c.payload as { resource?: string; amount?: number; fromNationId?: string; toNationId?: string; sourceTerritoryId?: string };
          return {
            clauseIndex: c.clauseIndex,
            clauseStatus: c.clauseStatus,
            missedPayments: c.missedPayments,
            resource: p.resource ?? '',
            amount: p.amount ?? 0,
            fromNationId: p.fromNationId ?? '',
            toNationId: p.toNationId ?? '',
            sourceTerritoryId: p.sourceTerritoryId ?? '',
          };
        }),
    })),
  };

  // Events from this specific tick.
  const events = world.eventLog.filter((e) => e.tick === tick);

  // Fragmentation data — only for territories owned by Abandoned nations.
  const fragmentationData: TickSnapshot['fragmentationData'] = [];
  for (const [nid, n] of Object.entries(world.nations)) {
    if (n.activityTier !== 'abandoned') continue;
    const abandonedAtTick = abandonedAtTickByNation?.get(nid) ?? tick;
    const ticksAbandoned = tick - abandonedAtTick;
    for (const [tid, t] of Object.entries(world.territories)) {
      if (t.state.ownerId !== nid) continue;
      fragmentationData.push({
        territoryId: tid,
        ownerId: t.state.ownerId,
        unrest: t.state.unrest,
        fragmentationRisk: harnessFragmentationRisk(t.state.unrest, ticksAbandoned),
      });
    }
  }

  return { tick, territories, nations, wars, diplomacy, events, fragmentationData };
}
