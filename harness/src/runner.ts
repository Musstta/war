/**
 * Core scenario runner — pure engine, no DB, no HTTP.
 */
import { resolve } from 'path';
import type { WorldState, QueuedAction, TerritoryDef, CulturalFamily } from '@war/engine';
import {
  loadTerritoryDefs,
  buildWorldState,
  resolveTick,
  computeNationCulture,
  computeCompatibility,
  computeConquestShock,
} from '@war/engine';
import type { Scenario, RunResult } from './types';
import { captureSnapshot } from './snapshot';

const DATA_FILE = process.env.WAR_DATA_FILE ?? resolve(__dirname, '../../data/territories.seed.json');

export function run(scenario: Scenario): RunResult {
  const defs = loadTerritoryDefs(DATA_FILE);
  const defById = new Map(defs.map((d) => [d.id, d]));

  // Build initial world from scenario nations.
  const nationInits = scenario.world.nations.map((n) => ({
    id: n.id,
    name: n.name,
    isAI: false,
    startingTerritoryIds: n.territories,
    armySize: n.armySize ?? 50,
  }));

  let world = buildWorldState(defs, nationInits, scenario.rngSeed ?? 42);

  // Apply capital overrides.
  for (const n of scenario.world.nations) {
    if (n.capitalTerritoryId && world.nations[n.id]) {
      world = {
        ...world,
        nations: {
          ...world.nations,
          [n.id]: { ...world.nations[n.id]!, capitalTerritoryId: n.capitalTerritoryId },
        },
      };
    }
  }

  // Apply per-territory attribute overrides.
  if (scenario.world.territoryOverrides) {
    for (const [tid, overrides] of Object.entries(scenario.world.territoryOverrides)) {
      const t = world.territories[tid];
      if (!t) continue;
      const newDef = overrides.culturalFamily
        ? { ...t.def, culturalFamily: overrides.culturalFamily as CulturalFamily }
        : t.def;
      const newState = {
        ...t.state,
        valueTraits: {
          individualist: overrides.individualist ?? t.state.valueTraits.individualist,
          progressive: overrides.progressive ?? t.state.valueTraits.progressive,
          militaristic: overrides.militaristic ?? t.state.valueTraits.militaristic,
          expansionist: overrides.expansionist ?? t.state.valueTraits.expansionist,
        },
        unrest: overrides.unrest ?? t.state.unrest,
      };
      world = { ...world, territories: { ...world.territories, [tid]: { def: newDef, state: newState } } };
    }
  }

  const snapshots: RunResult['snapshots'] = [];
  snapshots.push(captureSnapshot(world, 0, defs));

  // Group actions by tick for fast lookup.
  const actionsByTick = new Map<number, typeof scenario.actions extends undefined ? never[] : NonNullable<typeof scenario.actions>>();
  for (const action of scenario.actions ?? []) {
    if (!actionsByTick.has(action.tick)) actionsByTick.set(action.tick, []);
    actionsByTick.get(action.tick)!.push(action);
  }

  for (let i = 1; i <= scenario.ticks; i++) {
    const tickActions = actionsByTick.get(i) ?? [];
    const engineActions: QueuedAction[] = [];

    for (const action of tickActions) {
      const p = action.payload;

      if (action.type === 'assign_territory') {
        const tid = p['territoryId'] as string;
        const newOwnerId = (p['ownerId'] as string | null) ?? null;
        const t = world.territories[tid];
        if (!t) continue;

        // Compute compat-scaled shock from the NEW owner's existing culture.
        let shock = 0;
        if (newOwnerId) {
          const nc = computeNationCulture(newOwnerId, world.territories, world.nations[newOwnerId]?.capitalTerritoryId ?? null);
          const compat = computeCompatibility(t.state.valueTraits, t.def.culturalFamily, nc);
          shock = computeConquestShock(compat);
        }

        world = {
          ...world,
          territories: {
            ...world.territories,
            [tid]: {
              ...t,
              state: { ...t.state, ownerId: newOwnerId, ownershipShock: shock, acquiredTick: world.tick },
            },
          },
        };

      } else if (action.type === 'set_unrest') {
        const tid = p['territoryId'] as string;
        const value = p['value'] as number;
        const t = world.territories[tid];
        if (t) {
          world = {
            ...world,
            territories: { ...world.territories, [tid]: { ...t, state: { ...t.state, unrest: value } } },
          };
        }

      } else {
        // Pass-through to engine: derive nationId from territory owner.
        const tid = p['territoryId'] as string | undefined;
        const nationId = tid ? (world.territories[tid]?.state.ownerId ?? null) : null;
        if (!nationId) continue;

        let payload = { ...p, nationId };
        if (action.type === 'build_fort' && !payload['targetLevel']) {
          const fortLevel = (world.territories[tid!]?.state.fortificationLevel ?? 0) + 1;
          payload = { ...payload, targetLevel: fortLevel };
        }

        engineActions.push({ nationId, type: action.type, payload });
      }
    }

    const result = resolveTick(world, engineActions);
    world = result.world;

    snapshots.push(captureSnapshot(world, world.tick, defs));
  }

  return { scenario, snapshots };
}
