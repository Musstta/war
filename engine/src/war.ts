/**
 * War engine — Phase 5 War sub-phase.
 *
 * Battle resolution, siege progression, and war-unrest computation.
 * Pure functions only — no I/O, no mutation of arguments.
 *
 * All numeric constants are tagged [PLACEHOLDER]. Tune via harness once enough
 * war data exists. Do not tune by hand. (design doc §17)
 */
import type { War, OccupiedTerritory, Territory, Nation, WorldState, Army } from './types';

// ── Battle formula constants ──────────────────────────────────────────────────

/**
 * Geography bonus to effective defense strength. Applied when territory geography
 * is mountainous or forest — terrain naturally favors defenders. [PLACEHOLDER]
 */
export const GEO_DEFENSE_BONUS = 0.20; // +20% effective defense

/**
 * Road logistics bonus to effective attack strength. Applied when the attacker
 * owns a road in their source territory (any owned adjacent territory with hasRoad).
 * [PLACEHOLDER]
 */
export const ROAD_ATTACK_BONUS = 0.10; // +10% effective attack

/**
 * Maximum random factor applied symmetrically to attack strength.
 * RNG produces a value in [−BATTLE_RANDOM_SPREAD, +BATTLE_RANDOM_SPREAD].
 * [PLACEHOLDER]
 */
export const BATTLE_RANDOM_SPREAD = 0.15; // ±15%

/**
 * Army loss rate for the loser (defender when attacker wins, attacker when defender holds).
 * [PLACEHOLDER]
 */
export const BATTLE_LOSER_LOSS_RATE = 0.10; // −10% of loser armySize

/**
 * Army loss rate for the winner. [PLACEHOLDER]
 */
export const BATTLE_WINNER_LOSS_RATE = 0.05; // −5% of winner armySize

/**
 * Ticks of siege required to fully capture a territory.
 * Full capture = siegeProgress >= fortificationLevel + SIEGE_TICKS_BASE.
 * Unfortified (L0): 1 tick. L1: 2 ticks. L2: 3 ticks. L3: 4 ticks.
 * [PLACEHOLDER]
 */
export const SIEGE_TICKS_BASE = 1;

// ── War-unrest constants ──────────────────────────────────────────────────────

/**
 * Unrest equilibrium pressure added per occupied territory per distance unit from capital.
 * Applied to the occupying nation's own territories (overextension signal).
 * [PLACEHOLDER]
 */
export const WAR_OVEREXTENSION_PRESSURE_PER_DIST = 0.02;

/**
 * Unrest ramp added to all territories of an insolvent nation (wealthStock < 0) that is at war.
 * Fires when warInsolventNations includes the nation. [PLACEHOLDER]
 */
export const WAR_INSOLVENCY_UNREST_PER_TICK = 0.03;

/**
 * Fraction of each tick's GROSS production (territory baseWealth output, before upkeep
 * and tribute) that is skimmed toward debt repayment while a nation has debtBalance > 0
 * but wealthStock >= 0 (recovery phase). Applied against gross, not net, so tribute
 * obligations cannot stall recovery. [PLACEHOLDER]
 *
 * Changed from net-incoming to gross-production in v0.24 (see tuning-notes.md).
 * At 0.30 rate and 5 Wealth/tick gross: skim = floor(5 × 0.30) = 1/tick.
 * Target 10–20 ticks; likely needs 0.60–0.70 or a minimum skim floor.
 */
export const DEBT_RECOVERY_SKIM_RATE = 0.30;

/**
 * Equilibrium reduction for territories owned by a nation at war
 * where militaristic > 0.3. Activates the militaryBonus stub. [PLACEHOLDER]
 */
export const WAR_MILITARISTIC_HAPPINESS_BONUS = -0.02; // reduces equilibrium

/**
 * No-CB equilibrium spike magnitude applied to Peaceful/Isolationist territories
 * of the declaring nation. [PLACEHOLDER] — also in declare_war action.
 */
export const NO_CB_UNREST_SPIKE = 0.05;

/**
 * How many ticks after declaration the no-CB spike persists. [PLACEHOLDER]
 */
export const NO_CB_SPIKE_DURATION = 5;

// ── Peace negotiation constants ───────────────────────────────────────────────

/**
 * Ticks a peace proposal remains open before it lapses (no exhaustion bump).
 * If neither accept_peace nor decline_peace is queued within this window,
 * the proposal is silently dropped and the war returns to active. [PLACEHOLDER]
 */
export const PEACE_PROPOSAL_LAPSE_TICKS = 3;

