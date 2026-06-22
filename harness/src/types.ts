/**
 * Scenario format types for the WAR simulation harness.
 * Scenarios live in scenarios/ as JSON files conforming to these interfaces.
 */

export type MetricName =
  | 'unrest_per_territory_per_tick'
  | 'compat_per_territory_per_tick'
  | 'equilibrium_components_per_territory_per_tick'
  | 'nation_culture_per_tick'
  | 'revolt_events'
  | 'stockpiles_per_nation_per_tick'
  | 'treaty_state_per_tick';

/** Harness-level action types. Engine action types (build_road etc.) pass through to resolveTick. */
export type ActionType =
  | 'assign_territory'   // harness: directly set ownerId + compute conquest shock
  | 'set_unrest'         // harness: force unrest to a value (testing tool)
  | 'create_treaty'      // harness: directly place an active treaty into world state
  | 'break_treaty'       // harness: voluntarily break a treaty (collateral transfer + Trust hit)
  | 'set_nation_tier'    // harness: set inactivityTier, trigger degradation/upgrade logic
  | 'set_fort_level'     // harness: directly set fortificationLevel (0–3)
  | 'set_ai_doctrine'   // harness: assign doctrineBlend to an AI nation
  | 'set_army_size'     // harness: set the nation's first army size (creates if missing)
  | 'move_army'         // engine pass-through: { nationId, toTerritoryId } — moves first army
  | 'claim_territory'   // engine pass-through: { nationId, territoryId } — claim adjacent unclaimed
  | 'declare_war'        // harness: inject a War into world.wars (equivalent to server declareWar)
  | 'propose_peace'      // harness: set pendingPeaceDeal + peace_negotiation status on a war
  | 'attack_territory'   // engine pass-through with explicit nationId
  | 'accept_peace'       // engine pass-through with explicit nationId
  | 'assert_visibility'  // harness assertion: verify computeVisibility result for a territory
  | 'assert_equilibrium_component' // harness assertion: verify a named UnrestCauses component present/absent
  | 'propose_embassy'   // harness: directly place a proposed embassy into world.embassies
  | 'build_embassy'     // harness: advance an embassy to under_construction (engine pass-through)
  | 'expel_embassy'     // harness: expel an embassy (engine pass-through)
  | 'set_trade_route'         // harness: inject a TradeRoute into world.tradeRoutes (for tradeStability tests)
  | 'establish_trade_route'  // harness: inject a TradeRouteAgreement into world.tradeRouteAgreements
  | 'renew_trade_route'      // harness: simulate treaty renewal — end old route, inject new one carrying forward currentCapacity/cyclesCompleted
  | 'assert_route_capacity'  // harness assertion: verify route currentCapacity
  | 'assert_route_cycles'    // harness assertion: verify route cyclesCompleted
  | 'assert_route_upkeep'    // harness assertion: verify nation wealth decreased by expected upkeep
  | 'set_territory_infra'    // harness: set hasPort/hasMarket/hasRoad/portLevel on a territory
  | 'build_road'
  | 'build_port'
  | 'build_fort';

export interface ScenarioAction {
  tick: number;
  type: ActionType;
  /** For assign_territory:  { territoryId, ownerId }
   *  For set_unrest:         { territoryId, value }
   *  For create_treaty:      { id, partyIds, clauses, termTicks, collateralByParty }
   *  For break_treaty:       { treatyId, breakerNationId }
   *  For set_nation_tier:    { nationId, tier }
   *  For build_*:            { territoryId } — nationId derived from territory owner */
  payload: Record<string, unknown>;
}

export interface ScenarioNation {
  id: string;
  name: string;
  territories: string[];           // starting territory IDs
  armySize?: number;               // default 50
  capitalTerritoryId?: string;     // default = first territory
  /** Starting stockpile overrides — useful for treaty collateral scenarios. */
  wealthStock?: number;
  industryStock?: number;
  populationStock?: number;
  /** If true, treated as an AI nation (doctrineBlend must be set via set_ai_doctrine action). */
  isAI?: boolean;
}

export interface ScenarioWorld {
  nations: ScenarioNation[];
  /** Optional per-territory attribute overrides applied after world init. */
  territoryOverrides?: Record<string, {
    individualist?: number;
    progressive?: number;
    militaristic?: number;
    expansionist?: number;
    culturalFamily?: string;
    unrest?: number;
  }>;
  /**
   * When true, all incoming treaty proposals to any nation in the scenario
   * are auto-accepted at the start of the next tick (before engine resolution).
   * Used for AI merchant/diplomat scenario testing.
   */
  autoAcceptTreaties?: boolean;
}

