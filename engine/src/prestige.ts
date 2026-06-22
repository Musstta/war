/**
 * Prestige formula + Dominant qualification — Phase 8.
 *
 * All numeric constants are [PLACEHOLDER]. Do not tune by hand.
 * Tune via harness once multi-session play data exists.
 * See tuning-notes.md for the placeholder notes on each constant.
 */

import { PRESTIGE_PER_TRADE_CAPACITY } from './tradeRoutes';
export { PRESTIGE_PER_TRADE_CAPACITY };

// ── Prestige formula constants ────────────────────────────────────────────────

/** Prestige gained per owned territory. [PLACEHOLDER] */
export const PRESTIGE_PER_TERRITORY = 10;

/** Prestige gained per active/degraded treaty (standing treaties). [PLACEHOLDER] */
export const PRESTIGE_PER_TREATY = 5;

/** Prestige gained per treaty that ran to natural expiry without being broken (cumulative). [PLACEHOLDER] */
export const PRESTIGE_PER_KEPT_TREATY = 8;

/** Prestige gained per war won (cumulative). [PLACEHOLDER] */
export const PRESTIGE_PER_WAR_WIN = 15;

/** Average unrest must be below this threshold to qualify for the stability bonus. [PLACEHOLDER] */
export const PRESTIGE_STABILITY_THRESHOLD = 0.3;

/** Flat Prestige bonus when average unrest < PRESTIGE_STABILITY_THRESHOLD. [PLACEHOLDER] */
export const PRESTIGE_STABILITY_BONUS = 20;

/** Prestige gained per tick the nation has existed (age reward). [PLACEHOLDER] */
export const PRESTIGE_PER_TICK_AGE = 0.1;

/** Prestige per point of infrastructure score (sum of hasRoad+hasPort+fortLevel across all territories). [PLACEHOLDER] */
export const PRESTIGE_PER_INFRA_POINT = 0.5;

/** Prestige gained per point of Trust (0–100 scale). [PLACEHOLDER] */
export const PRESTIGE_TRUST_SCALE = 0.3;

// ── Dominant qualification constants ─────────────────────────────────────────

/**
 * Minimum absolute Prestige score required to be considered for Dominant status.
 * No nation is Dominant if no one crosses this floor, even if they are the clear leader.
 * [PLACEHOLDER — completely untested; needs multi-session simulation before it means anything]
 */
export const DOMINANT_PRESTIGE_FLOOR = 150;

/**
 * A nation qualifies as Dominant only if their Prestige >= topPrestige × this value.
 * 0.85 means within 15% of the top score.
 * Multiple nations may be co-Dominant if both cross the floor and both are within band.
 * [PLACEHOLDER — completely untested; needs multi-session simulation before it means anything]
 */
export const DOMINANT_COMPARABILITY_BAND = 0.85;

// ── Dominant mechanical effect constants ─────────────────────────────────────

/**
 * Multiplier on Trust loss when a Dominant nation voluntarily breaks a treaty.
 * < 1.0 = reduced penalty (Dominant nations take less Trust damage for betrayal).
 * Applied in breakTreaty handler. [PLACEHOLDER]
 */
export const DOMINANT_TRUST_PENALTY_REDUCTION = 0.75;

/**
 * Flat Prestige bonus awarded to the non-Dominant party when they accept a treaty
 * proposed by a Dominant nation. Dominant party receives nothing.
 * [PLACEHOLDER]
 */
export const UNDERDOG_PRESTIGE_BONUS = 5;

/**
 * Equilibrium reduction applied to all territories of the underdog nation
 * for UNDERDOG_UNREST_DURATION ticks when they accept a Dominant nation's treaty.
 * Negative = reduces equilibrium (unrest goes down). [PLACEHOLDER]
 */
export const UNDERDOG_UNREST_REDUCTION = -0.02;

/** How many ticks the underdog unrest reduction persists. [PLACEHOLDER] */
export const UNDERDOG_UNREST_DURATION = 3;

/**
 * Attack strength multiplier when a non-Dominant nation attacks a Dominant nation.
 * > 1.0 = bonus (underdog gets an edge attacking the big power).
 * Applied in battle resolution in tick.ts. [PLACEHOLDER]
 */
export const DOMINANT_WAR_ATTACKER_BONUS = 1.15;

/**
 * Additional equilibrium reduction for Militaristic territories of the attacker
 * for the entire war duration when attacking a Dominant nation.
 * Negative = reduces equilibrium. [PLACEHOLDER]
 */
export const DOMINANT_WAR_MILITARISTIC_BONUS = -0.03;

// ── Prestige decay/loss constants (v0.40) ────────────────────────────────────

/**
 * Prestige lost per tick for each territory currently in active revolt
 * (unrest >= REVOLT_THRESHOLD = 0.80). Applied as a per-tick subtraction
 * in computePrestige's decay term. [PLACEHOLDER]
 */
export const PRESTIGE_DECAY_PER_REVOLT_TICK = 1;

/**
 * Prestige lost when a nation loses a war (peace deal where they ceded territory
 * or paid tribute without receiving anything). Symmetric counterpart to
 * PRESTIGE_PER_WAR_WIN. Cumulative. [PLACEHOLDER]
 */
export const PRESTIGE_LOSS_PER_WAR_DEFEAT = 10;

/**
 * Prestige lost per territory permanently lost to another nation (conquest, cession-as-loser).
 * Symmetric counterpart to PRESTIGE_PER_TERRITORY. Cumulative. [PLACEHOLDER]
 */