/**
 * Unrest equilibrium bump applied to ALL territories of the party that declined
 * a peace proposal. Decays normally — not a permanent change. [PLACEHOLDER]
 */
export const PEACE_DECLINE_EXHAUSTION_BUMP = 0.04;

/**
 * How many ticks the decline exhaustion bump persists (as an additive equilibrium
 * pressure, not stored separately — tracked via warExhaustionByNation). [PLACEHOLDER]
 */
export const PEACE_DECLINE_EXHAUSTION_TICKS = 3;

/**
 * Trust bonus awarded to both parties when a war ends via signed peace deal
 * (accepted, not force-ended). [PLACEHOLDER]
 */
export const PEACE_TRUST_BONUS = 5;

// ── Pacification constants ────────────────────────────────────────────────────

/**
 * Progress required to complete pacification of an unclaimed territory. [PLACEHOLDER]
 * armyStrength contributes each tick while an army is stationed there.
 */
export const PACIFICATION_THRESHOLD = 100; // [PLACEHOLDER]

/** Pacification progress lost per tick when the claiming army is absent. [PLACEHOLDER] */
export const PACIFICATION_DECAY_PER_TICK = 10; // [PLACEHOLDER]

/**
 * Terrain difficulty multipliers for pacification.
 * nativeDifficulty = TERRAIN_DIFFICULTY[geography] × ... [PLACEHOLDER all values]
 */
export const TERRAIN_DIFFICULTY: Record<string, number> = {
  coastal:     1.0, // [PLACEHOLDER]
  inland:      1.2, // [PLACEHOLDER]
  mountainous: 1.8, // [PLACEHOLDER]
  desert:      1.5, // [PLACEHOLDER]
  forest:      1.4, // [PLACEHOLDER]
};

/** Per-capita population contribution to pacification difficulty. [PLACEHOLDER] */
export const POP_DIFFICULTY_SCALE = 0.001; // [PLACEHOLDER]

/** Cultural incompatibility contribution to pacification difficulty. [PLACEHOLDER] */
export const COMPAT_DIFFICULTY_SCALE = 0.5; // [PLACEHOLDER]

// ── Movement model (§1.3) ────────────────────────────────────────────────────

/**
 * Base ticks to cross one territory (before geography and road modifiers).
 * [PLACEHOLDER]
 */
export const BASE_MOVEMENT_TICKS = 1; // [PLACEHOLDER]

/**
 * Geography modifiers on movement speed. Values > 1 = slower.
 * All [PLACEHOLDER].
 */
export const GEOGRAPHY_MOVEMENT_MODIFIER: Record<string, number> = {
  mountainous: 1.5, // [PLACEHOLDER]
  forest:      1.5, // [PLACEHOLDER]
  desert:      1.33, // [PLACEHOLDER]
  plain:       1.0, // [PLACEHOLDER]
  coastal:     1.0, // [PLACEHOLDER]
  island:      1.0, // [PLACEHOLDER]
  inland:      1.0, // [PLACEHOLDER]
};

/**
 * Road movement modifier: multiply geography-adjusted cost by this when the
 * crossing territory has a road. Values < 1 = faster. [PLACEHOLDER]
 */
export const ROAD_MOVEMENT_MODIFIER = 0.5; // [PLACEHOLDER]

/**
 * Barricade: defense bonus applied to a territory when a barricade is active.
 * Added to fort/geo bonus in battle resolution. [PLACEHOLDER]
 */
export const BARRICADE_DEFENSE_BONUS = 0.15; // [PLACEHOLDER]

/**
 * Barricade: movement multiplier through a territory with an active barricade.
 * Values > 1 = slower for passing armies. [PLACEHOLDER]
 */
export const BARRICADE_MOVEMENT_MULTIPLIER = 1.5; // [PLACEHOLDER]

/**
 * Barricade: duration in ticks. [PLACEHOLDER]
 */
export const BARRICADE_DURATION_TICKS = 5; // [PLACEHOLDER]

/**
 * Border skirmish: ticks within which a prior skirmish between two nations
 * constitutes grounds for a Full CB (instead of soft CB). [PLACEHOLDER]
 */
export const SKIRMISH_FULL_CB_WINDOW = 10; // [PLACEHOLDER]

/**
 * Border skirmish: ticks within which a skirmish counts as recent context
 * for a no-Trust-penalty war declaration. [PLACEHOLDER]
 */
export const SKIRMISH_CB_DECLARATION_WINDOW = 5; // [PLACEHOLDER]

