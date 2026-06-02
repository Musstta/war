/**
 * Doctrine system — Phase 6 Prompt 2.
 *
 * Doctrine derivation from cultural traits and action scoring for AI nations.
 * Doctrine blends are assigned once at AI nation creation and never drift.
 *
 * All weights are [PLACEHOLDER]. Tune via harness once AI behavior data exists.
 * Pure functions only — no I/O, no mutation.
 */
import type { DoctrineBlend, ValueTraits } from './types';

// ── AI efficiency penalty ─────────────────────────────────────────────────────

/**
 * Effective army/production multiplier for AI nations vs human nations.
 * Compensates for AI predictability — a slight handicap keeps humans competitive.
 * [PLACEHOLDER]
 */
export const AI_EFFICIENCY_PENALTY = 0.7;

// ── Doctrine derivation weights ───────────────────────────────────────────────
// Each doctrine component is driven by one or more cultural trait signals.
// Signal thresholds: a trait value > 0.3 is "high positive"; < -0.3 is "high negative".
// [PLACEHOLDER] All weights below.

/** Threshold above which a trait is considered "high" for doctrine derivation. [PLACEHOLDER] */
const TRAIT_HIGH_THRESHOLD = 0.3;

/** Minimum doctrine component weight before normalization. Prevents any doctrine from reaching 0. [PLACEHOLDER] */
const DOCTRINE_MIN_WEIGHT = 0.05;

/**
 * Derive an AI nation's doctrine blend from its capital territory's cultural traits.
 *
 * Rules (additive, pre-normalization weights):
 *   expansionist doctrine: +0.5 if expansionist trait > 0.3, +0.2 if militaristic > 0.3
 *   merchant doctrine:     +0.5 if individualist > 0.3, +0.2 if progressive > 0.3
 *   industrialist doctrine:+0.4 if individualist > 0.3, +0.3 if progressive > 0.3
 *   militarist doctrine:   +0.6 if militaristic > 0.3, +0.3 if expansionist > 0.3
 *   isolationist doctrine: +0.6 if expansionist < -0.3 (isolationist pole), +0.3 if militaristic < -0.3
 *
 * Default base for each: 0.1 (so no doctrine ever reaches exactly 0 before normalization).
 * Sum is normalized to 1 after all signals are applied.
 *
 * [PLACEHOLDER] All weights.
 */
export function deriveDoctrineBlend(traits: ValueTraits): DoctrineBlend {
  let exp   = DOCTRINE_MIN_WEIGHT;
  let merch = DOCTRINE_MIN_WEIGHT;
  let ind   = DOCTRINE_MIN_WEIGHT;
  let mil   = DOCTRINE_MIN_WEIGHT;
  let iso   = DOCTRINE_MIN_WEIGHT;

  if (traits.expansionist > TRAIT_HIGH_THRESHOLD)   { exp  += 0.5; mil += 0.2; } // [PLACEHOLDER]
  if (traits.individualist > TRAIT_HIGH_THRESHOLD)  { merch += 0.5; ind += 0.4; } // [PLACEHOLDER]
  if (traits.progressive > TRAIT_HIGH_THRESHOLD)    { merch += 0.2; ind += 0.3; } // [PLACEHOLDER]
  if (traits.militaristic > TRAIT_HIGH_THRESHOLD)   { mil += 0.6; exp += 0.2; }  // [PLACEHOLDER]
  if (traits.expansionist < -TRAIT_HIGH_THRESHOLD)  { iso += 0.6; }              // [PLACEHOLDER]
  if (traits.militaristic < -TRAIT_HIGH_THRESHOLD)  { iso += 0.3; }              // [PLACEHOLDER]

  const total = exp + merch + ind + mil + iso;
  return {
    expansionist:  exp  / total,
    merchant:      merch / total,
    industrialist: ind  / total,
    militarist:    mil  / total,
    isolationist:  iso  / total,
  };
}

/** Balanced fallback doctrine (0.2 each) when no cultural trait signal is available. */
export const BALANCED_DOCTRINE: DoctrineBlend = {
  expansionist:  0.2,
  merchant:      0.2,
  industrialist: 0.2,
  militarist:    0.2,
  isolationist:  0.2,
};

// ── Action scoring ────────────────────────────────────────────────────────────
// Returns a score 0–1 for each candidate action given the nation's doctrine.
// Higher score = higher priority for this action. [PLACEHOLDER all weights]

export interface AiActionCandidate {
  type: 'build_road' | 'build_port' | 'build_fort' | 'expand_claim' | 'propose_treaty' | 'propose_trade';
  /** Extra context used in scoring (e.g. highestOwnedUnrest). */
  context?: Record<string, unknown>;
}

export function scoreAction(
  action: AiActionCandidate,
  doctrine: DoctrineBlend,
): number {
  const { expansionist: exp, merchant: merch, industrialist: ind, militarist: mil, isolationist: iso } = doctrine;

  switch (action.type) {
    case 'build_road': {
      const highUnrest = ((action.context?.highestOwnedUnrest as number) ?? 0) > 0.5;
      return 0.3 + ind * 0.4 + (highUnrest ? 0.3 : 0); // [PLACEHOLDER]
    }
    case 'build_port':
      return 0.2 + merch * 0.5 + ind * 0.2; // [PLACEHOLDER]

    case 'build_fort':
      return 0.2 + mil * 0.4 + iso * 0.3; // [PLACEHOLDER]

    case 'expand_claim':
      return 0.3 + exp * 0.6; // [PLACEHOLDER]

    case 'propose_treaty':
      return 0.2 + iso * 0.3 + merch * 0.2; // [PLACEHOLDER]

    case 'propose_trade':
      return 0.1 + merch * 0.6; // [PLACEHOLDER]

    default:
      return 0;
  }
}

// ── Offensive war scoring ─────────────────────────────────────────────────────
// [STUB — offensive war: activate after harness validation]
// Scored but fully gated — see OFFENSIVE_WAR_GATE.

/** [PLACEHOLDER] Score threshold above which an AI would consider starting a war. */
export const OFFENSIVE_WAR_THRESHOLD = 0.6; // [PLACEHOLDER]

/**
 * Score an offensive war against a target. [STUB — never fires in v1]
 * Only heavily militarist+expansionist AIs cross the 0.6 threshold,
 * and only against weak low-Trust targets.
 */
export function scoreOffensiveWar(doctrine: DoctrineBlend): number {
  return doctrine.militarist * 0.5 + doctrine.expansionist * 0.3; // [PLACEHOLDER]
}

// [STUB GATE] — offensive war disabled until harness validation confirms it
// doesn't destabilize the game. Remove this export gate to activate.
export const OFFENSIVE_WAR_GATE = false;
