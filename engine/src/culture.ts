/**
 * Cultural model — Phase 4 Culture & Unrest sub-phase.
 *
 * All numeric constants are tagged [PLACEHOLDER]. Do not tune by hand;
 * adjust via the simulation harness after accumulating enough tick data. (design doc §17)
 *
 * Pure functions only — no I/O, no mutation of arguments.
 */
import type { RNG } from './rng';
import type {
  CulturalFamily,
  NationCulture,
  CompatibilityBreakdown,
  UnrestCauses,
  Territory,
  ValueTraits,
} from './types';

// ── Unrest dynamics ───────────────────────────────────────────────────────────

/** Fraction of (equilibrium − unrest) gap closed per tick. [PLACEHOLDER] */
export const UNREST_DRIFT_RATE = 0.10;

/** Unrest at or above which a territory enters revolt. [PLACEHOLDER] */
export const REVOLT_THRESHOLD = 0.80;

/** Hysteresis: must drop this far below REVOLT_THRESHOLD to exit revolt. [PLACEHOLDER] */
export const REVOLT_HYSTERESIS = 0.05;

// ── Unrest equilibrium components ─────────────────────────────────────────────

/** Constant floor applied to every owned territory. [PLACEHOLDER] */
export const BASE_UNREST_FLOOR = 0.02;

/** Max unrest from full compatibility mismatch (compatibility=0). [PLACEHOLDER] */
export const COMPAT_UNREST_MAX = 0.55;

/** Unrest added per hop from capital, before saturation. [PLACEHOLDER] */
export const DISTANCE_UNREST_PER_HOP = 0.04;

/** Hop count at which distance pressure saturates (maps to maximum distance contribution). [PLACEHOLDER] */
export const MAX_CAPITAL_DISTANCE_HOPS = 6;

/** Nation territory count above which empire-size overexpansion pressure begins. [PLACEHOLDER] */
export const OVEREXPANSION_THRESHOLD = 3;

/** Unrest added per territory above the overexpansion threshold. [PLACEHOLDER] */
export const OVEREXPANSION_PER_TERRITORY = 0.03;

// ── Conquest shock (design doc §12.1) ────────────────────────────────────────

/**
 * Minimum shock applied even for a perfectly compatible conquest — annexation itself is jarring. [PLACEHOLDER]
 * Maximum shock applied for a fully incompatible conquest. [PLACEHOLDER]
 * Actual shock = CONQUEST_SHOCK_MIN + (MAX − MIN) × (1 − compat.total).
 */
export const CONQUEST_SHOCK_MIN = 0.20;
export const CONQUEST_SHOCK_MAX = 0.70;

/**
 * Computes the initial conquest shock scaled by cultural compatibility with the new owner.
 * Low compat → shock near MAX; high compat → shock near MIN.
 * Both bounds are [PLACEHOLDER] — tune once conquest data exists.
 */
export function computeConquestShock(compat: CompatibilityBreakdown): number {
  return CONQUEST_SHOCK_MIN + (CONQUEST_SHOCK_MAX - CONQUEST_SHOCK_MIN) * (1 - compat.total);
}

/**
 * Maximum fraction of shock that can decay per tick — only achieved with full integration
 * (road + port + fort, high compat, low structural unrest). Neglected territories approach 0.
 * Investment is causal to recovery; time alone does not heal. [PLACEHOLDER]
 */
export const CONQUEST_SHOCK_BASE_DECAY = 0.25;

/** Weight of infrastructure investment in the integration-progress score. [PLACEHOLDER] */
export const SHOCK_DECAY_INFRA_WEIGHT = 0.50;

/** Weight of structural stability (low non-shock equilibrium) in the integration-progress score. [PLACEHOLDER] */
export const SHOCK_DECAY_STABILITY_WEIGHT = 0.25;

/** Weight of cultural compatibility in the integration-progress score. [PLACEHOLDER] */
export const SHOCK_DECAY_COMPAT_WEIGHT = 0.25;

/**
 * Window (in ticks) over which a recently-acquired territory contributes to nation-wide
 * rapid-expansion pressure. Weight decays linearly from 1.0 at acquisition to 0.0 at window end.
 * Replaces the old hard 5-tick cliff. [PLACEHOLDER]
 */
export const RECENT_ACQUISITION_WINDOW = 12;

/** Unrest added per unit of rapid-expansion weight (summed across recently acquired territories). [PLACEHOLDER] */
export const RECENT_CONQUEST_PRESSURE_PER_TERRITORY = 0.06;

