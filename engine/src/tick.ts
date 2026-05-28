import type { WorldState, QueuedAction, ActionResult, Stockpiles } from './types';
import { tickRng } from './rng';

// ── Placeholder constants ─────────────────────────────────────────────────────
// These numbers are not final. All tuning happens via the simulation harness
// once enough systems are in place. Do not balance these by hand. (design doc §17)
const UPKEEP_PER_SOLDIER = 0.05; // [PLACEHOLDER] Wealth cost per soldier per tick

/** Ticks required to complete each construction type. [PLACEHOLDER] */
export const BUILD_TICKS: Record<string, number> = {
  port:    3,
  fort_l1: 3,
  fort_l2: 7,
  fort_l3: 14,
};

/** Industry stockpile cost deducted at construction start. [PLACEHOLDER] */
export const BUILD_INDUSTRY: Record<string, number> = {
  port:    5,
  fort_l1: 3,
  fort_l2: 6,
  fort_l3: 10,
};
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
 * tick, deterministically produces exactly one next world state plus an explicit
 * result record for every action (applied or discarded with reason).
 *
 * See design doc §17: pure in, pure out. No HTTP, no DB.
 */
export function resolveTick(
  world: WorldState,
  actions: QueuedAction[],
): { world: WorldState; actionResults: ActionResult[] } {
  const _rng = tickRng(world.rngSeed, world.tick);
  void _rng;

  const nations = { ...world.nations };
  const territories = Object.fromEntries(
    Object.entries(world.territories).map(([k, v]) => [k, { ...v, state: { ...v.state } }]),
  );
  const eventLog = [...world.eventLog];
  const actionResults: ActionResult[] = [];

  const discard = (action: QueuedAction, reason: string): void => {
    actionResults.push({ nationId: action.nationId, type: action.type, payload: action.payload, status: 'discarded', reason });
  };
  const apply = (action: QueuedAction): void => {
    actionResults.push({ nationId: action.nationId, type: action.type, payload: action.payload, status: 'applied' });
  };

  // ── Actions ───────────────────────────────────────────────────────────────
  for (const action of actions) {
    switch (action.type) {
      case 'build_road': {
        const { territoryId } = action.payload as { territoryId: string };
        const t = territories[territoryId];
        if (!t) { discard(action, 'territory not found'); break; }
        if (t.state.ownerId !== action.nationId) { discard(action, 'not owner'); break; }
        if (t.state.constructionType !== null) { discard(action, 'construction slot occupied'); break; }
        if (t.state.hasRoad) { discard(action, 'already has road'); break; }
        t.state.hasRoad = true;
        eventLog.push({
          tick: world.tick + 1,
          message: `${world.nations[action.nationId]?.name ?? action.nationId} built a road in ${t.def.name}.`,
        });
        apply(action);
        break;
      }

      case 'build_port': {
        const { territoryId } = action.payload as { territoryId: string };
        const t = territories[territoryId];
        const nation = nations[action.nationId];
        if (!t || !nation) { discard(action, 'territory or nation not found'); break; }
        if (t.state.ownerId !== action.nationId) { discard(action, 'not owner'); break; }
        if (!t.def.isCoastal) { discard(action, 'territory not coastal'); break; }
        if (t.state.hasPort) { discard(action, 'already has port'); break; }
        if (t.state.constructionType !== null) { discard(action, 'construction slot occupied'); break; }
        const portIndustryCost = BUILD_INDUSTRY['port']!;
        if (nation.stockpiles.industry < portIndustryCost) { discard(action, `insufficient industry (need ${portIndustryCost})`); break; }
        nations[action.nationId] = {
          ...nation,
          stockpiles: { ...nation.stockpiles, industry: nation.stockpiles.industry - portIndustryCost },
        };
        t.state.constructionType = 'port';
        t.state.constructionTicksLeft = BUILD_TICKS['port']!;
        eventLog.push({ tick: world.tick + 1, message: `${nation.name} began port construction in ${t.def.name}.` });
        apply(action);
        break;
      }

      case 'build_fort': {
        const { territoryId, targetLevel } = action.payload as { territoryId: string; targetLevel: 1 | 2 | 3 };
        const t = territories[territoryId];
        const nation = nations[action.nationId];
        if (!t || !nation) { discard(action, 'territory or nation not found'); break; }
        if (t.state.ownerId !== action.nationId) { discard(action, 'not owner'); break; }
        if (t.state.fortificationLevel !== targetLevel - 1) { discard(action, `fort level mismatch (have ${t.state.fortificationLevel}, need ${targetLevel - 1})`); break; }
        if (t.state.constructionType !== null) { discard(action, 'construction slot occupied'); break; }
        const constructionType = `fort_l${targetLevel}` as 'fort_l1' | 'fort_l2' | 'fort_l3';
        const fortIndustryCost = BUILD_INDUSTRY[constructionType]!;
        if (nation.stockpiles.industry < fortIndustryCost) { discard(action, `insufficient industry (need ${fortIndustryCost})`); break; }
        nations[action.nationId] = {
          ...nation,
          stockpiles: { ...nation.stockpiles, industry: nation.stockpiles.industry - fortIndustryCost },
        };
        t.state.constructionType = constructionType;
        t.state.constructionTicksLeft = BUILD_TICKS[constructionType]!;
        eventLog.push({ tick: world.tick + 1, message: `${nation.name} began fortification L${targetLevel} construction in ${t.def.name}.` });
        apply(action);
        break;
      }

      default:
        discard(action, `unknown action type: ${action.type}`);
        break;
    }
  }

  // ── Construction progression ──────────────────────────────────────────────
  for (const t of Object.values(territories)) {
    if (t.state.constructionType === null || t.state.constructionTicksLeft === null) continue;
    t.state.constructionTicksLeft -= 1;
    if (t.state.constructionTicksLeft > 0) continue;
    const completedType = t.state.constructionType;
    t.state.constructionType = null;
    t.state.constructionTicksLeft = null;
    const ownerName = t.state.ownerId ? (nations[t.state.ownerId]?.name ?? t.state.ownerId) : 'Unknown';
    if (completedType === 'port') {
      t.state.hasPort = true;
      eventLog.push({ tick: world.tick + 1, message: `${ownerName} completed a port in ${t.def.name}.` });
    } else {
      t.state.fortificationLevel += 1;
      eventLog.push({
        tick: world.tick + 1,
        message: `${ownerName} completed fortification level ${t.state.fortificationLevel} in ${t.def.name}.`,
      });
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

  return { world: { ...world, tick: world.tick + 1, nations, territories, eventLog }, actionResults };
}
