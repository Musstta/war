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

/**
 * General insolvency unrest pressure applied to all territories when wealthStock < 0,
 * even outside war. Separate from WAR_INSOLVENCY_UNREST_PER_TICK (which is war-gated).
 * Surfaces as a named component in UnrestCauses for legibility. [PLACEHOLDER]
 */
export const INSOLVENCY_GENERAL_UNREST_PER_TICK = 0.02;

// ── Trade → unrest and drift (2.1) ───────────────────────────────────────────

/**
 * Unrest equilibrium reduction per active trade clause flowing through a territory.
 * Negative — reduces equilibrium. [PLACEHOLDER]
 */
export const TRADE_STABILITY_BONUS = 0.02;

/**
 * Drift rate multiplier for territories on an active trade route's computedPath.
 * Applied to CULTURE_DRIFT_RATE this tick. [PLACEHOLDER]
 */
export const TRADE_DRIFT_MULTIPLIER = 1.3;

// ── Cultural constraint axes (2.2) ───────────────────────────────────────────

/** Active treaty count above which isolationist territories experience entanglement pressure. [PLACEHOLDER] */
export const ISOLATIONIST_TREATY_THRESHOLD = 3;

/** Unrest per treaty above threshold for isolationist > 0.3 territories. [PLACEHOLDER] */
export const ISOLATIONIST_ENTANGLEMENT_WEIGHT = 0.015;

/** Ticks without territorial acquisition before expansionist stagnation pressure fires. [PLACEHOLDER] */
export const EXPANSIONIST_GROWTH_WINDOW = 10;

/** Flat unrest for expansionist > 0.3 territories when no growth in EXPANSIONIST_GROWTH_WINDOW. [PLACEHOLDER] */
export const EXPANSIONIST_STAGNATION_WEIGHT = 0.02;

/** Unrest for collectivist (individualist < −0.3) territories with no tribute/solidarity receiver obligations. [PLACEHOLDER] */
export const COLLECTIVIST_ISOLATION_WEIGHT = 0.015;

/** Unrest per tribute obligation as payer for individualist > 0.3 territories. [PLACEHOLDER] */
export const INDIVIDUALIST_OBLIGATION_WEIGHT = 0.02;

/** Drift rate threshold above which traditional (progressive < −0.3) territories experience erosion pressure. [PLACEHOLDER] */
export const TRADITIONAL_EROSION_THRESHOLD = 0.05;

/** Unrest for traditional territories whose drift rate this tick exceeds TRADITIONAL_EROSION_THRESHOLD. [PLACEHOLDER] */
export const TRADITIONAL_EROSION_WEIGHT = 0.025;

/** Drift rate threshold below which progressive > 0.3 territories experience stagnation pressure. [PLACEHOLDER] */
export const PROGRESSIVE_STAGNATION_THRESHOLD = 0.01;

/** Unrest for progressive territories whose drift rate this tick is below PROGRESSIVE_STAGNATION_THRESHOLD. [PLACEHOLDER] */
export const PROGRESSIVE_STAGNATION_WEIGHT = 0.015;

// ── Population transfer shock (§1.2) ─────────────────────────────────────────

/**
 * Unrest equilibrium spike applied to all territories of both sender and receiver
 * when a population_transfer clause executes.
 * Formula: (1 − compatibilityScore) × POPULATION_TRANSFER_UNREST_SCALE added as
 * named `populationTransferShock` component for POPULATION_TRANSFER_SHOCK_DURATION ticks.
 * [PLACEHOLDER]
 */
export const POPULATION_TRANSFER_UNREST_SCALE = 0.15; // [PLACEHOLDER]

/** How many ticks the population_transfer_shock component persists. [PLACEHOLDER] */
export const POPULATION_TRANSFER_SHOCK_DURATION = 5; // [PLACEHOLDER]

/** How many ticks cultural drift accelerates toward transferred population's family after a transfer. [PLACEHOLDER] */
export const POPULATION_TRANSFER_DRIFT_DURATION = 8; // [PLACEHOLDER]

// ── Embassy system (§1.6) ────────────────────────────────────────────────────

/**
 * Flat bonus added to compatibility total when the embassy-owning nation has an active
 * embassy in the territory being evaluated. Does not change culture traits. [PLACEHOLDER]
 */
export const EMBASSY_COMPAT_BONUS = 0.10;

/**
 * Passive Trust recovery bonus per tick between the embassy-owning nation and the host
 * nation while the embassy is active. Added on top of normal passive recovery. [PLACEHOLDER]
 */
export const EMBASSY_TRUST_RECOVERY_PER_TICK = 0.2;

