/**
 * Diplomatic value engine — Phase 6.5, Prompt 4.
 * Systems-backlog §1.8.
 *
 * Pure functions. No I/O, no DB calls.
 * All formula constants are [PLACEHOLDER] — the function shapes matter more than exact values.
 *
 * computeClauseWealthValue:   reference Wealth equivalent of a clause to both parties.
 * computeClauseDiplomaticWeight: strategic/reputational importance classification.
 * computeMinCollateral:       minimum collateral floor from net value differential.
 */
import type { TreatyClause, WorldState, ClauseType } from './types';
import { totalArmySize } from './war';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Fraction of net Wealth value differential used as minimum collateral floor. [PLACEHOLDER] */
export const COLLATERAL_FLOOR_RATE = 0.20; // [PLACEHOLDER]

/** Maintain_peace bonus fraction when diplomatic value is low. [PLACEHOLDER] */
export const MAINTAIN_PEACE_LOW_VALUE_TRUST_FRACTION = 0.25; // [PLACEHOLDER]

/** Maximum consecutive maintain_peace treaties between same partners within the window. [PLACEHOLDER] */
export const MAINTAIN_PEACE_MAX_CONSECUTIVE = 2; // [PLACEHOLDER]

/** Ticks window for consecutive maintain_peace limit. [PLACEHOLDER] */
export const MAINTAIN_PEACE_CONSECUTIVE_WINDOW = 20; // [PLACEHOLDER]

// ── Wealth value per clause type ──────────────────────────────────────────────

/**
 * Computes a reference Wealth value for a single clause from the perspective of
 * the requesting nation. Positive = valuable to that nation; negative = costly.
 *
 * These are reference points for the proposal UI, not game-mechanical values.
 * All formulas are [PLACEHOLDER] — principled shapes, not tuned numbers.
 */
