/**
 * War engine — Phase 5 War sub-phase.
 *
 * Battle resolution, siege progression, and war-unrest computation.
 * Pure functions only — no I/O, no mutation of arguments.
 *
 * All numeric constants are tagged [PLACEHOLDER]. Tune via harness once enough
 * war data exists. Do not tune by hand. (design doc §17)
 */
import type { War, OccupiedTerritory, Territory, Nation, WorldState } from './types';

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
 * Unrest ramp added to all territories of an insolvent nation (wealthStock < 0) per tick.
 * Compounds — each tick the nation stays insolvent adds this on top. [PLACEHOLDER]
 */
export const WAR_INSOLVENCY_UNREST_PER_TICK = 0.03;

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