/**
 * Border skirmish: compatibility score below which cultural hostility
 * contributes to Full CB. [PLACEHOLDER]
 */
export const SKIRMISH_HOSTILITY_COMPAT_THRESHOLD = 0.3; // [PLACEHOLDER]

/**
 * Computes travel ticks to cross a single territory, given its geography,
 * road status, and any active TerritoryModifier movementMultiplier.
 * Returns the total (fractional accumulates; integer ticks required = ceil of total).
 * [PLACEHOLDER callsite]
 */
export function computeTerritoryTravelCost(
  geography: string,
  hasRoad: boolean,
  modifierMovementMultiplier: number,
): number {
  const geoMod = GEOGRAPHY_MOVEMENT_MODIFIER[geography] ?? 1.0; // [PLACEHOLDER callsite]
  const roadMod = hasRoad ? ROAD_MOVEMENT_MODIFIER : 1.0; // [PLACEHOLDER callsite]
  return BASE_MOVEMENT_TICKS * geoMod * roadMod * modifierMovementMultiplier; // [PLACEHOLDER callsite]
}

/**
 * Computes the full path from origin to destination using BFS, then computes
 * total travel ticks. Returns { path, totalTravelTicks } or null if unreachable.
 * Path excludes the origin, includes the destination.
 */
export function computeArmyPath(
  originId: string,
  destinationId: string,
  territories: Record<string, import('./types').Territory>,
  adjacency: Record<string, readonly string[]>,
  territoryModifiers: import('./types').TerritoryModifier[],
): { path: string[]; totalTravelTicks: number } | null {
  if (originId === destinationId) return { path: [], totalTravelTicks: 0 };

  // BFS for shortest path.
  const visited = new Set<string>();
  const queue: Array<{ id: string; path: string[] }> = [{ id: originId, path: [] }];

  while (queue.length > 0) {
    const { id, path } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    for (const adjId of adjacency[id] ?? []) {
      if (visited.has(adjId)) continue;
      const newPath = [...path, adjId];
      if (adjId === destinationId) {
        // Path found — compute travel ticks.
        let totalTicks = 0;
        for (const tid of newPath) {
          const t = territories[tid];
          if (!t) continue;
          const modMult = territoryModifiers
            .filter((m) => m.territoryId === tid && (m.expiresAtTick === null || m.expiresAtTick > 0))
            .reduce((acc, m) => acc * m.movementMultiplier, 1.0);
          totalTicks += computeTerritoryTravelCost(t.def.geography, t.state.hasRoad, modMult); // [PLACEHOLDER callsite]
        }
        return { path: newPath, totalTravelTicks: Math.ceil(totalTicks) };
      }
      queue.push({ id: adjId, path: newPath });
    }
  }

  return null; // unreachable
}

// ── Geography → conquest shock magnitude (2.5) ───────────────────────────────

/**
 * Multiplier applied to base conquest shock at territory acquisition.
 * Mountainous/isolated geographies generate more resistance than flat/connected ones.
 * multiply base shock × GEOGRAPHY_SHOCK_MULTIPLIER[geography] at conquest.
 * All values [PLACEHOLDER].
 */
export const GEOGRAPHY_SHOCK_MULTIPLIER: Record<string, number> = {
  mountainous: 1.3,  // [PLACEHOLDER] — natural fortifications, strong local identity
  forest:      1.15, // [PLACEHOLDER] — difficult terrain, guerrilla resistance
  desert:      1.2,  // [PLACEHOLDER] — harsh environment, supply difficulty
  island:      1.25, // [PLACEHOLDER] — geographic isolation fosters distinct identity
  coastal:     0.9,  // [PLACEHOLDER] — trade exposure reduces cultural resistance
  plain:       1.0,  // [PLACEHOLDER] — baseline, flat accessible terrain
  inland:      1.0,  // [PLACEHOLDER] — baseline (inland not in Geography type but safe default)
};

// ── Army helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the total army size for a nation across all its positioned armies.
 * Replaces the removed armySize field on Nation. // migrated from armySize
 */
export function totalArmySize(armies: Army[], nationId: string): number {
  return armies.filter((a) => a.nationId === nationId).reduce((s, a) => s + a.size, 0);
}

/**
 * Returns all armies belonging to a nation.
 */
export function armiesForNation(armies: Army[], nationId: string): Army[] {
  return armies.filter((a) => a.nationId === nationId);
}

/**
 * Returns the army stationed/besieging in a specific territory, if any.
 * If multiple armies are present (shouldn't happen in v1), returns the largest.
 */