// ── Infrastructure investment ─────────────────────────────────────────────────
// Each built structure reduces the territory's unrest equilibrium.
// Roads = integration backbone (largest bonus); ports = economic link; forts = security presence.

/** Unrest reduction from a road. [PLACEHOLDER] */
export const ROAD_INFRA_CONTRIBUTION = 0.08;

/** Unrest reduction from a port. [PLACEHOLDER] */
export const PORT_INFRA_CONTRIBUTION = 0.04;

/** Unrest reduction per fortification level. [PLACEHOLDER] */
export const FORT_INFRA_CONTRIBUTION_PER_LEVEL = 0.02;

// ── Compatibility ─────────────────────────────────────────────────────────────

/**
 * Share of compatibility score contributed by value-axis alignment.
 * Family is the dominant lever — these must sum to 1. [PLACEHOLDER]
 */
export const COMPAT_AXIS_WEIGHT = 0.40;

/** Share contributed by cultural family closeness — deliberately larger than axis weight. [PLACEHOLDER] */
export const COMPAT_FAMILY_WEIGHT = 0.60;

// ── Cultural drift ────────────────────────────────────────────────────────────

/** Fraction of (nation_val − terr_val) gap closed per tick at zero unrest. [PLACEHOLDER] */
export const CULTURE_DRIFT_RATE = 0.02;

/** k in weight ≈ pop × (1 + k × normProd). [PLACEHOLDER] */
export const PRODUCTION_WEIGHT_K = 0.3;

/**
 * Extra culture weight applied to the capital territory.
 * The capital disproportionately shapes national identity — it drives culture
 * toward itself more strongly than other territories of the same size. [PLACEHOLDER]
 */
export const CAPITAL_CULTURE_WEIGHT_MULTIPLIER = 2.0;

/** When a trait value crosses zero, probability the cross is allowed vs. bounced back. [PLACEHOLDER] */
export const TRAIT_FLIP_PROB = 0.5;

// ── Family closeness ──────────────────────────────────────────────────────────
// 1.0 = same family (handled separately). 0.0 = maximum clash.
// Unlisted pairs default to 0.1. Table is symmetric; look up both orderings. [PLACEHOLDER]

const FAMILY_CLOSENESS_TABLE: Partial<Record<string, number>> = {
  'latin|european':    0.60,
  'latin|indigenous':  0.30,
  'latin|african':     0.40,
  'european|slavic':   0.70,
  'european|african':  0.25,
  'slavic|east_asian': 0.20,
  'arab|south_asian':  0.45,
  'east_asian|south_asian': 0.30,
  'indigenous|african': 0.25,
};

export function familyCloseness(a: CulturalFamily, b: CulturalFamily): number {
  if (a === b) return 1.0;
  return (
    FAMILY_CLOSENESS_TABLE[`${a}|${b}`] ??
    FAMILY_CLOSENESS_TABLE[`${b}|${a}`] ??
    0.10
  );
}

// ── BFS distance on territory adjacency graph ─────────────────────────────────

/**
 * Shortest-path hop count between two territories.
 * Returns MAX_CAPITAL_DISTANCE_HOPS when unreachable (e.g. disconnected graph).
 */
export function bfsDistance(
  adjacency: Record<string, readonly string[]>,
  fromId: string,
  toId: string,
): number {
  if (fromId === toId) return 0;
  const visited = new Set<string>();
  const queue: [string, number][] = [[fromId, 0]];
  while (queue.length) {
    const [id, dist] = queue.shift()!;
    if (id === toId) return dist;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const adj of adjacency[id] ?? []) {
      if (!visited.has(adj)) queue.push([adj, dist + 1]);
    }
  }
  return MAX_CAPITAL_DISTANCE_HOPS;
}

// ── Nation culture ────────────────────────────────────────────────────────────

const AXES: (keyof ValueTraits)[] = ['individualist', 'progressive', 'militaristic', 'expansionist'];

/**
 * Computes the emergent nation culture as the production-boosted population-weighted
 * average of all owned territory traits. Nation family = highest-weight family.
 */