export function computeClauseWealthValue(
  clause: Pick<TreatyClause, 'type' | 'payload'>,
  world: WorldState,
  viewingNationId: string,
): number {
  const payload = clause.payload as Record<string, unknown>;

  switch (clause.type as ClauseType) {

    case 'non_aggression': {
      // Value scales with relative army sizes — more valuable when you're the weaker party.
      const viewerArmy = totalArmySize(world.armies, viewingNationId);
      const otherNations = Object.keys(world.nations).filter((id) => id !== viewingNationId);
      const largestOtherArmy = otherNations.reduce(
        (max, id) => Math.max(max, totalArmySize(world.armies, id)), 0,
      );
      const armyRatio = largestOtherArmy > 0 ? viewerArmy / largestOtherArmy : 1;
      // Weaker party benefits more. [PLACEHOLDER formula]
      const baseValue = 5; // [PLACEHOLDER]
      return baseValue * (1 + Math.max(0, 1 - armyRatio)); // [PLACEHOLDER]
    }

    case 'defense_pact': {
      // Similar to non_aggression but higher base — stronger mutual commitment.
      const viewerArmy = totalArmySize(world.armies, viewingNationId);
      const otherNations = Object.keys(world.nations).filter((id) => id !== viewingNationId);
      const avgOtherArmy = otherNations.length > 0
        ? otherNations.reduce((s, id) => s + totalArmySize(world.armies, id), 0) / otherNations.length
        : viewerArmy;
      const relativeWeakness = avgOtherArmy > 0 ? Math.max(0, avgOtherArmy - viewerArmy) / avgOtherArmy : 0;
      return 10 * (1 + relativeWeakness); // [PLACEHOLDER]
    }

    case 'tribute': {
      const amount = typeof payload['amount'] === 'number' ? payload['amount'] : 0;
      const fromNationId = payload['fromNationId'] as string | undefined;
      // Per-tick value × remaining ticks (caller provides term context).
      // Simple: face value in Wealth/tick.
      if (fromNationId === viewingNationId) return -amount; // payer: negative
      return amount; // receiver: positive
    }

    case 'trade': {
      const amount = typeof payload['amount'] === 'number' ? payload['amount'] : 0;
      const fromNationId = payload['fromNationId'] as string | undefined;
      const resource = payload['resource'] as string | undefined;
      // Trade is bilateral benefit — both parties gain from exchange.
      // Rough heuristic: face value adjusted by resource scarcity. [PLACEHOLDER]
      const scarcityMult = resource === 'population' ? 1.1 : resource === 'industry' ? 1.05 : 1.0; // [PLACEHOLDER]
      if (fromNationId === viewingNationId) return -amount * scarcityMult; // sender cost
      return amount * scarcityMult; // receiver gain
    }

    case 'military_access': {
      // Value of military access: strategic importance of the corridor.
      // Proxy: how many territories the other party owns (more = wider network = more value).
      const otherPartyId = Object.keys(world.nations).find((id) => id !== viewingNationId);
      const otherTerritoryCount = otherPartyId
        ? Object.values(world.territories).filter((t) => t.state.ownerId === otherPartyId).length
        : 0;
      return 3 * Math.max(1, otherTerritoryCount); // [PLACEHOLDER]
    }

    case 'territory_cession': {
      const toNationId = payload['toNationId'] as string | undefined;
      const territoryId = payload['territoryId'] as string | undefined;
      const terr = territoryId ? world.territories[territoryId] : undefined;
      if (!terr) return 0;
      // Rough value: sum of base production rates + infrastructure score. [PLACEHOLDER]
      const infraScore = (terr.state.hasRoad ? 2 : 0) + (terr.state.hasPort ? 3 : 0) + terr.state.fortificationLevel;
      const productionValue = (terr.def.baseWealth + terr.def.baseIndustry * 0.5 + terr.def.basePopulation * 0.3) * 3; // [PLACEHOLDER: 3 tick equivalent]
      const totalValue = productionValue + infraScore * 5; // [PLACEHOLDER]
      if (toNationId === viewingNationId) return totalValue; // receiver
      return -totalValue; // ceder
    }

    case 'army_lending': {
      const armySize = typeof payload['armySize'] === 'number' ? payload['armySize'] : 0;
      const loanDurationTicks = typeof payload['loanDurationTicks'] === 'number' ? payload['loanDurationTicks'] : 1;
      const lendingNationId = payload['lendingNationId'] as string | undefined;
      // Value = army × duration × upkeep cost per soldier. [PLACEHOLDER]
      const upkeepPerSoldier = 0.05; // mirrors UPKEEP_PER_SOLDIER [PLACEHOLDER]
      const totalCost = armySize * loanDurationTicks * upkeepPerSoldier;
      if (lendingNationId === viewingNationId) return -totalCost; // lender: losing army temporarily
      return totalCost * 1.2; // receiver: borrowed firepower is worth more than raw upkeep [PLACEHOLDER]
    }

    case 'population_transfer': {
      const amount = typeof payload['amount'] === 'number' ? payload['amount'] : 0;
      const fromNationId = payload['fromNationId'] as string | undefined;
      // Population is worth approximately 1 Wealth/unit in productivity. [PLACEHOLDER]
      if (fromNationId === viewingNationId) return -amount; // sender
      return amount * 0.8; // receiver: compat penalty reduces effective value [PLACEHOLDER]
    }

    case 'outpost': {
      // Visibility grants have strategic rather than Wealth value.
      // Proxy: 3 Wealth for sentry, 6 Wealth for outpost. [PLACEHOLDER]
      const type = payload['type'] as string | undefined;
      const grantedToNationId = payload['grantedToNationId'] as string | undefined;
      const baseVis = type === 'outpost' ? 6 : 3; // [PLACEHOLDER]
      if (grantedToNationId === viewingNationId) return baseVis; // grantee
      return -baseVis; // granter
    }

    case 'objective': {
      // Objective clauses have value = implied collateral risk. Heuristic: 0 (neutral). [PLACEHOLDER]
      return 0;
    }

    default:
      return 0;
  }
}

// ── Diplomatic weight ─────────────────────────────────────────────────────────

/**
 * Classifies the diplomatic/strategic importance of a clause.
 * 'critical' > 'high' > 'medium' > 'low'.
 * Not a Wealth value — reflects Trust and reputational stakes.
 * All thresholds [PLACEHOLDER].
 */
