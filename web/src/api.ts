export interface MeResponse {
  nationId: string;
  name: string;
  phase: 'main' | 'prep';
  mandateBudget: number;
  mandateUsed: number;
}

/** Per-axis compatibility gap (0 = perfect match, 1 = worst). */
export interface CompatibilityBreakdown {
  individualistGap: number;
  progressiveGap: number;
  militaristicGap: number;
  expansionistGap: number;
  /** 0 = no affinity, 1 = same family. */
  familyCloseness: number;
  /** Overall compatibility 0–1 (1 = fully compatible). */
  total: number;
}

/** Named causes of a territory's unrest equilibrium. Bonuses are ≤ 0; pressures are ≥ 0. */
export interface UnrestCauses {
  base: number;
  compatibilityPressure: number;
  distancePressure: number;
  infrastructureBonus: number;
  overexpansionPressure: number;
  ownershipShock: number;
  recentConquestPressure: number;
  militaryBonus: number;
  equilibrium: number;
}

/** Emergent nation culture — weighted average of owned territories. */
export interface NationCulture {
  individualist: number;
  progressive: number;
  militaristic: number;
  expansionist: number;
  primaryFamily: string | null;
  familyWeights: Record<string, number>;
}

export interface TerritoryView {
  id: string;
  ownerId: string | null;
  hasRoad: boolean;
  hasPort: boolean;
  isCoastal: boolean;
  isInRevolt: boolean;
  // present only for own + adjacent territories
  fortificationLevel?: number;
  unrest?: number;
  constructionType?: 'port' | 'fort_l1' | 'fort_l2' | 'fort_l3' | null;
  constructionTicksLeft?: number | null;
  pendingConstructionType?: 'port' | 'fort_l1' | 'fort_l2' | 'fort_l3' | 'road' | null;
  compatibility?: CompatibilityBreakdown;
  unrestCauses?: UnrestCauses;
  // present only for own territories (trade source selection)
  localPopStock?: number;
  localIndStock?: number;
  localWltStock?: number;
}

export interface NationView {
  id: string;
  name: string;
  culture?: NationCulture;
  prestige: number;
  // present only for own nation
  stockpiles?: { population: number; industry: number; wealth: number };
  armySize?: number;
}

export interface WorldView {
  tick: number;
  phase: 'main' | 'prep';
  myNationId: string;
  mandateBudget: number;
  mandateUsed: number;
  nations: Record<string, NationView>;
  territories: Record<string, TerritoryView>;
  recentEvents: Array<{ tick: number; message: string }>;
  myQueuedActions: Array<{ type: string; payload: unknown }>;
}

export interface TerritoryDevState {
  id: string;
  unrest: number;
  isInRevolt: boolean;
  individualist: number;
  progressive: number;
  militaristic: number;
  expansionist: number;
  constructionType: string | null;
  constructionTicksLeft: number | null;
  fortificationLevel: number;
  capitalTerritoryId?: string | null;
}

/** God's-eye territory row returned by GET /api/admin/world-full */
export interface AdminTerritoryRow {
  id: string;
  name: string;
  ownerId: string | null;
  ownerName: string | null;
  unrest: number;
  unrestCauses: UnrestCauses | null;
  isInRevolt: boolean;
  fortificationLevel: number;
  hasRoad: boolean;
  hasPort: boolean;
  isCoastal: boolean;
  constructionType: string | null;
  constructionTicksLeft: number | null;
  pendingConstructionType: string | null;
  compatibility: CompatibilityBreakdown | null;
  culture: { individualist: number; progressive: number; militaristic: number; expansionist: number; family: string };
}

export interface AdminNationRow {
  id: string;
  name: string;
  isAI: boolean;
  stockpiles: { population: number; industry: number; wealth: number };
  armySize: number;
  mandateBudget: number;
  mandateUsed: number;
  capital: string | null;
  culture: NationCulture | null;
}

