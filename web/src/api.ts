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
  treatyCulturalClash?: number;
  insolvencyPressure?: number;
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

/** Mirrors engine VisibilityTier enum values. */
export const VisibilityTier = {
  TrueFog:  0,
  LightFog: 1,
  Clear:    2,
} as const;
export type VisibilityTierValue = typeof VisibilityTier[keyof typeof VisibilityTier];

/** Army stationed in a territory, visible in Clear tier. */
export interface TerritoryArmyView {
  id: number;
  nationId: string;
  size: number;
  status: string;
}

/**
 * Territory as returned by /api/world.
 * Fields present depend on visibilityTier:
 *   TrueFog (0):  id, visibilityTier, geography, name
 *   LightFog (1): + ownerId, ownerName, isCoastal
 *   Clear (2):    + all detail fields + armies
 */
export interface TerritoryView {
  id: string;
  visibilityTier: VisibilityTierValue;
  geography: string | null;
  name: string;
  // LightFog+
  ownerId?: string | null;
  ownerName?: string | null;
  isCoastal?: boolean;
  // Clear only
  hasRoad?: boolean;
  hasPort?: boolean;
  hasMarket?: boolean;
  isInRevolt?: boolean;
  fortificationLevel?: number;
  unrest?: number;
  constructionType?: 'port' | 'market' | 'fort_l1' | 'fort_l2' | 'fort_l3' | null;
  constructionTicksLeft?: number | null;
  pendingConstructionType?: 'port' | 'market' | 'fort_l1' | 'fort_l2' | 'fort_l3' | 'road' | null;
  compatibility?: CompatibilityBreakdown;
  unrestCauses?: UnrestCauses;
  armies?: TerritoryArmyView[];
  // own territory only (Clear)
  localPopStock?: number;
  localIndStock?: number;
  localWltStock?: number;
}

export interface PrestigeHistoryPoint {
  tick: number;
  prestige: number;
}

export interface NationView {
  id: string;
  name: string;
  culture?: NationCulture;
  prestige: number;
  /** Prestige change since last tick. Positive = gained, negative = lost. */
  prestigeDelta: number;
  /** True if this nation currently holds Dominant status. */
  isDominant: boolean;
  /** Last ≤20 ticks of prestige history for sparklines. */
  prestigeHistory: PrestigeHistoryPoint[];
  /** Cumulative kept treaties (for secondary stat display). */
  completedTreatiesKept: number;
  /** Cumulative war wins. */
  warsWon: number;
  // present only for own nation
  stockpiles?: { population: number; industry: number; wealth: number };
  armySize?: number;
  debtBalance?: number;
  isInsolvent?: boolean;
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
  /** Active war IDs involving this nation. Used by the War Council panel. */
  myActiveWarIds: number[];
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
  hasMarket: boolean;
  portLevel: number;
  isCoastal: boolean;
  constructionType: string | null;
  constructionTicksLeft: number | null;
  pendingConstructionType: string | null;
  compatibility: CompatibilityBreakdown | null;
  culture: { individualist: number; progressive: number; militaristic: number; expansionist: number; family: string };
  fragmentationRisk: number | null;
}

export interface AdminArmyRow {
  id: number;
  territoryId: string;
  size: number;
  status: string;
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
  activityTier: string;
  lastActiveAt: string | null;
  abandonedAt: string | null;
  armies: AdminArmyRow[];
}

export interface AdminWorldFull {
  tick: number;
  phase: 'main' | 'prep';
  nations: AdminNationRow[];
  territories: AdminTerritoryRow[];
  recentEvents: Array<{ tick: number; message: string }>;
  tradeRouteAgreements?: TradeRouteAgreementView[];
}

// ── Diplomacy types ───────────────────────────────────────────────────────────

export type ClauseType = 'non_aggression' | 'tribute' | 'trade' | 'military_access' | 'defense_pact' | 'objective' | 'trade_route';

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

export interface TradeShipmentView {
  id: number;
  routeId: number;
  transitTicksRemaining: number;
  cargoAmount: number;
  cargoResource: string;
  departedAtTick: number;
}