export function computeClauseDiplomaticWeight(
  clause: Pick<TreatyClause, 'type' | 'payload'>,
  world: WorldState,
  viewingNationId: string,
): 'low' | 'medium' | 'high' | 'critical' {
  const wealthValue = Math.abs(computeClauseWealthValue(clause, world, viewingNationId));

  switch (clause.type as ClauseType) {
    case 'defense_pact':
      return 'critical';
    case 'territory_cession':
      return wealthValue > 30 ? 'critical' : 'high'; // [PLACEHOLDER threshold]
    case 'army_lending':
      return wealthValue > 20 ? 'high' : 'medium'; // [PLACEHOLDER threshold]
    case 'non_aggression':
      return wealthValue > 10 ? 'high' : 'medium'; // [PLACEHOLDER threshold]
    case 'tribute':
      return wealthValue > 15 ? 'high' : wealthValue > 5 ? 'medium' : 'low'; // [PLACEHOLDER thresholds]
    case 'trade':
      return wealthValue > 10 ? 'medium' : 'low'; // [PLACEHOLDER threshold]
    case 'military_access':
      return 'medium';
    case 'population_transfer':
      return wealthValue > 10 ? 'high' : 'medium'; // [PLACEHOLDER threshold]
    case 'outpost':
      return 'low';
    case 'objective':
      return 'low';
    default:
      return 'low';
  }
}

// ── Minimum collateral ────────────────────────────────────────────────────────

/**
 * Computes the minimum collateral that should be deposited for a proposed treaty.
 * Derived from the net Wealth value differential between the parties.
 * minCollateral = |valueToProposer - valueToTarget| × COLLATERAL_FLOOR_RATE
 *
 * The result is the total pool minimum — each party's share is split proportionally
 * to their net value received. [PLACEHOLDER formula]
 */
export function computeMinCollateral(
  clauses: Array<Pick<TreatyClause, 'type' | 'payload'>>,
  world: WorldState,
  proposerNationId: string,
  targetNationId: string,
): { minTotal: number; proposerShare: number; targetShare: number } {
  let proposerValue = 0;
  let targetValue = 0;

  for (const clause of clauses) {
    proposerValue += computeClauseWealthValue(clause, world, proposerNationId);
    targetValue += computeClauseWealthValue(clause, world, targetNationId);
  }

  const netDiff = Math.abs(proposerValue - targetValue);
  const minTotal = Math.max(0, netDiff * COLLATERAL_FLOOR_RATE); // [PLACEHOLDER callsite: COLLATERAL_FLOOR_RATE]

  // Split: party receiving less value deposits more collateral (they have less skin in the game).
  const proposerShare = proposerValue < targetValue ? minTotal * 0.6 : minTotal * 0.4; // [PLACEHOLDER split]
  const targetShare = minTotal - proposerShare;

  return { minTotal, proposerShare, targetShare };
}

// ── Maintain_peace diplomatic value scaling ───────────────────────────────────

/**
 * Determines if a maintain_peace clause has meaningful diplomatic value.
 * Low-value = nations that are genuinely peaceful with no conflict context.
 * Returns the Trust bonus multiplier (1.0 = full, 0.25 = low-value minimum).
 * [PLACEHOLDER formula]
 */
export function maintainPeaceTrustMultiplier(
  proposerNationId: string,
  targetNationId: string,
  world: WorldState,
): number {
  // Proxy for "genuine conflict context": have armies nearby, or prior skirmishes.
  const proposerArmy = totalArmySize(world.armies, proposerNationId);
  const targetArmy = totalArmySize(world.armies, targetNationId);
  const hasRecentSkirmish = world.borderSkirmishes.some(
    (s) => (s.nationAId === proposerNationId && s.nationBId === targetNationId) ||
            (s.nationAId === targetNationId && s.nationBId === proposerNationId),
  );

  // Low-value: no armies and no prior skirmish = peace treaty between pacifists.
  if (!hasRecentSkirmish && proposerArmy === 0 && targetArmy === 0) {
    return MAINTAIN_PEACE_LOW_VALUE_TRUST_FRACTION; // [PLACEHOLDER callsite]
  }
  return 1.0; // full value
}
