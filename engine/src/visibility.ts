/**
 * Fog-of-war visibility computation — Phase 7.
 *
 * Pure function: takes structured world data, returns a visibility tier
 * for every territory from the perspective of one nation.
 *
 * Called server-side when building the /api/world response.
 * Never called from resolveTick — has no effect on harness scenarios.
 *
 * Rules evaluated in order; highest tier wins:
 *   1. Own territory                                 → Clear
 *   2. Army owned by this nation present in or adj   → Clear
 *   3. Active military_access clause with owner      → Clear  [PLACEHOLDER — may be too strong]
 *   4. Federation member with territory owner        → Clear
 *   5. Active treaty of any kind with owner          → LightFog (minimum)
 *   6. Adjacent to any owned territory               → LightFog
 *   7. Default                                       → TrueFog
 */

export const enum VisibilityTier {
  TrueFog  = 0,  // geography only — no political information
  LightFog = 1,  // owner known, no details
  Clear    = 2,  // full information + armies
}

/** Minimal territory info needed for visibility computation. */
export interface VisTerritoryInput {
  id: string;
  ownerId: string | null;
  adjacentIds: readonly string[];
}

/** Minimal army info needed for visibility computation. */
export interface VisArmyInput {
  nationId: string;
  territoryId: string;
}

/** One active clause from any treaty — only type and parties matter. */
export interface VisTreatyInput {
  /** Nation IDs of both parties. */
  partyIds: readonly [string, string];
  /** At least one clause must be active for the treaty to grant visibility. */
  hasActiveMilitaryAccess: boolean;
  /**
   * §1.11 Outpost/sentry grants from this treaty.
   * Each entry: { targetTerritoryId, type: 'sentry'|'outpost', grantedToNationId }
   * sentry → LightFog on targetTerritoryId for grantedToNationId.
   * outpost → Clear on targetTerritoryId for grantedToNationId.
   */
  outpostGrants?: ReadonlyArray<{
    targetTerritoryId: string;
    type: 'sentry' | 'outpost';
    grantedToNationId: string;
  }>;
}

/** Federation membership entry. */
export interface VisFederationInput {
  /** All nationIds that are members of this federation. */
  memberNationIds: readonly string[];
}

/**
 * §1.6 Embassy visibility grant: owner nation gets Clear on hostTerritoryId
 * while embassy status === 'active'.
 */
export interface VisEmbassyInput {
  ownerNationId: string;
  hostTerritoryId: string;
}

export interface ComputeVisibilityInput {
  nationId: string;
  territories: readonly VisTerritoryInput[];
  armies: readonly VisArmyInput[];
  /** Only active/degraded treaties. Caller filters by status. */
  treaties: readonly VisTreatyInput[];
  /** Only active federations. */
  federations: readonly VisFederationInput[];
  /** Active embassies — each grants Clear to ownerNationId on hostTerritoryId. */
  embassies?: readonly VisEmbassyInput[];
}

/**
 * Compute visibility tier for every known territory from nationId's perspective.
 * Returns a Map with an entry for every territory in the input.
 */
