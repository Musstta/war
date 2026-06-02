/**
 * Diplomacy engine — Phase 4 Diplomacy sub-phase.
 *
 * All numeric constants are tagged [PLACEHOLDER]. Tune via harness once
 * enough diplomacy data exists. Do not tune by hand. (design doc §17)
 *
 * Pure functions only — no I/O, no mutation of arguments.
 */
import type { Treaty, Proposal, Nation, WorldState, ClauseType, TreatyClause, ObjectiveClause, ResponsibleParty } from './types';

// ── Trust constants ───────────────────────────────────────────────────────────

/** Trust scale: 0–100. Nations start at this baseline. */
export const TRUST_BASELINE = 50;

/** Trust loss on voluntarily breaking a treaty. [PLACEHOLDER] */
export const TRUST_BREAK_PENALTY = 20;

/**
 * Trust bonus on treaty completion, scaled by term with diminishing returns.
 * formula: min(termTicks × 0.5, 15). [PLACEHOLDER]
 */
export function trustCompletionBonus(termTicks: number): number {
  return Math.min(termTicks * 0.5, 15);
}

/**
 * Passive Trust recovery per tick toward TRUST_BASELINE.
 * Only applied when no broken-promise event in the last TRUST_RECOVERY_COOLDOWN ticks.
 * [PLACEHOLDER]
 */
export const TRUST_RECOVERY_PER_TICK = 0.5;

/**
 * Ticks after a broken-promise event during which passive recovery is suppressed. [PLACEHOLDER]
 */
export const TRUST_RECOVERY_COOLDOWN = 10;

/** Per-active-treaty Wealth fine per tick when Trust < TRUST_BASELINE. [PLACEHOLDER] */
export const LOW_TRUST_FINE_PER_TREATY = 1;

/** Minimum treaty term in ticks. Proposals below this are rejected. [PLACEHOLDER] */
export const MIN_TREATY_TERM = 3;

// ── Proposal expiry ───────────────────────────────────────────────────────────

/** Ticks a pending proposal stays open before auto-expiring. [PLACEHOLDER] */
export const PROPOSAL_EXPIRY_TICKS = 5;

// ── Mandate costs ─────────────────────────────────────────────────────────────

/** Mandate cost to propose a treaty (per-treaty, not per-clause). [PLACEHOLDER] */
export const PROPOSE_TREATY_COST = 1;

/** Mandate cost to accept a treaty. [PLACEHOLDER — 0.5 rounded to 1 for now] */
export const ACCEPT_TREATY_COST = 1;

// ── Treaty degradation constants ──────────────────────────────────────────────

/**
 * Ticks over which the active partner's collateral is refunded after degradation. [PLACEHOLDER]
 */
export const DEGRADATION_REFUND_TICKS = 3;

/** Fraction of escrowed collateral taken as skim when inactive player returns. [PLACEHOLDER] */
export const ESCROW_SKIM_RATE = 0.05;

// ── Cultural-clash unrest ─────────────────────────────────────────────────────

/**
 * Unrest added per clause type that culturally clashes with a territory's traits.
 * All [PLACEHOLDER] — tune once real diplomacy data exists.
 */
export const TREATY_CULTURAL_CLASH_WEIGHTS: Partial<Record<ClauseType, number>> = {
  non_aggression: 0.04,   // Militaristic territory dislikes non-aggression
  defense_pact:   0.03,   // Peaceful territory dislikes defense pact
  trade:          0.03,   // Isolationist territory dislikes trade (lights up when Trade ships)
  military_access: 0.03,  // Isolationist territory dislikes military access
};

// ── Clause type helpers ───────────────────────────────────────────────────────

/** Clause types the caretaker AI can honor — these continue unchanged during Dormant. */
const HONORABLE_DORMANT: Set<ClauseType> = new Set(['non_aggression', 'tribute', 'trade']);

/**
 * Returns the degraded version of a clause type when the nation goes Dormant.
 * defense_pact → effectively non_aggression (downgraded but not broken).
 * military_access → degraded (AI doesn't allow new movements).
 * Others → unchanged.
 */
export function degradedClauseType(type: ClauseType): ClauseType {
  if (type === 'defense_pact') return 'non_aggression';
  if (type === 'military_access') return 'non_aggression'; // closest honorable form
  return type;
}

/** Whether a treaty is functionally active (non-aggression is enforced, tribute fires). */
export function isTreatyOperational(treaty: Treaty): boolean {
  return treaty.status === 'active' || treaty.status === 'degraded';
}

// ── Cultural-clash computation ────────────────────────────────────────────────

