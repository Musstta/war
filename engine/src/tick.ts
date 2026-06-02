import { produce } from 'immer';
import type { WorldState, QueuedAction, ActionResult, Stockpiles } from './types';
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
import {
  TRUST_BASELINE,
  TRUST_BREAK_PENALTY,
  TRUST_RECOVERY_COOLDOWN,
  LOW_TRUST_FINE_PER_TREATY,
  DEGRADATION_REFUND_TICKS,
  PROPOSAL_EXPIRY_TICKS,
  applyPassiveTrustRecovery,
  computeTributeTransfers,
  computeTreatyCulturalClash,
  getActiveClausesForNation,
  isTreatyOperational,
  trustCompletionBonus,
  objectiveMeetBonus,
  responsibleNationIds,
  hasRoadConnectionToTerritory,
} from './diplomacy';
import type { ObjectiveClause } from './types';
import {
  TRADE_MISSED_PAYMENT_BREACH_THRESHOLD,
  resourceToNationStockpileField,
} from './trade';

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
 * Immer's produce() handles all state cloning. Direct mutations inside the
 * producer replace manual spread cloning throughout. actionResults lives outside
 * the draft — it is a return value, not world state.
 */
export function resolveTick(
  world: WorldState,
  actions: QueuedAction[],
): { world: WorldState; actionResults: ActionResult[] } {
  const rng = tickRng(world.rngSeed, world.tick);
  const actionResults: ActionResult[] = [];

  const discard = (action: QueuedAction, reason: string): void => {
    actionResults.push({ nationId: action.nationId, type: action.type, payload: action.payload, status: 'discarded', reason });
  };
  const apply = (action: QueuedAction): void => {
    actionResults.push({ nationId: action.nationId, type: action.type, payload: action.payload, status: 'applied' });
  };

  const nextWorld = produce(world, (draft) => {
    // ── Actions ───────────────────────────────────────────────────────────────
    for (const action of actions) {
      switch (action.type) {
        case 'build_road': {
          const { territoryId } = action.payload as { territoryId: string };
          const t = draft.territories[territoryId];
          if (!t) { discard(action, 'territory not found'); break; }
          if (t.state.ownerId !== action.nationId) { discard(action, 'not owner'); break; }
          if (t.state.constructionType !== null) { discard(action, 'construction slot occupied'); break; }
          if (t.state.hasRoad) { discard(action, 'already has road'); break; }
          t.state.hasRoad = true;
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `${world.nations[action.nationId]?.name ?? action.nationId} built a road in ${t.def.name}.`,
          });
          apply(action);
          break;
        }

        case 'build_port': {
          const { territoryId } = action.payload as { territoryId: string };
          const t = draft.territories[territoryId];
          const nation = draft.nations[action.nationId];
          if (!t || !nation) { discard(action, 'territory or nation not found'); break; }
          if (t.state.ownerId !== action.nationId) { discard(action, 'not owner'); break; }
          if (!t.def.isCoastal) { discard(action, 'territory not coastal'); break; }
          if (t.state.hasPort) { discard(action, 'already has port'); break; }
          if (t.state.constructionType !== null) { discard(action, 'construction slot occupied'); break; }
          const portIndustryCost = BUILD_INDUSTRY['port']!;
          if (nation.stockpiles.industry < portIndustryCost) { discard(action, `insufficient industry (need ${portIndustryCost})`); break; }
          nation.stockpiles.industry -= portIndustryCost;
          t.state.constructionType = 'port';
          t.state.constructionTicksLeft = BUILD_TICKS['port']!;
          draft.eventLog.push({ tick: world.tick + 1, message: `${nation.name} began port construction in ${t.def.name}.` });
          apply(action);
          break;
        }

        case 'build_fort': {
          const { territoryId, targetLevel } = action.payload as { territoryId: string; targetLevel: 1 | 2 | 3 };
          const t = draft.territories[territoryId];
          const nation = draft.nations[action.nationId];
          if (!t || !nation) { discard(action, 'territory or nation not found'); break; }
          if (t.state.ownerId !== action.nationId) { discard(action, 'not owner'); break; }
          if (t.state.fortificationLevel !== targetLevel - 1) { discard(action, `fort level mismatch (have ${t.state.fortificationLevel}, need ${targetLevel - 1})`); break; }
          if (t.state.constructionType !== null) { discard(action, 'construction slot occupied'); break; }
          const constructionType = `fort_l${targetLevel}` as 'fort_l1' | 'fort_l2' | 'fort_l3';
          const fortIndustryCost = BUILD_INDUSTRY[constructionType]!;
          if (nation.stockpiles.industry < fortIndustryCost) { discard(action, `insufficient industry (need ${fortIndustryCost})`); break; }
          nation.stockpiles.industry -= fortIndustryCost;
          t.state.constructionType = constructionType;
          t.state.constructionTicksLeft = BUILD_TICKS[constructionType]!;
          draft.eventLog.push({ tick: world.tick + 1, message: `${nation.name} began fortification L${targetLevel} construction in ${t.def.name}.` });
          apply(action);
          break;
        }

        case 'instant_trade': {
          // Proposer queued this; resource already pre-deducted from source territory.
          // We register the pending trade in world state so the recipient can see it.
          // Actual transfer fires in the instant-trade resolution block below when accepted.
          // (No engine mutation needed here — the InstantTrade object is already in world.instantTrades
          //  via the server loader. This case just prevents the 'unknown action type' discard.)
          apply(action);
          break;
        }

        case 'accept_instant_trade': {
          const { tradeId } = action.payload as { tradeId: number };
          const trade = draft.instantTrades.find((t) => t.id === tradeId);
          if (!trade) { discard(action, 'instant trade not found'); break; }
          if (trade.targetNationId !== action.nationId) { discard(action, 'not the target of this trade'); break; }
          if (trade.status !== 'pending') { discard(action, `trade is already ${trade.status}`); break; }

          const destNation = draft.nations[trade.targetNationId];
          if (!destNation) { discard(action, 'dest nation missing'); break; }

          // Resource was pre-deducted from proposer's nation general stockpile at queue time.
          // Transfer to dest nation's general stockpile.
          const field = resourceToNationStockpileField(trade.resource);
          destNation.stockpiles[field] += trade.amount;
          trade.status = 'accepted';

          const srcNationName = draft.nations[trade.proposerNationId]?.name ?? trade.proposerNationId;
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `${srcNationName} traded ${trade.amount} ${trade.resource} to ${destNation.name}.`,
          });
          apply(action);
          break;
        }

        case 'decline_instant_trade': {
          const { tradeId } = action.payload as { tradeId: number };
          const trade = draft.instantTrades.find((t) => t.id === tradeId);
          if (!trade) { discard(action, 'instant trade not found'); break; }
          if (trade.targetNationId !== action.nationId) { discard(action, 'not the target of this trade'); break; }
          if (trade.status !== 'pending') { discard(action, `trade is already ${trade.status}`); break; }

          // Refund pre-deducted resource to proposer's nation general stockpile.
          const proposerNation = draft.nations[trade.proposerNationId];
          if (proposerNation) {
            const nf = resourceToNationStockpileField(trade.resource);
            proposerNation.stockpiles[nf] += trade.amount;
          }
          trade.status = 'declined';
          apply(action);
          break;
        }

        default:
          discard(action, `unknown action type: ${action.type}`);
          break;
      }
    }

    // ── Instant trade expiry ──────────────────────────────────────────────────
    for (const trade of draft.instantTrades) {
      if (trade.status !== 'pending') continue;
      if (world.tick < trade.expiresAtTick) continue;
      // Expired — refund pre-deducted resource to proposer's nation general stockpile.
      const proposerNation = draft.nations[trade.proposerNationId];
      if (proposerNation) {
        const nf = resourceToNationStockpileField(trade.resource);
        proposerNation.stockpiles[nf] += trade.amount;
      }
      trade.status = 'expired';
    }

    // ── Construction progression ──────────────────────────────────────────────
    for (const t of Object.values(draft.territories)) {
      if (t.state.constructionType === null || t.state.constructionTicksLeft === null) continue;
      t.state.constructionTicksLeft -= 1;
      if (t.state.constructionTicksLeft > 0) continue;

      // Construction complete — capture both completed type and pending before clearing.
      const completedType = t.state.constructionType;
      const pending = t.state.pendingConstructionType;
      t.state.constructionType = null;
      t.state.constructionTicksLeft = null;
      t.state.pendingConstructionType = null;

      const ownerName = t.state.ownerId ? (draft.nations[t.state.ownerId]?.name ?? t.state.ownerId) : 'Unknown';
      if (completedType === 'port') {
        t.state.hasPort = true;
        draft.eventLog.push({ tick: world.tick + 1, message: `${ownerName} completed a port in ${t.def.name}.` });
      } else {
        t.state.fortificationLevel += 1;
        draft.eventLog.push({
          tick: world.tick + 1,
          message: `${ownerName} completed fortification level ${t.state.fortificationLevel} in ${t.def.name}.`,
        });
      }

      // Start queued pending build immediately.
      // Mandate + industry were deducted at queue time; just start the work here.
      if (pending === 'road') {
        t.state.hasRoad = true;
        draft.eventLog.push({ tick: world.tick + 1, message: `${ownerName} completed a queued road in ${t.def.name}.` });
      } else if (pending) {
        t.state.constructionType = pending;
        t.state.constructionTicksLeft = BUILD_TICKS[pending]!;
        draft.eventLog.push({ tick: world.tick + 1, message: `${ownerName} started queued ${pending} construction in ${t.def.name}.` });
      }
    }

    // ── Diplomacy ─────────────────────────────────────────────────────────────

    // 1. Expire pending proposals whose window has closed.
    for (const proposal of draft.proposals) {
      if (proposal.status === 'pending' && world.tick >= proposal.expiresAtTick) {
        proposal.status = 'expired';
        draft.eventLog.push({
          tick: world.tick + 1,
          message: `A treaty proposal from ${draft.nations[proposal.proposerId]?.name ?? proposal.proposerId} to ${draft.nations[proposal.targetId]?.name ?? proposal.targetId} has expired.`,
        });
      }
    }

    // 2. Process active/degraded treaties: tribute, term countdown, collateral refunds.
    const treatiesToExpire: number[] = [];
    for (const treaty of draft.treaties) {
      if (!isTreatyOperational(treaty)) continue;

      // Tribute transfers fire every tick.
      const transfers = computeTributeTransfers(treaty);
      for (const { fromId, toId, amount } of transfers) {
        const from = draft.nations[fromId];
        const to = draft.nations[toId];
        if (!from || !to) continue;
        const actual = Math.min(amount, from.stockpiles.wealth);
        from.stockpiles.wealth -= actual;
        to.stockpiles.wealth += actual;
      }

      // Trade clause flows: deduct from source territory's local stockpile → add to recipient nation.
      for (const clause of treaty.clauses) {
        if (clause.type !== 'trade') continue;
        if (clause.clauseStatus !== 'active') continue;

        const { resource, amount, fromNationId, toNationId, sourceTerritoryId } = clause.payload as {
          resource: string; amount: number; fromNationId: string; toNationId: string; sourceTerritoryId: string;
        };

        const sourceTerr = draft.territories[sourceTerritoryId];
        const fromNation = draft.nations[fromNationId];
        const toNation = draft.nations[toNationId];
        if (!sourceTerr || !fromNation || !toNation) {
          clause.missedPayments += 1;
          draft.eventLog.push({ tick: world.tick + 1, message: `Trade clause missed_payment: treaty #${treaty.id} clause ${clause.clauseIndex} — source territory or nation missing.` });
        } else if (sourceTerr.state.ownerId !== fromNationId) {
          // Source territory changed owner — clause degrades (not a Trust hit).
          clause.clauseStatus = 'degraded';
          draft.eventLog.push({ tick: world.tick + 1, message: `Trade clause degraded: treaty #${treaty.id} clause ${clause.clauseIndex} — ${sourceTerritoryId} no longer owned by sender.` });
        } else {
          // Draw from the sending nation's general stockpile.
          // (Source territory identifies the trade route origin, not a separate pool.)
          const nf = resourceToNationStockpileField(resource as import('./types').TradeResource);
          const available = fromNation.stockpiles[nf];
          if (available < amount) {
            // Insufficient stockpile — missed payment.
            clause.missedPayments += 1;
            draft.eventLog.push({ tick: world.tick + 1, message: `Trade clause missed_payment: treaty #${treaty.id} clause ${clause.clauseIndex} — insufficient ${resource} (have ${available.toFixed(1)}, need ${amount}).` });
            if (clause.missedPayments >= TRADE_MISSED_PAYMENT_BREACH_THRESHOLD) {
              // Breach: same consequence as voluntary break.
              clause.clauseStatus = 'breached';
              fromNation.trust = Math.max(0, fromNation.trust - TRUST_BREAK_PENALTY);
              fromNation.lastBrokenPromiseTick = world.tick;
              draft.eventLog.push({ tick: world.tick + 1, message: `Trade clause breached: treaty #${treaty.id} clause ${clause.clauseIndex} — ${clause.missedPayments} consecutive missed payments. Trust penalty applied.` });
            }
          } else {
            // Successful transfer.
            fromNation.stockpiles[nf] -= amount;
            toNation.stockpiles[nf] += amount;
            clause.missedPayments = 0; // reset on success
          }
        }
      }

      // Degradation refund: return active-partner collateral over DEGRADATION_REFUND_TICKS.
      for (const partyId of treaty.partyIds) {
        const remaining = treaty.refundRemainingByParty[partyId] ?? 0;
        if (remaining <= 0) continue;
        const startTick = treaty.refundStartTickByParty[partyId] ?? world.tick;
        const ticksElapsed = world.tick - startTick + 1;
        if (ticksElapsed <= DEGRADATION_REFUND_TICKS) {
          const portion = remaining / (DEGRADATION_REFUND_TICKS - ticksElapsed + 1);
          const nation = draft.nations[partyId];
          if (nation) nation.stockpiles.wealth += portion;
          treaty.refundRemainingByParty[partyId] = Math.max(0, remaining - portion);
        }
      }

      // Objective clause evaluation — runs each tick for pending objectives.
      // Build adjacency map once per treaty iteration (reused from the unrest section below).
      // We use the draft territories here because construction may have completed earlier this tick.
      const objAdjacency: Record<string, readonly string[]> = Object.fromEntries(
        Object.entries(draft.territories).map(([k, v]) => [k, v.def.adjacentIds]),
      );

      let allObjectivesMet = true;
      for (const clause of treaty.clauses) {
        if (clause.type !== 'objective') continue;
        const obj = clause.objective;
        if (!obj) continue;
        if (obj.status !== 'pending') { if (obj.status !== 'met' && obj.status !== 'waived') allObjectivesMet = false; continue; }

        const deadlineAbsolute = treaty.tickStarted + obj.deadlineTicks;
        const responsibleIds = responsibleNationIds(treaty, obj.responsibleParty);

        // ── Evaluation by objectiveType ───────────────────────────────────────
        let met = false;

        if (obj.objectiveType === 'build_port') {
          // Responsible party must own targetTerritoryId and it must have a port.
          const targetTerr = obj.targetTerritoryId ? draft.territories[obj.targetTerritoryId] : null;
          if (targetTerr && targetTerr.state.hasPort &&
              targetTerr.state.ownerId !== null &&
              responsibleIds.includes(targetTerr.state.ownerId)) {
            met = true;
          }

        } else if (obj.objectiveType === 'build_road_connection') {
          // Responsible party must have a road connecting targetTerritoryId to
          // any territory owned by the other party.
          const otherPartyId = responsibleIds.length === 1
            ? treaty.partyIds.find((id) => id !== responsibleIds[0])
            : null;
          if (otherPartyId && obj.targetTerritoryId) {
            // Check: responsible party's road network reaches targetTerritoryId,
            // AND targetTerritoryId is adjacent to (or owned by) the other party.
            // Per spec: responsible party has a road connecting targetTerritoryId
            // to any territory owned by the other party.
            for (const respId of responsibleIds) {
              if (hasRoadConnectionToTerritory(respId, obj.targetTerritoryId, draft.territories as WorldState['territories'], objAdjacency)) {
                // Also verify the target territory is adjacent to an other-party territory.
                const targetTerrAdjIds = objAdjacency[obj.targetTerritoryId] ?? [];
                const otherPartyOwns = (tid: string) => draft.territories[tid]?.state.ownerId === otherPartyId;
                if (otherPartyOwns(obj.targetTerritoryId) || targetTerrAdjIds.some(otherPartyOwns)) {
                  met = true;
                  break;
                }
              }
            }
          }

        } else if (obj.objectiveType === 'maintain_peace') {
          // maintain_peace is breached immediately on an attack; it cannot be
          // evaluated as "met" until the treaty ends cleanly. For now it stays
          // pending until treaty expiry — at that point the auto-complete path
          // below awards the bonus. No per-tick evaluation needed here.
          met = false; // not yet; handled by treaty expiry

        } else {
          // [STUB] joint_invasion and attack_player — data present, inert.
          // No tick evaluation. Stays pending until deadline.
          allObjectivesMet = false;
          continue;
        }

        if (met) {
          obj.status = 'met';
          const bonus = objectiveMeetBonus(treaty);
          for (const partyId of treaty.partyIds) {
            const nation = draft.nations[partyId];
            if (nation) nation.trust = Math.min(100, nation.trust + bonus);
          }
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `Objective met: treaty #${treaty.id} clause ${clause.clauseIndex} (${obj.objectiveType}). Trust bonus applied.`,
          });
        } else if (world.tick + 1 > deadlineAbsolute) {
          // Deadline passed unmet — treat as voluntary break by responsible party.
          obj.status = 'failed';
          const breakPenalty = TRUST_BREAK_PENALTY;
          for (const respId of responsibleIds) {
            const nation = draft.nations[respId];
            if (nation) {
              nation.trust = Math.max(0, nation.trust - breakPenalty);
              nation.lastBrokenPromiseTick = world.tick;
            }
          }
          // Collateral: breaker's share → wronged party (same logic as treaty break).
          // Identify wronged parties as those not responsible.
          const wrongedIds = treaty.partyIds.filter((id) => !responsibleIds.includes(id));
          for (const respId of responsibleIds) {
            const breakerCollateral = treaty.collateralByParty[respId] ?? 0;
            if (breakerCollateral > 0) {
              for (const wrongedId of wrongedIds) {
                const wrongedNation = draft.nations[wrongedId];
                if (wrongedNation) wrongedNation.stockpiles.wealth += breakerCollateral;
              }
              treaty.collateralByParty[respId] = 0;
            }
          }
          allObjectivesMet = false;
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `Objective failed: treaty #${treaty.id} clause ${clause.clauseIndex} (${obj.objectiveType}) — deadline passed. Trust penalty applied to responsible party.`,
          });
        } else {
          allObjectivesMet = false;
        }
      }

      // Early auto-complete: all objective clauses met or waived before term ends.
      const hasObjectiveClauses = treaty.clauses.some((c) => c.type === 'objective');
      if (hasObjectiveClauses && allObjectivesMet && treaty.status !== 'expired') {
        // All objectives resolved — grant full Trust bonuses immediately.
        const bonus = trustCompletionBonus(treaty.termTicks);
        for (const partyId of treaty.partyIds) {
          const nation = draft.nations[partyId];
          if (!nation) continue;
          nation.trust = Math.min(100, nation.trust + bonus);
          const escrow = treaty.escrowAmountByParty[partyId] ?? 0;
          if (escrow > 0) {
            nation.stockpiles.wealth += escrow;
            treaty.escrowAmountByParty[partyId] = 0;
          }
        }
        treaty.status = 'expired';
        draft.eventLog.push({
          tick: world.tick + 1,
          message: `Treaty #${treaty.id} completed early — all objective clauses met. Full Trust bonuses granted.`,
        });
      }

      // Term countdown.
      if (world.tick + 1 >= treaty.tickEnds) {
        treatiesToExpire.push(treaty.id);
      }
    }

    // Expire treaties that have run their full term — grant Trust bonus to both parties.
    for (const treatyId of treatiesToExpire) {
      const treaty = draft.treaties.find((t) => t.id === treatyId);
      if (!treaty) continue;
      // Skip if already expired by the early-complete path above.
      if (treaty.status === 'expired') continue;

      // At natural expiry, mark pending maintain_peace objectives as met
      // (they persisted to term end without being breached).
      for (const clause of treaty.clauses) {
        if (clause.type !== 'objective' || !clause.objective) continue;
        if (clause.objective.objectiveType === 'maintain_peace' && clause.objective.status === 'pending') {
          clause.objective.status = 'met';
        }
      }

      treaty.status = 'expired';
      const bonus = trustCompletionBonus(treaty.termTicks);
      for (const partyId of treaty.partyIds) {
        const nation = draft.nations[partyId];
        if (!nation) continue;
        nation.trust = Math.min(100, nation.trust + bonus);
        // Return escrowed collateral (minus skim if applicable — skim handled on player return in server).
        // For natural expiry, just return any remaining escrow directly.
        const escrow = treaty.escrowAmountByParty[partyId] ?? 0;
        if (escrow > 0) {
          nation.stockpiles.wealth += escrow;
          treaty.escrowAmountByParty[partyId] = 0;
        }
      }
      draft.eventLog.push({
        tick: world.tick + 1,
        message: `Treaty #${treaty.id} between ${treaty.partyIds.map((id) => draft.nations[id]?.name ?? id).join(' and ')} has completed its term. Both parties gain Trust.`,
      });
    }

    // 3. Low-Trust fines: nations below baseline pay per active treaty per tick.
    const activeTreatyCountByNation: Record<string, number> = {};
    for (const treaty of draft.treaties) {
      if (!isTreatyOperational(treaty)) continue;
      for (const partyId of treaty.partyIds) {
        activeTreatyCountByNation[partyId] = (activeTreatyCountByNation[partyId] ?? 0) + 1;
      }
    }
    for (const nation of Object.values(draft.nations)) {
      if (nation.trust >= TRUST_BASELINE) continue;
      const count = activeTreatyCountByNation[nation.id] ?? 0;
      if (count === 0) continue;
      const fine = count * LOW_TRUST_FINE_PER_TREATY;
      nation.stockpiles.wealth = Math.max(0, nation.stockpiles.wealth - fine);
    }

    // 4. Passive Trust recovery toward baseline.
    for (const nation of Object.values(draft.nations)) {
      nation.trust = applyPassiveTrustRecovery(nation.trust, nation.lastBrokenPromiseTick, world.tick);
    }

    // 5. Build per-nation active clause summary for cultural-clash unrest.
    // Read from the original world.treaties so treaty state changes above don't feed back this tick.
    const nationActiveClauses: Record<string, ReturnType<typeof getActiveClausesForNation>> = {};
    for (const nationId of Object.keys(draft.nations)) {
      nationActiveClauses[nationId] = getActiveClausesForNation(nationId, world.treaties);
    }

    // ── Culture & Unrest ──────────────────────────────────────────────────────
    // Build adjacency map once for BFS distance lookups.
    const adjacency: Record<string, readonly string[]> = Object.fromEntries(
      Object.entries(draft.territories).map(([k, v]) => [k, v.def.adjacentIds]),
    );

    // Count territories per nation; compute smooth-decay rapid-expansion weights.
    const territoryCounts: Record<string, number> = {};
    const recentAcquisitionWeights: Record<string, number> = {};
    for (const t of Object.values(draft.territories)) {
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

    const nationCultures: Record<string, ReturnType<typeof computeNationCulture>> = {};
    for (const nationId of Object.keys(draft.nations)) {
      const cap = draft.nations[nationId]?.capitalTerritoryId ?? null;
      nationCultures[nationId] = computeNationCulture(nationId, draft.territories as WorldState['territories'], cap);
    }

    // Process each owned territory: decay shock, drift unrest, check revolt, apply cultural drift.
    for (const t of Object.values(draft.territories)) {
      const ownerId = t.state.ownerId;
      if (!ownerId) continue;

      const nationCulture = nationCultures[ownerId];
      if (!nationCulture) continue;

      const capital = draft.nations[ownerId]?.capitalTerritoryId ?? null;
      const hops = capital ? bfsDistance(adjacency, capital, t.def.id) : 0;
      const tcount = territoryCounts[ownerId] ?? 1;
      const recentWeight = recentAcquisitionWeights[ownerId] ?? 0;

      // Cultural-clash unrest from active treaty clauses.
      const clauseSummary = nationActiveClauses[ownerId];
      const clashPressure = clauseSummary
        ? computeTreatyCulturalClash(t.state.valueTraits, clauseSummary.clauseTypes, clauseSummary.termsByClause)
        : 0;

      const compat = computeCompatibility(t.state.valueTraits, t.def.culturalFamily, nationCulture);
      const causes = computeUnrestEquilibrium(
        compat, hops,
        t.state.hasRoad, t.state.hasPort, t.state.fortificationLevel,
        tcount, t.state.ownershipShock, recentWeight, clashPressure,
      );

      // Decay ownership shock at a rate gated by integration progress.
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
        draft.eventLog.push({
          tick: world.tick + 1,
          message: `${t.def.name} has risen in revolt against ${draft.nations[ownerId]?.name ?? ownerId}!`,
        });
      } else if (t.state.isInRevolt && t.state.unrest < REVOLT_THRESHOLD - REVOLT_HYSTERESIS) {
        t.state.isInRevolt = false;
        draft.eventLog.push({
          tick: world.tick + 1,
          message: `The revolt in ${t.def.name} has been suppressed.`,
        });
      }

      // Cultural drift: high unrest slows assimilation.
      t.state.valueTraits = applyDrift(t.state.valueTraits, nationCulture, t.state.unrest, rng);
    }

    // ── Production + local stockpile → nation general stockpile ──────────────
    // Each territory produces into its own persistent local stockpile.
    // Trade flows (instant trades, treaty trade clauses) draw from local stockpiles during this tick.
    // The entire local stockpile flushes to the nation's general stockpile at end of tick —
    // whatever was not drawn by trade becomes general stockpile. Upkeep from general Wealth.
    for (const t of Object.values(draft.territories)) {
      const oid = t.state.ownerId;
      if (!oid || t.state.isInRevolt) continue;
      t.state.localPopStock += t.def.basePopulation;
      t.state.localIndStock += t.def.baseIndustry;
      t.state.localWltStock += t.def.baseWealth;
    }

    // Flush all remaining local stock to nation general stockpile.
    for (const t of Object.values(draft.territories)) {
      const oid = t.state.ownerId;
      if (!oid) continue;
      const nation = draft.nations[oid];
      if (!nation) continue;
      nation.stockpiles.population += t.state.localPopStock;
      nation.stockpiles.industry   += t.state.localIndStock;
      nation.stockpiles.wealth     += t.state.localWltStock;
      // Reset to zero — flush is complete. Production next tick refills.
      t.state.localPopStock = 0;
      t.state.localIndStock = 0;
      t.state.localWltStock = 0;
    }

    // Upkeep paid from nation general Wealth after flush.
    for (const nation of Object.values(draft.nations)) {
      const upkeep = nation.armySize * UPKEEP_PER_SOLDIER;
      nation.stockpiles.wealth = Math.max(0, nation.stockpiles.wealth - upkeep);
    }

    draft.tick += 1;
  });

  return { world: nextWorld, actionResults };
}