export interface Scenario {
  name: string;
  description?: string;
  ticks: number;
  world: ScenarioWorld;
  actions?: ScenarioAction[];
  metrics: MetricName[];
  /** Optional seed for the RNG. Default 42. */
  rngSeed?: number;
}

// ── Snapshot types (collected after each tick) ────────────────────────────────

import type { UnrestCauses, Stockpiles, NationCulture } from '@war/engine';

export interface TerritorySnapshot {
  ownerId: string | null;
  unrest: number;
  equilibrium: number;
  ownershipShock: number;
  isInRevolt: boolean;
  compatTotal: number | null;
  causes: UnrestCauses | null;
}

export interface NationSnapshot {
  stockpiles: Stockpiles;
  armySize: number;
  culture: NationCulture | null;
}

export interface WarSnapshot {
  id: number;
  attackerId: string;
  defenderId: string;
  type: string;
  hasCasusBelli: boolean;
  status: string;
  startTick: number;
  occupiedCount: number;   // number of territories currently occupied by either side
}

export interface NationDiplomacySnapshot {
  trust: number;
  inactivityTier: string;
  activityTier: string;
  wealthStock: number;
  debtBalance: number;
}

export interface TerritoryFragmentationSnapshot {
  territoryId: string;
  ownerId: string | null;
  unrest: number;
  fragmentationRisk: number;   // 0 when not abandoned; tick-based formula otherwise
}

export interface ObjectiveSnapshot {
  clauseIndex: number;
  objectiveType: string;
  status: string;   // 'pending' | 'met' | 'failed' | 'waived'
  deadlineTicks: number;
  responsibleParty: string;
}

export interface TradeClauseState {
  clauseIndex: number;
  clauseStatus: string;   // 'active' | 'degraded' | 'breached'
  missedPayments: number;
  /** Clause payload fields for flow reconstruction. */
  resource: string;
  amount: number;
  fromNationId: string;
  toNationId: string;
  sourceTerritoryId: string;
}

export interface TreatySnapshot {
  id: number;
  status: string;
  partyIds: [string, string];
  clauses: string[];        // clause type names
  termTicks: number;
  tickEnds: number;
  totalCollateral: number;
  collateralByParty: Record<string, number>;
  escrowAmountByParty: Record<string, number>;
  refundRemainingByParty: Record<string, number>;
  objectives: ObjectiveSnapshot[];
  tradeClauses: TradeClauseState[];
}

export interface TradeRouteSnapshot {
  routeId: number;
  type: string;
  ownerNationId: string;
  partnerNationId: string | null;
  sourceTerritoryId: string;
  destinationTerritoryId: string;
  baseCapacity: number;
  currentCapacity: number;
  growthCap: number;
  cyclesCompleted: number;
  profitMultiplier: number;
  upkeepPerTick: number;
  shipmentCount: number;
  status: string;
}

export interface TickSnapshot {
  tick: number;
  territories: Record<string, TerritorySnapshot>;
  nations: Record<string, NationSnapshot>;
  wars: WarSnapshot[];
  diplomacy: {
    nationState: Record<string, NationDiplomacySnapshot>;
    treaties: TreatySnapshot[];
  };
  events: Array<{ tick: number; message: string }>;
  /** Per-territory fragmentation data — only populated for abandoned nation territories. */
  fragmentationData: TerritoryFragmentationSnapshot[];
  /** Trade route agreement snapshots — only populated when routes exist. */
  tradeRoutes: TradeRouteSnapshot[];
}

export interface VisibilityAssertionError {
  tick: number;
  type: 'assert_visibility';
  observerNationId: string;
  territoryId: string;
  expectedTier: number;
  actualTier: number;
  message: string;
}

export interface EquilibriumComponentAssertionError {
  tick: number;
  type: 'assert_equilibrium_component';
  territoryId: string;
  component: string;
  expectedPresent: boolean;
  message: string;
}

export interface RouteCapacityAssertionError {
  tick: number;
  type: 'assert_route_capacity';
  routeId: number;
  sourceTerritoryId: string;
  destinationTerritoryId: string;
  expectedMin: number;
  actualCapacity: number;
  message: string;
}

export interface RouteUpkeepAssertionError {
  tick: number;
  type: 'assert_route_upkeep';
  nationId: string;
  expectedDelta: number;
  actualDelta: number;
  message: string;
}

export type AssertionError = VisibilityAssertionError | EquilibriumComponentAssertionError | RouteCapacityAssertionError | RouteUpkeepAssertionError;

export interface RunResult {
  scenario: Scenario;
  snapshots: TickSnapshot[];   // index 0 = T0 initial state
  assertionErrors: AssertionError[];
}