export function computeVisibility(
  input: ComputeVisibilityInput,
): Map<string, VisibilityTier> {
  const { nationId, territories, armies, treaties, federations, embassies } = input;

  // ── Pre-compute lookup sets ───────────────────────────────────────────────

  // Own territory IDs.
  const ownedIds = new Set<string>();
  for (const t of territories) {
    if (t.ownerId === nationId) ownedIds.add(t.id);
  }

  // IDs of territories containing or adjacent to an army we own.
  const armyClearIds = new Set<string>();
  for (const a of armies) {
    if (a.nationId !== nationId) continue;
    armyClearIds.add(a.territoryId);
    // Adjacent to army position also grants Clear.
    const terr = territories.find((t) => t.id === a.territoryId);
    if (terr) {
      for (const adjId of terr.adjacentIds) armyClearIds.add(adjId);
    }
  }

  // Adjacent to any owned territory → LightFog (at minimum).
  const ownAdjIds = new Set<string>();
  for (const t of territories) {
    if (!ownedIds.has(t.id)) continue;
    for (const adjId of t.adjacentIds) {
      if (!ownedIds.has(adjId)) ownAdjIds.add(adjId);
    }
  }

  // Owner IDs that have an active treaty of any kind with us.
  const treatyOwnerIds = new Set<string>();
  // Owner IDs with an active military_access clause with us.
  const militaryAccessOwnerIds = new Set<string>();
  // §1.6 Embassy grants: territoryId → Clear for ownerNationId.
  const embassyClearIds = new Set<string>();
  if (embassies) {
    for (const e of embassies) {
      if (e.ownerNationId === nationId) embassyClearIds.add(e.hostTerritoryId);
    }
  }

  // §1.11 Outpost/sentry grants: territoryId → minimum tier granted to us.
  const outpostGrantTiers = new Map<string, VisibilityTier>();
  for (const treaty of treaties) {
    const [a, b] = treaty.partyIds;
    if (a !== nationId && b !== nationId) continue;
    const partnerId = a === nationId ? b : a;
    treatyOwnerIds.add(partnerId);
    if (treaty.hasActiveMilitaryAccess) {
      militaryAccessOwnerIds.add(partnerId);
    }
    // §1.11 Outpost grants: check if any clause grants outpost/sentry to us.
    if (treaty.outpostGrants) {
      for (const grant of treaty.outpostGrants) {
        if (grant.grantedToNationId !== nationId) continue;
        const grantTier = grant.type === 'outpost' ? VisibilityTier.Clear : VisibilityTier.LightFog;
        const existing = outpostGrantTiers.get(grant.targetTerritoryId) ?? VisibilityTier.TrueFog;
        if (grantTier > existing) outpostGrantTiers.set(grant.targetTerritoryId, grantTier);
      }
    }
  }

  // Owner IDs that share a federation with us.
  const federationOwnerIds = new Set<string>();
  for (const fed of federations) {
    if (!fed.memberNationIds.includes(nationId)) continue;
    for (const memberId of fed.memberNationIds) {
      if (memberId !== nationId) federationOwnerIds.add(memberId);
    }
  }

  // ── Assign tier per territory ─────────────────────────────────────────────

  const result = new Map<string, VisibilityTier>();

  for (const t of territories) {
    let tier = VisibilityTier.TrueFog;

    const owner = t.ownerId;

    // Rule 1: own territory
    if (ownedIds.has(t.id)) {
      tier = VisibilityTier.Clear;
    }
    // Rule 2: army presence (own army in or adjacent to this territory)
    else if (armyClearIds.has(t.id)) {
      tier = VisibilityTier.Clear;
    }
    // Rule 3: military_access clause with the territory's owner [PLACEHOLDER — may be too strong]
    else if (owner && militaryAccessOwnerIds.has(owner)) {
      tier = VisibilityTier.Clear;
    }
    // Rule 4: federation membership with territory owner
    else if (owner && federationOwnerIds.has(owner)) {
      tier = VisibilityTier.Clear;
    }
    // Rule 4b: §1.11 outpost/sentry grant for this specific territory
    else if (outpostGrantTiers.has(t.id)) {
      tier = outpostGrantTiers.get(t.id)!;
    }
    // Rule 4c: §1.6 embassy in this territory → Clear for embassy owner
    else if (embassyClearIds.has(t.id)) {
      tier = VisibilityTier.Clear;
    }
    // Rule 5: any active treaty with the territory's owner → LightFog minimum
    else if (owner && treatyOwnerIds.has(owner)) {
      tier = VisibilityTier.LightFog;
    }
    // Rule 6: adjacent to an owned territory → LightFog minimum
    else if (ownAdjIds.has(t.id)) {
      tier = VisibilityTier.LightFog;
    }
    // Rule 7: default TrueFog (already set)

    result.set(t.id, tier);
  }

  return result;
}