export function computeNationCulture(
  nationId: string,
  territories: Record<string, Territory>,
  capitalTerritoryId?: string | null,
): NationCulture {
  // Find max production across ALL territories for normalization denominator.
  let maxProd = 0;
  for (const t of Object.values(territories)) {
    const prod = t.def.baseIndustry + t.def.baseWealth;
    if (prod > maxProd) maxProd = prod;
  }

  let totalWeight = 0;
  const sum: ValueTraits = { individualist: 0, progressive: 0, militaristic: 0, expansionist: 0 };
  const familyWeights: Partial<Record<CulturalFamily, number>> = {};

  for (const t of Object.values(territories)) {
    if (t.state.ownerId !== nationId) continue;
    const normProd = maxProd > 0 ? (t.def.baseIndustry + t.def.baseWealth) / maxProd : 0;
    const capitalMult = capitalTerritoryId && t.def.id === capitalTerritoryId ? CAPITAL_CULTURE_WEIGHT_MULTIPLIER : 1;
    const weight = t.def.basePopulation * (1 + PRODUCTION_WEIGHT_K * normProd) * capitalMult;
    totalWeight += weight;
    for (const axis of AXES) sum[axis] += weight * t.state.valueTraits[axis];
    const fam = t.def.culturalFamily;
    familyWeights[fam] = (familyWeights[fam] ?? 0) + weight;
  }

  if (totalWeight === 0) {
    return { individualist: 0, progressive: 0, militaristic: 0, expansionist: 0, primaryFamily: null, familyWeights: {} };
  }

  const avg: ValueTraits = { individualist: 0, progressive: 0, militaristic: 0, expansionist: 0 };
  for (const axis of AXES) avg[axis] = sum[axis] / totalWeight;

  let primaryFamily: CulturalFamily | null = null;
  let maxFw = 0;
  const normalizedFw: Partial<Record<CulturalFamily, number>> = {};
  for (const [fam, w] of Object.entries(familyWeights) as [CulturalFamily, number][]) {
    normalizedFw[fam] = w / totalWeight;
    if (w > maxFw) { maxFw = w; primaryFamily = fam; }
  }

  return { ...avg, primaryFamily, familyWeights: normalizedFw };
}

// ── Compatibility ─────────────────────────────────────────────────────────────

/**
 * Measures how well a territory's culture aligns with its owner nation's culture.
 * Returns a breakdown with named per-axis gaps and a family closeness score.
 * `total` is 1.0 for a perfect match, approaching 0 for maximum mismatch.
 */
export function computeCompatibility(
  terrTraits: ValueTraits,
  terrFamily: CulturalFamily,
  nationCulture: NationCulture,
): CompatibilityBreakdown {
  const axisGaps: Record<keyof ValueTraits, number> = {
    individualist: 0, progressive: 0, militaristic: 0, expansionist: 0,
  };
  let totalAxisScore = 0;
  for (const axis of AXES) {
    // Gap in [-1, +1] space: max distance is 2.0, normalize to [0, 1].
    const gap = Math.abs(terrTraits[axis] - nationCulture[axis]) / 2.0;
    axisGaps[axis] = gap;
    totalAxisScore += (1 - gap);
  }
  const axisScore = totalAxisScore / 4;

  const famCloseness = nationCulture.primaryFamily
    ? familyCloseness(terrFamily, nationCulture.primaryFamily)
    : 0.5;

  const total = COMPAT_AXIS_WEIGHT * axisScore + COMPAT_FAMILY_WEIGHT * famCloseness;

  return {
    individualistGap: axisGaps.individualist,
    progressiveGap: axisGaps.progressive,
    militaristicGap: axisGaps.militaristic,
    expansionistGap: axisGaps.expansionist,
    familyCloseness: famCloseness,
    total,
  };
}

// ── Unrest equilibrium ────────────────────────────────────────────────────────

/**
 * Computes all named contributors to a territory's unrest equilibrium.
 * The territory drifts its unrest value toward `equilibrium` each tick.
 *
 * All numeric constants are [PLACEHOLDER] — tune via simulation harness (design doc §17).
 */