export interface AdminWorldFull {
  tick: number;
  phase: 'main' | 'prep';
  nations: AdminNationRow[];
  territories: AdminTerritoryRow[];
  recentEvents: Array<{ tick: number; message: string }>;
}

// ── Diplomacy types ───────────────────────────────────────────────────────────

export type ClauseType = 'non_aggression' | 'tribute' | 'trade' | 'military_access' | 'defense_pact' | 'objective';

export type ObjectiveType =
  | 'build_road_connection'
  | 'build_port'
  | 'maintain_peace'
  | 'joint_invasion'   // [STUB]
  | 'attack_player';   // [STUB]

export type ObjectiveStatus = 'pending' | 'met' | 'failed' | 'waived';
export type ResponsibleParty = 'partyA' | 'partyB' | 'both';

export interface ObjectiveClauseView {
  id: number;
  treatyClauseId: number;
  objectiveType: ObjectiveType;
  targetNationId: string | null;
  targetTerritoryId: string | null;
  deadlineTicks: number;
  status: ObjectiveStatus;
  responsibleParty: ResponsibleParty;
}

export interface TradeRouteView {
  path: string[];
  isSeaRoute: boolean;
  pathStale: boolean;
  capacity: number | null;
  friction: number | null;
}

export interface TreatyClauseView {
  id: number;
  clauseIndex: number;
  type: ClauseType;
  collateral: number;
  payload: Record<string, unknown>;
  clauseStatus: 'active' | 'degraded' | 'breached';
  missedPayments: number;
  tradeRoute?: TradeRouteView | null;
  objectiveClause?: ObjectiveClauseView | null;
}

export interface InstantTradeView {
  id: number;
  proposerNationId?: string;
  proposerName?: string;
  targetNationId?: string;
  targetName?: string;
  resource: 'population' | 'industry' | 'wealth';
  amount: number;
  sourceTerritoryId: string;
  tickProposed: number;
  expiresAtTick: number;
}

export interface TreatyPartyView {
  nationId: string;
  nationName: string;
  collateralDeposited: number;
  escrowAmount: number;
  refundRemaining: number;
}

export interface TreatyView {
  id: number;
  status: 'active' | 'degraded' | 'broken' | 'expired';
  termTicks: number;
  tickStarted: number;
  tickEnds: number;
  totalCollateral: number;
  parties: TreatyPartyView[];
  clauses: TreatyClauseView[];
  partnerTrust: Array<{ nationId: string; trust: number }>;
}

export interface ProposalView {
  id: number;
  proposerId?: string;
  proposerName?: string;
  proposerTrust?: number;
  targetId?: string;
  targetName?: string;
  termTicks: number;
  proposerCollateral: number;
  targetCollateral: number;
  tickProposed: number;
  expiresAtTick: number;
  clauses: TreatyClauseView[];
}

export interface DiplomacyView {
  myTrust: number;
  inactivityTier: string;
  treaties: TreatyView[];
  incomingProposals: ProposalView[];
  outgoingProposals: ProposalView[];
  nationTrust: Record<string, { name: string; trust: number }>;
  incomingInstantTrades: InstantTradeView[];
  outgoingInstantTrades: InstantTradeView[];
}

export interface ObjectiveClauseInput {
  objectiveType: ObjectiveType;
  targetNationId?: string;
  targetTerritoryId?: string;
  deadlineTicks: number;
  responsibleParty: ResponsibleParty;
}

