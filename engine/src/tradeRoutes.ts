/**
 * Trade route constants — v0.33 system.
 * All values are [PLACEHOLDER]. See tuning-notes.md §"Trade route placeholders (v0.33)".
 */

// ── Capacity ──────────────────────────────────────────────────────────────────

/** Base capacity for market-tier routes (domestic or international). [PLACEHOLDER] */
export const MARKET_ROUTE_BASE_CAPACITY = 5;

/** Base capacity for port-tier routes, indexed by port level. [PLACEHOLDER] */
export const PORT_ROUTE_BASE_CAPACITY: Record<number, number> = {
  1: 8,
  2: 12,
  3: 18,
};

/** currentCapacity can grow up to baseCapacity × this multiplier. [PLACEHOLDER] */
export const ROUTE_GROWTH_CAP_MULTIPLIER = 1.5;

// ── Growth ────────────────────────────────────────────────────────────────────

/** Capacity added per completed shipment cycle = baseCapacity × this rate. [PLACEHOLDER] */
export const ROUTE_GROWTH_RATE = 0.05;

// ── Upkeep ────────────────────────────────────────────────────────────────────

/** Per-tick upkeep cost = currentCapacity × this rate. [PLACEHOLDER] */
export const ROUTE_UPKEEP_RATE = 0.1;

/** Fraction of upkeep paid by each party on international routes (0.5 = 50/50). [PLACEHOLDER] */
export const ROUTE_INTERNATIONAL_UPKEEP_SPLIT = 0.5;

// ── Port-tier distance bonus ──────────────────────────────────────────────────

/** profitMultiplier += this value per hop on port-tier routes. [PLACEHOLDER] */
export const PORT_DISTANCE_PROFIT_BONUS = 0.1;

// ── Loss event ────────────────────────────────────────────────────────────────

/** unrestSpike = (lostValue / growthCap) × this scale. [PLACEHOLDER] */
export const ROUTE_LOSS_UNREST_SCALE = 0.1;

/** Duration of the TerritoryModifier applied on route loss. [PLACEHOLDER] */
export const ROUTE_LOSS_UNREST_TICKS = 5;

/**
 * Prestige penalty applied to the route-owning nation(s) when a grown route is severed.
 * Scaled by (lostValue / growthCap) — same shape as unrest formula.
 * For international routes: full penalty to owner; half penalty to partner (asymmetric — owner chose the route).
 * [PLACEHOLDER]
 */
export const PRESTIGE_LOSS_PER_ROUTE_LOSS = 5;

/**
 * Wealth penalty applied to the receiving party when an in-transit shipment is lost.
 * Represents collateral for undelivered merchandise.
 * For domestic routes: applied to the single nation.
 * For international routes: applied only to the destination nation (the one that would have received cargo).
 * Formula: SHIPMENT_LOSS_WEALTH_VALUE × (lostValue / growthCap) — scales with how much the route had grown.
 * [PLACEHOLDER]
 */
export const SHIPMENT_LOSS_WEALTH_VALUE = 3;

// ── Cultural pressure ─────────────────────────────────────────────────────────

/** merchantPressure per route = (currentCapacity / nationOutput) × this weight. [PLACEHOLDER] */
export const ROUTE_MERCHANT_PRESSURE_WEIGHT = 0.5;

/**
 * Routes beyond this count add routeCountPressure to isolationistEntanglement.
 * Intentionally separate counter from ISOLATIONIST_TREATY_THRESHOLD. [PLACEHOLDER]
 */
export const ROUTE_ISOLATIONIST_THRESHOLD = 3;

/** Per-route-above-threshold isolationist entanglement penalty. [PLACEHOLDER] */
export const ROUTE_ISOLATIONIST_COUNT_WEIGHT = 0.02;

// ── Prestige ──────────────────────────────────────────────────────────────────

/** prestige += Σ(currentCapacity) × this factor. [PLACEHOLDER] */
export const PRESTIGE_PER_TRADE_CAPACITY = 0.3;

// ── Mandate costs ─────────────────────────────────────────────────────────────

/** Mandate cost to establish a domestic trade route. [PLACEHOLDER] */
export const ESTABLISH_DOMESTIC_ROUTE_MANDATE = 2;

/** Mandate cost for international route (treaty negotiation is the real cost). [PLACEHOLDER] */
export const INTERNATIONAL_ROUTE_MANDATE = 1;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Compute baseCapacity for a new route given its type and portLevel. */
export function computeBaseCapacity(
  type: 'domestic' | 'international_market' | 'international_port',
  portLevel: number,
): number {
  if (type === 'international_port') {
    return PORT_ROUTE_BASE_CAPACITY[portLevel] ?? PORT_ROUTE_BASE_CAPACITY[1];
  }
  return MARKET_ROUTE_BASE_CAPACITY;
}

/** Compute profitMultiplier for a port-tier route given the hop distance. */
export function computeProfitMultiplier(
  type: 'domestic' | 'international_market' | 'international_port',
  hopDistance: number,
): number {
  if (type !== 'international_port') return 1.0;
  return 1 + hopDistance * PORT_DISTANCE_PROFIT_BONUS;
}
