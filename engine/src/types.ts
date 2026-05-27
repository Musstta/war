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
 * Four cultural value axes. Each value is 0.0–1.0 toward the named pole.
 * 0 = collectivist / traditional / peaceful / isolationist.
 * 1 = individualist / progressive / militaristic / expansionist.
 * Stored as mutable values because traits drift over time (design doc §7.5).
 */
export interface ValueTraits {
  individualist: number;
  progressive: number;
  militaristic: number;
  expansionist: number;
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
  unrest: number; // 0.0–1.0 (design doc §12)
  /** Mutable copy of value traits; drift rules applied here each tick (design doc §7.5). */
  valueTraits: ValueTraits;
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