export interface TradeRouteAgreementView {
  id: number;
  treatyClauseId: number | null;
  ownerNationId: string;
  ownerNationName: string;
  partnerNationId: string | null;
  partnerNationName: string | null;
  type: 'domestic' | 'international_market' | 'international_port';
  sourceTerritoryId: string;
  sourceTerritoryName: string;
  destinationTerritoryId: string;
  destinationTerritoryName: string;
  portLevel: number;
  baseCapacity: number;
  currentCapacity: number;
  growthCap: number;
  cyclesCompleted: number;
  profitMultiplier: number;
  upkeepPerTick: number;
  status: 'active' | 'suspended' | 'ended';
  startedAtTick: number;
  shipments: TradeShipmentView[];
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

// ── War Council types ─────────────────────────────────────────────────────────

export interface CouncilMember {
  nationId: string;
  name: string;
  isMe: boolean;
  hasQueuedMilitary: boolean;
  queuedActions: Array<{ actionType: string; targetTerritoryId: string | null }>;
}

export interface CouncilContestedTerritory {
  territoryId: string;
  name: string;
  siegeProgress: number | null;
  occupyingNationId: string | null;
  councilArmiesPresent: Array<{ nationId: string; size: number; status: string }>;
}

export interface JointInvasionChecklist {
  treatyId: number;
  clauseIndex: number;
  targetTerritoryId: string | null;
  status: string;
  deadlineTicks: number;
  checklist: Array<{ nationId: string; name: string; hasQueuedAttack: boolean }>;
}

export interface WarCouncilView {
  warId: number;
  warStatus: string;
  councilSide: 'attacker' | 'defender';
  tick: number;
  members: CouncilMember[];
  contestedTerritories: CouncilContestedTerritory[];
  jointInvasionObjectives: JointInvasionChecklist[];
}

// ── Lobby / Territory types (v0.36–v0.37) ─────────────────────────────────────

export interface GameListItem {
  id: string;
  name: string;
  hostUserId: number | null;
  maxPlayers: number;
  status: string;
  tickIntervalSeconds: number;
  memberCount: number;
  createdAt: string;
}

export interface GameMember {
  slotIndex: number;
  userId: number;
  username: string;
  nationId: string | null;
  confirmedTerritoryId?: string | null;
}

export interface GameDetail {
  id: string;
  name: string;
  status: string; // 'lobby' | 'territory_selection' | 'active' | 'ended'
  maxPlayers: number;
  tickIntervalSeconds: number;
  lastTickAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  tick: number | null;
  hostUserId: number | null;
  members: GameMember[];
  aiSlots?: number[];
  removedSlots?: number[];
}

export interface CandidateView {
  slotIndex: number;
  territoryId: string;
  name: string;
  qualityTier: number;
  isCoastal: boolean;
  confirmed: boolean;
}

export interface CandidatesResponse {
  candidates: CandidateView[];
  confirmedTerritoryId: string | null;
  rerollUsed: boolean;
  allConfirmed: boolean;
  confirmedCount: number;
  totalHuman: number;
}

export interface ConfirmResponse {
  ok: boolean;
  sniped: boolean;
  candidates: CandidateView[];
  transitioned: boolean;
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

  gameWorld: (gameId: string) => apiFetch<WorldView>(`/api/games/${gameId}/world`),

