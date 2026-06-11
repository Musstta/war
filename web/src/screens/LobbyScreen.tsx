import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type GameListItem } from '../api';
import { useAuth } from '../AuthContext';
import { C, T } from '../styles';

export function LobbyScreen() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [games, setGames] = useState<GameListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Create game form
  const [name, setName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(5);
  const [tickInterval, setTickInterval] = useState(86400);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [joiningId, setJoiningId] = useState<string | null>(null);

  const loadGames = async () => {
    try {
      const list = await api.listGames();
      setGames(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load games');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadGames(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreateError('');
    setCreating(true);
    try {
      const res = await api.createGame(name.trim(), maxPlayers, tickInterval);
      navigate(`/games/${res.gameId}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create game');
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = async (gameId: string) => {
    setJoiningId(gameId);
    try {
      await api.joinGame(gameId);
      navigate(`/games/${gameId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join');
      setJoiningId(null);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div style={{ ...T.page, padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem', borderBottom: `1px solid ${C.border}`, paddingBottom: '1rem' }}>
        <div>
          <span style={{ fontSize: '1.1rem', fontWeight: 700, letterSpacing: '-0.01em' }}>WAR</span>
          <span style={{ color: C.muted, marginLeft: '0.75rem', fontSize: '0.85rem' }}>Lobby</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ color: C.muted, fontSize: '0.85rem' }}>{user?.username}</span>
          <button onClick={handleLogout} style={{ ...T.btnGhost, padding: '0.3rem 0.65rem', fontSize: '0.8rem' }}>
            Sign out
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '2rem', maxWidth: 960, margin: '0 auto' }}>
        {/* Create game */}
        <div>
          <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 }}>Create game</h2>
          <form onSubmit={handleCreate} style={{ ...T.card, display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <div>
              <label style={T.label}>Game name</label>
              <input style={T.input} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Friday night war" autoFocus />
            </div>
            <div>
              <label style={T.label}>Max players</label>
              <input style={T.input} type="number" min={2} max={10} value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} />
            </div>
            <div>
              <label style={T.label}>Tick interval</label>
              <select
                style={{ ...T.input }}
                value={tickInterval}
                onChange={(e) => setTickInterval(Number(e.target.value))}
              >
                <option value={60}>1 minute (testing)</option>
                <option value={300}>5 minutes (testing)</option>
                <option value={3600}>1 hour</option>
                <option value={21600}>6 hours</option>
                <option value={86400}>24 hours (default)</option>
              </select>
            </div>
            {createError && <div style={T.errorBox}>{createError}</div>}
            <button type="submit" disabled={creating || !name.trim()} style={{ ...T.btn, opacity: (creating || !name.trim()) ? 0.6 : 1 }}>
              {creating ? 'Creating…' : 'Create'}
            </button>
          </form>
        </div>

        {/* Browse / join games */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Open games</h2>
            <button onClick={loadGames} style={{ ...T.btnGhost, padding: '0.25rem 0.6rem', fontSize: '0.78rem' }}>Refresh</button>
          </div>

          {error && <div style={{ ...T.errorBox, marginBottom: '1rem' }}>{error}</div>}

          {loading ? (
            <p style={{ color: C.muted }}>Loading…</p>
          ) : games.length === 0 ? (
            <div style={{ ...T.card, color: C.muted, textAlign: 'center', padding: '2rem' }}>
              No open games — create one to get started.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {games.map((g) => (
                <div key={g.id} style={{ ...T.card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '0.9rem 1.1rem' }}>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>{g.name}</div>
                    <div style={{ color: C.muted, fontSize: '0.8rem' }}>
                      {g.memberCount}/{g.maxPlayers} players
                      <span style={{ margin: '0 0.4rem', color: C.dim }}>·</span>
                      {tickIntervalLabel(g.tickIntervalSeconds)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => navigate(`/games/${g.id}`)}
                      style={{ ...T.btnSm, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted }}
                    >
                      View
                    </button>
                    <button
                      onClick={() => handleJoin(g.id)}
                      disabled={joiningId === g.id}
                      style={{ ...T.btnSm, opacity: joiningId === g.id ? 0.6 : 1 }}
                    >
                      {joiningId === g.id ? 'Joining…' : 'Join'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function tickIntervalLabel(s: number): string {
  if (s < 120) return `${s}s tick`;
  if (s < 3600) return `${Math.round(s / 60)}m tick`;
  if (s < 86400) return `${Math.round(s / 3600)}h tick`;
  return `${Math.round(s / 86400)}d tick`;
}