export function armyInTerritory(armies: Army[], territoryId: string): Army | undefined {
  const present = armies.filter((a) => a.territoryId === territoryId);
  if (present.length === 0) return undefined;
  return present.reduce((best, a) => (a.size > best.size ? a : best));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true if the two nations are currently at war with each other. */
export function areAtWar(wars: War[], nationA: string, nationB: string): boolean {
  return wars.some(
    (w) =>
      w.status === 'active' &&
      ((w.attackerId === nationA && w.defenderId === nationB) ||
       (w.attackerId === nationB && w.defenderId === nationA)),
  );
}

/** Returns the active war between two nations, or null. */
export function getActiveBetween(wars: War[], nationA: string, nationB: string): War | undefined {
  return wars.find(
    (w) =>
      w.status === 'active' &&
      ((w.attackerId === nationA && w.defenderId === nationB) ||
       (w.attackerId === nationB && w.defenderId === nationA)),
  );
}

/**
 * Compute attack and defense strengths for a single battle.
 *
 * attackerArmySize    — Nation.armySize of the attacker.
 * defenderArmySize    — Nation.armySize of the defender.
 * fortLevel           — territory fortificationLevel (0–3).
 * geography           — territory def geography.
 * attackerHasRoad     — true if any adjacent territory the attacker owns has hasRoad.
 * rngValue            — seeded random in [0, 1) from tickRng.
 *
 * Returns { attackStrength, defendStrength }.
 */
export function computeBattleStrengths(
  attackerArmySize: number,
  defenderArmySize: number,
  fortLevel: number,
  geography: Territory['def']['geography'],
  attackerHasRoad: boolean,
  rngValue: number,
): { attackStrength: number; defendStrength: number } {
  // Geography modifier — mountainous/forest bonus for defender.
  const geoBonus = (geography === 'mountainous' || geography === 'forest') ? GEO_DEFENSE_BONUS : 0;

  // Fort bonus — each level adds GEO_DEFENSE_BONUS worth of protection. [PLACEHOLDER: same rate]
  const fortBonus = fortLevel * GEO_DEFENSE_BONUS;

  // Road logistics bonus for attacker.
  const roadBonus = attackerHasRoad ? ROAD_ATTACK_BONUS : 0;

  // Random factor: maps rngValue [0,1) → [1−spread, 1+spread].
  const randomFactor = 1 + (rngValue * 2 - 1) * BATTLE_RANDOM_SPREAD;

  const attackStrength = attackerArmySize * (1 + roadBonus) * randomFactor;
  const defendStrength = defenderArmySize * (1 + fortBonus + geoBonus);

  return { attackStrength, defendStrength };
}

/**
 * Returns the number of siege ticks required to fully capture a territory.
 * fortificationLevel 0 → 1 tick, L1 → 2, L2 → 3, L3 → 4.
 */
export function siegeTicksRequired(fortLevel: number): number {
  return fortLevel + SIEGE_TICKS_BASE;
}

/**
 * Compute the war-overextension equilibrium pressure for a single territory
 * of the occupying nation. Returns the pressure value (≥ 0) to add.
 *
 * Each occupied territory the nation holds that is distHops from the capital
 * contributes WAR_OVEREXTENSION_PRESSURE_PER_DIST × distHops.
 */
export function computeOverextensionPressure(
  occupiedTerritories: OccupiedTerritory[],
  occupyingNationId: string,
  capitalTerritoryId: string | null,
  adjacency: Record<string, readonly string[]>,
): number {
  let pressure = 0;
  for (const occ of occupiedTerritories) {
    if (occ.occupyingNationId !== occupyingNationId) continue;
    const dist = capitalTerritoryId
      ? bfsDistanceFromAdjacency(adjacency, capitalTerritoryId, occ.territoryId)
      : 1;
    pressure += WAR_OVEREXTENSION_PRESSURE_PER_DIST * Math.max(1, dist);
  }
  return pressure;
}

/** BFS distance between two territory IDs using an adjacency map. Returns 1 if unreachable. */
function bfsDistanceFromAdjacency(
  adjacency: Record<string, readonly string[]>,
  from: string,
  to: string,
): number {
  if (from === to) return 0;
  const visited = new Set<string>();
  const queue: Array<[string, number]> = [[from, 0]];
  while (queue.length > 0) {
    const [id, dist] = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (id === to) return dist;
    for (const adj of adjacency[id] ?? []) {
      if (!visited.has(adj)) queue.push([adj, dist + 1]);
    }
  }
  return 1; // unreachable — treat as distance 1 for overextension purposes
}
