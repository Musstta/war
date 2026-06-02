export type Geography = 'coastal' | 'inland' | 'mountainous' | 'desert' | 'forest';

export type CulturalFamily =
  | 'latin'
  | 'european'
  | 'arab'
  | 'slavic'
  | 'east_asian'
  | 'african'
  | 'south_asian'
  | 'indigenous';

/**
 * Four cultural value axes. Each value is −1.0 to +1.0.
 * Positive pole = the named trait; negative pole = the opposite.
 *   individualist: −1 = collectivist,  +1 = individualist
 *   progressive:   −1 = traditional,   +1 = progressive
 *   militaristic:  −1 = peaceful,      +1 = militaristic
 *   expansionist:  −1 = isolationist,  +1 = expansionist
 * Stored as mutable values because traits drift over time (design doc §7.5).
 */
export interface ValueTraits {
  individualist: number;
  progressive: number;
  militaristic: number;
  expansionist: number;
}

/** Per-axis gap (0 = perfect match, 1 = maximum possible gap) plus derived totals. */
export interface CompatibilityBreakdown {
  individualistGap: number;
  progressiveGap: number;
  militaristicGap: number;
  expansionistGap: number;
  /** 0 = no family affinity, 1 = same family. */
  familyCloseness: number;
  /** Overall compatibility score 0–1 (1 = fully compatible). */
  total: number;
}

/** Named contributions to a territory's unrest equilibrium. Bonuses are ≤ 0; pressures are ≥ 0. */
export interface UnrestCauses {
  base: number;
  compatibilityPressure: number;
  distancePressure: number;
  /** Negative — roads/ports/forts each reduce equilibrium. Replaces the old road/no-road split. */
  infrastructureBonus: number;
  overexpansionPressure: number;
  /** Decays each tick — spike applied when a territory changes owner (design doc §12.1). */
  ownershipShock: number;
  /** Nation-wide pressure scaling with count of recently-acquired territories. */
  recentConquestPressure: number;
  /** Stub — always 0 until troop mechanics exist. */
  militaryBonus: number;
  /** Pressure from active treaty clauses that culturally clash with this territory's traits. */
  treatyCulturalClash: number;
  /** General insolvency pressure when wealthStock < 0 (outside war — war path uses warEquilibriumAdj). */
  insolvencyPressure: number;
  /** Clamped sum [0, 1]. This is the target unrest asymptotes toward. */
  equilibrium: number;
}

/** Nation culture — emergent weighted average of owned territories. Computed each tick; not stored. */
export interface NationCulture {
  individualist: number;
  progressive: number;
  militaristic: number;
  expansionist: number;
  primaryFamily: CulturalFamily | null;
  /** Fraction of total territory weight per family (sums to 1). */
  familyWeights: Partial<Record<CulturalFamily, number>>;
}

/** Static territory data loaded from the territories data file. Never mutated at runtime. */
export interface TerritoryDef {
  id: string;
  name: string;
  /** Base resource production per tick — all values are placeholders until simulation tuning. */
  basePopulation: number;
  baseIndustry: number;
  baseWealth: number;
  geography: Geography;
  isCoastal: boolean;
  culturalFamily: CulturalFamily;
  /** Starting value traits — copied into TerritoryState at world init so they can drift. */
  valueTraits: ValueTraits;
  adjacentIds: string[];
}

/** Mutable per-territory game state. */
export interface TerritoryState {
  ownerId: string | null;
  fortificationLevel: number; // 0–3
  hasRoad: boolean;
  hasPort: boolean;
  unrest: number; // 0.0–1.0
  /** True when unrest crosses REVOLT_THRESHOLD; territory stops producing. */
  isInRevolt: boolean;
  /** Mutable copy of value traits; drift rules applied here each tick (design doc §7.5). */
  valueTraits: ValueTraits;
  /** Phase 4: single construction slot — ports and forts occupy this slot; roads are immediate. */
  constructionType: 'port' | 'fort_l1' | 'fort_l2' | 'fort_l3' | null;
  constructionTicksLeft: number | null;
  /**
   * Next build queued to start automatically when constructionType completes.
   * Mandate + industry are already deducted at queue time.
   * 'road' is instant when it fires; 'port'/'fort_*' start multi-tick construction.
   */
  pendingConstructionType: 'port' | 'fort_l1' | 'fort_l2' | 'fort_l3' | 'road' | null;
  /**
   * Temporary unrest component applied when a territory changes owner (design doc §12.1).
   * Starts at CONQUEST_SHOCK_INITIAL and decays each tick toward 0.
   */
  ownershipShock: number;
  /** World tick when this territory last changed owner. null = native (never conquered). */
  acquiredTick: number | null;
  /**
   * Per-territory local stockpiles. Fed by that territory's own production each tick.
   * Trade flows (instant trades, treaty trade clauses) draw from these local stores.
   * Surplus flows to the nation's general stockpile at end of tick.
   */
  localPopStock: number;
  localIndStock: number;
  localWltStock: number;
}