/**
 * Ticks required to build an embassy once construction begins. [PLACEHOLDER]
 */
export const EMBASSY_BUILD_TICKS = 3;

/**
 * Trust penalty applied when a host nation expels an embassy. [PLACEHOLDER]
 */
export const EMBASSY_EXPEL_TRUST_PENALTY = 10;

// ── Territory cession clause (§1.5) ──────────────────────────────────────────

/**
 * Ticks after transferAtTick during which the cession waits for a missing embassy.
 * If no embassy appears within this window, the clause breaches. [PLACEHOLDER]
 */
export const CESSION_EMBASSY_GRACE_TICKS = 3; // [PLACEHOLDER]

/**
 * Minimum ticks in the future that transferAtTick must be from treaty signing.
 * Gives the receiver time to build an embassy. [PLACEHOLDER]
 */
export const CESSION_MIN_FUTURE_TICKS = 3; // [PLACEHOLDER]

// ── Roads → cultural drift rate (2.4) ────────────────────────────────────────

/**
 * Drift rate multiplier when territory has a road.
 * Applied to CULTURE_DRIFT_RATE before computing this tick's drift.
 * Roads connect territories to the cultural core, accelerating integration. [PLACEHOLDER]
 */
export const ROAD_DRIFT_MULTIPLIER = 1.25;

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
  treatyCulturalClash = 0,
  militaryBonus = 0,                // negative = happier; activated by War sub-phase for Militaristic territories
  insolvencyPressure = 0,           // general insolvency pressure (wealthStock < 0, any context)
  tradeStability = 0,               // negative — active trade routes flowing through this territory [PLACEHOLDER]
  isolationistEntanglement = 0,     // isolationist territory with too many treaties [PLACEHOLDER]
  expansionistStagnation = 0,       // expansionist territory with no territorial growth [PLACEHOLDER]
  collectivistIsolation = 0,        // collectivist territory with no solidarity obligations [PLACEHOLDER]
  individualistObligation = 0,      // individualist territory burdened by tribute obligations [PLACEHOLDER]
  traditionalErosion = 0,           // traditional territory experiencing high cultural drift [PLACEHOLDER]
  progressiveStagnation = 0,        // progressive territory with stagnant cultural drift [PLACEHOLDER]
  populationTransferShock = 0,      // temporary spike from population transfer event [PLACEHOLDER]
  tradeRouteStability = 0,          // negative — grown trade route flowing to/through this territory [PLACEHOLDER]
  tradeRouteLossSpike = 0,          // temporary positive spike when a grown route is severed [PLACEHOLDER]
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

  const equilibrium = Math.max(0, Math.min(1,
    base + compatibilityPressure + distancePressure + infrastructureBonus +
    overexpansionPressure + ownershipShock + recentConquestPressure + militaryBonus +
    treatyCulturalClash + insolvencyPressure + tradeStability +
    isolationistEntanglement + expansionistStagnation + collectivistIsolation +
    individualistObligation + traditionalErosion + progressiveStagnation +
    populationTransferShock + tradeRouteStability + tradeRouteLossSpike,
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
    treatyCulturalClash,
    insolvencyPressure,
    tradeStability,
    isolationistEntanglement,
    expansionistStagnation,
    collectivistIsolation,
    individualistObligation,
    traditionalErosion,
    progressiveStagnation,
    populationTransferShock,
    tradeRouteStability,
    tradeRouteLossSpike,
    equilibrium,
  };
}

/**
 * Computes the effective ownership-shock decay rate for this tick.
 * Infrastructure investment is the gate — without it, shock does not decay at all.
 * Cultural compatibility and structural stability amplify decay when infra is present,
 * but cannot substitute for it. Design intent: player action is causal to integration.
 * [PLACEHOLDER weights]
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

  // Zero infrastructure → zero decay. No amount of cultural compatibility heals a
  // neglected territory; building any single structure unlocks compat-driven recovery.
  if (infraScore === 0) return 0;

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
 * driftMultiplier: optional stacked multiplier (2.1 trade route × 2.4 road).
 * Default 1.0 (no multiplier). [PLACEHOLDER callsite]
 *
 * Returns a new ValueTraits object; does not mutate the input.
 */
export function applyDrift(
  traits: ValueTraits,
  nationCulture: NationCulture,
  unrest: number,
  rng: RNG,
  driftMultiplier = 1.0, // [PLACEHOLDER callsite: TRADE_DRIFT_MULTIPLIER × ROAD_DRIFT_MULTIPLIER from tick.ts]
): ValueTraits {
  const effectiveDrift = CULTURE_DRIFT_RATE * Math.max(0, 1 - unrest) * driftMultiplier;
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
