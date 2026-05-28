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

/** Named causes of a territory's unrest equilibrium. Bonuses are negative values. */
export interface UnrestCauses {
  base: number;
  compatibilityPressure: number;
  distancePressure: number;
  noRoadPressure: number;
  overexpansionPressure: number;
  roadBonus: number;
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
}

export interface NationView {
  id: string;
  name: string;
  culture?: NationCulture;
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
  recentEvents: string[];
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

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
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
};
