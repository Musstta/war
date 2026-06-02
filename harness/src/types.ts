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
  culture: NationCulture | null;
}

export interface NationDiplomacySnapshot {
  trust: number;
  inactivityTier: string;
  wealthStock: number;
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

export interface TickSnapshot {
  tick: number;
  territories: Record<string, TerritorySnapshot>;
  nations: Record<string, NationSnapshot>;
  diplomacy: {
    nationState: Record<string, NationDiplomacySnapshot>;
    treaties: TreatySnapshot[];
  };
  events: Array<{ tick: number; message: string }>;
}

export interface RunResult {
  scenario: Scenario;
  snapshots: TickSnapshot[];   // index 0 = T0 initial state
}
