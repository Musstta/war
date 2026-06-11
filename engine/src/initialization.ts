/**
 * Territory initialization pipeline — Phase 6.5, Prompt 2.
 *
 * Derives principled starting traits, population, and production modifiers
 * for a territory from its cultural family and geography type. Used at world
 * initialization; does NOT run during tick resolution.
 *
 * All numeric constants are tagged [PLACEHOLDER]. Tune via the harness after
 * the Phase 7 territory set is authored. Do not hand-tune. (design doc §17)
 *
 * Pure function — no I/O, no side effects.
 */
import type { CulturalFamily, Geography, ValueTraits } from './types';

// ── §3.1 Cultural family → starting trait offsets ────────────────────────────
// From systems-backlog.md §3.1 (Hofstede-derived starting points).
// Each entry maps family → { individualist, progressive, militaristic, expansionist } offsets.
// All [PLACEHOLDER].

const FAMILY_TRAIT_OFFSETS: Record<CulturalFamily, ValueTraits> = {
  latin:        { individualist: -0.3, progressive: -0.1, militaristic: -0.1, expansionist:  0.1 }, // [PLACEHOLDER]
  european:     { individualist: -0.2, progressive: -0.1, militaristic:  0.1, expansionist:  0.2 }, // [PLACEHOLDER]
  arab:         { individualist: -0.2, progressive: -0.5, militaristic:  0.1, expansionist:  0.0 }, // [PLACEHOLDER]
  slavic:       { individualist: -0.1, progressive: -0.2, militaristic:  0.2, expansionist:  0.1 }, // [PLACEHOLDER]
  east_asian:   { individualist: -0.5, progressive: -0.4, militaristic:  0.1, expansionist: -0.1 }, // [PLACEHOLDER]
  african:      { individualist: -0.3, progressive: -0.2, militaristic:  0.0, expansionist:  0.0 }, // [PLACEHOLDER]
  south_asian:  { individualist: -0.4, progressive: -0.3, militaristic:  0.0, expansionist:  0.0 }, // [PLACEHOLDER]
  indigenous:   { individualist: -0.2, progressive: -0.4, militaristic: -0.2, expansionist: -0.3 }, // [PLACEHOLDER]
};

// ── §3.2 Geography → trait modifiers ─────────────────────────────────────────
// Applied on top of the family baseline.
// All [PLACEHOLDER].

const GEOGRAPHY_TRAIT_MODIFIERS: Record<Geography, ValueTraits> = {
  mountainous: { individualist:  0.0, progressive: -0.2, militaristic:  0.1, expansionist: -0.2 }, // [PLACEHOLDER]
  coastal:     { individualist: -0.1, progressive:  0.2, militaristic: -0.1, expansionist:  0.2 }, // [PLACEHOLDER]
  inland:      { individualist:  0.0, progressive:  0.0, militaristic:  0.0, expansionist:  0.0 }, // [PLACEHOLDER] — neutral baseline
  desert:      { individualist:  0.0, progressive: -0.3, militaristic:  0.2, expansionist:  0.0 }, // [PLACEHOLDER]
  forest:      { individualist:  0.0, progressive: -0.1, militaristic:  0.1, expansionist: -0.1 }, // [PLACEHOLDER]
};

/** Maximum random variance added to each trait axis from seeded RNG. [PLACEHOLDER] */
export const TRAIT_RNG_VARIANCE = 0.15; // [PLACEHOLDER]

// ── §3.3 Starting population ──────────────────────────────────────────────────
// Base population density by geography, then scaled by family multiplier.
// All [PLACEHOLDER].

const GEOGRAPHY_BASE_POPULATION: Record<Geography, number> = {
  coastal:     80, // [PLACEHOLDER]
  inland:      60, // [PLACEHOLDER]
  forest:      40, // [PLACEHOLDER]
  mountainous: 30, // [PLACEHOLDER]
  desert:      15, // [PLACEHOLDER]
};

const FAMILY_POPULATION_MULTIPLIER: Record<CulturalFamily, number> = {
  east_asian:  1.8, // [PLACEHOLDER]
  south_asian: 1.6, // [PLACEHOLDER]
  european:    1.1, // [PLACEHOLDER]
  latin:       1.0, // [PLACEHOLDER]
  arab:        0.9, // [PLACEHOLDER]
  african:     0.8, // [PLACEHOLDER]
  slavic:      0.7, // [PLACEHOLDER]
  indigenous:  0.6, // [PLACEHOLDER]
};

// ── §3.4 Cultural family → base economic productivity multipliers ─────────────
// Multipliers applied to the territory's base production rates.
// All [PLACEHOLDER].

export interface ProductionModifiers {
  /** Multiplier on baseWealth production. [PLACEHOLDER] */
  wealthMultiplier: number;
  /** Multiplier on baseIndustry production. [PLACEHOLDER] */
  industryMultiplier: number;
  /** Multiplier on basePopulation growth/production. [PLACEHOLDER] */
  populationMultiplier: number;
}