  proposeTreaty: (gameId: string, targetNationId: string, termTicks: number, clauses: TreatyClauseInput[], proposerCollateral?: number, targetCollateral?: number) =>
    apiFetch<{ ok: boolean }>(`/api/games/${gameId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'propose_treaty', payload: { targetNationId, termTicks, clauses, proposerCollateral: proposerCollateral ?? 0, targetCollateral: targetCollateral ?? 0 } }),
    }),

  acceptTreaty: (gameId: string, proposalId: number) =>
    apiFetch<{ ok: boolean }>(`/api/games/${gameId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'accept_treaty', payload: { proposalId } }),
    }),

  declineTreaty: (gameId: string, proposalId: number) =>
    apiFetch<{ ok: boolean }>(`/api/games/${gameId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'decline_treaty', payload: { proposalId } }),
    }),

  breakTreaty: (gameId: string, treatyId: number) =>
    apiFetch<{ ok: boolean }>(`/api/games/${gameId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'break_treaty', payload: { treatyId } }),
    }),

  proposeRenewal: (gameId: string, treatyId: number, termTicks?: number) =>
    apiFetch<{ ok: boolean }>(`/api/games/${gameId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'propose_renewal', payload: { treatyId, ...(termTicks !== undefined ? { termTicks } : {}) } }),
    }),

  instantTrade: (gameId: string, resource: 'population' | 'industry' | 'wealth', amount: number, sourceTerritoryId: string, targetNationId: string) =>
    apiFetch<{ ok: boolean }>(`/api/games/${gameId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'instant_trade', payload: { resource, amount, sourceTerritoryId, targetNationId } }),
    }),

  acceptInstantTrade: (gameId: string, tradeId: number) =>
    apiFetch<{ ok: boolean }>(`/api/games/${gameId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'accept_instant_trade', payload: { tradeId } }),
    }),

  declineInstantTrade: (gameId: string, tradeId: number) =>
    apiFetch<{ ok: boolean }>(`/api/games/${gameId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'decline_instant_trade', payload: { tradeId } }),
    }),

  // ── Auth (v0.34+) ──────────────────────────────────────────────────────────
  register: (username: string, password: string) =>
    apiFetch<{ ok: boolean; userId: number }>('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),

  authLogin: (username: string, password: string) =>
    apiFetch<{ ok: boolean; nationId: string | null }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),

  authLogout: () => apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  // ── Games / Lobby (v0.36+) ─────────────────────────────────────────────────
  createGame: (name: string, maxPlayers: number, tickIntervalSeconds: number) =>
    apiFetch<{ ok: boolean; gameId: string; name: string }>('/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, maxPlayers, tickIntervalSeconds }),
    }),

  listGames: () =>
    apiFetch<GameListItem[]>('/api/games'),

  getGame: (gameId: string) =>
    apiFetch<GameDetail>(`/api/games/${gameId}`),

  joinGame: (gameId: string) =>
    apiFetch<{ ok: boolean; slotIndex: number }>(`/api/games/${gameId}/join`, { method: 'POST' }),

  leaveGame: (gameId: string) =>
    apiFetch<{ ok: boolean }>(`/api/games/${gameId}/leave`, { method: 'POST' }),

  startGame: (gameId: string, emptySlotPolicy: 'ai' | 'removed' | 'open', slotResolutions?: Record<number, 'ai' | 'removed'>) =>
    apiFetch<{ ok: boolean; phase: string; aiSlots: number[]; removedSlots: number[] }>(`/api/games/${gameId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emptySlotPolicy, slotResolutions }),
    }),

  endGame: (gameId: string) =>
    apiFetch<{ ok: boolean }>(`/api/games/${gameId}/end`, { method: 'POST' }),

  // ── Territory selection (v0.37+) ───────────────────────────────────────────
  rollTerritories: (gameId: string) =>
    apiFetch<{ ok: boolean; candidates: CandidateView[] }>(`/api/games/${gameId}/territory/roll`, { method: 'POST' }),

  getCandidates: (gameId: string) =>
    apiFetch<CandidatesResponse>(`/api/games/${gameId}/territory/candidates`),

  rerollTerritories: (gameId: string) =>
    apiFetch<{ ok: boolean; candidates: CandidateView[] }>(`/api/games/${gameId}/territory/reroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }),

  confirmTerritory: (gameId: string, slotIndex: number) =>
    apiFetch<ConfirmResponse>(`/api/games/${gameId}/territory/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotIndex }),
    }),

  forceResolve: (gameId: string) =>
    apiFetch<{ ok: boolean }>(`/api/games/${gameId}/territory/force-resolve`, { method: 'POST' }),

  // ── Per-game player endpoints (v0.39+) ────────────────────────────────────
  gameAction: (gameId: string, type: string, payload: unknown) =>
    apiFetch<{ ok: boolean }>(`/api/games/${gameId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload }),
    }),

  gameDiplomacy: (gameId: string) => apiFetch<DiplomacyView>(`/api/games/${gameId}/diplomacy`),

  gameWarCouncil: (gameId: string, warId: number) =>
    apiFetch<WarCouncilView>(`/api/games/${gameId}/war/${warId}/council`),

  // ── Dev endpoints (member-authenticated, game-scoped) ─────────────────────
  dev: {
    tick: (gameId: string) =>
      apiFetch<{ ok: boolean; tick: number }>(`/api/dev/games/${gameId}/tick`, { method: 'POST' }),
    setPhase: (gameId: string, phase?: 'main' | 'prep') =>
      apiFetch<{ ok: boolean; phase: string }>(
        `/api/dev/games/${gameId}/set-phase${phase ? `?phase=${phase}` : ''}`,
        { method: 'POST' },
      ),
    resetWorld: (gameId: string) =>
      apiFetch<{ ok: boolean }>(`/api/dev/games/${gameId}/reset-world`, { method: 'POST' }),
  },

  // ── Admin endpoints (X-Admin-Key gated) ──────────────────────────────────
  // [DEFERRED SECURITY] Key lives in React state only — never in cookies/localStorage.
  // See docs §11 — disable before any public deployment.
  admin: {
    world: (key: string, gameId: string) =>
      apiFetch<AdminWorldFull>(`/api/admin/games/${gameId}/world-full`, { headers: adminHeaders(key) }),
    tick: (key: string, gameId: string) =>
      apiFetch<{ ok: boolean; tick: number }>(
        `/api/admin/games/${gameId}/tick`,
        { method: 'POST', headers: adminHeaders(key) },
      ),
    setPhase: (key: string, phase: 'main' | 'prep' | undefined, gameId: string) =>
      apiFetch<{ ok: boolean; phase: string }>(
        `/api/admin/games/${gameId}/set-phase${phase ? `?phase=${phase}` : ''}`,
        { method: 'POST', headers: adminHeaders(key) },
      ),
    resetWorld: (key: string, gameId: string) =>
      apiFetch<{ ok: boolean }>(
        `/api/admin/games/${gameId}/reset-world`,
        { method: 'POST', headers: adminHeaders(key) },
      ),
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
    toggleMarket: (key: string, id: string) =>
      apiFetch<{ ok: boolean }>(`/api/admin/territory/${id}/toggle-market`, {
        method: 'POST', headers: adminHeaders(key),
      }),
    clearConstruction: (key: string, id: string) =>
      apiFetch<{ ok: boolean }>(`/api/admin/territory/${id}/clear-construction`, {
        method: 'POST', headers: adminHeaders(key),
      }),

    // ── Diplomacy admin ───────────────────────────────────────────────────
    diplomacy: (key: string) =>
      apiFetch<{ treaties: unknown[]; proposals: unknown[]; nations: unknown[]; instantTrades: unknown[]; tradeRoutes: unknown[] }>('/api/admin/diplomacy', {
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
    convertToAi: (key: string, nationId: string) =>
      apiFetch<{ ok: boolean }>(`/api/admin/nation/${nationId}/convert-to-ai`, {
        method: 'POST', headers: adminHeaders(key),
      }),
    createFederation: (key: string, name: string, memberNationIds: string[]) =>
      apiFetch<{ ok: boolean; federationId: number }>('/api/admin/create-federation', {
        method: 'POST',
        headers: adminHeaders(key, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name, memberNationIds }),
      }),
    setPortLevel: (key: string, territoryId: string, portLevel: number) =>
      apiFetch<{ ok: boolean; portLevel: number }>(`/api/admin/territory/${territoryId}/set-port-level`, {
        method: 'POST',
        headers: adminHeaders(key, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ portLevel }),
      }),
  },
};
