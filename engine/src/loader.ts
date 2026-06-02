import { readFileSync } from 'fs';
import type {
  TerritoryDef,
  Territory,
  TerritoryState,
  Nation,
  WorldState,
} from './types';

export function loadTerritoryDefs(filepath: string): TerritoryDef[] {
  const raw = readFileSync(filepath, 'utf-8');
  const defs: TerritoryDef[] = JSON.parse(raw);

  const ids = new Set(defs.map((d) => d.id));
  for (const def of defs) {
    for (const adjId of def.adjacentIds) {
      if (!ids.has(adjId)) {
        throw new Error(
          `Territory "${def.id}" references unknown adjacent id "${adjId}"`,
        );
      }
    }
  }

  return defs;
}

function initialState(def: TerritoryDef): TerritoryState {
  return {
    ownerId: null,
    fortificationLevel: 0,
    hasRoad: false,
    hasPort: false,
    unrest: 0,
    isInRevolt: false,
    valueTraits: { ...def.valueTraits },
    constructionType: null,
    constructionTicksLeft: null,
    pendingConstructionType: null,
    ownershipShock: 0,
    acquiredTick: null,
    localPopStock: 0,
    localIndStock: 0,
    localWltStock: 0,
  };
}

export interface NationInit {
  id: string;
  name: string;
  isAI: boolean;
  startingTerritoryIds: string[];
  armySize?: number;
}

export function buildWorldState(
  defs: TerritoryDef[],
  nations: NationInit[],
  rngSeed: number,
): WorldState {
  const territories: Record<string, Territory> = {};
  for (const def of defs) {
    territories[def.id] = { def, state: initialState(def) };
  }

  const nationMap: Record<string, Nation> = {};
  for (const init of nations) {
    for (const tid of init.startingTerritoryIds) {
      if (!territories[tid]) {
        throw new Error(`NationInit "${init.id}" references unknown territory "${tid}"`);
      }
      territories[tid].state.ownerId = init.id;
    }

    nationMap[init.id] = {
      id: init.id,
      name: init.name,
      isAI: init.isAI,
      stockpiles: { population: 0, industry: 0, wealth: 0 },
      armySize: init.armySize ?? 0,
      trust: 50,
      prestige: 0,
      capitalTerritoryId: init.startingTerritoryIds[0] ?? null,
      inactivityTier: 'active',
      lastBrokenPromiseTick: null,
      debtBalance: 0,
    };
  }

  return {
    tick: 0,
    rngSeed,
    territories,
    nations: nationMap,
    eventLog: [],
    treaties: [],
    proposals: [],
    instantTrades: [],
    tradeRoutes: [],
    wars: [],
  };

}