const FAMILY_PRODUCTION_MODIFIERS: Record<CulturalFamily, ProductionModifiers> = {
  latin:        { wealthMultiplier: 1.0, industryMultiplier: 0.9, populationMultiplier: 1.1 }, // [PLACEHOLDER]
  european:     { wealthMultiplier: 1.1, industryMultiplier: 1.2, populationMultiplier: 1.0 }, // [PLACEHOLDER]
  east_asian:   { wealthMultiplier: 1.1, industryMultiplier: 1.3, populationMultiplier: 1.2 }, // [PLACEHOLDER]
  arab:         { wealthMultiplier: 1.2, industryMultiplier: 0.8, populationMultiplier: 1.0 }, // [PLACEHOLDER]
  slavic:       { wealthMultiplier: 0.9, industryMultiplier: 1.1, populationMultiplier: 1.0 }, // [PLACEHOLDER]
  african:      { wealthMultiplier: 0.9, industryMultiplier: 0.8, populationMultiplier: 1.0 }, // [PLACEHOLDER]
  south_asian:  { wealthMultiplier: 1.0, industryMultiplier: 0.9, populationMultiplier: 1.1 }, // [PLACEHOLDER]
  indigenous:   { wealthMultiplier: 0.7, industryMultiplier: 0.8, populationMultiplier: 0.9 }, // [PLACEHOLDER]
};

// ── Deterministic seed helper ─────────────────────────────────────────────────

/**
 * Deterministic per-territory RNG seed derived from territory ID string.
 * Uses a simple djb2-style hash so the seed is stable across sessions
 * and requires no extra data file fields.
 */
export function deterministicSeed(territoryId: string): number {
  let hash = 5381;
  for (let i = 0; i < territoryId.length; i++) {
    hash = ((hash << 5) + hash) ^ territoryId.charCodeAt(i);
    hash = hash >>> 0; // coerce to unsigned 32-bit
  }
  return hash;
}

/**
 * Tiny seeded LCG (linear congruential generator) for the initialization pipeline.
 * Returns a value in [0, 1). Not cryptographic — determinism and portability only.
 * Used in place of tickRng so initialization doesn't share state with tick resolution.
 */
function lcgRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface DerivedTerritoryTraits {
  /** All four cultural axis values, clamped to [−1, 1]. */
  traits: ValueTraits;
  /** Starting population (integer, rounded). */
  startingPopulation: number;
  /** Production multipliers derived from cultural family. */
  productionModifiers: ProductionModifiers;
}

/**
 * Derives principled starting traits, population, and production modifiers
 * for a territory from its cultural family and geography type.
 *
 * Pipeline:
 *   1. Start with family offset (§3.1).
 *   2. Add geography modifier (§3.2).
 *   3. Add seeded RNG variance ±TRAIT_RNG_VARIANCE per axis.
 *   4. Clamp each axis to [−1, 1].
 *   5. startingPopulation = GEOGRAPHY_BASE_POPULATION × FAMILY_POPULATION_MULTIPLIER.
 *   6. productionModifiers = FAMILY_PRODUCTION_MODIFIERS[family].
 *
 * All table values [PLACEHOLDER] — see tuning-notes.md.
 */
export function deriveTerritoryTraits(
  culturalFamily: CulturalFamily,
  geographyType: Geography,
  rngSeed: number,
): DerivedTerritoryTraits {
  const rng = lcgRng(rngSeed);
  const familyOffset = FAMILY_TRAIT_OFFSETS[culturalFamily];
  const geoMod = GEOGRAPHY_TRAIT_MODIFIERS[geographyType];

  const axes: (keyof ValueTraits)[] = ['individualist', 'progressive', 'militaristic', 'expansionist'];
  const traits: ValueTraits = { individualist: 0, progressive: 0, militaristic: 0, expansionist: 0 };

  for (const axis of axes) {
    // family offset + geography modifier + seeded variance in [−TRAIT_RNG_VARIANCE, +TRAIT_RNG_VARIANCE]
    const variance = (rng() * 2 - 1) * TRAIT_RNG_VARIANCE; // [PLACEHOLDER callsite: TRAIT_RNG_VARIANCE]
    traits[axis] = Math.max(-1, Math.min(1,
      familyOffset[axis] + geoMod[axis] + variance,
    ));
  }

  const basePop = GEOGRAPHY_BASE_POPULATION[geographyType]; // [PLACEHOLDER callsite: GEOGRAPHY_BASE_POPULATION]
  const famMult = FAMILY_POPULATION_MULTIPLIER[culturalFamily]; // [PLACEHOLDER callsite: FAMILY_POPULATION_MULTIPLIER]
  const startingPopulation = Math.round(basePop * famMult);

  const productionModifiers = FAMILY_PRODUCTION_MODIFIERS[culturalFamily]; // [PLACEHOLDER callsite: FAMILY_PRODUCTION_MODIFIERS]

  return { traits, startingPopulation, productionModifiers };
}
