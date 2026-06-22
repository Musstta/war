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
  TRADE_STABILITY_BONUS,
  TRADE_DRIFT_MULTIPLIER,
  ISOLATIONIST_TREATY_THRESHOLD,
  ISOLATIONIST_ENTANGLEMENT_WEIGHT,
  EXPANSIONIST_GROWTH_WINDOW,
  EXPANSIONIST_STAGNATION_WEIGHT,
  COLLECTIVIST_ISOLATION_WEIGHT,
  INDIVIDUALIST_OBLIGATION_WEIGHT,
  TRADITIONAL_EROSION_THRESHOLD,
  TRADITIONAL_EROSION_WEIGHT,
  PROGRESSIVE_STAGNATION_THRESHOLD,
  PROGRESSIVE_STAGNATION_WEIGHT,
  ROAD_DRIFT_MULTIPLIER,
  POPULATION_TRANSFER_UNREST_SCALE,
  POPULATION_TRANSFER_SHOCK_DURATION,
  POPULATION_TRANSFER_DRIFT_DURATION,
  CESSION_EMBASSY_GRACE_TICKS,
  EMBASSY_COMPAT_BONUS,
  EMBASSY_TRUST_RECOVERY_PER_TICK,
  EMBASSY_BUILD_TICKS,
  EMBASSY_EXPEL_TRUST_PENALTY,
} from './culture';
import {
  TRUST_BASELINE,
  TRUST_BREAK_PENALTY,
  TRUST_RECOVERY_COOLDOWN,
  LOW_TRUST_FINE_PER_TREATY,
  DEGRADATION_REFUND_TICKS,
  PROPOSAL_EXPIRY_TICKS,
  TRIBUTE_DIMINISHING_SCALE,
  TRIBUTE_DIMINISHING_CAP,
  TRIBUTE_EXPLOITATION_THRESHOLD,
  TRIBUTE_EXPLOITATION_UNREST,
  TRIBUTE_EXPLOITATION_PRESTIGE_PENALTY,
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
  computeEffectiveFortLevel,
  computeGarrisonSize,
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
  DEBT_RECOVERY_SKIM_RATE,
  totalArmySize,
  armyInTerritory,
  armiesForNation,
  PACIFICATION_THRESHOLD,
  PACIFICATION_DECAY_PER_TICK,
  TERRAIN_DIFFICULTY,
  POP_DIFFICULTY_SCALE,
  COMPAT_DIFFICULTY_SCALE,
  GEOGRAPHY_SHOCK_MULTIPLIER,
  computeArmyPath,
  SKIRMISH_FULL_CB_WINDOW,
  SKIRMISH_HOSTILITY_COMPAT_THRESHOLD,
  BARRICADE_DEFENSE_BONUS,
  GEOGRAPHY_MOVEMENT_MODIFIER,
} from './war';
// Alias for inline use in army transit advancement.
const GEOGRAPHY_MOVEMENT_MODIFIER_INLINE = GEOGRAPHY_MOVEMENT_MODIFIER;
import {
  computeTradeCapacity,
  computeTradeFriction,
} from './trade';
import { INSOLVENCY_GENERAL_UNREST_PER_TICK } from './culture';
import type { PeaceDeal } from './types';
import {
  DOMINANT_WAR_ATTACKER_BONUS,
  DOMINANT_WAR_MILITARISTIC_BONUS,
} from './prestige';
import {
  MARKET_ROUTE_BASE_CAPACITY,
  PORT_ROUTE_BASE_CAPACITY,
  ROUTE_GROWTH_CAP_MULTIPLIER,
  ROUTE_GROWTH_RATE,
  ROUTE_UPKEEP_RATE,
  ROUTE_INTERNATIONAL_UPKEEP_SPLIT,
  ROUTE_LOSS_UNREST_SCALE,
  ROUTE_LOSS_UNREST_TICKS,
  PRESTIGE_LOSS_PER_ROUTE_LOSS,
  SHIPMENT_LOSS_WEALTH_VALUE,
  ROUTE_MERCHANT_PRESSURE_WEIGHT,
  ROUTE_ISOLATIONIST_THRESHOLD,
  ROUTE_ISOLATIONIST_COUNT_WEIGHT,
  computeBaseCapacity,
  computeProfitMultiplier,
} from './tradeRoutes';
import type { TradeRouteAgreement, TradeShipment } from './types';

// ── Placeholder constants ─────────────────────────────────────────────────────
// These numbers are not final. All tuning happens via the simulation harness
// once enough systems are in place. Do not balance these by hand. (design doc §17)
const UPKEEP_PER_SOLDIER = 0.05; // [PLACEHOLDER] Wealth cost per soldier per tick

// ── Infrastructure maintenance (v0.40 + v0.41) ───────────────────────────────
// Per-tick Wealth cost per territory, deducted from nation general stockpile alongside army upkeep.
// Deducted AFTER production flush, same order as army upkeep and trade route upkeep.
// Insolvency from these deductions triggers PRESTIGE_DECAY_PER_INSOLVENCY_TICK next tick
// (insolvency is detected in saveWorldState after the tick, when prestige is computed).

/** Per-tick Wealth cost per port level (multiplied by portLevel, so L2 port costs 2× L1). [PLACEHOLDER] */
const PORT_MAINTENANCE_PER_LEVEL = 0.1; // [PLACEHOLDER]

/** Per-tick Wealth cost per territory with hasMarket = true. [PLACEHOLDER] */
const MARKET_MAINTENANCE_FLAT = 0.05; // [PLACEHOLDER]

/** Per-tick Wealth cost per territory with hasRoad = true. [PLACEHOLDER] */
const ROAD_MAINTENANCE_FLAT = 0.02; // [PLACEHOLDER]

/** Per-tick Wealth cost per fortification level (multiplied by fortificationLevel). [PLACEHOLDER] */
const FORT_MAINTENANCE_PER_LEVEL = 0.08; // [PLACEHOLDER]

// ── Garrison constants (v0.41) ────────────────────────────────────────────────
// A garrison = any army with status 'stationed' in a territory with fortificationLevel >= 1.
// No new DB row needed — derived from existing Army rows each tick.

/**
 * Fort effectiveness when completely ungarrisoned (garrisonSize === 0).
 * Empty fort = FORT_UNGARRISONED_PENALTY × fortificationLevel effective level.
 * Target: 0.4–0.5 (40–50% of full value). [PLACEHOLDER]
 */
const FORT_UNGARRISONED_PENALTY = 0.45; // [PLACEHOLDER]

/**
 * Garrison unit count at/above which the fort operates at 100% effectiveness.
 * Below this, effectiveness scales linearly: (garrisonSize / GARRISON_FULL_THRESHOLD).
 * [PLACEHOLDER]
 */
const GARRISON_FULL_THRESHOLD = 8; // [PLACEHOLDER]

/**
 * Maximum garrison size for capacity validation in station_garrison action.
 * Per fortification level: garrisonCapacity = GARRISON_CAPACITY_PER_LEVEL × fortificationLevel.
 * [PLACEHOLDER]
 */
const GARRISON_CAPACITY_PER_LEVEL = 5; // [PLACEHOLDER]

/** Fraction by which garrisoned units' effective upkeep is reduced (0.25 = 25% discount). [PLACEHOLDER] */
const GARRISON_UPKEEP_REDUCTION = 0.25; // [PLACEHOLDER]

/** Equilibrium reduction while a garrison is present (garrisonSize > 0). [PLACEHOLDER] */
const GARRISON_UNREST_SUPPRESSION = 0.04; // [PLACEHOLDER]

/**
 * When nation's militaristic trait > this threshold, garrison suppression is multiplied
 * by MILITARISTIC_GARRISON_MULTIPLIER. Culturally compatible presence = stronger effect.
 * [PLACEHOLDER]
 */
const MILITARISTIC_GARRISON_THRESHOLD = 0.3; // [PLACEHOLDER]

/** Multiplier applied to GARRISON_UNREST_SUPPRESSION for militaristic territories. [PLACEHOLDER] */
const MILITARISTIC_GARRISON_MULTIPLIER = 1.5; // [PLACEHOLDER]

/**
 * Fraction added to create_army output when the action fires in a garrisoned fort territory.
 * Output = floor(baseSize × (1 + GARRISON_RECRUITMENT_BONUS)). [PLACEHOLDER]
 */
const GARRISON_RECRUITMENT_BONUS = 0.2; // [PLACEHOLDER]

// ── Expansionist stagnation relief (v0.41) ────────────────────────────────────
/**
 * Minimum increase in total active trade route currentCapacity (across all of a nation's routes)
 * since the last stagnation-timer reset to reset the expansionist stagnation timer.
 * [PLACEHOLDER]
 */
const EXPANSIONIST_TRADE_GROWTH_THRESHOLD = 2.0; // [PLACEHOLDER]

/**
 * Base population at which production multiplier is 1.0.
 * A territory with population 100 produces 2× base; population 25 produces 0.5× base.
 * Linear scaling — may need sublinear curve at high population. [PLACEHOLDER]
 * See tuning-notes.md for the "population production scaling" note.
 */
const POPULATION_PRODUCTION_BASE = 50; // [PLACEHOLDER]

/** Ticks required to complete each construction type. [PLACEHOLDER] */
export const BUILD_TICKS: Record<string, number> = {
  port:    3,
  market:  3, // [PLACEHOLDER] same as port
  fort_l1: 3,
  fort_l2: 7,
  fort_l3: 14,
};