export interface TreatyClauseInput {
  type: ClauseType;
  collateral?: number;
  payload?: Record<string, unknown>;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function adminHeaders(key: string, extra?: Record<string, string>): Record<string, string> {
  return { 'X-Admin-Key': key, ...extra };
}

export const api = {
  login: (username: string, password: string) =>
    apiFetch<{ ok: boolean; nationId: string }>('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),

  logout: () => apiFetch<{ ok: boolean }>('/api/logout', { method: 'POST' }),

  me: () => apiFetch<MeResponse>('/api/me'),

  world: () => apiFetch<WorldView>('/api/world'),

  action: (type: string, payload: unknown) =>
    apiFetch<{ ok: boolean }>('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload }),
    }),

  // ── Diplomacy ─────────────────────────────────────────────────────────────
  diplomacy: () => apiFetch<DiplomacyView>('/api/diplomacy'),

  proposeTreaty: (targetNationId: string, termTicks: number, clauses: TreatyClauseInput[], proposerCollateral?: number, targetCollateral?: number) =>
    apiFetch<{ ok: boolean }>('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'propose_treaty', payload: { targetNationId, termTicks, clauses, proposerCollateral: proposerCollateral ?? 0, targetCollateral: targetCollateral ?? 0 } }),
    }),

  acceptTreaty: (proposalId: number) =>
    apiFetch<{ ok: boolean }>('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'accept_treaty', payload: { proposalId } }),
    }),

  declineTreaty: (proposalId: number) =>
    apiFetch<{ ok: boolean }>('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'decline_treaty', payload: { proposalId } }),
    }),

  breakTreaty: (treatyId: number) =>
    apiFetch<{ ok: boolean }>('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'break_treaty', payload: { treatyId } }),
    }),

  proposeRenewal: (treatyId: number, termTicks?: number) =>
    apiFetch<{ ok: boolean }>('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'propose_renewal', payload: { treatyId, ...(termTicks !== undefined ? { termTicks } : {}) } }),
    }),

  instantTrade: (resource: 'population' | 'industry' | 'wealth', amount: number, sourceTerritoryId: string, targetNationId: string) =>
    apiFetch<{ ok: boolean }>('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'instant_trade', payload: { resource, amount, sourceTerritoryId, targetNationId } }),
    }),

  acceptInstantTrade: (tradeId: number) =>
    apiFetch<{ ok: boolean }>('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'accept_instant_trade', payload: { tradeId } }),
    }),

  declineInstantTrade: (tradeId: number) =>
    apiFetch<{ ok: boolean }>('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'decline_instant_trade', payload: { tradeId } }),
    }),

  // ── Dev endpoints (player1 only) ──────────────────────────────────────────
  dev: {
    tick: () => apiFetch<{ ok: boolean; tick: number }>('/api/dev/tick', { method: 'POST' }),
    setPhase: (phase?: 'main' | 'prep') =>
      apiFetch<{ ok: boolean; phase: string }>(`/api/dev/set-phase${phase ? `?phase=${phase}` : ''}`, { method: 'POST' }),
    resetWorld: () => apiFetch<{ ok: boolean }>('/api/dev/reset-world', { method: 'POST' }),
    territory: (id: string) => apiFetch<TerritoryDevState>(`/api/dev/territory/${id}`),
    setUnrest: (id: string, value: number) =>
      apiFetch<{ ok: boolean }>(`/api/dev/territory/${id}/set-unrest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      }),
    setTrait: (id: string, trait: string, value: number) =>
      apiFetch<{ ok: boolean }>(`/api/dev/territory/${id}/set-trait`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trait, value }),
      }),
  },

  // ── Admin endpoints (X-Admin-Key gated) ──────────────────────────────────
  // [DEFERRED SECURITY] Key lives in React state only — never in cookies/localStorage.
  // See docs §11 — disable before any public deployment.
  admin: {
    world: (key: string) =>
      apiFetch<AdminWorldFull>('/api/admin/world-full', { headers: adminHeaders(key) }),
    tick: (key: string) =>
      apiFetch<{ ok: boolean; tick: number }>('/api/admin/tick', { method: 'POST', headers: adminHeaders(key) }),
    setPhase: (key: string, phase?: 'main' | 'prep') =>
      apiFetch<{ ok: boolean; phase: string }>(
        `/api/admin/set-phase${phase ? `?phase=${phase}` : ''}`,
        { method: 'POST', headers: adminHeaders(key) },
      ),
    resetWorld: (key: string) =>
      apiFetch<{ ok: boolean }>('/api/admin/reset-world', { method: 'POST', headers: adminHeaders(key) }),
    setUnrest: (key: string, id: string, value: number) =>
      apiFetch<{ ok: boolean }>(`/api/admin/territory/${id}/set-unrest`, {
        method: 'POST',
        headers: adminHeaders(key, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ value }),
      }),
    setTrait: (key: string, id: string, trait: string, value: number) =>
      apiFetch<{ ok: boolean }>(`/api/admin/territory/${id}/set-trait`, {
        method: 'POST',
        headers: adminHeaders(key, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ trait, value }),
      }),
    toggleRevolt: (key: string, id: string) =>
      apiFetch<{ ok: boolean; isInRevolt: boolean }>(`/api/admin/territory/${id}/toggle-revolt`, {
        method: 'POST', headers: adminHeaders(key),
      }),
    setFamily: (key: string, id: string, family: string | null) =>
      apiFetch<{ ok: boolean }>(`/api/admin/territory/${id}/set-family`, {
        method: 'POST',
        headers: adminHeaders(key, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ family }),
      }),
    setOwner: (key: string, id: string, ownerId: string | null) =>
      apiFetch<{ ok: boolean }>(`/api/admin/territory/${id}/set-owner`, {
        method: 'POST',
        headers: adminHeaders(key, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ownerId }),
      }),
    setFort: (key: string, id: string, level: number) =>
      apiFetch<{ ok: boolean }>(`/api/admin/territory/${id}/set-fort`, {
        method: 'POST',
        headers: adminHeaders(key, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ level }),
      }),
    toggleRoad: (key: string, id: string) =>
      apiFetch<{ ok: boolean }>(`/api/admin/territory/${id}/toggle-road`, {
        method: 'POST', headers: adminHeaders(key),
      }),
    togglePort: (key: string, id: string) =>
      apiFetch<{ ok: boolean }>(`/api/admin/territory/${id}/toggle-port`, {
        method: 'POST', headers: adminHeaders(key),
      }),
    clearConstruction: (key: string, id: string) =>
      apiFetch<{ ok: boolean }>(`/api/admin/territory/${id}/clear-construction`, {
        method: 'POST', headers: adminHeaders(key),
      }),

    // ── Diplomacy admin ───────────────────────────────────────────────────
    diplomacy: (key: string) =>
      apiFetch<{ treaties: unknown[]; proposals: unknown[]; nations: unknown[] }>('/api/admin/diplomacy', {
        headers: adminHeaders(key),
      }),
    setTrust: (key: string, id: string, value: number) =>
      apiFetch<{ ok: boolean }>(`/api/admin/nation/${id}/set-trust`, {
        method: 'POST',
        headers: adminHeaders(key, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ value }),
      }),
    setTier: (key: string, id: string, tier: string) =>
      apiFetch<{ ok: boolean; tier: string }>(`/api/admin/nation/${id}/set-tier`, {
        method: 'POST',
        headers: adminHeaders(key, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ tier }),
      }),
    forceBreakTreaty: (key: string, treatyId: number) =>
      apiFetch<{ ok: boolean }>(`/api/admin/treaty/${treatyId}/force-break`, {
        method: 'POST', headers: adminHeaders(key),
      }),
    forceMeetObjective: (key: string, objectiveId: number) =>
      apiFetch<{ ok: boolean; status: string }>(`/api/admin/objective/${objectiveId}/force-meet`, {
        method: 'POST', headers: adminHeaders(key),
      }),
    forceFailObjective: (key: string, objectiveId: number) =>
      apiFetch<{ ok: boolean; status: string }>(`/api/admin/objective/${objectiveId}/force-fail`, {
        method: 'POST', headers: adminHeaders(key),
      }),
  },
};
