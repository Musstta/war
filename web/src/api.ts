export interface MeResponse {
  nationId: string;
  name: string;
  phase: 'main' | 'prep';
  mandateBudget: number;
  mandateUsed: number;
}

export interface TerritoryView {
  id: string;
  ownerId: string | null;
  hasRoad: boolean;
  hasPort: boolean;
  isCoastal: boolean;
  // present only for own + adjacent territories
  fortificationLevel?: number;
  unrest?: number;
  constructionType?: 'port' | 'fort_l1' | 'fort_l2' | 'fort_l3' | null;
  constructionTicksLeft?: number | null;
}

export interface NationView {
  id: string;
  name: string;
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
};
