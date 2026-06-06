/**
 * Trade engine — Phase 4 Trade sub-phase.
 *
 * Covers:
 *   - Pathfinding for trade routes (BFS + sea-route shortcut)
 *   - Per-tick trade clause flow resolution
 *   - Missed-payment tracking and breach logic
 *   - Clause degradation when source territory changes owner
 *
 * All numeric constants tagged [PLACEHOLDER]. Pure functions only — no I/O.
 */
import type {
  Territory, TerritoryDef, TradeResource, TradeRoute, WorldState,
} from './types';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Consecutive missed trade-clause payments before the clause breaches.
 * Breach = same consequence as voluntary treaty break (Trust penalty + collateral).
 * [PLACEHOLDER]
 */
export const TRADE_MISSED_PAYMENT_BREACH_THRESHOLD = 2;

/**
 * Sea-route capacity tier — higher than land because ports represent invested
 * infrastructure (design doc §14A.2). [PLACEHOLDER] null until capacity formula exists.
 */
export const SEA_ROUTE_CAPACITY: number | null = null;

/**
 * Land-route capacity tier. [PLACEHOLDER] null until capacity formula exists.
 */
export const LAND_ROUTE_CAPACITY: number | null = null;

// ── Pathfinder ────────────────────────────────────────────────────────────────

/**
 * Result of a pathfind call.
 * isSeaRoute: true when the connection is a direct port-to-port sea link
 *             (no intermediate territory IDs in path).
 */
export interface PathResult {
  path: string[];
  isSeaRoute: boolean;
}

/**
 * Find the shortest path from sourceTerritoryId to any territory owned by
 * destinationNationId. Returns the path (list of territory IDs from source to
 * destination inclusive) and whether it is a sea route.
 *
 * Sea route rule: if the source territory has a port AND the destination nation
 * has at least one territory with a port, the sea path is always available as a
 * zero-intermediate-territory route (length-2 path: [source, dest]).
 *
 * Returns null if no path exists (genuinely unreachable — landlocked with no
 * land connection and neither side has ports).
 */
export function findTradePath(
  sourceTerritoryId: string,
  destinationNationId: string,
  territories: Record<string, Territory>,
  defs: TerritoryDef[],
): PathResult | null {
  const defById = new Map(defs.map((d) => [d.id, d]));
  const sourceTerritory = territories[sourceTerritoryId];
  if (!sourceTerritory) return null;

  const destTerritoryIds = new Set(
    Object.entries(territories)
      .filter(([, t]) => t.state.ownerId === destinationNationId)
      .map(([id]) => id),
  );

  if (destTerritoryIds.size === 0) return null;

  // Sea route: available if source has port and any dest territory has a port.
  const sourceHasPort = sourceTerritory.state.hasPort;
  const destPortTerritoryId = sourceHasPort
    ? [...destTerritoryIds].find((id) => territories[id]?.state.hasPort)
    : undefined;

  if (destPortTerritoryId) {
    return { path: [sourceTerritoryId, destPortTerritoryId], isSeaRoute: true };
  }

  // BFS over land adjacency graph.
  const adjacency: Record<string, readonly string[]> = Object.fromEntries(
    defs.map((d) => [d.id, d.adjacentIds]),
  );

  const visited = new Set<string>();
  const queue: Array<{ id: string; path: string[] }> = [
    { id: sourceTerritoryId, path: [sourceTerritoryId] },
  ];

  while (queue.length > 0) {
    const { id, path } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    if (destTerritoryIds.has(id)) return { path, isSeaRoute: false };

    for (const adjId of adjacency[id] ?? []) {
      if (!visited.has(adjId)) {
        queue.push({ id: adjId, path: [...path, adjId] });
      }
    }
  }

  return null; // unreachable
}

/**
 * Returns true if any territory on a stored route path has changed owner since
 * the path was computed. Excludes the source (always owned by sender at computation
 * time) and destination (always owned by receiver).
 */
export function isPathStale(
  route: TradeRoute,
  territories: Record<string, Territory>,
  sourceNationId: string,
  destNationId: string,
): boolean {
  for (let i = 1; i < route.path.length - 1; i++) {
    const tid = route.path[i]!;
    const t = territories[tid];
    if (!t) return true;
    // Intermediate territory changed hands
    if (t.state.ownerId !== sourceNationId && t.state.ownerId !== destNationId) return true;
  }
  return false;
}

// ── Geography → capacity and friction (2.3) ──────────────────────────────────

/** Base trade route capacity before infrastructure modifiers. [PLACEHOLDER] */
export const CAPACITY_BASE = 10; // [PLACEHOLDER]

/** Sea route (port+port) capacity multiplier. [PLACEHOLDER] */
export const SEA_CAPACITY_MULTIPLIER = 2.0; // [PLACEHOLDER]

/** Land route with roads on both endpoints capacity multiplier. [PLACEHOLDER] */
export const LAND_ROAD_CAPACITY_MULTIPLIER = 1.5; // [PLACEHOLDER]