export const PRESTIGE_LOSS_PER_TERRITORY_LOST = 8;

/**
 * Prestige lost per tick that a nation is insolvent (wealthStock < 0 OR debtBalance > 0).
 * Applied as a per-tick subtraction. [PLACEHOLDER]
 */
export const PRESTIGE_DECAY_PER_INSOLVENCY_TICK = 2;

// ── Formula ───────────────────────────────────────────────────────────────────

export interface PrestigeInput {
  nationId: string;
  territoryCount: number;
  standingTreatyCount: number;
  completedTreatiesKept: number;
  warsWon: number;
  /** Cumulative wars-lost count (tracked on Nation same as warsWon). */
  warsLost: number;
  /** Cumulative territories permanently lost to other nations. */
  territoriesLost: number;
  avgUnrest: number;
  /** Number of owned territories currently in active revolt (unrest >= REVOLT_THRESHOLD). */
  revoltTerritoryCount: number;
  /** Whether the nation is currently insolvent (wealthStock < 0 OR debtBalance > 0). */
  isInsolvent: boolean;
  nationAgeTicks: number;
  infrastructureScore: number;
  trust: number;
  /** Sum of currentCapacity across all active trade route agreements. [PLACEHOLDER] */
  tradeRouteScore: number;
}

/**
 * Compute the raw Prestige score from inputs. Returns a non-negative integer.
 *
 * Full formula (v0.40):
 *   GAINS (per tick, cumulative where noted):
 *     + territoryCount × PRESTIGE_PER_TERRITORY (10)
 *     + standingTreatyCount × PRESTIGE_PER_TREATY (5)
 *     + completedTreatiesKept × PRESTIGE_PER_KEPT_TREATY (8) [cumulative]
 *     + warsWon × PRESTIGE_PER_WAR_WIN (15) [cumulative]
 *     + PRESTIGE_STABILITY_BONUS (20) if avgUnrest < PRESTIGE_STABILITY_THRESHOLD (0.3)
 *     + nationAgeTicks × PRESTIGE_PER_TICK_AGE (0.1)
 *     + infrastructureScore × PRESTIGE_PER_INFRA_POINT (0.5)
 *     + trust × PRESTIGE_TRUST_SCALE (0.3)
 *     + tradeRouteScore × PRESTIGE_PER_TRADE_CAPACITY (0.3)
 *   LOSSES (per tick or cumulative):
 *     − warsLost × PRESTIGE_LOSS_PER_WAR_DEFEAT (10) [cumulative]
 *     − territoriesLost × PRESTIGE_LOSS_PER_TERRITORY_LOST (8) [cumulative]
 *     − revoltTerritoryCount × PRESTIGE_DECAY_PER_REVOLT_TICK (1) [per tick, each revolting territory]
 *     − PRESTIGE_DECAY_PER_INSOLVENCY_TICK (2) per tick if insolvent
 *   Result clamped to ≥ 0.
 */
export function computePrestige(input: PrestigeInput): number {
  const {
    territoryCount, standingTreatyCount, completedTreatiesKept,
    warsWon, warsLost, territoriesLost,
    avgUnrest, revoltTerritoryCount, isInsolvent,
    nationAgeTicks, infrastructureScore, trust,
    tradeRouteScore,
  } = input;

  const gains =
    territoryCount        * PRESTIGE_PER_TERRITORY +
    standingTreatyCount   * PRESTIGE_PER_TREATY +
    completedTreatiesKept * PRESTIGE_PER_KEPT_TREATY +
    warsWon               * PRESTIGE_PER_WAR_WIN +
    (avgUnrest < PRESTIGE_STABILITY_THRESHOLD ? PRESTIGE_STABILITY_BONUS : 0) +
    nationAgeTicks        * PRESTIGE_PER_TICK_AGE +
    infrastructureScore   * PRESTIGE_PER_INFRA_POINT +
    trust                 * PRESTIGE_TRUST_SCALE +
    tradeRouteScore       * PRESTIGE_PER_TRADE_CAPACITY;

  const losses =
    warsLost              * PRESTIGE_LOSS_PER_WAR_DEFEAT +
    territoriesLost       * PRESTIGE_LOSS_PER_TERRITORY_LOST +
    revoltTerritoryCount  * PRESTIGE_DECAY_PER_REVOLT_TICK +
    (isInsolvent ? PRESTIGE_DECAY_PER_INSOLVENCY_TICK : 0);

  return Math.max(0, Math.round(gains - losses));
}


/**
 * Given a map of nationId → prestige score, return the set of nationIds that
 * hold Dominant status this tick.
 *
 * Rules:
 *   1. Nation must have prestige >= DOMINANT_PRESTIGE_FLOOR.
 *   2. Nation must have prestige >= topPrestige × DOMINANT_COMPARABILITY_BAND.
 *   3. If no nation crosses the floor, the result is an empty set.
 */
export function computeDominantNations(prestigeByNation: Map<string, number>): Set<string> {
  const dominant = new Set<string>();
  if (prestigeByNation.size === 0) return dominant;

  const topPrestige = Math.max(...prestigeByNation.values());
  if (topPrestige < DOMINANT_PRESTIGE_FLOOR) return dominant; // nobody qualifies

  const bandThreshold = topPrestige * DOMINANT_COMPARABILITY_BAND;
  for (const [nationId, score] of prestigeByNation) {
    if (score >= DOMINANT_PRESTIGE_FLOOR && score >= bandThreshold) {
      dominant.add(nationId);
    }
  }
  return dominant;
}