/**
 * Computes the treaty_cultural_clash unrest contribution for a territory.
 *
 * A territory's traits interact with the *types* of active treaty clauses its
 * nation holds — not the specific partner. The result is a named unrest component
 * that the territory can see in its breakdown (legibility rule, design doc §7.2).
 *
 * Clash rules (v1):
 *   Militaristic (> 0.3) territory + any non_aggression clause  → pressure
 *   Peaceful (< -0.3) territory + any defense_pact clause       → pressure
 *   Isolationist (< -0.3) territory + trade or military_access  → pressure (lights up when downstream ships)
 *   Expansionist (> 0.3) territory + long-term non_aggression   → pressure (term > 10 ticks)
 */
export function computeTreatyCulturalClash(
  valueTraits: { militaristic: number; expansionist: number },
  activeClauses: ClauseType[],
  treatyTermsByClause: Map<ClauseType, number[]>,
): number {
  let pressure = 0;

  const clauseSet = new Set(activeClauses);

  // Militaristic territory + non_aggression
  if (valueTraits.militaristic > 0.3 && clauseSet.has('non_aggression')) {
    pressure += TREATY_CULTURAL_CLASH_WEIGHTS['non_aggression']!;
  }

  // Expansionist territory + long-term non_aggression (term > 10 ticks)
  if (valueTraits.expansionist > 0.3 && clauseSet.has('non_aggression')) {
    const terms = treatyTermsByClause.get('non_aggression') ?? [];
    if (terms.some((t) => t > 10)) {
      pressure += TREATY_CULTURAL_CLASH_WEIGHTS['non_aggression']! * 0.5;
    }
  }

  return pressure;
}

// ── Trust tick processing ─────────────────────────────────────────────────────

/**
 * Applies passive Trust recovery toward TRUST_BASELINE for one nation.
 * Recovery is suppressed for TRUST_RECOVERY_COOLDOWN ticks after a broken-promise event.
 * Returns the new Trust value (clamped 0–100). Does not mutate input.
 */
export function applyPassiveTrustRecovery(
  trust: number,
  lastBrokenPromiseTick: number | null,
  currentTick: number,
): number {
  if (trust === TRUST_BASELINE) return trust;
  // Suppress recovery if a broken-promise event happened recently.
  if (lastBrokenPromiseTick !== null && currentTick - lastBrokenPromiseTick < TRUST_RECOVERY_COOLDOWN) {
    return trust;
  }
  if (trust < TRUST_BASELINE) {
    return Math.min(TRUST_BASELINE, trust + TRUST_RECOVERY_PER_TICK);
  }
  return Math.max(TRUST_BASELINE, trust - TRUST_RECOVERY_PER_TICK);
}

// ── Tribute resolution ────────────────────────────────────────────────────────

/**
 * Returns the Wealth transfers that should fire this tick for tribute clauses
 * on an operational treaty. Each entry is { fromId, toId, amount }.
 */
export function computeTributeTransfers(
  treaty: Treaty,
): Array<{ fromId: string; toId: string; amount: number }> {
  if (!isTreatyOperational(treaty)) return [];
  const transfers: Array<{ fromId: string; toId: string; amount: number }> = [];
  for (const clause of treaty.clauses) {
    if (clause.type !== 'tribute') continue;
    const { fromNationId, toNationId, amount } = clause.payload as {
      fromNationId: string;
      toNationId: string;
      amount: number;
    };
    if (typeof fromNationId === 'string' && typeof toNationId === 'string' && typeof amount === 'number') {
      transfers.push({ fromId: fromNationId, toId: toNationId, amount });
    }
  }
  return transfers;
}

// ── Degradation helpers ───────────────────────────────────────────────────────

/**
 * Returns true if the given nation in this treaty is the one that went Dormant
 * (i.e., the inactive party that has collateral in escrow).
 */
export function isInactiveParty(treaty: Treaty, nationId: string): boolean {
  return (treaty.escrowAmountByParty[nationId] ?? 0) > 0;
}

// ── Non-aggression enforcement ────────────────────────────────────────────────

/**
 * Returns the set of nation-pair IDs that are bound by non-aggression this tick.
 * Used by the War sub-phase (not yet built) to gate attack actions.
 * Format: Set of sorted "nationA|nationB" strings.
 */
export function getNonAggressionPairs(treaties: Treaty[]): Set<string> {
  const pairs = new Set<string>();
  for (const treaty of treaties) {
    if (!isTreatyOperational(treaty)) continue;
    const hasNA = treaty.clauses.some((c) => c.type === 'non_aggression' || c.type === 'defense_pact');
    if (!hasNA) continue;
    const [a, b] = treaty.partyIds;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    pairs.add(key);
  }
  return pairs;
}

