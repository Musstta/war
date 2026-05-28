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

export function captureSnapshot(world: WorldState, tick: number, defs: TerritoryDef[]): TickSnapshot {
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
    nations[nid] = { stockpiles: n.stockpiles, culture: cultures[nid] ?? null };
  }

  // Events from this specific tick.
  const events = world.eventLog.filter((e) => e.tick === tick);

  return { tick, territories, nations, events };
}
