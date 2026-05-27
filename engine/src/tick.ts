import type { WorldState, QueuedAction, Stockpiles } from './types';
import { tickRng } from './rng';

// ── Placeholder constants ─────────────────────────────────────────────────────
// These numbers are not final. All tuning happens via the simulation harness
// once enough systems are in place. Do not balance these by hand. (design doc §17)
const UPKEEP_PER_SOLDIER = 0.05; // Wealth cost per soldier per tick
// ─────────────────────────────────────────────────────────────────────────────

function sumProduction(world: WorldState, nationId: string): Stockpiles {
  let population = 0;
  let industry = 0;
  let wealth = 0;
  for (const t of Object.values(world.territories)) {
    if (t.state.ownerId === nationId) {
      population += t.def.basePopulation;
      industry += t.def.baseIndustry;
      wealth += t.def.baseWealth;
    }
  }
  return { population, industry, wealth };
}

/**
 * Core tick function. Given a world state and the queued player actions for this
 * tick, deterministically produces exactly one next world state.
 *
 * Phase 1: only resource production and army upkeep are implemented.
 * Actions are accepted but not yet processed — the signature is final.
 *
 * See design doc §17: "given a world state and the set of queued actions,
 * it produces exactly one next world state."
 */
export function resolveTick(
  world: WorldState,
  actions: QueuedAction[],
): WorldState {
  const _rng = tickRng(world.rngSeed, world.tick);
  void _rng;

  const nations = { ...world.nations };
  const territories = Object.fromEntries(
    Object.entries(world.territories).map(([k, v]) => [k, { ...v, state: { ...v.state } }]),
  );
  const eventLog = [...world.eventLog];

  // ── Actions ───────────────────────────────────────────────────────────────
  for (const action of actions) {
    switch (action.type) {
      case 'build_road': {
        const { territoryId } = action.payload as { territoryId: string };
        const t = territories[territoryId];
        if (t && t.state.ownerId === action.nationId && !t.state.hasRoad) {
          t.state.hasRoad = true;
          eventLog.push({
            tick: world.tick + 1,
            message: `${world.nations[action.nationId]?.name ?? action.nationId} built a road in ${t.def.name}.`,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  // ── Production + upkeep ───────────────────────────────────────────────────
  for (const nation of Object.values(nations)) {
    const prod = sumProduction({ ...world, territories }, nation.id);
    const upkeep = nation.armySize * UPKEEP_PER_SOLDIER;

    nations[nation.id] = {
      ...nation,
      stockpiles: {
        population: nation.stockpiles.population + prod.population,
        industry: nation.stockpiles.industry + prod.industry,
        wealth: Math.max(0, nation.stockpiles.wealth + prod.wealth - upkeep),
      },
    };
  }

  return { ...world, tick: world.tick + 1, nations, territories, eventLog };
}