/** Land route with no road infrastructure on either endpoint. [PLACEHOLDER] */
export const NO_INFRA_CAPACITY_MULTIPLIER = 0.7; // [PLACEHOLDER]

/** Base friction per territory on the path. [PLACEHOLDER] */
export const FRICTION_BASE = 0.05; // [PLACEHOLDER]

/** Extra friction for mountainous territory on path. [PLACEHOLDER] */
export const FRICTION_MOUNTAIN = 0.08; // [PLACEHOLDER]

/** Extra friction for desert territory on path. [PLACEHOLDER] */
export const FRICTION_DESERT = 0.06; // [PLACEHOLDER]

/** Extra friction for crossing a territory owned by neither the source nor destination nation. [PLACEHOLDER] */
export const FRICTION_HOSTILE_CROSSING = 0.10; // [PLACEHOLDER]

/** Friction reduction for territories with a road on the path. [PLACEHOLDER] */
export const FRICTION_ROAD_REDUCTION = 0.03; // [PLACEHOLDER]

/**
 * Computes the capacity for a trade route given endpoint territory state and whether
 * it is a sea route. Capacity is the maximum flow per tick.
 *
 * Formula (design doc §14A.2, §2.3):
 *   sea route (port+port):   baseCapacity × SEA_CAPACITY_MULTIPLIER
 *   land route with roads:   baseCapacity × LAND_ROAD_CAPACITY_MULTIPLIER
 *   no infrastructure:       baseCapacity × NO_INFRA_CAPACITY_MULTIPLIER
 *
 * All constants [PLACEHOLDER]. [2.3 callsite]
 */
export function computeTradeCapacity(
  sourceTerr: Territory,
  destTerr: Territory,
  isSeaRoute: boolean,
): number {
  const baseCapacity = CAPACITY_BASE;
  if (isSeaRoute && sourceTerr.state.hasPort && destTerr.state.hasPort) {
    return baseCapacity * SEA_CAPACITY_MULTIPLIER; // [PLACEHOLDER callsite: SEA_CAPACITY_MULTIPLIER]
  }
  if (sourceTerr.state.hasRoad && destTerr.state.hasRoad) {
    return baseCapacity * LAND_ROAD_CAPACITY_MULTIPLIER; // [PLACEHOLDER callsite: LAND_ROAD_CAPACITY_MULTIPLIER]
  }
  return baseCapacity * NO_INFRA_CAPACITY_MULTIPLIER; // [PLACEHOLDER callsite: NO_INFRA_CAPACITY_MULTIPLIER]
}

/**
 * Computes the friction for a trade route given the path territories and their owners.
 * Friction is the fraction of flow lost in transit (0 = no loss, 1 = total loss).
 *
 * Per-territory friction formula:
 *   FRICTION_BASE
 *   + (mountainous ? FRICTION_MOUNTAIN : 0)
 *   + (desert ? FRICTION_DESERT : 0)
 *   + (not owned by source or dest nation ? FRICTION_HOSTILE_CROSSING : 0)
 *   - (hasRoad ? FRICTION_ROAD_REDUCTION : 0)
 *
 * totalFriction = sum(frictionPerTerritory for each territory on path).
 * All constants [PLACEHOLDER]. [2.3 callsite]
 */
export function computeTradeFriction(
  path: string[],
  territories: Record<string, Territory>,
  sourceNationId: string,
  destNationId: string,
): number {
  let totalFriction = 0;
  for (const tid of path) {
    const t = territories[tid];
    if (!t) continue;
    let frictionHere = FRICTION_BASE; // [PLACEHOLDER callsite: FRICTION_BASE]
    if (t.def.geography === 'mountainous') frictionHere += FRICTION_MOUNTAIN; // [PLACEHOLDER callsite: FRICTION_MOUNTAIN]
    if (t.def.geography === 'desert') frictionHere += FRICTION_DESERT; // [PLACEHOLDER callsite: FRICTION_DESERT]
    if (t.state.ownerId !== sourceNationId && t.state.ownerId !== destNationId) {
      frictionHere += FRICTION_HOSTILE_CROSSING; // [PLACEHOLDER callsite: FRICTION_HOSTILE_CROSSING]
    }
    if (t.state.hasRoad) frictionHere -= FRICTION_ROAD_REDUCTION; // [PLACEHOLDER callsite: FRICTION_ROAD_REDUCTION]
    totalFriction += frictionHere;
  }
  return totalFriction;
}

// ── Per-territory local stockpile helpers ─────────────────────────────────────

export type LocalResource = 'localPopStock' | 'localIndStock' | 'localWltStock';

export function resourceToLocalField(resource: TradeResource): LocalResource {
  if (resource === 'population') return 'localPopStock';
  if (resource === 'industry')   return 'localIndStock';
  return 'localWltStock';
}

export function resourceToNationStockpileField(resource: TradeResource): 'population' | 'industry' | 'wealth' {
  return resource as 'population' | 'industry' | 'wealth';
}