export function computeUnrestEquilibrium(
  compatibility: CompatibilityBreakdown,
  distanceHops: number,
  hasRoad: boolean,
  hasPort: boolean,
  fortificationLevel: number,
  nationTerritoryCount: number,
  ownershipShock: number,
  recentAcquisitionCount: number,
): UnrestCauses {
  const base = BASE_UNREST_FLOOR;

  const compatibilityPressure = (1 - compatibility.total) * COMPAT_UNREST_MAX;

  const normalizedDist = Math.min(distanceHops / MAX_CAPITAL_DISTANCE_HOPS, 1.0);
  const distancePressure = normalizedDist * (DISTANCE_UNREST_PER_HOP * MAX_CAPITAL_DISTANCE_HOPS);

  // Infrastructure investment: more built structures = lower equilibrium.
  const infraScore = (hasRoad ? ROAD_INFRA_CONTRIBUTION : 0)
    + (hasPort ? PORT_INFRA_CONTRIBUTION : 0)
    + (fortificationLevel * FORT_INFRA_CONTRIBUTION_PER_LEVEL);
  const infrastructureBonus = -infraScore; // negative = reduces equilibrium

  const overCount = Math.max(0, nationTerritoryCount - OVEREXPANSION_THRESHOLD);
  const overexpansionPressure = overCount * OVEREXPANSION_PER_TERRITORY;

  // Nation-wide pressure from rapid expansion — affects every territory the nation owns.
  const recentConquestPressure = recentAcquisitionCount * RECENT_CONQUEST_PRESSURE_PER_TERRITORY;

  const militaryBonus = 0; // [STUB] no troop mechanics yet

  const equilibrium = Math.max(0, Math.min(1,
    base + compatibilityPressure + distancePressure + infrastructureBonus +
    overexpansionPressure + ownershipShock + recentConquestPressure + militaryBonus,
  ));

  return {
    base,
    compatibilityPressure,
    distancePressure,
    infrastructureBonus,
    overexpansionPressure,
    ownershipShock,
    recentConquestPressure,
    militaryBonus,
    equilibrium,
  };
}

/**
 * Computes the effective ownership-shock decay rate for this tick.
 * Scales with integration progress — infrastructure, structural stability, and cultural
 * alignment all contribute. Neglected territory → near 0%/tick; fully integrated → up to
 * CONQUEST_SHOCK_BASE_DECAY per tick. Time alone does not heal. [PLACEHOLDER weights]
 */
export function computeShockDecayRate(
  hasRoad: boolean,
  hasPort: boolean,
  fortificationLevel: number,
  compat: CompatibilityBreakdown,
  causes: UnrestCauses,
): number {
  const infraRaw = (hasRoad ? ROAD_INFRA_CONTRIBUTION : 0)
    + (hasPort ? PORT_INFRA_CONTRIBUTION : 0)
    + (fortificationLevel * FORT_INFRA_CONTRIBUTION_PER_LEVEL);
  const infraMax = ROAD_INFRA_CONTRIBUTION + PORT_INFRA_CONTRIBUTION + 3 * FORT_INFRA_CONTRIBUTION_PER_LEVEL;
  const infraScore = infraRaw / infraMax;

  // Structural equilibrium excluding the shock — measures underlying trouble.
  const structuralEq = Math.max(0, causes.equilibrium - causes.ownershipShock);
  const stabilityScore = Math.max(0, 1 - structuralEq * 3);

  const integrationProgress =
    infraScore * SHOCK_DECAY_INFRA_WEIGHT +
    stabilityScore * SHOCK_DECAY_STABILITY_WEIGHT +
    compat.total * SHOCK_DECAY_COMPAT_WEIGHT;

  return CONQUEST_SHOCK_BASE_DECAY * integrationProgress;
}

// ── Cultural drift ────────────────────────────────────────────────────────────

/**
 * Drifts territory traits one step toward the nation's culture.
 * Drift rate scales inversely with unrest: content territory assimilates,
 * resentful territory resists. When an axis value would cross zero, a seeded
 * RNG roll decides whether the flip is allowed or the value bounces back.
 *
 * Returns a new ValueTraits object; does not mutate the input.
 */
export function applyDrift(
  traits: ValueTraits,
  nationCulture: NationCulture,
  unrest: number,
  rng: RNG,
): ValueTraits {
  const effectiveDrift = CULTURE_DRIFT_RATE * Math.max(0, 1 - unrest);
  const result = { ...traits };

  for (const axis of AXES) {
    const old = result[axis];
    const target = nationCulture[axis];
    const moved = old + effectiveDrift * (target - old);

    if (old !== 0 && moved !== 0 && Math.sign(old) !== Math.sign(moved)) {
      // Would cross zero — roll for flip
      if (rng() < TRAIT_FLIP_PROB) {
        result[axis] = moved;
      } else {
        result[axis] = Math.sign(old) * 0.01; // bounce back to near-zero on original side
      }
    } else {
      result[axis] = moved;
    }
  }

  return result;
}
