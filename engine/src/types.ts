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

/** Named contributions to a territory's unrest equilibrium. All values ≥ 0 except bonuses (≤ 0). */
export interface UnrestCauses {
  base: number;
  compatibilityPressure: number;
  distancePressure: number;
  noRoadPressure: number;
  overexpansionPressure: number;
  roadBonus: number;
  /** Stub — always 0 until troop mechanics exist. */
  militaryBonus: number;
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
}

export interface EventLogEntry {
  tick: number;
  message: string;
}

export interface WorldState {
  tick: number;
  rngSeed: number;
  territories: Record<string, Territory>;
  nations: Record<string, Nation>;
  eventLog: EventLogEntry[];
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
