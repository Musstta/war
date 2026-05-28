import type { WorldState, QueuedAction, ActionResult, Stockpiles, ValueTraits } from './types';
import { tickRng } from './rng';
import {
  computeNationCulture,
  computeCompatibility,
  computeUnrestEquilibrium,
  computeShockDecayRate,
  applyDrift,
  bfsDistance,
  UNREST_DRIFT_RATE,
  REVOLT_THRESHOLD,
  REVOLT_HYSTERESIS,
  RECENT_ACQUISITION_WINDOW,
} from './culture';

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

/**
 * Sums base resource production for a nation, excluding revolting territories.
 * "Production" is the per-tick yield of each territory — not stored stockpiles.
 */
function sumProduction(world: WorldState, nationId: string): Stockpiles {
  let population = 0;
  let industry = 0;
  let wealth = 0;
  for (const t of Object.values(world.territories)) {
    if (t.state.ownerId !== nationId) continue;
    if (t.state.isInRevolt) continue; // revolting territory produces nothing
    population += t.def.basePopulation;
    industry += t.def.baseIndustry;
    wealth += t.def.baseWealth;
  }
  return { population, industry, wealth };
}

/**
 * Core tick function. Given a world state and the queued player actions for this
 * tick, deterministically produces exactly one next world state plus an explicit
 * result record for every action (applied or discarded with reason).
 *
 * See design doc §17: pure in, pure out. No HTTP, no DB.
 *
 * Immer note: ValueTraits is now explicitly spread in the clone step below so
 * drift mutations don't bleed into the input world. No deeper nesting exists yet,
 * so full Immer adoption remains deferred (design doc §13).
 */
export function resolveTick(
  world: WorldState,
  actions: QueuedAction[],
): { world: WorldState; actionResults: ActionResult[] } {
  const rng = tickRng(world.rngSeed, world.tick);

  const nations = { ...world.nations };
  // Explicitly spread ValueTraits so culture drift doesn't mutate the input world.
  const territories = Object.fromEntries(
    Object.entries(world.territories).map(([k, v]) => [
      k,
      { ...v, state: { ...v.state, valueTraits: { ...v.state.valueTraits } } },
    ]),
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

    // Construction complete — capture both completed type and pending before clearing.
    const completedType = t.state.constructionType;
    const pending = t.state.pendingConstructionType;
    t.state.constructionType = null;
    t.state.constructionTicksLeft = null;
    t.state.pendingConstructionType = null;

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

    // Start queued pending build immediately.
    // Mandate + industry were deducted at queue time; just start the work here.
    if (pending === 'road') {
      t.state.hasRoad = true;
      eventLog.push({ tick: world.tick + 1, message: `${ownerName} completed a queued road in ${t.def.name}.` });
    } else if (pending) {
      t.state.constructionType = pending;
      t.state.constructionTicksLeft = BUILD_TICKS[pending]!;
      eventLog.push({ tick: world.tick + 1, message: `${ownerName} started queued ${pending} construction in ${t.def.name}.` });
    }
  }

  // ── Culture & Unrest ──────────────────────────────────────────────────────
  // Build adjacency map once for BFS distance lookups.
  const adjacency: Record<string, readonly string[]> = Object.fromEntries(
    Object.entries(territories).map(([k, v]) => [k, v.def.adjacentIds]),
  );

  // Count territories per nation; compute smooth-decay rapid-expansion weights.
  // Each recently acquired territory contributes a weight that decays linearly from
  // 1.0 at acquisition to 0.0 at RECENT_ACQUISITION_WINDOW ticks — no hard cliff.
  const territoryCounts: Record<string, number> = {};
  const recentAcquisitionWeights: Record<string, number> = {};
  for (const t of Object.values(territories)) {
    const oid = t.state.ownerId;
    if (!oid) continue;
    territoryCounts[oid] = (territoryCounts[oid] ?? 0) + 1;
    if (t.state.acquiredTick !== null) {
      const age = world.tick - t.state.acquiredTick;
      if (age <= RECENT_ACQUISITION_WINDOW) {
        const weight = Math.max(0, 1 - age / RECENT_ACQUISITION_WINDOW);
        recentAcquisitionWeights[oid] = (recentAcquisitionWeights[oid] ?? 0) + weight;
      }
    }
  }

  // Compute each nation's current culture — capital gets extra weight (item 7).
  const nationCultures: Record<string, ReturnType<typeof computeNationCulture>> = {};
  for (const nationId of Object.keys(nations)) {
    const cap = nations[nationId]?.capitalTerritoryId ?? null;
    nationCultures[nationId] = computeNationCulture(nationId, territories, cap);
  }

  // Process each owned territory: decay shock, drift unrest, check revolt, apply cultural drift.
  for (const t of Object.values(territories)) {
    const ownerId = t.state.ownerId;
    if (!ownerId) continue;

    const nationCulture = nationCultures[ownerId];
    if (!nationCulture) continue;

    const capital = nations[ownerId]?.capitalTerritoryId ?? null;
    const hops = capital ? bfsDistance(adjacency, capital, t.def.id) : 0;
    const tcount = territoryCounts[ownerId] ?? 1;
    const recentWeight = recentAcquisitionWeights[ownerId] ?? 0;

    const compat = computeCompatibility(t.state.valueTraits, t.def.culturalFamily, nationCulture);
    const causes = computeUnrestEquilibrium(
      compat, hops,
      t.state.hasRoad, t.state.hasPort, t.state.fortificationLevel,
      tcount, t.state.ownershipShock, recentWeight,
    );

    // Decay ownership shock at a rate gated by integration progress.
    // Neglected territories stay shocked; actively integrated ones heal quickly.
    if (t.state.ownershipShock > 0) {
      const decayRate = computeShockDecayRate(
        t.state.hasRoad, t.state.hasPort, t.state.fortificationLevel, compat, causes,
      );
      t.state.ownershipShock = Math.max(0, t.state.ownershipShock * (1 - decayRate));
    }

    // Drift unrest toward equilibrium.
    t.state.unrest = t.state.unrest + UNREST_DRIFT_RATE * (causes.equilibrium - t.state.unrest);

    // Revolt hysteresis: enter above threshold, exit only when well below it.
    if (!t.state.isInRevolt && t.state.unrest >= REVOLT_THRESHOLD) {
      t.state.isInRevolt = true;
      eventLog.push({
        tick: world.tick + 1,
        message: `${t.def.name} has risen in revolt against ${nations[ownerId]?.name ?? ownerId}!`,
      });
    } else if (t.state.isInRevolt && t.state.unrest < REVOLT_THRESHOLD - REVOLT_HYSTERESIS) {
      t.state.isInRevolt = false;
      eventLog.push({
        tick: world.tick + 1,
        message: `The revolt in ${t.def.name} has been suppressed.`,
      });
    }

    // Cultural drift: high unrest slows assimilation.
    t.state.valueTraits = applyDrift(t.state.valueTraits, nationCulture, t.state.unrest, rng);
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