export interface Territory {
  def: TerritoryDef;
  state: TerritoryState;
}

export interface Stockpiles {
  population: number;
  industry: number;
  wealth: number;
}

export interface Nation {
  id: string;
  name: string;
  isAI: boolean;
  stockpiles: Stockpiles;
  armySize: number;
  trust: number;    // 0–100 (design doc §8.6)
  prestige: number;
  /** The territory ID considered the nation's capital, for distance-from-capital unrest. */
  capitalTerritoryId: string | null;
  /** 'active' | 'dormant' | 'autopilot' | 'abandoned'. Deferred to AI sub-phase. */
  inactivityTier: string;
  /** Tick of the last broken-promise event; gates passive Trust recovery. null = never broken. */
  lastBrokenPromiseTick: number | null;
  /**
   * Cumulative wealth debt accrued while wealthStock < 0.
   * During insolvency: debtBalance grows each tick.
   * During recovery (wealthStock >= 0 but debtBalance > 0): incoming wealth applies a skim
   * toward debtBalance until it reaches 0. Insolvent = wealthStock < 0 || debtBalance > 0.
   */
  debtBalance: number;
  /** 'active' | 'dormant' | 'autopilot' | 'abandoned' | 'dissolved' */
  activityTier: string;
  /** Player-configurable caretaker priority order. */
  caretakerPriorities: string[];
}

export interface EventLogEntry {
  tick: number;
  message: string;
}

// ── Diplomacy ─────────────────────────────────────────────────────────────────

export type ClauseType = 'non_aggression' | 'tribute' | 'trade' | 'military_access' | 'defense_pact' | 'objective';

/**
 * V1 objective types.
 * Functional: build_road_connection, build_port, maintain_peace.
 * Stub (data-model present, engine inert): joint_invasion, attack_player.
 */
export type ObjectiveType =
  | 'build_road_connection'
  | 'build_port'
  | 'maintain_peace'
  | 'joint_invasion'   // [STUB] — activate when War sub-phase ships
  | 'attack_player';   // [STUB] — activate when War sub-phase ships

export type ObjectiveStatus = 'pending' | 'met' | 'failed' | 'waived';
export type ResponsibleParty = 'partyA' | 'partyB' | 'both';

export type TradeResource = 'population' | 'industry' | 'wealth';

export interface TreatyClause {
  id: number;
  clauseIndex: number;
  type: ClauseType;
  collateral: number;
  /** Clause-specific parameters.
   *  tribute:   { amount, fromNationId, toNationId }
   *  trade:     { resource, amount, fromNationId, toNationId, sourceTerritoryId }
   *  objective: { objectiveType, targetNationId?, targetTerritoryId?, deadlineTicks,
   *               responsibleParty, status } — see ObjectiveClause
   */
  payload: Record<string, unknown>;
  /** 'active' | 'degraded' | 'breached' */
  clauseStatus: string;
  /** Consecutive ticks a trade clause payment was missed. Resets to 0 on success. */
  missedPayments: number;
  /** Present only when type === 'objective'. Null otherwise. */
  objective: ObjectiveClause | null;
}

/**
 * Structured data for an objective clause. Stored in the DB as its own table
 * (one-to-one with TreatyClause where type === 'objective').
 */
export interface ObjectiveClause {
  id: number;
  treatyClauseId: number;
  objectiveType: ObjectiveType;
  /** Nation the objective targets (for attack_player, joint_invasion). */
  targetNationId: string | null;
  /** Territory the objective targets (for build_port, build_road_connection). */
  targetTerritoryId: string | null;
  /**
   * Ticks from treaty signing by which the objective must be met.
   * Absolute deadline = treaty.tickStarted + deadlineTicks.
   */
  deadlineTicks: number;
  status: ObjectiveStatus;
  responsibleParty: ResponsibleParty;
}

export interface Treaty {
  id: number;
  proposalId: number;
  /** Nation IDs of the two parties. */
  partyIds: [string, string];
  clauses: TreatyClause[];
  /** 'active' | 'degraded' | 'broken' | 'expired' */
  status: string;
  termTicks: number;
  tickStarted: number;
  tickEnds: number;
  totalCollateral: number;
  /** Collateral deposited by each party, keyed by nationId. */
  collateralByParty: Record<string, number>;
  /** Set when status = 'broken'. */
  breakerNationId: string | null;
  /** Active-partner refund state: amount still to be returned, keyed by nationId. */
  refundRemainingByParty: Record<string, number>;
  refundStartTickByParty: Record<string, number | null>;
  /** Inactive-partner escrow state: amount in escrow, keyed by nationId. */
  escrowAmountByParty: Record<string, number>;
  escrowStartTickByParty: Record<string, number | null>;
}

