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
  breachMaintainPeaceObjectives,
} from './diplomacy';
import type { ObjectiveClause } from './types';
import {
  TRADE_MISSED_PAYMENT_BREACH_THRESHOLD,
  resourceToNationStockpileField,
} from './trade';
import {
  computeBattleStrengths,
  siegeTicksRequired,
  computeOverextensionPressure,
  areAtWar,
  WAR_INSOLVENCY_UNREST_PER_TICK,
  WAR_MILITARISTIC_HAPPINESS_BONUS,
  NO_CB_UNREST_SPIKE,
  NO_CB_SPIKE_DURATION,
  BATTLE_LOSER_LOSS_RATE,
  BATTLE_WINNER_LOSS_RATE,
  PEACE_PROPOSAL_LAPSE_TICKS,
  PEACE_DECLINE_EXHAUSTION_BUMP,
  PEACE_DECLINE_EXHAUSTION_TICKS,
  PEACE_TRUST_BONUS,
} from './war';
import type { PeaceDeal } from './types';

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

        case 'declare_war': {
          // War creation and validation happen at the server/action-handler level.
          // The engine breaches maintain_peace objectives here (tick resolution path)
          // so saveWorldState picks up the status change via the normal clause loop.
          const dwp = action.payload as { targetNationId: string };
          if (dwp?.targetNationId) {
            breachMaintainPeaceObjectives(action.nationId, dwp.targetNationId, draft.treaties as typeof world.treaties);
          }
          apply(action);
          break;
        }

        case 'attack_territory': {
          // Attack intent — resolved in the war section below after all actions are collected.
          // Just mark applied here; actual battle fires in the war resolution block.
          apply(action);
          break;
        }

        case 'retreat_army': {
          const { fromTerritoryId } = action.payload as { fromTerritoryId: string; toTerritoryId: string };
          // Find and reset any siege this nation is prosecuting on fromTerritoryId.
          for (const war of draft.wars) {
            if (war.status !== 'active') continue;
            if (war.attackerId !== action.nationId && war.defenderId !== action.nationId) continue;
            const occIdx = war.occupiedTerritories.findIndex(
              (o) => o.territoryId === fromTerritoryId && o.occupyingNationId === action.nationId,
            );
            if (occIdx !== -1) {
              // Remove from occupied list — siege progress resets to 0 by removal.
              war.occupiedTerritories.splice(occIdx, 1);
              const terrName = draft.territories[fromTerritoryId]?.def.name ?? fromTerritoryId;
              draft.eventLog.push({
                tick: world.tick + 1,
                message: `${draft.nations[action.nationId]?.name ?? action.nationId} retreated from ${terrName}. Siege progress lost.`,
              });
            }
          }
          apply(action);
          break;
        }

        case 'propose_peace': {
          // Validation at queue time; engine sets the pendingPeaceDeal and transitions status.
          // The deal is a pass-through — actual execution fires when accept_peace is queued.
          apply(action);
          break;
        }

        case 'accept_peace': {
          // Accept is a pass-through marker collected below in peace resolution.
          apply(action);
          break;
        }

        case 'decline_peace': {
          // Decline is a pass-through marker collected below in peace resolution.
          apply(action);
          break;
        }

        default:
          discard(action, `unknown action type: ${action.type}`);
          break;
      }
    }

    // ── War resolution ────────────────────────────────────────────────────────
    // Collect all attack_territory actions this tick, grouped by attacking nation.
    const attacksByNation: Record<string, string[]> = {};
    for (const action of actions) {
      if (action.type !== 'attack_territory') continue;
      const { targetTerritoryId } = action.payload as { targetTerritoryId: string };
      if (!attacksByNation[action.nationId]) attacksByNation[action.nationId] = [];
      attacksByNation[action.nationId].push(targetTerritoryId);
    }

    for (const war of draft.wars) {
      // Battle continues during peace_negotiation — both parties may still queue attacks.
      if (war.status !== 'active' && war.status !== 'peace_negotiation') continue;

      const attacker = draft.nations[war.attackerId];
      const defender = draft.nations[war.defenderId];
      if (!attacker || !defender) continue;

      // Process each attack queued this tick by either belligerent against the other.
      for (const [attackingNationId, targetIds] of Object.entries(attacksByNation)) {
        if (attackingNationId !== war.attackerId && attackingNationId !== war.defenderId) continue;
        const defendingNationId = attackingNationId === war.attackerId ? war.defenderId : war.attackerId;
        const attackingNation = draft.nations[attackingNationId];
        const defendingNation = draft.nations[defendingNationId];
        if (!attackingNation || !defendingNation) continue;

        for (const targetTerritoryId of targetIds) {
          const targetTerr = draft.territories[targetTerritoryId];
          if (!targetTerr) continue;

          // Verify the target is owned by or occupied by the defending nation.
          // (Validation at queue time also checks this; engine re-checks for safety.)
          const isDefenderOwned = targetTerr.state.ownerId === defendingNationId;
          const isDefenderOccupied = war.occupiedTerritories.some(
            (o) => o.territoryId === targetTerritoryId && o.occupyingNationId === defendingNationId,
          );
          if (!isDefenderOwned && !isDefenderOccupied) continue;

          // Check if attacker has a road in any adjacent owned territory (logistics bonus).
          const attackerHasRoad = (targetTerr.def.adjacentIds ?? []).some(
            (adjId) => draft.territories[adjId]?.state.ownerId === attackingNationId &&
                       draft.territories[adjId]?.state.hasRoad,
          );

          // Seeded RNG value for this battle (unique per war+territory+tick).
          const rngVal = rng();

          const { attackStrength, defendStrength } = computeBattleStrengths(
            attackingNation.armySize,
            defendingNation.armySize,
            targetTerr.state.fortificationLevel,
            targetTerr.def.geography,
            attackerHasRoad,
            rngVal,
          );

          const attackerWins = attackStrength > defendStrength;
          const terrName = targetTerr.def.name;
          const attackerName = attackingNation.name;
          const defenderName = defendingNation.name;

          // Check if this territory is already in occupied state for this war.
          const existingOccIdx = war.occupiedTerritories.findIndex(
            (o) => o.territoryId === targetTerritoryId && o.occupyingNationId === attackingNationId,
          );

          if (attackerWins) {
            // Attacker wins this battle tick.
            const lossFrac = BATTLE_LOSER_LOSS_RATE;
            const winFrac  = BATTLE_WINNER_LOSS_RATE;
            const defenderLosses = Math.max(1, Math.floor(defendingNation.armySize * lossFrac));
            const attackerLosses = Math.max(0, Math.floor(attackingNation.armySize * winFrac));
            defendingNation.armySize = Math.max(0, defendingNation.armySize - defenderLosses);
            attackingNation.armySize = Math.max(0, attackingNation.armySize - attackerLosses);

            if (existingOccIdx === -1) {
              // First successful attack — place in occupied state with siegeProgress 1.
              war.occupiedTerritories.push({
                territoryId: targetTerritoryId,
                occupyingNationId: attackingNationId,
                siegeProgress: 1,
                siegeStartTick: world.tick,
              });
              draft.eventLog.push({
                tick: world.tick + 1,
                message: `${attackerName} won a battle in ${terrName} (att ${attackStrength.toFixed(0)} vs def ${defendStrength.toFixed(0)}). Siege begun. Casualties: ${attackerName} −${attackerLosses}, ${defenderName} −${defenderLosses}.`,
              });
            } else {
              // Continuing siege — increment progress.
              const occ = war.occupiedTerritories[existingOccIdx]!;
              occ.siegeProgress += 1;
              const required = siegeTicksRequired(targetTerr.state.fortificationLevel);

              if (occ.siegeProgress >= required) {
                // Territory fully captured — transfer ownership.
                war.occupiedTerritories.splice(existingOccIdx, 1);
                targetTerr.state.ownerId = attackingNationId;
                targetTerr.state.acquiredTick = world.tick;
                // Conquest shock applied — reuse the same compat-scaled formula as admin set-owner.
                // Keep it simple here: set ownershipShock to CONQUEST_SHOCK_INITIAL placeholder.
                // The full compat-scaled version is computed in the server; engine uses a fixed value.
                targetTerr.state.ownershipShock = 0.50; // [PLACEHOLDER] see computeConquestShock
                draft.eventLog.push({
                  tick: world.tick + 1,
                  message: `${attackerName} captured ${terrName} from ${defenderName} after ${occ.siegeProgress} tick siege. Casualties: ${attackerName} −${attackerLosses}, ${defenderName} −${defenderLosses}.`,
                });
              } else {
                draft.eventLog.push({
                  tick: world.tick + 1,
                  message: `${attackerName} advanced siege of ${terrName} (progress ${occ.siegeProgress}/${required}). Casualties: ${attackerName} −${attackerLosses}, ${defenderName} −${defenderLosses}.`,
                });
              }
            }

            // ── Siege relief check ───────────────────────────────────────────
            // If the defending nation also attacked a territory this tick that the
            // attacker was besieging, and the defender wins, that siege is broken.
            // (Handled naturally: defender queues attack_territory on the besieged
            //  territory; if they win, the attacker's occupation entry is cleared above
            //  in the retreat_army branch — actually handled here explicitly.)

          } else {
            // Defender holds. Attacker takes losses.
            const attackerLosses = Math.max(0, Math.floor(attackingNation.armySize * BATTLE_WINNER_LOSS_RATE));
            attackingNation.armySize = Math.max(0, attackingNation.armySize - attackerLosses);

            // If this was a continuing siege, the failed attack resets progress (attacker driven off).
            if (existingOccIdx !== -1) {
              war.occupiedTerritories.splice(existingOccIdx, 1);
              draft.eventLog.push({
                tick: world.tick + 1,
                message: `${defenderName} repelled ${attackerName} in ${terrName} (att ${attackStrength.toFixed(0)} vs def ${defendStrength.toFixed(0)}). Siege broken. ${attackerName} −${attackerLosses}.`,
              });
            } else {
              draft.eventLog.push({
                tick: world.tick + 1,
                message: `${defenderName} held ${terrName} against ${attackerName} (att ${attackStrength.toFixed(0)} vs def ${defendStrength.toFixed(0)}). ${attackerName} −${attackerLosses}.`,
              });
            }
          }
        }
      }
    }

    // ── Peace resolution ─────────────────────────────────────────────────────
    // Runs after all battle resolution. Handles:
    //   1. propose_peace  — attach deal to war, set status = peace_negotiation (server-side).
    //      Engine just acknowledges the action; the server handler mutates the DB War row
    //      directly before the tick fires, so the loaded world already has status=peace_negotiation
    //      and pendingPeaceDeal populated. The engine then sees the state and processes responses.
    //   2. accept_peace   — execute deal: cessions, tribute treaty, return remaining occupied.
    //   3. decline_peace  — apply exhaustion bump to decliner, reset to active.
    //   4. lapse          — if peace_negotiation and no accept/decline this tick and proposal
    //      has exceeded PEACE_PROPOSAL_LAPSE_TICKS → silently revert to active.

    // Collect peace action intents this tick.
    const peaceAcceptors = new Set<string>();   // nationIds that queued accept_peace
    const peaceDeclinersByWar = new Map<string, string>(); // warId-keyed → declining nationId
    for (const action of actions) {
      if (action.type === 'accept_peace') peaceAcceptors.add(action.nationId);
      if (action.type === 'decline_peace') {
        const p = action.payload as { warId: number };
        peaceDeclinersByWar.set(String(p.warId), action.nationId);
      }
    }

    // Helper: execute a peace deal on the draft world.
    const executePeaceDeal = (war: typeof draft.wars[number], deal: PeaceDeal) => {
      const attackerName = draft.nations[war.attackerId]?.name ?? war.attackerId;
      const defenderName = draft.nations[war.defenderId]?.name ?? war.defenderId;

      // 1. Territory cessions — transfer ownership with conquest shock.
      for (const cession of deal.territoryCessions) {
        const terr = draft.territories[cession.territoryId];
        if (!terr) continue;
        terr.state.ownerId = cession.toNationId;
        terr.state.acquiredTick = world.tick;
        terr.state.ownershipShock = 0.50; // [PLACEHOLDER] same as battle capture
        draft.eventLog.push({
          tick: world.tick + 1,
          message: `${draft.nations[cession.toNationId]?.name ?? cession.toNationId} received ${terr.def.name} via peace treaty.`,
        });
      }

      // 2. All occupied territories NOT in cession list → returned to original owner.
      // "Original owner" = the other belligerent (the war is bilateral).
      const cedingIds = new Set(deal.territoryCessions.map((c) => c.territoryId));
      for (const occ of war.occupiedTerritories) {
        if (cedingIds.has(occ.territoryId)) continue;
        // Return to the non-occupying belligerent.
        const returnToId = occ.occupyingNationId === war.attackerId ? war.defenderId : war.attackerId;
        const terr = draft.territories[occ.territoryId];
        if (terr) {
          terr.state.ownerId = returnToId;
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `${terr.def.name} returned to ${draft.nations[returnToId]?.name ?? returnToId} under peace terms.`,
          });
        }
      }
      war.occupiedTerritories = [];

      // 3. Tribute creates a new treaty — recorded in eventLog; server builds the Treaty row.
      //    The engine emits a tribute-treaty-needed event which the server save hook reads.
      if (deal.tributeWealth > 0 && deal.tributeTicks > 0) {
        draft.eventLog.push({
          tick: world.tick + 1,
          message: `[TRIBUTE_TREATY] warId=${war.id} fromNationId=${war.attackerId} toNationId=${war.defenderId} amount=${deal.tributeWealth} ticks=${deal.tributeTicks}`,
        });
      }

      // 4. Trust bonus for peaceful resolution.
      for (const nId of [war.attackerId, war.defenderId]) {
        const n = draft.nations[nId];
        if (n) n.trust = Math.min(100, n.trust + PEACE_TRUST_BONUS);
      }

      // 5. Defense pact check — emit event noting unfulfilled pact (inert in v1).
      // (Happens in war-end cleanup below via common path.)

      // 6. End the war.
      war.status = 'ended';
      war.endTick = world.tick + 1;
      war.pendingPeaceDeal = null;

      draft.eventLog.push({
        tick: world.tick + 1,
        message: `Peace of tick ${world.tick + 1} signed between ${attackerName} and ${defenderName}.`,
      });
    };

    // Helper: war-end cleanup (defense pact notice + army action cleanup handled by server).
    const endWarCleanup = (war: typeof draft.wars[number]) => {
      // Defense pact: check if any treaty involves a third party with a defense_pact toward defender.
      // Inert in v1 — just emit the event.
      for (const treaty of draft.treaties) {
        if (!treaty.partyIds.includes(war.defenderId)) continue;
        const hasPact = treaty.clauses.some((c) => c.type === 'defense_pact' && c.clauseStatus === 'active');
        if (!hasPact) continue;
        const thirdPartyId = treaty.partyIds.find((id) => id !== war.defenderId);
        if (!thirdPartyId || thirdPartyId === war.attackerId) continue;
        const thirdName = draft.nations[thirdPartyId]?.name ?? thirdPartyId;
        const defName = draft.nations[war.defenderId]?.name ?? war.defenderId;
        draft.eventLog.push({
          tick: world.tick + 1,
          message: `[DEFENSE_PACT_UNHONORED] ${thirdName} had a defense pact with ${defName} but did not intervene. (Activation deferred — v1 stub.)`,
        });
      }
    };

    for (const war of draft.wars) {
      if (war.status === 'peace_negotiation' && war.pendingPeaceDeal) {
        const deal = war.pendingPeaceDeal;
        const warIdStr = String(war.id);
        const nonProposer = [war.attackerId, war.defenderId].find((id) => id !== deal.proposingNationId)!;

        // Did the non-proposing party accept this tick?
        if (peaceAcceptors.has(nonProposer)) {
          executePeaceDeal(war, deal);
          endWarCleanup(war);
          continue;
        }

        // Did the non-proposing party decline?
        const decliner = peaceDeclinersByWar.get(warIdStr);
        if (decliner === nonProposer) {
          // Apply exhaustion bump to the declining party.
          war.exhaustionByNation[decliner] = world.tick + 1 + PEACE_DECLINE_EXHAUSTION_TICKS;
          war.pendingPeaceDeal = null;
          war.status = 'active';
          const declinerName = draft.nations[decliner]?.name ?? decliner;
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `${declinerName} declined the peace proposal. War continues. Exhaustion penalty applied.`,
          });
          continue;
        }

        // Lapse: proposal expired with no response?
        if (world.tick + 1 >= deal.proposedAtTick + PEACE_PROPOSAL_LAPSE_TICKS) {
          war.pendingPeaceDeal = null;
          war.status = 'active';
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `Peace proposal in war #${war.id} lapsed without response. War continues.`,
          });
        }
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

        } else if (obj.objectiveType === 'joint_invasion') {
          // Both responsible parties must have queued attack_territory against targetTerritoryId
          // in this same tick. If both did: met. If deadline passes without both doing so
          // in the same tick: failed.
          if (obj.targetTerritoryId) {
            const allResponsibleAttacked = responsibleIds.every((respId) => {
              const targets = attacksByNation[respId] ?? [];
              return targets.includes(obj.targetTerritoryId!);
            });
            if (allResponsibleAttacked && responsibleIds.length >= 2) {
              met = true;
            }
          }

        } else if (obj.objectiveType === 'attack_player') {
          // Responsible party must be the attacker in an active war against targetNationId.
          // Check any active/peace_negotiation war that started on or before current tick.
          if (obj.targetNationId) {
            for (const respId of responsibleIds) {
              const hasWar = draft.wars.some(
                (w) =>
                  (w.status === 'active' || w.status === 'peace_negotiation') &&
                  w.attackerId === respId &&
                  w.defenderId === obj.targetNationId &&
                  w.startTick <= world.tick,
              );
              if (hasWar) { met = true; break; }
            }
          }

        } else {
          // Unknown objective type — leave pending, do not count as met.
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

    // ── War-unrest pre-computation ────────────────────────────────────────────
    // Compute per-nation war-driven unrest modifiers before the territory loop.
    // These are additive to the equilibrium computed by computeUnrestEquilibrium.

    const nationAtWar = new Set<string>();
    const warOverextensionByNation: Record<string, number> = {};
    const warInsolventNations = new Set<string>();
    const warNoCBDeclarer = new Set<string>(); // no-CB spike still active
    const warExhaustionNations = new Set<string>(); // exhaustion bump from declined peace

    for (const war of draft.wars) {
      if (war.status !== 'active' && war.status !== 'peace_negotiation') continue;
      nationAtWar.add(war.attackerId);
      nationAtWar.add(war.defenderId);

      // Overextension pressure per nation from their occupied territories.
      for (const nationId of [war.attackerId, war.defenderId]) {
        const cap = draft.nations[nationId]?.capitalTerritoryId ?? null;
        const pressure = computeOverextensionPressure(war.occupiedTerritories, nationId, cap, adjacency);
        warOverextensionByNation[nationId] = (warOverextensionByNation[nationId] ?? 0) + pressure;
      }

      // No-CB spike: still active if within NO_CB_SPIKE_DURATION ticks of declaration.
      if (!war.hasCasusBelli && (world.tick - war.declaredTick) < NO_CB_SPIKE_DURATION) {
        warNoCBDeclarer.add(war.attackerId);
      }

      // Exhaustion bump from a declined peace proposal (active until exhaustionEndsAtTick).
      for (const [nationId, endsAtTick] of Object.entries(war.exhaustionByNation)) {
        if (world.tick < endsAtTick) {
          warExhaustionNations.add(nationId);
        }
      }
    }

    // Insolvency check: nations whose wealthStock has gone negative.
    for (const nation of Object.values(draft.nations)) {
      if (nationAtWar.has(nation.id) && nation.stockpiles.wealth < 0) {
        warInsolventNations.add(nation.id);
      }
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

      // militaryBonus: activated for territories with militaristic > 0.3 when nation is at war.
      // Negative value = reduces equilibrium (happier at war). Previously always 0 (stub).
      const militaryBonus = (nationAtWar.has(ownerId) && t.state.valueTraits.militaristic > 0.3)
        ? WAR_MILITARISTIC_HAPPINESS_BONUS
        : 0;

      const compat = computeCompatibility(t.state.valueTraits, t.def.culturalFamily, nationCulture);
      const causes = computeUnrestEquilibrium(
        compat, hops,
        t.state.hasRoad, t.state.hasPort, t.state.fortificationLevel,
        tcount, t.state.ownershipShock, recentWeight, clashPressure,
        militaryBonus,
      );

      // War unrest additions (applied directly to equilibrium after computeUnrestEquilibrium).
      // These are pure additions outside the standard formula — war physics on top of base unrest.
      let warEquilibriumAdj = 0;

      // Overextension: distance-scaled pressure from occupied territories.
      warEquilibriumAdj += warOverextensionByNation[ownerId] ?? 0;

      // Insolvency ramp: fighting on credit.
      if (warInsolventNations.has(ownerId)) {
        warEquilibriumAdj += WAR_INSOLVENCY_UNREST_PER_TICK;
      }

      // No-CB spike: Peaceful/Isolationist territories of the unjustified declarer.
      if (warNoCBDeclarer.has(ownerId) &&
          (t.state.valueTraits.militaristic < -0.3 || t.state.valueTraits.expansionist < -0.3)) {
        warEquilibriumAdj += NO_CB_UNREST_SPIKE;
      }

      // Exhaustion bump: nation that declined a peace proposal.
      if (warExhaustionNations.has(ownerId)) {
        warEquilibriumAdj += PEACE_DECLINE_EXHAUSTION_BUMP;
      }

      const effectiveEquilibrium = Math.min(1, Math.max(0, causes.equilibrium + warEquilibriumAdj));

      // Decay ownership shock at a rate gated by integration progress.
      if (t.state.ownershipShock > 0) {
        const decayRate = computeShockDecayRate(
          t.state.hasRoad, t.state.hasPort, t.state.fortificationLevel, compat, causes,
        );
        t.state.ownershipShock = Math.max(0, t.state.ownershipShock * (1 - decayRate));
      }

      // Drift unrest toward effective equilibrium (base + war adjustments).
      t.state.unrest = t.state.unrest + UNREST_DRIFT_RATE * (effectiveEquilibrium - t.state.unrest);

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
