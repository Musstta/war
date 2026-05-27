// [DEFERRED SECURITY] Phase 3 player credentials are plaintext dev-only.
// Must use hashed secrets + proper secrets management before production.
// See docs/persistent-world-tech-stack.md §11.

export interface Player {
  nationId: string;
  password: string;
}

export const PLAYERS: Record<string, Player> = {
  player1: { password: 'war1', nationId: 'nation_costa_rica' },
  player2: { password: 'war2', nationId: 'nation_guatemala' },
  player3: { password: 'war3', nationId: 'nation_honduras' },
  player4: { password: 'war4', nationId: 'nation_nicaragua' },
  player5: { password: 'war5', nationId: 'nation_panama' },
};

export function authenticate(username: string, password: string): Player | null {
  const player = PLAYERS[username];
  if (!player || player.password !== password) return null;
  return player;
}