/** Industry stockpile cost deducted at construction start. [PLACEHOLDER] */
export const BUILD_INDUSTRY: Record<string, number> = {
  port:    5,
  market:  5, // [PLACEHOLDER] same as port
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
 * Fire a trade route loss event: log, apply TerritoryModifier unrest spike, Prestige reduction,
 * and wealth penalty for the receiving party. Mark route ended.
 * Only applies if the route grew beyond baseCapacity. Called from treaty expiry, ownership change,
 * and infra destruction paths.
 *
 * Prestige penalty: PRESTIGE_LOSS_PER_ROUTE_LOSS × (lostValue / growthCap), applied to ownerNationId.
 * For international routes: half penalty also applied to partnerNationId.
 * Wealth penalty: SHIPMENT_LOSS_WEALTH_VALUE × (lostValue / growthCap), applied to the destination nation.
 * For domestic routes: destination nation = ownerNationId.
 * For international routes: destination = partnerNationId (the one receiving cargo from source).
 * If route is symmetric and direction unclear, apply to partnerNationId; if no partner, apply to owner.
 */
function applyRouteLossEvent(
  route: TradeRouteAgreement,
  draft: {
    territories: WorldState['territories'];
    territoryModifiers: WorldState['territoryModifiers'];
    eventLog: WorldState['eventLog'];
    nations: WorldState['nations'];
  },
  currentTick: number,
): void {
  const lostValue = route.currentCapacity - route.baseCapacity;
  if (lostValue <= 0) {
    route.status = 'ended';
    return;
  }

  const lossFraction = lostValue / route.growthCap;
  const pctGrown = Math.round((route.currentCapacity / route.growthCap) * 100);
  const srcName = draft.territories[route.sourceTerritoryId]?.def.name ?? route.sourceTerritoryId;
  const dstName = draft.territories[route.destinationTerritoryId]?.def.name ?? route.destinationTerritoryId;

  // Prestige penalty for owner; half-penalty for partner on international routes.
  const prestigePenalty = Math.round(lossFraction * PRESTIGE_LOSS_PER_ROUTE_LOSS);
  const ownerNation = draft.nations[route.ownerNationId];
  if (ownerNation && prestigePenalty > 0) {
    ownerNation.prestige = Math.max(0, ownerNation.prestige - prestigePenalty);
  }
  if (route.partnerNationId) {
    const partnerNation = draft.nations[route.partnerNationId];
    const partnerPenalty = Math.max(1, Math.round(prestigePenalty * 0.5));
    if (partnerNation && partnerPenalty > 0) {
      partnerNation.prestige = Math.max(0, partnerNation.prestige - partnerPenalty);
    }
  }

  // Wealth penalty for the receiving (destination) party — collateral for lost shipment.
  const wealthPenalty = lossFraction * SHIPMENT_LOSS_WEALTH_VALUE;
  // For international routes, the destination territory's owner is the receiving nation.
  // For domestic routes, the owner is the same nation on both ends.
  const destTerr = draft.territories[route.destinationTerritoryId];
  const receivingNationId = destTerr?.state.ownerId
    ?? route.partnerNationId
    ?? route.ownerNationId;
  const receivingNation = draft.nations[receivingNationId];
  if (receivingNation && wealthPenalty > 0) {
    receivingNation.stockpiles.wealth -= wealthPenalty;
  }

  draft.eventLog.push({
    tick: currentTick,
    message: `The trade route between ${srcName} and ${dstName} (grown to ${pctGrown}% over ${route.cyclesCompleted} cycles) has been severed. Prestige −${prestigePenalty}. Wealth −${wealthPenalty.toFixed(1)} (undelivered cargo).`,
  });

  const unrestSpike = lossFraction * ROUTE_LOSS_UNREST_SCALE;
  for (const endpointId of [route.sourceTerritoryId, route.destinationTerritoryId]) {
    const endpointTerr = draft.territories[endpointId];
    if (!endpointTerr) continue;
    // Generate a unique negative ID (in-memory placeholder; DB ID assigned by server on save).
    const modId = -(currentTick * 100000 + Math.abs(route.id) * 2 + (endpointId === route.sourceTerritoryId ? 0 : 1));
    draft.territoryModifiers.push({
      id: modId,
      territoryId: endpointId,
      source: 'trade_route_loss',
      movementMultiplier: 1.0,
      productionMultiplier: 1.0,
      unrestEquilibriumAdj: unrestSpike,
      driftRateMultiplier: 1.0,
      defenseBonus: 0,
      startTick: currentTick,
      durationTicks: ROUTE_LOSS_UNREST_TICKS,
      expiresAtTick: currentTick + ROUTE_LOSS_UNREST_TICKS,
    });
  }

  route.status = 'ended';
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

        case 'build_market': {
          const { territoryId } = action.payload as { territoryId: string };
          const t = draft.territories[territoryId];
          const nation = draft.nations[action.nationId];
          if (!t || !nation) { discard(action, 'territory or nation not found'); break; }
          if (t.state.ownerId !== action.nationId) { discard(action, 'not owner'); break; }
          if (t.def.isCoastal) { discard(action, 'territory is coastal — build a port instead'); break; }
          if (t.state.hasMarket) { discard(action, 'already has market'); break; }
          if (t.state.hasPort) { discard(action, 'already has port'); break; }
          if (t.state.constructionType !== null) { discard(action, 'construction slot occupied'); break; }
          const marketIndustryCost = BUILD_INDUSTRY['market']!;
          if (nation.stockpiles.industry < marketIndustryCost) { discard(action, `insufficient industry (need ${marketIndustryCost})`); break; }
          nation.stockpiles.industry -= marketIndustryCost;
          t.state.constructionType = 'market';
          t.state.constructionTicksLeft = BUILD_TICKS['market']!;
          draft.eventLog.push({ tick: world.tick + 1, message: `${nation.name} began market construction in ${t.def.name}.` });
          apply(action);
          break;
        }

        case 'establish_trade_route': {
          // Domestic trade route — both territories owned by same nation, at least one has infra.
          // Mandate cost is handled by the server action handler at queue time.
          // The engine receives the fully-formed TradeRouteAgreement object and injects it.
          // (Same pattern as treaty acceptance: server validates, engine just records.)
          const { tradeRoute } = action.payload as { tradeRoute: TradeRouteAgreement };
          if (!tradeRoute) { discard(action, 'establish_trade_route: missing tradeRoute payload'); break; }
          const sourceTerr = draft.territories[tradeRoute.sourceTerritoryId];
          const destTerr = draft.territories[tradeRoute.destinationTerritoryId];
          if (!sourceTerr || !destTerr) { discard(action, 'establish_trade_route: territory not found'); break; }
          if (sourceTerr.state.ownerId !== action.nationId) { discard(action, 'establish_trade_route: source not owned by nation'); break; }
          if (destTerr.state.ownerId !== action.nationId) { discard(action, 'establish_trade_route: destination not owned by nation'); break; }
          const hasInfra = sourceTerr.state.hasPort || sourceTerr.state.hasMarket
            || destTerr.state.hasPort || destTerr.state.hasMarket;
          if (!hasInfra) { discard(action, 'establish_trade_route: no market or port at either endpoint'); break; }
          // Duplicate check: no other active domestic route between these endpoints.
          const duplicate = draft.tradeRouteAgreements.some(
            (r) => r.status === 'active' && r.type === 'domestic'
              && ((r.sourceTerritoryId === tradeRoute.sourceTerritoryId && r.destinationTerritoryId === tradeRoute.destinationTerritoryId)
              || (r.sourceTerritoryId === tradeRoute.destinationTerritoryId && r.destinationTerritoryId === tradeRoute.sourceTerritoryId)),
          );
          if (duplicate) { discard(action, 'establish_trade_route: active domestic route already exists between these territories'); break; }
          draft.tradeRouteAgreements.push(tradeRoute);
          const ownerName = draft.nations[action.nationId]?.name ?? action.nationId;
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `${ownerName} established a domestic trade route: ${sourceTerr.def.name} → ${destTerr.def.name} (base capacity ${tradeRoute.baseCapacity}).`,
          });
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
          // Move the army back and clear any siege.
          const retreatingArmy = draft.armies.find(
            (a) => a.nationId === action.nationId && a.territoryId === fromTerritoryId,
          );
          if (retreatingArmy) {
            const { toTerritoryId } = action.payload as { fromTerritoryId: string; toTerritoryId: string };
            retreatingArmy.territoryId = toTerritoryId ?? retreatingArmy.territoryId;
            retreatingArmy.status = 'stationed';
            retreatingArmy.destinationTerritoryId = null;
          }
          // Clear occupied entry in any active war.
          for (const war of draft.wars) {
            if (war.status !== 'active') continue;
            if (war.attackerId !== action.nationId && war.defenderId !== action.nationId) continue;
            const occIdx = war.occupiedTerritories.findIndex(
              (o) => o.territoryId === fromTerritoryId && o.occupyingNationId === action.nationId,
            );
            if (occIdx !== -1) {
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

        case 'move_army': {
          // §1.3 Multi-tick movement model: compute path and set army in transit.
          const { armyId, toTerritoryId } = action.payload as { armyId: number; toTerritoryId: string };
          const army = draft.armies.find((a) => a.id === armyId && a.nationId === action.nationId);
          if (!army) { discard(action, 'army not found or not owned by this nation'); break; }
          if (army.movedThisTick) { discard(action, 'army already moved this tick'); break; }
          const targetTerr = draft.territories[toTerritoryId];
          if (!targetTerr) { discard(action, 'destination territory not found'); break; }

          // Build adjacency for pathfinding.
          const moveAdjacency: Record<string, readonly string[]> = Object.fromEntries(
            Object.entries(draft.territories).map(([k, v]) => [k, v.def.adjacentIds]),
          );

          // Compute path from current position to destination.
          const pathResult = computeArmyPath( // [PLACEHOLDER callsite: §1.3 movement model]
            army.territoryId,
            toTerritoryId,
            draft.territories as WorldState['territories'],
            moveAdjacency,
            draft.territoryModifiers,
          );
          if (!pathResult) { discard(action, 'destination unreachable'); break; }

          if (pathResult.totalTravelTicks <= 1) {
            // Instant move (1 tick or adjacent with fast terrain): arrive immediately.
            const prevTerritoryId = army.territoryId;
            army.territoryId = toTerritoryId;
            army.movedThisTick = true;
            army.destinationTerritoryId = null;
            army.transitPath = [];
            army.transitTicksRemaining = 0;

            const activeWar = draft.wars.find(
              (w) => (w.status === 'active' || w.status === 'peace_negotiation') &&
                ((w.attackerId === action.nationId && w.defenderId === targetTerr.state.ownerId) ||
                 (w.defenderId === action.nationId && w.attackerId === targetTerr.state.ownerId)),
            );
            if (activeWar && targetTerr.state.ownerId && targetTerr.state.ownerId !== action.nationId) {
              army.status = 'besieging';
            } else if (targetTerr.state.ownerId === action.nationId) {
              army.status = 'stationed';
            } else if (!targetTerr.state.ownerId) {
              army.status = 'occupying';
            }

            draft.eventLog.push({
              tick: world.tick + 1,
              message: `${draft.nations[action.nationId]?.name ?? action.nationId} moved an army from ${prevTerritoryId} to ${toTerritoryId}.`,
            });
          } else {
            // Multi-tick transit: army begins journey. [PLACEHOLDER callsite: §1.3]
            army.status = 'moving';
            army.destinationTerritoryId = toTerritoryId;
            army.transitPath = pathResult.path;
            army.transitTicksRemaining = pathResult.totalTravelTicks;
            army.movedThisTick = true;

            draft.eventLog.push({
              tick: world.tick + 1,
              message: `${draft.nations[action.nationId]?.name ?? action.nationId} army begins ${pathResult.totalTravelTicks}-tick march to ${toTerritoryId} (path: ${pathResult.path.join(' → ')}).`,
            });
          }
          apply(action);
          break;
        }

        case 'station_garrison': {
          // Station an army (or portion) as a garrison in a fort territory.
          // Garrison = the army remains stationed; this action validates and registers intent.
          // garrisonUnits: how many units of the army to designate as garrison (≤ army.size).
          const { armyId: garrisonArmyId, garrisonUnits } = action.payload as { armyId: number; garrisonUnits: number };
          const garrisonArmy = draft.armies.find((a) => a.id === garrisonArmyId && a.nationId === action.nationId);
          if (!garrisonArmy) { discard(action, 'army not found or not owned by this nation'); break; }
          if (garrisonArmy.status !== 'stationed') { discard(action, 'army must be stationed to garrison'); break; }
          const garrisonTerr = draft.territories[garrisonArmy.territoryId];
          if (!garrisonTerr) { discard(action, 'territory not found'); break; }
          if (garrisonTerr.state.ownerId !== action.nationId) { discard(action, 'must own the territory to garrison it'); break; }
          if (garrisonTerr.state.fortificationLevel < 1) { discard(action, 'territory has no fort (fortificationLevel must be >= 1)'); break; }
          const maxGarrison = GARRISON_CAPACITY_PER_LEVEL * garrisonTerr.state.fortificationLevel; // [PLACEHOLDER callsite: GARRISON_CAPACITY_PER_LEVEL]
          const units = Math.min(garrisonUnits ?? garrisonArmy.size, garrisonArmy.size, maxGarrison);
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `${draft.nations[action.nationId]?.name ?? action.nationId} garrisoned ${units} units in ${garrisonTerr.def.name} (fort L${garrisonTerr.state.fortificationLevel}).`,
          });
          apply(action);
          break;
        }

        case 'unstation_garrison': {
          // Release garrisoned units back to active army status (they remain stationed but ungarrisoned).
          const { armyId: ungArmyId } = action.payload as { armyId: number };
          const ungArmy = draft.armies.find((a) => a.id === ungArmyId && a.nationId === action.nationId);
          if (!ungArmy) { discard(action, 'army not found or not owned by this nation'); break; }
          const ungTerr = draft.territories[ungArmy.territoryId];
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `${draft.nations[action.nationId]?.name ?? action.nationId} released garrison in ${ungTerr?.def.name ?? ungArmy.territoryId}.`,
          });
          apply(action);
          break;
        }

        case 'build_barricade': {
          // §1.4 Barricade: temporary movement debuff + defense bonus on a territory.
          const { territoryId: barricadeTid } = action.payload as { territoryId: string };
          const barricadeTerr = draft.territories[barricadeTid];
          if (!barricadeTerr) { discard(action, 'territory not found'); break; }
          if (barricadeTerr.state.ownerId !== action.nationId) { discard(action, 'not owner'); break; }

          // Add TerritoryModifier for the barricade.
          const barricadeId = -(draft.territoryModifiers.length + 1); // negative = new, persisted by server
          draft.territoryModifiers.push({
            id: barricadeId,
            territoryId: barricadeTid,
            source: 'barricade',
            movementMultiplier: 1.5, // [PLACEHOLDER callsite: BARRICADE_MOVEMENT_MULTIPLIER]
            productionMultiplier: 1.0,
            unrestEquilibriumAdj: 0,
            driftRateMultiplier: 1.0,
            defenseBonus: BARRICADE_DEFENSE_BONUS, // [PLACEHOLDER callsite]
            startTick: world.tick + 1,
            durationTicks: 5, // [PLACEHOLDER: BARRICADE_DURATION_TICKS]
            expiresAtTick: world.tick + 1 + 5,
          });
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `${draft.nations[action.nationId]?.name ?? action.nationId} built a barricade in ${barricadeTerr.def.name}. [movementMultiplier ×1.5, defenseBonus +${BARRICADE_DEFENSE_BONUS}, expires T${world.tick + 6}]`,
          });
          apply(action);
          break;
        }

        case 'claim_territory': {
          // Claim an unclaimed adjacent territory. Ownership not transferred yet — pacification needed.
          const { territoryId } = action.payload as { territoryId: string };
          const claimTerr = draft.territories[territoryId];
          if (!claimTerr) { discard(action, 'territory not found'); break; }
          if (claimTerr.state.ownerId !== null) { discard(action, 'territory is not unclaimed'); break; }
          // Check adjacency.
          const isAdjToOwned = Object.values(draft.territories).some(
            (t) => t.state.ownerId === action.nationId && t.def.adjacentIds.includes(territoryId),
          );
          if (!isAdjToOwned) { discard(action, 'territory not adjacent to any owned territory'); break; }
          // Upsert claim.
          const existingClaim = draft.territoryClaims.find(
            (c) => c.nationId === action.nationId && c.territoryId === territoryId,
          );
          if (existingClaim) { discard(action, 'claim already exists for this territory'); break; }
          draft.territoryClaims.push({
            id: world.tick * 1000 + draft.territoryClaims.length + 1, // stable harness ID
            nationId: action.nationId,
            territoryId,
            claimedAtTick: world.tick,
            pacificationProgress: 0,
          });
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `${draft.nations[action.nationId]?.name ?? action.nationId} has claimed ${claimTerr.def.name}.`,
          });
          apply(action);
          break;
        }

        case 'build_embassy': {
          // §1.6 Embassy construction: find the proposed embassy and begin building.
          const { embassyId } = action.payload as { embassyId: number };
          const embIdx = draft.embassies.findIndex((e) => e.id === embassyId);
          if (embIdx === -1) { discard(action, 'embassy not found'); break; }
          const emb = draft.embassies[embIdx]!;
          if (emb.ownerNationId !== action.nationId) { discard(action, 'not embassy owner'); break; }
          if (emb.status !== 'proposed') { discard(action, `embassy already ${emb.status}`); break; }
          emb.status = 'under_construction';
          emb.constructionTicksLeft = EMBASSY_BUILD_TICKS; // [PLACEHOLDER callsite: EMBASSY_BUILD_TICKS]
          emb.startedAtTick = world.tick + 1;
          const embTerr = draft.territories[emb.hostTerritoryId];
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `${draft.nations[action.nationId]?.name ?? action.nationId} began embassy construction in ${embTerr?.def.name ?? emb.hostTerritoryId}. [${EMBASSY_BUILD_TICKS} ticks]`,
          });
          apply(action);
          break;
        }

        case 'expel_embassy': {
          // §1.6 Embassy expulsion: host nation expels a foreign embassy.
          const { embassyId: expelId } = action.payload as { embassyId: number };
          const expelIdx = draft.embassies.findIndex((e) => e.id === expelId);
          if (expelIdx === -1) { discard(action, 'embassy not found'); break; }
          const expelEmb = draft.embassies[expelIdx]!;
          // Validate: action must be from the host territory's owner.
          const expelHostTerr = draft.territories[expelEmb.hostTerritoryId];
          if (!expelHostTerr || expelHostTerr.state.ownerId !== action.nationId) {
            discard(action, 'only the host territory owner may expel an embassy');
            break;
          }
          if (expelEmb.status !== 'active' && expelEmb.status !== 'under_construction') {
            discard(action, `cannot expel embassy with status ${expelEmb.status}`);
            break;
          }
          expelEmb.status = 'expelled';
          // Trust penalty on both nations. [PLACEHOLDER callsite: EMBASSY_EXPEL_TRUST_PENALTY]
          const expelOwner = draft.nations[expelEmb.ownerNationId];
          const expelHost = draft.nations[action.nationId];
          if (expelOwner) expelOwner.trust = Math.max(0, expelOwner.trust - EMBASSY_EXPEL_TRUST_PENALTY);
          if (expelHost) expelHost.trust = Math.max(0, expelHost.trust - EMBASSY_EXPEL_TRUST_PENALTY);
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `${expelHost?.name ?? action.nationId} expelled the embassy of ${expelOwner?.name ?? expelEmb.ownerNationId} from ${expelHostTerr.def.name}. Trust −${EMBASSY_EXPEL_TRUST_PENALTY} applied to both nations. [PLACEHOLDER: EMBASSY_EXPEL_TRUST_PENALTY]`,
          });
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

          // Use positioned army sizes when armies are present; fall back to nation.armySize for
          // backward compatibility (harness scenarios without Army rows). // migrated from armySize
          const attackingArmy = armyInTerritory(draft.armies, targetTerritoryId) ??
            draft.armies.find((a) => a.nationId === attackingNationId) ?? null;
          const defendingArmy = armyInTerritory(draft.armies, targetTerritoryId) &&
            (armyInTerritory(draft.armies, targetTerritoryId)!.nationId === defendingNationId)
            ? armyInTerritory(draft.armies, targetTerritoryId)!
            : draft.armies.find((a) => a.nationId === defendingNationId && a.territoryId === targetTerritoryId) ?? null;

          const attackingArmySize = attackingArmy?.nationId === attackingNationId
            ? attackingArmy.size
            : (draft.armies.length > 0 ? totalArmySize(draft.armies, attackingNationId) : attackingNation.armySize); // migrated from armySize
          const defendingArmySize = defendingArmy
            ? defendingArmy.size
            : (draft.armies.length > 0 ? totalArmySize(draft.armies, defendingNationId) : defendingNation.armySize); // migrated from armySize

          // Dominant war attacker bonus: non-Dominant attacking a Dominant nation.
          // [PLACEHOLDER — DOMINANT_WAR_ATTACKER_BONUS = 1.15]
          const defenderIsDominant = draft.nations[defendingNationId]?.isDominant ?? false;
          const attackerIsDominant = draft.nations[attackingNationId]?.isDominant ?? false;
          const dominantAttackBonus = (!attackerIsDominant && defenderIsDominant)
            ? DOMINANT_WAR_ATTACKER_BONUS
            : 1.0;

          // Garrison-gated effective fort level: empty fort = FORT_UNGARRISONED_PENALTY × level.
          const defenderGarrisonSize = computeGarrisonSize(draft.armies, targetTerr.def.id);
          const effectiveFortLevelBattle = computeEffectiveFortLevel(
            targetTerr.state.fortificationLevel,
            defenderGarrisonSize,
            FORT_UNGARRISONED_PENALTY,   // [PLACEHOLDER callsite: FORT_UNGARRISONED_PENALTY]
            GARRISON_FULL_THRESHOLD,     // [PLACEHOLDER callsite: GARRISON_FULL_THRESHOLD]
          );
          const { attackStrength: rawAttackStrength, defendStrength } = computeBattleStrengths(
            attackingArmySize,
            defendingArmySize,
            effectiveFortLevelBattle,
            targetTerr.def.geography,
            attackerHasRoad,
            rngVal,
          );
          // Apply Dominant attacker bonus to the raw attack strength.
          const attackStrength = rawAttackStrength * dominantAttackBonus; // [PLACEHOLDER callsite: DOMINANT_WAR_ATTACKER_BONUS]

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
            const defenderLosses = Math.max(1, Math.floor(defendingArmySize * lossFrac));
            const attackerLosses = Math.max(0, Math.floor(attackingArmySize * winFrac));
            // Apply losses to positioned armies if present; else to nation totals.
            if (attackingArmy?.nationId === attackingNationId) {
              attackingArmy.size = Math.max(0, attackingArmy.size - attackerLosses);
              if (attackingArmy.size === 0) {
                draft.armies.splice(draft.armies.indexOf(attackingArmy), 1);
                draft.eventLog.push({ tick: world.tick + 1, message: `${attackerName}'s army was destroyed in battle.` });
              }
            } else {
              attackingNation.armySize = Math.max(0, attackingNation.armySize - attackerLosses); // migrated from armySize
            }
            if (defendingArmy) {
              defendingArmy.size = Math.max(0, defendingArmy.size - defenderLosses);
              if (defendingArmy.size === 0) {
                draft.armies.splice(draft.armies.indexOf(defendingArmy), 1);
                draft.eventLog.push({ tick: world.tick + 1, message: `${defenderName}'s army was destroyed in battle.` });
              }
            } else {
              defendingNation.armySize = Math.max(0, defendingNation.armySize - defenderLosses); // migrated from armySize
            }

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
              const required = siegeTicksRequired(effectiveFortLevelBattle); // garrison-gated

              if (occ.siegeProgress >= required) {
                // Territory fully captured — transfer ownership.
                war.occupiedTerritories.splice(existingOccIdx, 1);
                // Track territory loss on the defender for Prestige decay.
                const previousOwner = draft.nations[war.defenderId];
                if (previousOwner) previousOwner.territoriesLost += 1;
                targetTerr.state.ownerId = attackingNationId;
                targetTerr.state.acquiredTick = world.tick;
                // Conquest shock: base 0.50 × geography multiplier. [PLACEHOLDER callsite: GEOGRAPHY_SHOCK_MULTIPLIER]
                const geoShockMult = GEOGRAPHY_SHOCK_MULTIPLIER[targetTerr.def.geography] ?? 1.0; // [PLACEHOLDER callsite: GEOGRAPHY_SHOCK_MULTIPLIER]
                targetTerr.state.ownershipShock = Math.min(1, 0.50 * geoShockMult); // [PLACEHOLDER] see computeConquestShock
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
            const attackerLosses = Math.max(0, Math.floor(attackingArmySize * BATTLE_WINNER_LOSS_RATE));
            if (attackingArmy?.nationId === attackingNationId) {
              attackingArmy.size = Math.max(0, attackingArmy.size - attackerLosses);
              if (attackingArmy.size === 0) draft.armies.splice(draft.armies.indexOf(attackingArmy), 1);
            } else {
              attackingNation.armySize = Math.max(0, attackingNation.armySize - attackerLosses); // migrated from armySize
            }

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
        // Conquest shock: base × geography multiplier. [PLACEHOLDER callsite: GEOGRAPHY_SHOCK_MULTIPLIER]
        const cessionGeoMult = GEOGRAPHY_SHOCK_MULTIPLIER[terr.def.geography] ?? 1.0; // [PLACEHOLDER callsite: GEOGRAPHY_SHOCK_MULTIPLIER]
        terr.state.ownershipShock = Math.min(1, 0.50 * cessionGeoMult); // [PLACEHOLDER] same as battle capture
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

      // 3b. Prestige warsWon / warsLost / territoriesLost increments.
      // A nation wins if territory was ceded to them, OR tribute flows to them (defender extracts tribute).
      // White peace (no cessions, no tribute) = no winner; neither increments.
      const attackerGainedTerritory = deal.territoryCessions.some((c) => c.toNationId === war.attackerId);
      const defenderGainedTerritory = deal.territoryCessions.some((c) => c.toNationId === war.defenderId);
      const defenderExtractedTribute = deal.tributeWealth > 0 && deal.tributeTicks > 0;
      const attackerLostTerritory = deal.territoryCessions.some((c) => c.toNationId === war.defenderId);
      const defenderLostTerritory = deal.territoryCessions.some((c) => c.toNationId === war.attackerId);
      // Tribute flows attacker→defender, so defender wins by extracting tribute.
      if (attackerGainedTerritory) {
        const attacker = draft.nations[war.attackerId];
        if (attacker) attacker.warsWon += 1;
      }
      if (defenderGainedTerritory || defenderExtractedTribute) {
        const defender = draft.nations[war.defenderId];
        if (defender) defender.warsWon += 1;
      }
      // Symmetric losses — loser is the one who ceded territory or paid tribute.
      if (attackerLostTerritory || defenderExtractedTribute) {
        const attacker = draft.nations[war.attackerId];
        if (attacker) {
          attacker.warsLost += 1;
          const cededCount = deal.territoryCessions.filter((c) => c.toNationId === war.defenderId).length;
          attacker.territoriesLost += cededCount;
        }
      }
      if (defenderLostTerritory) {
        const defender = draft.nations[war.defenderId];
        if (defender) {
          defender.warsLost += 1;
          const cededCount = deal.territoryCessions.filter((c) => c.toNationId === war.attackerId).length;
          defender.territoriesLost += cededCount;
        }
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

    // ── Army movedThisTick reset ──────────────────────────────────────────────
    for (const army of draft.armies) {
      army.movedThisTick = false;
    }

    // ── §1.3 Army transit advancement ─────────────────────────────────────────
    // Each tick, decrement transit counters. When 0: advance one step on path.
    for (const army of draft.armies) {
      if (army.status !== 'moving' || army.transitPath.length === 0) continue;

      army.transitTicksRemaining -= 1;
      if (army.transitTicksRemaining > 0) continue;

      // Advance to next territory on path.
      const nextTerritoryId = army.transitPath[0]!;
      army.transitPath = army.transitPath.slice(1);
      army.territoryId = nextTerritoryId;

      const nextTerr = draft.territories[nextTerritoryId];

      if (army.transitPath.length === 0) {
        // Journey complete — army arrived.
        army.destinationTerritoryId = null;
        const activeWar = draft.wars.find(
          (w) => (w.status === 'active' || w.status === 'peace_negotiation') &&
            ((w.attackerId === army.nationId && w.defenderId === nextTerr?.state.ownerId) ||
             (w.defenderId === army.nationId && w.attackerId === nextTerr?.state.ownerId)),
        );
        if (activeWar && nextTerr?.state.ownerId && nextTerr.state.ownerId !== army.nationId) {
          army.status = 'besieging';
        } else if (nextTerr?.state.ownerId === army.nationId) {
          army.status = 'stationed';
        } else if (!nextTerr?.state.ownerId) {
          army.status = 'occupying';
        } else {
          army.status = 'stationed'; // fallback
        }
        draft.eventLog.push({
          tick: world.tick + 1,
          message: `${draft.nations[army.nationId]?.name ?? army.nationId} army arrived at ${nextTerr?.def.name ?? nextTerritoryId}.`,
        });
      } else {
        // Still in transit — compute ticks for next leg.
        const nextLegTerr = draft.territories[army.transitPath[0]!];
        if (nextLegTerr) {
          const modMult = draft.territoryModifiers
            .filter((m) => m.territoryId === army.transitPath[0] && (m.expiresAtTick === null || m.expiresAtTick > world.tick + 1))
            .reduce((acc, m) => acc * m.movementMultiplier, 1.0);
          // [PLACEHOLDER callsite: §1.3 per-leg travel cost]
          const geoMod = GEOGRAPHY_MOVEMENT_MODIFIER_INLINE[nextLegTerr.def.geography] ?? 1.0;
          const roadMod = nextLegTerr.state.hasRoad ? 0.5 : 1.0;
          army.transitTicksRemaining = Math.ceil(1 * geoMod * roadMod * modMult);
        } else {
          army.transitTicksRemaining = 1;
        }
      }
    }

    // ── Trade route shipment transit advancement ──────────────────────────────
    // Mirror of army transit advancement. Each tick: decrement transitTicksRemaining.
    // On arrival (transitTicksRemaining hits 0): deposit cargo, apply growth, depart new shipment.
    // Shipments are carried on route.shipments (in-memory); persisted by server/world.ts.
    {
      // Helper: depart a new shipment from source → destination.
      const departShipment = (route: TradeRouteAgreement, currentTick: number): TradeShipment => {
        const cargoAmount = route.currentCapacity;
        // Deduct from source territory local wealth stockpile; allow insolvency.
        const srcTerrState = draft.territories[route.sourceTerritoryId]?.state;
        if (srcTerrState && !srcTerrState.isInRevolt) {
          const deducted = Math.min(srcTerrState.localWltStock, cargoAmount);
          srcTerrState.localWltStock -= deducted;
          // The remaining deduction from general stockpile is handled at flush time naturally —
          // the route upkeep block covers the wealth cost. For shipment cargo we just note departure.
        }
        return {
          id: -(currentTick * 10000 + draft.tradeRouteAgreements.indexOf(route)), // negative = in-memory (not DB row)
          routeId: route.id,
          path: [...route.path],
          transitTicksRemaining: 1,
          cargoAmount,
          cargoResource: 'wealth',
          direction: 'forward',
          departedAtTick: currentTick,
        };
      };

      for (const route of draft.tradeRouteAgreements) {
        if (route.status !== 'active') continue;

        // Auto-depart first shipment if none in transit (newly created route or resumed after suspension).
        if (route.shipments.length === 0) {
          route.shipments.push(departShipment(route, world.tick + 1));
          continue;
        }

        const shipmentsToRemove: number[] = [];
        const shipmentsToAdd: TradeShipment[] = [];

        for (let si = 0; si < route.shipments.length; si++) {
          const shipment = route.shipments[si]!;
          shipment.transitTicksRemaining -= 1;
          if (shipment.transitTicksRemaining > 0) continue;

          // Advance one step on path.
          shipment.path = shipment.path.slice(1);

          if (shipment.path.length === 0) {
            // Shipment arrived at destination.
            const destTerrState = draft.territories[route.destinationTerritoryId]?.state;
            if (destTerrState) {
              destTerrState.localWltStock += shipment.cargoAmount * route.profitMultiplier;
            }

            // Apply growth to route.
            route.currentCapacity = Math.min(
              route.growthCap,
              route.currentCapacity + route.baseCapacity * ROUTE_GROWTH_RATE,
            );
            route.cyclesCompleted += 1;

            shipmentsToRemove.push(si);

            // Depart next shipment immediately if route still active.
            if (route.status === 'active') {
              shipmentsToAdd.push(departShipment(route, world.tick + 1));
            }
          } else {
            // Still in transit — compute ticks for next territory on path.
            const nextTerrId = shipment.path[0];
            if (nextTerrId) {
              const nextTerr = draft.territories[nextTerrId];
              const geoMod = nextTerr ? (GEOGRAPHY_MOVEMENT_MODIFIER_INLINE[nextTerr.def.geography] ?? 1.0) : 1.0;
              const roadMod = nextTerr?.state.hasRoad ? 0.5 : 1.0;
              shipment.transitTicksRemaining = Math.max(1, Math.ceil(geoMod * roadMod));
            } else {
              shipment.transitTicksRemaining = 1;
            }
          }
        }

        // Remove arrived shipments (in reverse index order).
        for (let ri = shipmentsToRemove.length - 1; ri >= 0; ri--) {
          route.shipments.splice(shipmentsToRemove[ri]!, 1);
        }
        for (const s of shipmentsToAdd) {
          route.shipments.push(s);
        }
      }
    }

    // ── §1.3 Border skirmish detection ────────────────────────────────────────
    // Detect armies from different non-war nations crossing the same territory this tick.
    // A skirmish fires when two such armies both had attack intents on the same territory.
    const skirmishAttackIntents: Map<string, { nationId: string; armySize: number }[]> = new Map();
    for (const action of actions) {
      if (action.type !== 'attack_territory') continue;
      const { targetTerritoryId } = action.payload as { targetTerritoryId: string };
      if (!skirmishAttackIntents.has(targetTerritoryId)) skirmishAttackIntents.set(targetTerritoryId, []);
      const attackingArmy = draft.armies.find((a) => a.nationId === action.nationId);
      const sz = attackingArmy?.size ?? totalArmySize(draft.armies, action.nationId);
      skirmishAttackIntents.get(targetTerritoryId)!.push({ nationId: action.nationId, armySize: sz });
    }

    for (const [skirmishTid, intents] of skirmishAttackIntents) {
      if (intents.length < 2) continue;
      // Check every pair of nations with intents on the same territory.
      for (let i = 0; i < intents.length; i++) {
        for (let j = i + 1; j < intents.length; j++) {
          const intentA = intents[i]!;
          const intentB = intents[j]!;
          // Not a skirmish if they're at war (handled by normal battle resolution).
          if (areAtWar(draft.wars, intentA.nationId, intentB.nationId)) continue;

          // Resolve small battle.
          const rngVal = rng();
          const { attackStrength, defendStrength } = computeBattleStrengths(
            intentA.armySize, intentB.armySize, 0, 'plain', false, rngVal,
          );
          const winnerId = attackStrength > defendStrength ? intentA.nationId
            : defendStrength > attackStrength ? intentB.nationId
            : null;

          // Determine Full CB: prior skirmish, competing claim, or hostile compat.
          const priorSkirmish = draft.borderSkirmishes.some(
            (s) => (s.nationAId === intentA.nationId && s.nationBId === intentB.nationId ||
                     s.nationAId === intentB.nationId && s.nationBId === intentA.nationId) &&
              world.tick - s.tick < SKIRMISH_FULL_CB_WINDOW, // [PLACEHOLDER callsite]
          );
          const competingClaim = draft.territoryClaims.some(
            (c) => (c.nationId === intentA.nationId || c.nationId === intentB.nationId) &&
              c.territoryId === skirmishTid,
          );
          // Compat check for Full CB: use a quick on-the-spot nation culture estimate.
          const skirmishTerrTmp = draft.territories[skirmishTid];
          let hostileCompat = false;
          if (skirmishTerrTmp) {
            // Compute culture inline to avoid forward reference to nationCultures map.
            const capA = draft.nations[intentA.nationId]?.capitalTerritoryId ?? null;
            const capB = draft.nations[intentB.nationId]?.capitalTerritoryId ?? null;
            const ncA = computeNationCulture(intentA.nationId, draft.territories as WorldState['territories'], capA);
            const ncB = computeNationCulture(intentB.nationId, draft.territories as WorldState['territories'], capB);
            const compatAB = computeCompatibility(skirmishTerrTmp.state.valueTraits, skirmishTerrTmp.def.culturalFamily, ncA);
            const compatBA = computeCompatibility(skirmishTerrTmp.state.valueTraits, skirmishTerrTmp.def.culturalFamily, ncB);
            hostileCompat = compatAB.total < SKIRMISH_HOSTILITY_COMPAT_THRESHOLD || // [PLACEHOLDER callsite]
              compatBA.total < SKIRMISH_HOSTILITY_COMPAT_THRESHOLD;
          }
          const fullCasusBelli = priorSkirmish || competingClaim || hostileCompat;

          const skirmish: import('./types').BorderSkirmish = {
            id: -(draft.borderSkirmishes.length + 1), // negative = new
            tick: world.tick + 1,
            territoryId: skirmishTid,
            nationAId: intentA.nationId,
            nationBId: intentB.nationId,
            armySizeA: intentA.armySize,
            armySizeB: intentB.armySize,
            winnerId,
            fullCasusBelli,
          };
          draft.borderSkirmishes.push(skirmish);

          const nameA = draft.nations[intentA.nationId]?.name ?? intentA.nationId;
          const nameB = draft.nations[intentB.nationId]?.name ?? intentB.nationId;
          const resultStr = winnerId ? `${draft.nations[winnerId]?.name ?? winnerId} wins` : 'draw';
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `Border skirmish in ${draft.territories[skirmishTid]?.def.name ?? skirmishTid}: ${nameA} vs ${nameB}. ${resultStr}. ${fullCasusBelli ? 'Full CB granted.' : 'Soft CB granted.'} [SKIRMISH]`,
          });
        }
      }
    }

    // ── §1.4 TerritoryModifier expiry ─────────────────────────────────────────
    // Remove modifiers whose expiresAtTick has passed.
    draft.territoryModifiers = draft.territoryModifiers.filter(
      (m) => m.expiresAtTick === null || m.expiresAtTick > world.tick + 1,
    );

    // ── §1.6 Embassy construction advancement ────────────────────────────────
    for (const emb of draft.embassies) {
      if (emb.status !== 'under_construction') continue;
      emb.constructionTicksLeft -= 1;
      if (emb.constructionTicksLeft <= 0) {
        emb.status = 'active';
        const embTerr = draft.territories[emb.hostTerritoryId];
        draft.eventLog.push({
          tick: world.tick + 1,
          message: `Embassy of ${draft.nations[emb.ownerNationId]?.name ?? emb.ownerNationId} in ${embTerr?.def.name ?? emb.hostTerritoryId} is now active. Visibility and compatibility effects begin.`,
        });
      }
    }

    // ── §1.6 Embassy destruction on ownership change ─────────────────────────
    // Any active/under_construction embassy whose hostTerritoryId changed owner is destroyed.
    for (const emb of draft.embassies) {
      if (emb.status === 'expelled' || emb.status === 'destroyed') continue;
      const hostTerr = draft.territories[emb.hostTerritoryId];
      if (!hostTerr) { emb.status = 'destroyed'; continue; }
      // Find what the territory owner was at start of tick (world.territories, pre-draft).
      const origOwner = world.territories[emb.hostTerritoryId]?.state.ownerId;
      const newOwner = hostTerr.state.ownerId;
      if (origOwner !== newOwner) {
        emb.status = 'destroyed';
        draft.eventLog.push({
          tick: world.tick + 1,
          message: `Embassy of ${draft.nations[emb.ownerNationId]?.name ?? emb.ownerNationId} in ${hostTerr.def.name} was destroyed — territory changed ownership.`,
        });
      }
    }

    // ── §1.6 Embassy Trust recovery ──────────────────────────────────────────
    // For each active embassy pair, apply passive Trust recovery bonus to both nations.
    // Only once per bilateral pair (avoid double-applying if two embassies face both ways).
    const embassyTrustPairs = new Set<string>();
    for (const emb of draft.embassies) {
      if (emb.status !== 'active') continue;
      const hostTerr = draft.territories[emb.hostTerritoryId];
      const hostNationId = hostTerr?.state.ownerId;
      if (!hostNationId || hostNationId === emb.ownerNationId) continue;
      const pairKey = [emb.ownerNationId, hostNationId].sort().join(':');
      if (embassyTrustPairs.has(pairKey)) continue;
      embassyTrustPairs.add(pairKey);
      const ownerNation = draft.nations[emb.ownerNationId];
      const hostNation = draft.nations[hostNationId];
      if (ownerNation) ownerNation.trust = Math.min(100, ownerNation.trust + EMBASSY_TRUST_RECOVERY_PER_TICK); // [PLACEHOLDER callsite: EMBASSY_TRUST_RECOVERY_PER_TICK]
      if (hostNation) hostNation.trust = Math.min(100, hostNation.trust + EMBASSY_TRUST_RECOVERY_PER_TICK); // [PLACEHOLDER callsite: EMBASSY_TRUST_RECOVERY_PER_TICK]
    }

    // ── Siege maintenance by army presence ────────────────────────────────────
    // Besieging armies auto-advance siege each tick without re-queuing.
    for (const war of draft.wars) {
      if (war.status !== 'active' && war.status !== 'peace_negotiation') continue;
      for (const [attackingNationId, defendingNationId] of [
        [war.attackerId, war.defenderId] as const,
        [war.defenderId, war.attackerId] as const,
      ]) {
        const besiegingArmies = draft.armies.filter(
          (a) => a.nationId === attackingNationId && a.status === 'besieging',
        );
        for (const army of besiegingArmies) {
          const targetTerr = draft.territories[army.territoryId];
          if (!targetTerr || targetTerr.state.ownerId !== defendingNationId) continue;

          // Check if already tracked in occupiedTerritories.
          const occIdx = war.occupiedTerritories.findIndex(
            (o) => o.territoryId === army.territoryId && o.occupyingNationId === attackingNationId,
          );
          if (occIdx === -1) {
            // Army just arrived — start siege tracking.
            war.occupiedTerritories.push({
              territoryId: army.territoryId,
              occupyingNationId: attackingNationId,
              siegeProgress: 1,
              siegeStartTick: world.tick,
            });
          } else {
            // Continuing siege — auto-advance.
            const occ = war.occupiedTerritories[occIdx]!;
            occ.siegeProgress += 1;
            // Garrison-gated siege requirement: a garrisoned fort takes longer to capture.
            const siegeGarrisonSize = computeGarrisonSize(draft.armies, army.territoryId);
            const siegeEffectiveFortLevel = computeEffectiveFortLevel(
              targetTerr.state.fortificationLevel,
              siegeGarrisonSize,
              FORT_UNGARRISONED_PENALTY,
              GARRISON_FULL_THRESHOLD,
            );
            const required = siegeTicksRequired(siegeEffectiveFortLevel);
            if (occ.siegeProgress >= required) {
              war.occupiedTerritories.splice(occIdx, 1);
              targetTerr.state.ownerId = attackingNationId;
              targetTerr.state.acquiredTick = world.tick;
              // Conquest shock: base × geography multiplier. [PLACEHOLDER callsite: GEOGRAPHY_SHOCK_MULTIPLIER]
              targetTerr.state.ownershipShock = Math.min(1, 0.50 * (GEOGRAPHY_SHOCK_MULTIPLIER[targetTerr.def.geography] ?? 1.0)); // [PLACEHOLDER callsite: GEOGRAPHY_SHOCK_MULTIPLIER]
              army.status = 'stationed';
              const attackerName = draft.nations[attackingNationId]?.name ?? attackingNationId;
              const defenderName = draft.nations[defendingNationId]?.name ?? defendingNationId;
              draft.eventLog.push({
                tick: world.tick + 1,
                message: `${attackerName} captured ${targetTerr.def.name} from ${defenderName} by siege (army presence).`,
              });
            }
          }
        }
      }
    }

    // ── Pacification resolution ───────────────────────────────────────────────
    // Each tick, for every TerritoryClaim where the nation has an army present: accumulate progress.
    // When progress >= PACIFICATION_THRESHOLD: transfer ownership.
    const claimsToDelete: number[] = [];
    for (const claim of draft.territoryClaims) {
      const claimTerr = draft.territories[claim.territoryId];
      if (!claimTerr) { claimsToDelete.push(claim.id); continue; }

      // If territory was claimed by another nation already, this claim is void.
      if (claimTerr.state.ownerId !== null) { claimsToDelete.push(claim.id); continue; }

      // Check for army presence.
      const presentArmy = draft.armies.find(
        (a) => a.nationId === claim.nationId && a.territoryId === claim.territoryId,
      );

      if (presentArmy) {
        // Compute pacification difficulty.
        const terrDiff = TERRAIN_DIFFICULTY[claimTerr.def.geography] ?? 1.0;
        const nativeDifficulty = terrDiff
          + claimTerr.def.basePopulation * POP_DIFFICULTY_SCALE;
        // Compatibility not available without nation culture; use 0.5 as placeholder.
        const armyStrength = presentArmy.size;
        const progressGain = armyStrength / nativeDifficulty;
        claim.pacificationProgress += progressGain;

        if (claim.pacificationProgress >= PACIFICATION_THRESHOLD) {
          claimTerr.state.ownerId = claim.nationId;
          claimTerr.state.acquiredTick = world.tick;
          // Harder territories generate more shock.
          claimTerr.state.ownershipShock = Math.min(0.50, 0.20 + nativeDifficulty * 0.05);
          presentArmy.status = 'stationed';
          const nationName = draft.nations[claim.nationId]?.name ?? claim.nationId;
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `${nationName} has pacified and annexed ${claimTerr.def.name}.`,
          });
          claimsToDelete.push(claim.id);
        }
      } else {
        // Army absent — decay progress.
        claim.pacificationProgress = Math.max(0, claim.pacificationProgress - PACIFICATION_DECAY_PER_TICK);
      }
    }
    // Remove completed or voided claims.
    for (const id of claimsToDelete) {
      const idx = draft.territoryClaims.findIndex((c) => c.id === id);
      if (idx !== -1) draft.territoryClaims.splice(idx, 1);
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
      } else if (completedType === 'market') {
        t.state.hasMarket = true;
        draft.eventLog.push({ tick: world.tick + 1, message: `${ownerName} completed a market in ${t.def.name}.` });
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

      // Tribute transfers fire every tick — §1.10 auto-assign: distribute proportionally
      // across owned territories weighted by their baseWealth production rate.
      // If sourceTerritoryId is present on a tribute clause payload (legacy/manual pin),
      // use existing direct stockpile deduction. Otherwise auto-assign.
      const transfers = computeTributeTransfers(treaty);
      for (const { fromId, toId, amount } of transfers) {
        const from = draft.nations[fromId];
        const to = draft.nations[toId];
        if (!from || !to) continue;

        // §1.10 Auto-assign tribute: deduct proportionally from territory local Wealth stockpiles.
        // Territories weighted by baseWealth (their wealth production rate this tick).
        const fromTerritories = Object.values(draft.territories).filter(
          (t) => t.state.ownerId === fromId && !t.state.isInRevolt,
        );
        const totalWealthRate = fromTerritories.reduce((s, t) => s + t.def.baseWealth, 0);
        if (totalWealthRate > 0) {
          // Check total available local wealth (pre-flush — still in local stockpiles this tick).
          const totalLocalWealth = fromTerritories.reduce((s, t) => s + t.state.localWltStock, 0)
            + from.stockpiles.wealth;
          if (totalLocalWealth < amount) {
            // Wealth goes negative — tribute deducted anyway (insolvency path unchanged).
          }
          // Distribute deduction proportionally across local stockpiles, then overflow to general.
          let remaining = amount;
          for (const t of fromTerritories) {
            const share = amount * (t.def.baseWealth / totalWealthRate);
            const fromLocal = Math.min(t.state.localWltStock, share);
            t.state.localWltStock -= fromLocal;
            remaining -= fromLocal;
          }
          // Any remaining deduction comes from general stockpile.
          from.stockpiles.wealth -= remaining;
        } else {
          // No territories — fall back to direct stockpile deduction (original path).
          from.stockpiles.wealth -= amount;
        }

        // §v0.40 Diminishing returns: receiver's effective gain scales down as they get wealthier.
        // tributeEffectiveValue = amount × (1 − min(CAP, receiverWealth / SCALE))
        // [PLACEHOLDER callsite: TRIBUTE_DIMINISHING_SCALE, TRIBUTE_DIMINISHING_CAP]
        const receiverWealth = to.stockpiles.wealth;
        const diminishFactor = Math.min(TRIBUTE_DIMINISHING_CAP, Math.max(0, receiverWealth / TRIBUTE_DIMINISHING_SCALE));
        const effectiveTribute = amount * (1 - diminishFactor);
        to.stockpiles.wealth += effectiveTribute;
        // Remainder of the tribute (the diminished portion) is lost — models diminishing marginal value,
        // not a transfer back to the payer. The payer still loses the full amount.

        // §v0.40 Exploitation cost: if payer is much smaller than receiver (territory count),
        // the receiver incurs unrest + Prestige penalty for the exploitation optics.
        // Metric: territory count (stable proxy for power; stockpiles fluctuate too much).
        // [PLACEHOLDER callsite: TRIBUTE_EXPLOITATION_THRESHOLD, TRIBUTE_EXPLOITATION_UNREST, TRIBUTE_EXPLOITATION_PRESTIGE_PENALTY]
        const payerTerritoryCount = Object.values(draft.territories).filter(
          (t) => t.state.ownerId === fromId,
        ).length;
        const receiverTerritoryCount = Object.values(draft.territories).filter(
          (t) => t.state.ownerId === toId,
        ).length;
        const isExploitative = receiverTerritoryCount > 0
          && (payerTerritoryCount / receiverTerritoryCount) < TRIBUTE_EXPLOITATION_THRESHOLD;
        if (isExploitative) {
          // Prestige penalty for receiver (exploitation stigma).
          to.prestige = Math.max(0, to.prestige - TRIBUTE_EXPLOITATION_PRESTIGE_PENALTY);
          // Unrest pressure on all receiver territories.
          for (const t of Object.values(draft.territories)) {
            if (t.state.ownerId !== toId) continue;
            // Applied via TerritoryModifier with 1-tick duration so it renews each tick the clause is active.
            const modId = -(world.tick * 1000000 + Math.abs(treaty.id) * 10 + 7);
            const existingMod = draft.territoryModifiers.find(
              (m) => m.id === modId && m.territoryId === t.def.id,
            );
            if (existingMod) {
              existingMod.expiresAtTick = world.tick + 2; // extend by 1 tick
            } else {
              draft.territoryModifiers.push({
                id: modId - draft.territoryModifiers.length,
                territoryId: t.def.id,
                source: 'tribute_exploitation',
                movementMultiplier: 1.0,
                productionMultiplier: 1.0,
                unrestEquilibriumAdj: TRIBUTE_EXPLOITATION_UNREST,
                driftRateMultiplier: 1.0,
                defenseBonus: 0,
                startTick: world.tick + 1,
                durationTicks: 2,
                expiresAtTick: world.tick + 3,
              });
            }
          }
        }
      }

      // Trade clause flows — §1.10 auto-assign and manual pin.
      for (const clause of treaty.clauses) {
        if (clause.type !== 'trade') continue;
        if (clause.clauseStatus !== 'active') continue;

        const payload = clause.payload as {
          resource: string; amount: number; fromNationId: string; toNationId: string;
          sourceTerritoryId?: string | null;
        };
        const { resource, amount, fromNationId, toNationId } = payload;
        const sourceTerritoryId = payload.sourceTerritoryId ?? null;

        const fromNation = draft.nations[fromNationId];
        const toNation = draft.nations[toNationId];
        if (!fromNation || !toNation) {
          clause.missedPayments += 1;
          draft.eventLog.push({ tick: world.tick + 1, message: `Trade clause missed_payment: treaty #${treaty.id} clause ${clause.clauseIndex} — nation missing.` });
          continue;
        }

        const nf = resourceToNationStockpileField(resource as import('./types').TradeResource);

        if (sourceTerritoryId) {
          // ── Manual pin: existing behavior ────────────────────────────────────
          const sourceTerr = draft.territories[sourceTerritoryId];
          if (!sourceTerr) {
            clause.missedPayments += 1;
            draft.eventLog.push({ tick: world.tick + 1, message: `Trade clause missed_payment: treaty #${treaty.id} clause ${clause.clauseIndex} — source territory missing.` });
          } else if (sourceTerr.state.ownerId !== fromNationId) {
            clause.clauseStatus = 'degraded';
            draft.eventLog.push({ tick: world.tick + 1, message: `Trade clause degraded: treaty #${treaty.id} clause ${clause.clauseIndex} — ${sourceTerritoryId} no longer owned by sender.` });
          } else {
            const available = fromNation.stockpiles[nf];
            if (available < amount) {
              clause.missedPayments += 1;
              draft.eventLog.push({ tick: world.tick + 1, message: `Trade clause missed_payment: treaty #${treaty.id} clause ${clause.clauseIndex} — insufficient ${resource} (have ${available.toFixed(1)}, need ${amount}).` });
              if (clause.missedPayments >= TRADE_MISSED_PAYMENT_BREACH_THRESHOLD) {
                clause.clauseStatus = 'breached';
                fromNation.trust = Math.max(0, fromNation.trust - TRUST_BREAK_PENALTY);
                fromNation.lastBrokenPromiseTick = world.tick;
                draft.eventLog.push({ tick: world.tick + 1, message: `Trade clause breached: treaty #${treaty.id} clause ${clause.clauseIndex} — ${clause.missedPayments} consecutive missed payments. Trust penalty applied.` });
              }
            } else {
              fromNation.stockpiles[nf] -= amount;
              toNation.stockpiles[nf] += amount;
              clause.missedPayments = 0;
            }
          }
        } else {
          // ── §1.10 Auto-assign: distribute proportionally across owned territories ────
          // Weight each non-revolting owned territory by its relevant base production rate.
          const localField = resource === 'population' ? 'localPopStock'
            : resource === 'industry' ? 'localIndStock'
            : 'localWltStock';
          const baseField = resource === 'population' ? 'basePopulation'
            : resource === 'industry' ? 'baseIndustry'
            : 'baseWealth';

          const senderTerritories = Object.values(draft.territories).filter(
            (t) => t.state.ownerId === fromNationId && !t.state.isInRevolt,
          );
          const totalRate = senderTerritories.reduce(
            (s, t) => s + (t.def[baseField as keyof typeof t.def] as number), 0,
          );

          // Check total available (local + general).
          const totalLocalAvail = senderTerritories.reduce(
            (s, t) => s + (t.state[localField as keyof typeof t.state] as number), 0,
          );
          const totalAvail = totalLocalAvail + fromNation.stockpiles[nf];

          if (totalAvail < amount) {
            clause.missedPayments += 1;
            draft.eventLog.push({ tick: world.tick + 1, message: `Trade clause missed_payment: treaty #${treaty.id} clause ${clause.clauseIndex} — insufficient ${resource} across all territories (have ${totalAvail.toFixed(1)}, need ${amount}).` });
            if (clause.missedPayments >= TRADE_MISSED_PAYMENT_BREACH_THRESHOLD) {
              clause.clauseStatus = 'breached';
              fromNation.trust = Math.max(0, fromNation.trust - TRUST_BREAK_PENALTY);
              fromNation.lastBrokenPromiseTick = world.tick;
              draft.eventLog.push({ tick: world.tick + 1, message: `Trade clause breached: treaty #${treaty.id} clause ${clause.clauseIndex} — ${clause.missedPayments} consecutive missed payments. Trust penalty applied.` });
            }
          } else {
            // Deduct proportionally from each territory's local stockpile.
            let remaining = amount;
            if (totalRate > 0) {
              for (const t of senderTerritories) {
                const rate = t.def[baseField as keyof typeof t.def] as number;
                const share = amount * (rate / totalRate);
                const local = t.state[localField as keyof typeof t.state] as number;
                const fromLocal = Math.min(local, share);
                (t.state as Record<string, number>)[localField] = local - fromLocal;
                remaining -= fromLocal;
              }
            }
            // Overflow to general stockpile.
            fromNation.stockpiles[nf] -= remaining;
            toNation.stockpiles[nf] += amount;
            clause.missedPayments = 0;
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

      // ── §1.5 Territory cession clause evaluation ─────────────────────────────
      for (const clause of treaty.clauses) {
        if (clause.type !== 'territory_cession') continue;
        if (clause.clauseStatus !== 'active') continue;

        const cp = clause.payload as {
          territoryId: string; fromNationId: string; toNationId: string;
          transferAtTick: number; delayedSinceTick?: number;
        };
        if (!cp.territoryId || !cp.fromNationId || !cp.toNationId) continue;

        const cessionTerr = draft.territories[cp.territoryId];
        if (!cessionTerr) { clause.clauseStatus = 'degraded'; continue; }

        // Only process once transferAtTick is reached.
        if (world.tick + 1 < cp.transferAtTick) continue;

        // §1.5 Embassy check: receiving nation must have an active embassy in this territory.
        // Exception: unclaimed territories (ownerId null) do not require an embassy.
        const embassyPresent = cp.fromNationId === null
          || draft.embassies.some(
            (e) => e.status === 'active' && e.ownerNationId === cp.toNationId && e.hostTerritoryId === cp.territoryId,
          );

        if (embassyPresent) {
          // Execute transfer.
          cessionTerr.state.ownerId = cp.toNationId;
          cessionTerr.state.acquiredTick = world.tick;
          const geoShockMult = GEOGRAPHY_SHOCK_MULTIPLIER[cessionTerr.def.geography] ?? 1.0; // [PLACEHOLDER callsite]
          cessionTerr.state.ownershipShock = Math.min(1, 0.50 * geoShockMult);
          clause.clauseStatus = 'degraded'; // clause consumed — mark degraded to stop re-firing
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `Territory cession executed: ${cessionTerr.def.name} transferred from ${draft.nations[cp.fromNationId]?.name ?? cp.fromNationId} to ${draft.nations[cp.toNationId]?.name ?? cp.toNationId}.`,
          });
        } else {
          // No embassy — check grace period. [PLACEHOLDER callsite: CESSION_EMBASSY_GRACE_TICKS]
          const delayedSince = cp.delayedSinceTick ?? (world.tick + 1);
          if (!cp.delayedSinceTick) {
            (clause.payload as Record<string, unknown>)['delayedSinceTick'] = world.tick + 1;
          }
          const ticksWaited = world.tick + 1 - delayedSince;
          if (ticksWaited >= CESSION_EMBASSY_GRACE_TICKS) {
            // Grace period expired — breach: receiver failed to build embassy.
            clause.clauseStatus = 'breached';
            const receiverNation = draft.nations[cp.toNationId];
            if (receiverNation) {
              receiverNation.trust = Math.max(0, receiverNation.trust - TRUST_BREAK_PENALTY);
              receiverNation.lastBrokenPromiseTick = world.tick;
              // Collateral: receiver's deposit → sender.
              const receiverCollateral = treaty.collateralByParty[cp.toNationId] ?? 0;
              if (receiverCollateral > 0) {
                const senderNation = draft.nations[cp.fromNationId];
                if (senderNation) senderNation.stockpiles.wealth += receiverCollateral;
                treaty.collateralByParty[cp.toNationId] = 0;
              }
            }
            draft.eventLog.push({
              tick: world.tick + 1,
              message: `Territory cession breached: ${draft.nations[cp.toNationId]?.name ?? cp.toNationId} failed to establish embassy in ${cessionTerr.def.name} within ${CESSION_EMBASSY_GRACE_TICKS} ticks. [PLACEHOLDER: CESSION_EMBASSY_GRACE_TICKS]`,
            });
          } else {
            draft.eventLog.push({
              tick: world.tick + 1,
              message: `Territory cession for ${cessionTerr.def.name} delayed — no embassy present (grace tick ${ticksWaited}/${CESSION_EMBASSY_GRACE_TICKS}). [PLACEHOLDER: CESSION_EMBASSY_GRACE_TICKS]`,
            });
          }
        }
      }

      // ── §1.2 Population transfer clause evaluation ────────────────────────────
      for (const clause of treaty.clauses) {
        if (clause.type !== 'population_transfer') continue;
        if (clause.clauseStatus !== 'active') continue;

        const pp = clause.payload as {
          amount: number; fromNationId: string; toNationId: string; transferAtTick: number;
        };
        if (!pp.fromNationId || !pp.toNationId || typeof pp.amount !== 'number') continue;
        if (world.tick + 1 !== pp.transferAtTick) continue; // only fires exactly at transferAtTick

        const fromNation = draft.nations[pp.fromNationId];
        const toNation = draft.nations[pp.toNationId];
        if (!fromNation || !toNation) { clause.clauseStatus = 'degraded'; continue; }

        // Transfer population stockpile.
        fromNation.stockpiles.population -= pp.amount;
        toNation.stockpiles.population += pp.amount;

        // Compute compatibility-scaled unrest shock per territory and store the per-territory magnitude.
        // (v0.40 fix: previously shockMagnitude was computed but discarded via `void shockMagnitude`;
        //  this fix stores it in TerritoryState.populationTransferShockMagnitude so the territory loop
        //  uses the correct compat-scaled value rather than the fixed POPULATION_TRANSFER_UNREST_SCALE.)
        // Use nation culture of the receiver; apply to all territories of both nations.
        // Computed inline to avoid forward reference — nationCultures is declared later in tick.ts.
        const receiverCapital = draft.nations[pp.toNationId]?.capitalTerritoryId ?? null;
        const receiverCulture = computeNationCulture(pp.toNationId, draft.territories as WorldState['territories'], receiverCapital);
        for (const t of Object.values(draft.territories)) {
          if (t.state.ownerId !== pp.fromNationId && t.state.ownerId !== pp.toNationId) continue;
          let compatScore = 0.5; // default if culture not computed yet
          if (receiverCulture) {
            const compat = computeCompatibility(t.state.valueTraits, t.def.culturalFamily, receiverCulture);
            compatScore = compat.total;
          }
          // shockMagnitude: high compat → small shock (near 0); low compat → large shock (up to SCALE).
          const shockMagnitude = (1 - compatScore) * POPULATION_TRANSFER_UNREST_SCALE; // [PLACEHOLDER callsite]
          t.state.populationTransferShockTicksLeft = POPULATION_TRANSFER_SHOCK_DURATION; // [PLACEHOLDER callsite]
          t.state.populationTransferShockMagnitude = shockMagnitude; // stored for territory loop use
        }

        clause.clauseStatus = 'degraded'; // one-time transfer, consume clause
        draft.eventLog.push({
          tick: world.tick + 1,
          message: `Population transfer: ${pp.amount} population from ${fromNation.name} to ${toNation.name}. Unrest spike applied for ${POPULATION_TRANSFER_SHOCK_DURATION} ticks (compat-scaled). [PLACEHOLDER: POPULATION_TRANSFER_UNREST_SCALE=${POPULATION_TRANSFER_UNREST_SCALE}]`,
        });
      }

      // ── §1.1 Army lending clause evaluation ──────────────────────────────────
      // Delivery and return logistics are tracked via deliveredAtTick / returnDueAtTick.
      // Actual army movement uses the existing move_army infrastructure.
      for (const clause of treaty.clauses) {
        if (clause.type !== 'army_lending') continue;
        if (clause.clauseStatus !== 'active') continue;

        const ap = clause.payload as {
          armySize: number; lendingNationId: string; receivingNationId: string;
          deliveryTerritoryId: string; returnTerritoryId: string; loanDurationTicks: number;
          deliveredAtTick: number | null; returnDueAtTick: number | null; sold: boolean;
        };
        if (!ap.lendingNationId || !ap.receivingNationId) continue;

        // Check for war between the two parties — immediate revoke. [TODO: travel time on revoke]
        const lenderAtWar = draft.wars.some(
          (w) => (w.status === 'active' || w.status === 'peace_negotiation') &&
            ((w.attackerId === ap.lendingNationId && w.defenderId === ap.receivingNationId) ||
             (w.attackerId === ap.receivingNationId && w.defenderId === ap.lendingNationId)),
        );
        if (lenderAtWar) {
          // Immediate revoke — find and return the loaned army.
          // [TODO: travel time on revoke — currently teleports back]
          const loanedArmy = draft.armies.find(
            (a) => a.nationId === ap.receivingNationId &&
              (ap.deliveredAtTick !== null), // armies transferred on delivery
          );
          if (loanedArmy) {
            loanedArmy.nationId = ap.lendingNationId;
            loanedArmy.territoryId = ap.returnTerritoryId;
            loanedArmy.status = 'stationed';
          }
          clause.clauseStatus = 'degraded';
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `Army lending revoked: war declared between ${draft.nations[ap.lendingNationId]?.name ?? ap.lendingNationId} and ${draft.nations[ap.receivingNationId]?.name ?? ap.receivingNationId}. Loaned army returned. [TODO: travel time on revoke]`,
          });
          continue;
        }

        // Return check: army due back?
        if (ap.returnDueAtTick !== null && world.tick + 1 >= ap.returnDueAtTick && !ap.sold) {
          // Find loaned army and return it.
          const returnArmy = draft.armies.find(
            (a) => a.nationId === ap.receivingNationId,
          );
          const returnedSize = returnArmy?.size ?? 0;
          if (returnArmy) {
            returnArmy.nationId = ap.lendingNationId;
            returnArmy.territoryId = ap.returnTerritoryId;
            returnArmy.status = 'stationed';
          }

          // Return penalty if army was reduced. [PLACEHOLDER callsite: quadratic penalty]
          const lostUnits = Math.max(0, ap.armySize - returnedSize);
          if (lostUnits > 0) {
            const penaltyFrac = Math.pow(lostUnits / ap.armySize, 2); // quadratic
            const penaltyAmount = (treaty.collateralByParty[ap.receivingNationId] ?? 0) * penaltyFrac;
            const receiverNation = draft.nations[ap.receivingNationId];
            const lenderNation = draft.nations[ap.lendingNationId];
            if (receiverNation && lenderNation && penaltyAmount > 0) {
              receiverNation.stockpiles.wealth -= penaltyAmount;
              lenderNation.stockpiles.wealth += penaltyAmount;
              draft.eventLog.push({
                tick: world.tick + 1,
                message: `Army lending return penalty: ${penaltyAmount.toFixed(1)} Wealth transferred to ${lenderNation.name} for ${lostUnits} missing soldiers (quadratic penalty). [PLACEHOLDER]`,
              });
            }
          }

          clause.clauseStatus = 'degraded'; // lending complete
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `Army lending complete: loaned army returned to ${draft.nations[ap.lendingNationId]?.name ?? ap.lendingNationId}.`,
          });
        }
      }

      // ── §1.11 Outpost clause — no per-tick action needed ──────────────────────
      // Outpost clauses grant visibility via computeVisibility reading active treaty clauses.
      // Construction state (pending → active) is tracked via the territory's constructionType.
      // When the outpost construction completes (type 'outpost'), the clause becomes active.
      // Destruction on ownership change is handled in the territory acquisition code above:
      // if a territory with an outpost clause changes owner, the clause degrades automatically.
      for (const clause of treaty.clauses) {
        if (clause.type !== 'outpost') continue;
        if (clause.clauseStatus !== 'active') continue;
        const op = clause.payload as { targetTerritoryId: string };
        if (!op.targetTerritoryId) continue;
        const outpostTerr = draft.territories[op.targetTerritoryId];
        if (!outpostTerr) { clause.clauseStatus = 'degraded'; continue; }
        // If territory changed owner, degrade the outpost clause.
        const grantingNationId = treaty.partyIds.find(
          (id) => id !== (clause.payload as { grantedToNationId?: string }).grantedToNationId,
        );
        if (grantingNationId && outpostTerr.state.ownerId !== grantingNationId) {
          clause.clauseStatus = 'degraded';
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `Outpost in ${outpostTerr.def.name} destroyed — territory changed ownership. Outpost clause degraded.`,
          });
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
          nation.completedTreatiesKept += 1; // Prestige counter: early-complete counts as kept
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

      // trade_route clause expiry: fire loss event on associated TradeRouteAgreement.
      for (const clause of treaty.clauses) {
        if (clause.type !== 'trade_route') continue;
        const route = draft.tradeRouteAgreements.find(
          (r) => r.treatyClauseId === clause.id && r.status === 'active',
        );
        if (route) {
          applyRouteLossEvent(route, draft, world.tick + 1);
        }
      }

      treaty.status = 'expired';
      const bonus = trustCompletionBonus(treaty.termTicks);
      for (const partyId of treaty.partyIds) {
        const nation = draft.nations[partyId];
        if (!nation) continue;
        nation.trust = Math.min(100, nation.trust + bonus);
        nation.completedTreatiesKept += 1; // Prestige counter: treaty kept to full term
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
      nation.stockpiles.wealth -= fine; // wealth may go negative (insolvency)
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
    // Track most-recent acquisition tick per nation for expansionist stagnation check (2.2).
    const latestAcquisitionTickByNation: Record<string, number> = {};
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
        // Latest acquisition tick for expansionist stagnation check.
        const prev = latestAcquisitionTickByNation[oid];
        if (prev === undefined || t.state.acquiredTick > prev) {
          latestAcquisitionTickByNation[oid] = t.state.acquiredTick;
        }
      }
    }

    // ── Expansionist stagnation relief (v0.41) ────────────────────────────────
    // Two additional reset conditions for the expansionist stagnation timer:
    // 1. New treaty signed this tick: treaty.tickStarted === world.tick + 1 (treaties activate next tick).
    // 2. Trade route capacity growth >= EXPANSIONIST_TRADE_GROWTH_THRESHOLD since last reset.
    //
    // Both update latestAcquisitionTickByNation (the stagnation timer) to current tick.
    // No separate timer — the acquisition tick is the unified stagnation timer.

    // Relief condition 1: new treaty signed this tick.
    // Treaties created before this tick run have tickStarted = world.tick (the pre-tick world tick).
    for (const treaty of draft.treaties) {
      if (treaty.tickStarted !== world.tick) continue;
      if (treaty.status !== 'active') continue;
      for (const partyId of treaty.partyIds) {
        // Reset stagnation timer for each treaty party — both in the local map and persisted on the nation.
        const prev = latestAcquisitionTickByNation[partyId];
        if (prev === undefined || world.tick > prev) {
          latestAcquisitionTickByNation[partyId] = world.tick;
        }
        const nation = draft.nations[partyId];
        if (nation) {
          const prevReset = nation.lastExpansionistResetTick;
          if (prevReset === null || world.tick > prevReset) {
            nation.lastExpansionistResetTick = world.tick;
          }
        }
      }
    }

    // Relief condition 2: trade route capacity growth.
    // Compute total active route capacity per nation this tick.
    const totalTradeCapacityByNation: Record<string, number> = {};
    for (const route of draft.tradeRouteAgreements) {
      if (route.status !== 'active') continue;
      const parties = [route.ownerNationId, ...(route.partnerNationId ? [route.partnerNationId] : [])];
      for (const nid of parties) {
        totalTradeCapacityByNation[nid] = (totalTradeCapacityByNation[nid] ?? 0) + route.currentCapacity;
      }
    }
    for (const [nid, currentCapacity] of Object.entries(totalTradeCapacityByNation)) {
      const nation = draft.nations[nid];
      if (!nation) continue;
      const baseline = nation.lastStagnationCapacityBaseline;
      const growth = currentCapacity - baseline;
      if (growth >= EXPANSIONIST_TRADE_GROWTH_THRESHOLD) { // [PLACEHOLDER callsite: EXPANSIONIST_TRADE_GROWTH_THRESHOLD]
        // Reset stagnation timer — both in local map and persisted on nation.
        const prev = latestAcquisitionTickByNation[nid];
        if (prev === undefined || world.tick > prev) {
          latestAcquisitionTickByNation[nid] = world.tick;
        }
        const prevReset = nation.lastExpansionistResetTick;
        if (prevReset === null || world.tick > prevReset) {
          nation.lastExpansionistResetTick = world.tick;
        }
        // Update baseline so we measure growth from the new level.
        nation.lastStagnationCapacityBaseline = currentCapacity;
      }
    }
    // Initialize baseline for nations without routes (capacity = 0).
    for (const [nid, nation] of Object.entries(draft.nations)) {
      if (totalTradeCapacityByNation[nid] === undefined) {
        nation.lastStagnationCapacityBaseline = 0;
      }
    }

    const nationCultures: Record<string, ReturnType<typeof computeNationCulture>> = {};
    for (const nationId of Object.keys(draft.nations)) {
      const cap = draft.nations[nationId]?.capitalTerritoryId ?? null;
      nationCultures[nationId] = computeNationCulture(nationId, draft.territories as WorldState['territories'], cap);
    }

    // ── Per-nation pre-computations for cultural constraint axes (2.2) ─────────

    // Active treaty count per nation (already computed above for Low-Trust fines — reuse).
    // activeTreatyCountByNation is already populated.

    // Tribute obligations per nation: count clauses where nation is the payer.
    const tributeObligationsAsPayer: Record<string, number> = {};
    // Count clauses where nation is the receiver of tribute or solidarity obligations.
    const tributeObligationsAsReceiver: Record<string, boolean> = {};
    for (const treaty of draft.treaties) {
      if (!isTreatyOperational(treaty)) continue;
      for (const clause of treaty.clauses) {
        if (clause.type !== 'tribute') continue;
        const { fromNationId, toNationId } = clause.payload as { fromNationId: string; toNationId: string };
        if (fromNationId) {
          tributeObligationsAsPayer[fromNationId] = (tributeObligationsAsPayer[fromNationId] ?? 0) + 1;
        }
        if (toNationId) {
          tributeObligationsAsReceiver[toNationId] = true;
        }
      }
    }

    // ── Trade route cultural feedback pre-computation ────────────────────────
    // Compute merchant pressure and route count pressure per nation before the territory loop.
    // merchantPressure: drives drift toward individualist on endpoint territories.
    // routeCountPressure: adds to isolationistEntanglement on isolationist territories.
    // Both are portfolio-aware: the aggregate across all active routes matters, not any single route.
    const routeMerchantPressureByNation: Record<string, number> = {};
    const routeCountByNation: Record<string, number> = {};
    // Gross wealth output per nation (non-revolting territories) — denominator for merchant pressure.
    const nationEconomicOutput: Record<string, number> = {};
    for (const t of Object.values(draft.territories)) {
      const oid = t.state.ownerId;
      if (!oid || t.state.isInRevolt) continue;
      nationEconomicOutput[oid] = (nationEconomicOutput[oid] ?? 0) + t.def.baseWealth;
    }
    for (const route of draft.tradeRouteAgreements) {
      if (route.status !== 'active') continue;
      const parties = [route.ownerNationId, ...(route.partnerNationId ? [route.partnerNationId] : [])];
      for (const nid of parties) {
        routeCountByNation[nid] = (routeCountByNation[nid] ?? 0) + 1;
        const output = nationEconomicOutput[nid] ?? 1;
        const pressure = (route.currentCapacity / output) * ROUTE_MERCHANT_PRESSURE_WEIGHT;
        routeMerchantPressureByNation[nid] = (routeMerchantPressureByNation[nid] ?? 0) + pressure;
      }
    }

    // ── 2.1 Trade → territory set pre-computation ─────────────────────────────
    // Build a set of territory IDs on active trade route computedPaths, keyed by
    // receiving nation ID. A territory on N paths for the same nation gets N×TRADE_STABILITY_BONUS.
    // Read from world.tradeRoutes (pre-tick, stable reference).
    const tradeRouteTerritoryBonus: Record<string, number> = {}; // territoryId → negative bonus count
    const tradeRouteTerritoryReceiver: Record<string, Set<string>> = {}; // territoryId → receiverNationIds

    for (const route of world.tradeRoutes) {
      if (!route.path || route.path.length === 0) continue;
      // Find the treaty clause to get the receiver nation.
      // The clause's toNationId is the receiver — use destinationNationId on the route.
      const receiverNationId = route.destinationNationId;
      if (!receiverNationId) continue;

      for (const tid of route.path) {
        tradeRouteTerritoryBonus[tid] = (tradeRouteTerritoryBonus[tid] ?? 0) + 1;
        if (!tradeRouteTerritoryReceiver[tid]) tradeRouteTerritoryReceiver[tid] = new Set();
        tradeRouteTerritoryReceiver[tid]!.add(receiverNationId);
      }
    }

    // ── War-unrest pre-computation ────────────────────────────────────────────
    // Compute per-nation war-driven unrest modifiers before the territory loop.
    // These are additive to the equilibrium computed by computeUnrestEquilibrium.

    const nationAtWar = new Set<string>();
    const warOverextensionByNation: Record<string, number> = {};
    const warInsolventNations = new Set<string>();
    const warNoCBDeclarer = new Set<string>(); // no-CB spike still active
    const warExhaustionNations = new Set<string>(); // exhaustion bump from declined peace
    // Nations that are non-Dominant and currently attacking a Dominant nation.
    // Grants Militaristic territory unrest bonus for the war's duration.
    // [PLACEHOLDER callsite: DOMINANT_WAR_MILITARISTIC_BONUS]
    const dominantWarAttackers = new Set<string>();

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

      // Dominant giant-killer: non-Dominant attacking Dominant → Militaristic bonus.
      const attackerDominant = draft.nations[war.attackerId]?.isDominant ?? false;
      const defenderDominant = draft.nations[war.defenderId]?.isDominant ?? false;
      if (!attackerDominant && defenderDominant) {
        dominantWarAttackers.add(war.attackerId);
      }
    }

    // Insolvency: wealthStock < 0 OR debtBalance > 0 (still in recovery).
    // warInsolventNations: subset at war (WAR_INSOLVENCY_UNREST_PER_TICK applies).
    // generalInsolventNations: all insolvent nations (INSOLVENCY_GENERAL_UNREST_PER_TICK applies).
    const generalInsolventNations = new Set<string>();
    for (const nation of Object.values(draft.nations)) {
      const isInsolvent = nation.stockpiles.wealth < 0 || nation.debtBalance > 0;
      if (isInsolvent) {
        generalInsolventNations.add(nation.id);
        if (nationAtWar.has(nation.id)) {
          warInsolventNations.add(nation.id);
        }
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
      // Additional bonus for Militaristic territories of a non-Dominant attacker vs Dominant defender.
      // [PLACEHOLDER callsite: DOMINANT_WAR_MILITARISTIC_BONUS]
      const militaryBonus = (nationAtWar.has(ownerId) && t.state.valueTraits.militaristic > 0.3)
        ? WAR_MILITARISTIC_HAPPINESS_BONUS
          + (dominantWarAttackers.has(ownerId) ? DOMINANT_WAR_MILITARISTIC_BONUS : 0)
        : 0;

      // ── Garrison size for this territory ────────────────────────────────────
      // Sum of stationed army sizes owned by this nation at this territory.
      // Used for: effectiveFortLevel in unrest equilibrium, garrison upkeep reduction, and
      // garrison unrest suppression (Part 4).
      const garrisonSize = computeGarrisonSize(draft.armies, t.def.id);
      // Garrison-gated effective fort level for passive unrest contribution.
      // A fort with no garrison provides less stability protection than a garrisoned one.
      const effectiveFortLevelUnrest = computeEffectiveFortLevel(
        t.state.fortificationLevel,
        garrisonSize,
        FORT_UNGARRISONED_PENALTY,   // [PLACEHOLDER callsite: FORT_UNGARRISONED_PENALTY]
        GARRISON_FULL_THRESHOLD,     // [PLACEHOLDER callsite: GARRISON_FULL_THRESHOLD]
      );

      // General insolvency pressure: applies when wealthStock < 0, even outside war.
      const insolvencyPressure = generalInsolventNations.has(ownerId)
        ? INSOLVENCY_GENERAL_UNREST_PER_TICK
        : 0;

      // ── 2.1 Trade stability (named component) ────────────────────────────────
      // For every active trade clause flowing through this territory's path:
      // apply −TRADE_STABILITY_BONUS per clause to the receiving nation's territories on the path.
      // Territories owned by the receiving nation get the bonus. [PLACEHOLDER callsite: TRADE_STABILITY_BONUS]
      const tradeRouteCount = tradeRouteTerritoryBonus[t.def.id] ?? 0;
      const receiverIds = tradeRouteTerritoryReceiver[t.def.id];
      const isOnReceiverPath = receiverIds?.has(ownerId) ?? false;
      const tradeStability = (tradeRouteCount > 0 && isOnReceiverPath)
        ? -(tradeRouteCount * TRADE_STABILITY_BONUS) // [PLACEHOLDER callsite: TRADE_STABILITY_BONUS]
        : 0;

      // ── 2.2 Cultural constraint axes ─────────────────────────────────────────

      // isolationist_entanglement: isolationist > 0.3 (expansionist < −0.3) AND treaty count > threshold.
      // Also adds routeCountPressure from active trade routes (separate counter, separate threshold).
      // [PLACEHOLDER callsite: ISOLATIONIST_TREATY_THRESHOLD, ISOLATIONIST_ENTANGLEMENT_WEIGHT]
      let isolationistEntanglement = 0;
      if (t.state.valueTraits.expansionist < -0.3) {
        const treatyCount = activeTreatyCountByNation[ownerId] ?? 0;
        if (treatyCount > ISOLATIONIST_TREATY_THRESHOLD) {
          isolationistEntanglement = (treatyCount - ISOLATIONIST_TREATY_THRESHOLD) * ISOLATIONIST_ENTANGLEMENT_WEIGHT; // [PLACEHOLDER]
        }
        // Route count pressure — SEPARATE from treaty count, distinct threshold.
        const routeCount = routeCountByNation[ownerId] ?? 0;
        if (routeCount > ROUTE_ISOLATIONIST_THRESHOLD) {
          isolationistEntanglement += (routeCount - ROUTE_ISOLATIONIST_THRESHOLD) * ROUTE_ISOLATIONIST_COUNT_WEIGHT; // [PLACEHOLDER]
        }
      }

      // expansionist_stagnation: expansionist > 0.3 AND no territory acquired in last EXPANSIONIST_GROWTH_WINDOW ticks.
      // [PLACEHOLDER callsite: EXPANSIONIST_GROWTH_WINDOW, EXPANSIONIST_STAGNATION_WEIGHT]
      let expansionistStagnation = 0;
      if (t.state.valueTraits.expansionist > 0.3) {
        const latestAcq = latestAcquisitionTickByNation[ownerId];
        const nationResetTick = draft.nations[ownerId]?.lastExpansionistResetTick ?? null;
        // Use whichever is more recent: last territory acquired or last explicit reset (treaty/trade growth).
        const latestReset = latestAcq !== undefined && nationResetTick !== null
          ? Math.max(latestAcq, nationResetTick)
          : latestAcq !== undefined ? latestAcq : nationResetTick;
        const ticksSinceGrowth = latestReset !== null ? world.tick - latestReset : world.tick;
        if (ticksSinceGrowth > EXPANSIONIST_GROWTH_WINDOW) { // [PLACEHOLDER callsite: EXPANSIONIST_GROWTH_WINDOW]
          expansionistStagnation = EXPANSIONIST_STAGNATION_WEIGHT; // [PLACEHOLDER callsite: EXPANSIONIST_STAGNATION_WEIGHT]
        }
      }

      // collectivist_isolation: collectivist (individualist < −0.3) AND no active treaties of any kind.
      // v0.41 broadening: original condition was "no tribute_receiver obligations only".
      // New condition: zero active treaties (any clause type). A collectivist nation that is
      // diplomatically engaged (any treaty) is not considered isolated.
      // activeTreatyCountByNation already computed above — reuse it. [PLACEHOLDER callsite: COLLECTIVIST_ISOLATION_WEIGHT]
      let collectivistIsolation = 0;
      if (t.state.valueTraits.individualist < -0.3) {
        const activeTreatyCount = activeTreatyCountByNation[ownerId] ?? 0;
        if (activeTreatyCount === 0) {
          collectivistIsolation = COLLECTIVIST_ISOLATION_WEIGHT; // [PLACEHOLDER callsite: COLLECTIVIST_ISOLATION_WEIGHT]
        }
      }

      // individualist_obligation: individualist > 0.3 AND nation has tribute clauses as payer.
      // [PLACEHOLDER callsite: INDIVIDUALIST_OBLIGATION_WEIGHT]
      let individualistObligation = 0;
      if (t.state.valueTraits.individualist > 0.3) {
        const tributeCount = tributeObligationsAsPayer[ownerId] ?? 0;
        if (tributeCount > 0) {
          individualistObligation = tributeCount * INDIVIDUALIST_OBLIGATION_WEIGHT; // [PLACEHOLDER callsite: INDIVIDUALIST_OBLIGATION_WEIGHT]
        }
      }

      // §1.4 TerritoryModifier: collect active modifiers for this territory.
      const activeMods = draft.territoryModifiers.filter(
        (m) => m.territoryId === t.def.id && (m.expiresAtTick === null || m.expiresAtTick > world.tick + 1),
      );
      const modUnrestAdj = activeMods.reduce((acc, m) => acc + m.unrestEquilibriumAdj, 0);
      const modDriftMult = activeMods.reduce((acc, m) => acc * m.driftRateMultiplier, 1.0);

      // traditional_erosion and progressive_stagnation require the drift rate this tick.
      // Compute effective drift rate before applying (2.4 road multiplier, §1.4 modifier).
      // [PLACEHOLDER callsite: ROAD_DRIFT_MULTIPLIER]
      const effectiveDriftRate = UNREST_DRIFT_RATE
        * (t.state.hasRoad ? ROAD_DRIFT_MULTIPLIER : 1.0) // [PLACEHOLDER callsite: ROAD_DRIFT_MULTIPLIER, 2.4]
        * modDriftMult; // [PLACEHOLDER callsite: §1.4 TerritoryModifier driftRateMultiplier]

      // Approximate drift magnitude this tick: CULTURE_DRIFT_RATE × (1 − unrest) per axis.
      // We use the axis-average drift delta as a proxy for the overall drift rate signal.
      const cultureDriftMagnitude = 0.02 * Math.max(0, 1 - t.state.unrest)
        * (t.state.hasRoad ? ROAD_DRIFT_MULTIPLIER : 1.0); // includes 2.4 road multiplier

      // traditional_erosion: progressive < −0.3 AND drift rate exceeds threshold.
      // [PLACEHOLDER callsite: TRADITIONAL_EROSION_THRESHOLD, TRADITIONAL_EROSION_WEIGHT]
      let traditionalErosion = 0;
      if (t.state.valueTraits.progressive < -0.3 && cultureDriftMagnitude > TRADITIONAL_EROSION_THRESHOLD) {
        traditionalErosion = TRADITIONAL_EROSION_WEIGHT; // [PLACEHOLDER callsite: TRADITIONAL_EROSION_WEIGHT]
      }

      // progressive_stagnation: progressive > 0.3 AND drift rate below threshold.
      // [PLACEHOLDER callsite: PROGRESSIVE_STAGNATION_THRESHOLD, PROGRESSIVE_STAGNATION_WEIGHT]
      let progressiveStagnation = 0;
      if (t.state.valueTraits.progressive > 0.3 && cultureDriftMagnitude < PROGRESSIVE_STAGNATION_THRESHOLD) {
        progressiveStagnation = PROGRESSIVE_STAGNATION_WEIGHT; // [PLACEHOLDER callsite: PROGRESSIVE_STAGNATION_WEIGHT]
      }

      // §1.6 Embassy compat bonus: active embassy from owner nation in this territory.
      const hasActiveEmbassy = draft.embassies.some(
        (e) => e.status === 'active' && e.ownerNationId === ownerId && e.hostTerritoryId === t.def.id,
      );
      const rawCompat = computeCompatibility(t.state.valueTraits, t.def.culturalFamily, nationCulture);
      // Apply embassy compat bonus (clamped to 1.0). [PLACEHOLDER callsite: EMBASSY_COMPAT_BONUS]
      const compat = hasActiveEmbassy
        ? { ...rawCompat, total: Math.min(1, rawCompat.total + EMBASSY_COMPAT_BONUS) }
        : rawCompat;

      // Trade route loss spike: TerritoryModifiers from applyRouteLossEvent are applied via modUnrestAdj.
      // The named component tradeRouteLossSpike is always 0 here (the spike is in the modifier).
      // tradeRouteStability: endpoint territories of grown active routes get a mild stability bonus.
      const isEndpointTerritory = draft.tradeRouteAgreements.some(
        (r) => r.status === 'active' && r.currentCapacity > r.baseCapacity
          && (r.sourceTerritoryId === t.def.id || r.destinationTerritoryId === t.def.id),
      );
      const tradeRouteStability = isEndpointTerritory ? -0.01 : 0; // [PLACEHOLDER: minor stability bonus for grown routes]

      // Garrison suppression: negative when garrisoned army at a fort territory.
      // Militaristic territories get extra suppression (culturally compatible presence).
      // [PLACEHOLDER callsite: GARRISON_UNREST_SUPPRESSION, MILITARISTIC_GARRISON_THRESHOLD, MILITARISTIC_GARRISON_MULTIPLIER]
      let garrisonUnrestAdj = 0;
      if (garrisonSize > 0 && t.state.fortificationLevel >= 1) {
        const militaristicMultiplier = t.state.valueTraits.militaristic > MILITARISTIC_GARRISON_THRESHOLD
          ? MILITARISTIC_GARRISON_MULTIPLIER
          : 1.0;
        garrisonUnrestAdj = -GARRISON_UNREST_SUPPRESSION * militaristicMultiplier;
      }

      const causes = computeUnrestEquilibrium(
        compat, hops,
        t.state.hasRoad, t.state.hasPort, effectiveFortLevelUnrest,
        tcount, t.state.ownershipShock, recentWeight, clashPressure,
        militaryBonus, insolvencyPressure,
        tradeStability,
        isolationistEntanglement,
        expansionistStagnation,
        collectivistIsolation,
        individualistObligation,
        traditionalErosion,
        progressiveStagnation,
        // §1.2 Population transfer shock: active while ticksLeft > 0.
        // v0.40 fix: use compat-scaled magnitude stored per-territory instead of fixed POPULATION_TRANSFER_UNREST_SCALE.
        t.state.populationTransferShockTicksLeft > 0 ? t.state.populationTransferShockMagnitude : 0,
        tradeRouteStability,
        0, // tradeRouteLossSpike — applied via TerritoryModifier (modUnrestAdj), not equilibrium formula
        garrisonUnrestAdj, // [PLACEHOLDER callsite: GARRISON_UNREST_SUPPRESSION] — negative when garrisoned
      );

      // Store causes for assert_equilibrium_component harness assertions.
      t.state.lastEquilibriumCauses = causes;

      // Decay population transfer shock counter.
      if (t.state.populationTransferShockTicksLeft > 0) {
        t.state.populationTransferShockTicksLeft -= 1;
      }

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

      // Garrison unrest suppression: computed inline and passed to computeUnrestEquilibrium above.
      // garrisonUnrestAdj is stored inside causes.garrisonSuppression and included in causes.equilibrium.

      const effectiveEquilibrium = Math.min(1, Math.max(0,
        causes.equilibrium + warEquilibriumAdj + modUnrestAdj, // [PLACEHOLDER callsite: §1.4 TerritoryModifier unrestEquilibriumAdj]
      ));

      // Decay ownership shock at a rate gated by integration progress.
      if (t.state.ownershipShock > 0) {
        const decayRate = computeShockDecayRate(
          t.state.hasRoad, t.state.hasPort, t.state.fortificationLevel, compat, causes,
        );
        t.state.ownershipShock = Math.max(0, t.state.ownershipShock * (1 - decayRate));
      }

      // Drift unrest toward effective equilibrium (base + war adjustments).
      // 2.4 road drift multiplier applied to UNREST_DRIFT_RATE via effectiveDriftRate.
      t.state.unrest = t.state.unrest + effectiveDriftRate * (effectiveEquilibrium - t.state.unrest); // [PLACEHOLDER callsite: ROAD_DRIFT_MULTIPLIER, 2.4]

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
      // 2.1 TRADE_DRIFT_MULTIPLIER: territories on active trade route paths drift faster.
      // 2.4 ROAD_DRIFT_MULTIPLIER: territories with roads drift faster.
      // Both multipliers stack on top of each other.
      const tradeOnPath = tradeRouteTerritoryBonus[t.def.id] !== undefined && tradeRouteTerritoryBonus[t.def.id]! > 0;
      const tradeDriftMult = tradeOnPath ? TRADE_DRIFT_MULTIPLIER : 1.0; // [PLACEHOLDER callsite: TRADE_DRIFT_MULTIPLIER, 2.1]
      const roadDriftMult = t.state.hasRoad ? ROAD_DRIFT_MULTIPLIER : 1.0; // [PLACEHOLDER callsite: ROAD_DRIFT_MULTIPLIER, 2.4]
      t.state.valueTraits = applyDrift(t.state.valueTraits, nationCulture, t.state.unrest, rng,
        tradeDriftMult * roadDriftMult * modDriftMult, // [PLACEHOLDER callsite: §1.4 TerritoryModifier driftRateMultiplier]
      );

      // §11.8 Trade route merchant pressure drift bias.
      // Endpoint territories of active routes: nudge individualist axis toward +1 by merchantPressure × scale.
      // Applied as a direct trait adjustment (not via applyDrift) to avoid coupling with nationCulture.
      // [PLACEHOLDER callsite: ROUTE_MERCHANT_PRESSURE_WEIGHT]
      const merchantPressure = routeMerchantPressureByNation[ownerId] ?? 0;
      if (merchantPressure > 0 && isEndpointTerritory) {
        const nudge = merchantPressure * 0.01 * Math.max(0, 1 - t.state.unrest); // [PLACEHOLDER scale]
        t.state.valueTraits = {
          ...t.state.valueTraits,
          individualist: Math.min(1, t.state.valueTraits.individualist + nudge),
        };
      }
    }

    // ── Production + local stockpile → nation general stockpile ──────────────
    // Each territory produces into its own persistent local stockpile.
    // Trade flows (instant trades, treaty trade clauses) draw from local stockpiles during this tick.
    // The entire local stockpile flushes to the nation's general stockpile at end of tick —
    // whatever was not drawn by trade becomes general stockpile. Upkeep from general Wealth.
    for (const t of Object.values(draft.territories)) {
      const oid = t.state.ownerId;
      if (!oid || t.state.isInRevolt) continue;
      // 2.6 Population production scaling: multiply base rates by (population / POPULATION_PRODUCTION_BASE).
      // population 100 = 2× base; population 25 = 0.5× base; linear scaling. [PLACEHOLDER callsite: POPULATION_PRODUCTION_BASE]
      const popScale = t.def.basePopulation / POPULATION_PRODUCTION_BASE; // [PLACEHOLDER callsite: POPULATION_PRODUCTION_BASE, 2.6]
      t.state.localPopStock += t.def.basePopulation * popScale;
      t.state.localIndStock += t.def.baseIndustry * popScale;
      t.state.localWltStock += t.def.baseWealth * popScale;
    }

    // Flush all remaining local stock to nation general stockpile.
    // Also compute gross wealth production per nation (population-scaled baseWealth of non-revolting
    // owned territories, before trade draws and upkeep). Used for debt recovery skim — gross
    // is used so tribute obligations cannot prevent recovery from accruing.
    const grossWealthByNation: Record<string, number> = {};
    for (const t of Object.values(draft.territories)) {
      const oid = t.state.ownerId;
      if (!oid || t.state.isInRevolt) continue;
      const popScale = t.def.basePopulation / POPULATION_PRODUCTION_BASE; // [PLACEHOLDER callsite: POPULATION_PRODUCTION_BASE, 2.6]
      grossWealthByNation[oid] = (grossWealthByNation[oid] ?? 0) + t.def.baseWealth * popScale;
    }

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

    // ── Army upkeep + infrastructure maintenance ─────────────────────────────
    // All deducted from nation general Wealth after production flush. Wealth may go negative (insolvency).
    // Insolvency from these deductions triggers PRESTIGE_DECAY_PER_INSOLVENCY_TICK next tick
    // (prestige is computed in saveWorldState after the tick completes, reading fresh DB state).
    for (const nation of Object.values(draft.nations)) {
      // Use total of all positioned armies if available; fall back to nation.armySize. // migrated from armySize
      const effectiveArmySize = draft.armies.length > 0
        ? totalArmySize(draft.armies, nation.id)
        : nation.armySize;
      let armyUpkeep = effectiveArmySize * UPKEEP_PER_SOLDIER;

      // Garrison upkeep reduction: stationed armies at fort territories pay GARRISON_UPKEEP_REDUCTION
      // fraction less upkeep. Only applies to the garrison units themselves, not other armies.
      // [PLACEHOLDER callsite: GARRISON_UPKEEP_REDUCTION]
      if (draft.armies.length > 0) {
        for (const army of draft.armies) {
          if (army.nationId !== nation.id) continue;
          if (army.status !== 'stationed') continue;
          const fortTerr = draft.territories[army.territoryId];
          if (!fortTerr || fortTerr.state.fortificationLevel < 1) continue;
          const discount = army.size * UPKEEP_PER_SOLDIER * GARRISON_UPKEEP_REDUCTION; // [PLACEHOLDER callsite: GARRISON_UPKEEP_REDUCTION]
          armyUpkeep = Math.max(0, armyUpkeep - discount);
        }
      }

      nation.stockpiles.wealth -= armyUpkeep;

      // Infrastructure maintenance (v0.40 port/market/road + v0.41 fort): all deducted together.
      // Fort maintenance applies regardless of garrison status — owning a fort costs wealth every tick.
      let infraMaintenance = 0;
      for (const t of Object.values(draft.territories)) {
        if (t.state.ownerId !== nation.id) continue;
        if (t.state.hasPort) {
          infraMaintenance += t.state.portLevel * PORT_MAINTENANCE_PER_LEVEL; // [PLACEHOLDER callsite: PORT_MAINTENANCE_PER_LEVEL]
        }
        if (t.state.hasMarket) {
          infraMaintenance += MARKET_MAINTENANCE_FLAT; // [PLACEHOLDER callsite: MARKET_MAINTENANCE_FLAT]
        }
        if (t.state.hasRoad) {
          infraMaintenance += ROAD_MAINTENANCE_FLAT; // [PLACEHOLDER callsite: ROAD_MAINTENANCE_FLAT]
        }
        if (t.state.fortificationLevel >= 1) {
          infraMaintenance += t.state.fortificationLevel * FORT_MAINTENANCE_PER_LEVEL; // [PLACEHOLDER callsite: FORT_MAINTENANCE_PER_LEVEL]
        }
      }
      nation.stockpiles.wealth -= infraMaintenance;
    }

    // ── Trade route upkeep deduction ─────────────────────────────────────────
    // Per-tick upkeep = currentCapacity × upkeepRate, deducted from owning nation(s).
    // Domestic: 100% from owner. International: 50/50 split. Wealth may go negative.
    for (const route of draft.tradeRouteAgreements) {
      if (route.status !== 'active') continue;
      const upkeep = route.currentCapacity * ROUTE_UPKEEP_RATE;
      if (route.type === 'domestic') {
        const ownerNation = draft.nations[route.ownerNationId];
        if (ownerNation) ownerNation.stockpiles.wealth -= upkeep;
      } else {
        const ownerFraction = upkeep * ROUTE_INTERNATIONAL_UPKEEP_SPLIT;
        const partnerFraction = upkeep - ownerFraction;
        const ownerNation = draft.nations[route.ownerNationId];
        const partnerNation = route.partnerNationId ? draft.nations[route.partnerNationId] : null;
        if (ownerNation) ownerNation.stockpiles.wealth -= ownerFraction;
        if (partnerNation) partnerNation.stockpiles.wealth -= partnerFraction;
      }
    }

    // ── Trade route ownership-change loss event ───────────────────────────────
    // When a territory changes owner, any active route with that territory as an endpoint
    // fires the loss event. Check by comparing territory ownerId to route's owner.
    for (const route of draft.tradeRouteAgreements) {
      if (route.status !== 'active') continue;
      const srcOwner = draft.territories[route.sourceTerritoryId]?.state.ownerId;
      const dstOwner = draft.territories[route.destinationTerritoryId]?.state.ownerId;
      const srcWrong = route.type === 'domestic'
        ? srcOwner !== route.ownerNationId
        : srcOwner !== route.ownerNationId && srcOwner !== route.partnerNationId;
      const dstWrong = route.type === 'domestic'
        ? dstOwner !== route.ownerNationId
        : dstOwner !== route.ownerNationId && dstOwner !== route.partnerNationId;
      if (srcWrong || dstWrong) {
        applyRouteLossEvent(route, draft, world.tick + 1);
      }
    }

    // ── Insolvency + debt resolution ──────────────────────────────────────────
    // Runs after all deductions. Three states per nation:
    //   1. Insolvent entry:  wealthStock < 0, was solvent last tick (debtBalance was 0 pre-tick)
    //   2. Continuing debt:  wealthStock < 0, debtBalance already > 0
    //   3. Recovery:         wealthStock >= 0, debtBalance > 0 — skim incoming wealth toward debt
    //   4. Solvent:          wealthStock >= 0, debtBalance == 0 — no action
    for (const nation of Object.values(draft.nations)) {
      const wealth = nation.stockpiles.wealth;
      const prevDebt = nation.debtBalance;

      if (wealth < 0) {
        // Nation is actively insolvent this tick.
        const additionalDebt = Math.abs(wealth);
        if (prevDebt === 0) {
          // Just became insolvent.
          nation.debtBalance = additionalDebt;
          draft.eventLog.push({
            tick: world.tick + 1,
            message: `${nation.name} has become insolvent (wealth ${wealth.toFixed(1)}).`,
          });
        } else {
          // Already in debt — accumulate.
          nation.debtBalance += additionalDebt;
        }
        // wealth stays negative — intentional (insolvency is real)
      } else if (prevDebt > 0) {
        // Recovery phase: wealth is non-negative, still carrying debt.
        // Skim against gross production (not net) so tribute can't stall recovery.
        const gross = grossWealthByNation[nation.id] ?? 0;
        const skim = Math.floor(gross * DEBT_RECOVERY_SKIM_RATE);
        if (skim > 0) {
          const applied = Math.min(skim, nation.debtBalance);
          nation.debtBalance = Math.max(0, nation.debtBalance - applied);
          nation.stockpiles.wealth -= applied; // skim comes off current wealth
          if (nation.debtBalance === 0) {
            draft.eventLog.push({
              tick: world.tick + 1,
              message: `${nation.name} has cleared its debt.`,
            });
          }
        }
      }
    }

    draft.tick += 1;
  });

  return { world: nextWorld, actionResults };
}