export interface Proposal {
  id: number;
  proposerId: string;
  targetId: string;
  /** 'pending' | 'accepted' | 'declined' | 'expired' */
  status: string;
  termTicks: number;
  clauses: TreatyClause[];
  proposerCollateral: number;
  targetCollateral: number;
  tickProposed: number;
  expiresAtTick: number;
  parentProposalId: number | null;
}

// ── Trade ─────────────────────────────────────────────────────────────────────

export type InstantTradeStatus = 'pending' | 'accepted' | 'declined' | 'expired';

/** A pending instant trade offer. Resource pre-deducted from source territory at queue time. */
export interface InstantTrade {
  id: number;
  proposerNationId: string;
  targetNationId: string;
  resource: TradeResource;
  amount: number;
  sourceTerritoryId: string;
  status: InstantTradeStatus;
  tickProposed: number;
  expiresAtTick: number;
}

/** Route computed for a trade clause at treaty signing. Stored as a real object (design doc §14A.6). */
export interface TradeRoute {
  id: number;
  treatyClauseId: number;
  sourceTerritoryId: string;
  destinationNationId: string;
  /** Ordered territory IDs from source to destination. Empty array = sea route (no intermediate territories). */
  path: string[];
  pathComputedAtTick: number;
  /** True when any territory on path changed owner since pathComputedAtTick. */
  pathStale: boolean;
  /** [PLACEHOLDER] Max flow per tick. null until capacity formula is specified. */
  capacity: number | null;
  /** [PLACEHOLDER] Fraction of flow lost in transit. null until friction formula is specified. */
  friction: number | null;
  isSeaRoute: boolean;
}

// ── War ───────────────────────────────────────────────────────────────────────

export type WarType = 'conquest' | 'raid'; // raid behavior identical to conquest in v1 [STUB]
export type WarStatus = 'active' | 'peace_negotiation' | 'ended';
export type PeaceDealType = 'white_peace' | 'negotiated' | 'surrender';

export interface Territorycessation {
  territoryId: string;
  fromNationId: string;
  toNationId: string;
}

/**
 * A pending peace deal attached to a War in peace_negotiation status.
 * proposedAtTick + PEACE_PROPOSAL_LAPSE_TICKS = tick when it silently expires.
 */
export interface PeaceDeal {
  proposingNationId: string;
  proposedAtTick: number;
  warType: PeaceDealType;
  territoryCessions: Territorycessation[];
  tributeWealth: number;
  tributeTicks: number;
}

/**
 * One territory currently occupied (besieged or taken) in a war.
 * siegeProgress counts ticks the attacker has maintained presence.
 * Full capture requires siegeProgress >= fortificationLevel + 1.
 */
export interface OccupiedTerritory {
  territoryId: string;
  occupyingNationId: string;
  siegeProgress: number;
  siegeStartTick: number;
}

export interface War {
  id: number;
  attackerId: string;
  defenderId: string;
  /** 'conquest' | 'raid' — raid stored, behavior identical to conquest for now. [STUB] */
  type: WarType;
  /** true = declared with a justification; false = unjustified (soft-CB penalties apply). */
  hasCasusBelli: boolean;
  status: WarStatus;
  startTick: number;
  endTick: number | null;
  /** Territories currently occupied by either belligerent. */
  occupiedTerritories: OccupiedTerritory[];
  /** null when status is 'active'; populated when status is 'peace_negotiation'. */
  pendingPeaceDeal: PeaceDeal | null;
  /**
   * Tick the war was declared — used to track the no-CB unrest spike duration.
   * Duplicate of startTick but kept separate for clarity.
   */
  declaredTick: number;
  /**
   * Per-nation exhaustion state from a declined peace proposal.
   * { nationId: exhaustionEndsAtTick }
   * Each tick where world.tick < exhaustionEndsAtTick, that nation's territories
   * get PEACE_DECLINE_EXHAUSTION_BUMP added to their equilibrium.
   */
  exhaustionByNation: Record<string, number>;
}

export interface WorldState {
  tick: number;
  rngSeed: number;
  territories: Record<string, Territory>;
  nations: Record<string, Nation>;
  eventLog: EventLogEntry[];
  treaties: Treaty[];
  proposals: Proposal[];
  instantTrades: InstantTrade[];
  tradeRoutes: TradeRoute[];
  wars: War[];
}

/** A player action queued during the Main Phase and resolved at tick time. */
export interface QueuedAction {
  nationId: string;
  type: string;
  payload: unknown;
}

/** Per-action outcome returned by resolveTick. Used by the server for mandate refunds. */
export interface ActionResult {
  nationId: string;
  type: string;
  payload: unknown;
  status: 'applied' | 'discarded';
  /** Present when status === 'discarded'. Human-readable; for logging only. */
  reason?: string;
}