// ── Active clause summary for a nation ───────────────────────────────────────

/**
 * Returns all clause types active for a nation across all its operational treaties.
 * Also returns a map of clause type → list of treaty terms (for expansionist check).
 */
export function getActiveClausesForNation(
  nationId: string,
  treaties: Treaty[],
): { clauseTypes: ClauseType[]; termsByClause: Map<ClauseType, number[]> } {
  const clauseTypes: ClauseType[] = [];
  const termsByClause = new Map<ClauseType, number[]>();

  for (const treaty of treaties) {
    if (!isTreatyOperational(treaty)) continue;
    if (!treaty.partyIds.includes(nationId)) continue;
    for (const clause of treaty.clauses) {
      clauseTypes.push(clause.type);
      const existing = termsByClause.get(clause.type) ?? [];
      existing.push(treaty.termTicks);
      termsByClause.set(clause.type, existing);
    }
  }
  return { clauseTypes, termsByClause };
}

// ── Objective clause evaluation ───────────────────────────────────────────────

/**
 * Trust bonus applied when an objective clause is met.
 * [PLACEHOLDER] Full completion bonus for now; prorate later.
 */
export function objectiveMeetBonus(treaty: Treaty): number {
  return trustCompletionBonus(treaty.termTicks);
}

/**
 * Returns the nation IDs that are "responsible" for an objective clause
 * given the treaty's party ordering.
 *   partyA → treaty.partyIds[0]
 *   partyB → treaty.partyIds[1]
 *   both   → both
 */
export function responsibleNationIds(treaty: Treaty, responsibleParty: ResponsibleParty): string[] {
  if (responsibleParty === 'partyA') return [treaty.partyIds[0]];
  if (responsibleParty === 'partyB') return [treaty.partyIds[1]];
  return [treaty.partyIds[0], treaty.partyIds[1]];
}

/**
 * Called by the War sub-phase when an attack resolves against a nation.
 * Marks any pending maintain_peace objective clauses in shared treaties as failed
 * and applies Trust penalty to the attacker.
 *
 * Returns the list of treaties affected (for callers to persist).
 * [STUB INTEGRATION POINT] — call this from the attack-resolution path when War ships.
 */
export function breachMaintainPeaceObjectives(
  attackerNationId: string,
  defendingNationId: string,
  treaties: Treaty[],
): Array<{ treatyId: number; clauseIndex: number }> {
  const affected: Array<{ treatyId: number; clauseIndex: number }> = [];
  for (const treaty of treaties) {
    if (!isTreatyOperational(treaty)) continue;
    if (!treaty.partyIds.includes(attackerNationId)) continue;
    if (!treaty.partyIds.includes(defendingNationId)) continue;
    for (const clause of treaty.clauses) {
      if (clause.type !== 'objective' || !clause.objective) continue;
      if (clause.objective.objectiveType !== 'maintain_peace') continue;
      if (clause.objective.status !== 'pending') continue;
      clause.objective.status = 'failed';
      affected.push({ treatyId: treaty.id, clauseIndex: clause.clauseIndex });
    }
  }
  return affected;
}

/**
 * BFS from any territory owned by `nationId` to `targetTerritoryId` following
 * only road-connected edges. Returns true if a road path exists.
 *
 * A road path means every territory along the path (including the target) has
 * hasRoad === true. The source territory is owned by the responsible nation;
 * intermediate and target territories may be owned by anyone — only the hasRoad
 * flag matters (roads are permanent infrastructure, not gated by ownership).
 */
export function hasRoadConnectionToTerritory(
  nationId: string,
  targetTerritoryId: string,
  territories: WorldState['territories'],
  adjacency: Record<string, readonly string[]>,
): boolean {
  const targetTerritory = territories[targetTerritoryId];
  if (!targetTerritory) return false;
  if (!targetTerritory.state.hasRoad) return false;

  // Seed BFS with all road-having territories owned by nationId.
  const visited = new Set<string>();
  const queue: string[] = [];

  for (const [tid, t] of Object.entries(territories)) {
    if (t.state.ownerId === nationId && t.state.hasRoad) {
      queue.push(tid);
      visited.add(tid);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetTerritoryId) return true;
    for (const adjId of adjacency[current] ?? []) {
      if (visited.has(adjId)) continue;
      const adj = territories[adjId];
      if (!adj?.state.hasRoad) continue;
      visited.add(adjId);
      queue.push(adjId);
    }
  }
  return false;
}
