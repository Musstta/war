import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type GameDetail } from '../api';
import { useAuth } from '../AuthContext';
import { C, T } from '../styles';

const POLL_MS = 3000;

export function GameLobbyScreen() {
  const { id: gameId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [game, setGame] = useState<GameDetail | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [emptyPolicy, setEmptyPolicy] = useState<'ai' | 'removed'>('ai');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    if (!gameId) return;
    try {
      const g = await api.getGame(gameId);
      setGame(g);
      // Redirect if game moved past lobby
      if (g.status === 'territory_selection') navigate(`/games/${gameId}/select-territory`, { replace: true });
      else if (g.status === 'active' || g.status === 'ended') navigate(`/games/${gameId}/play`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load game');
    }
  };

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  if (!game) return (
    <div style={{ ...T.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {error ? <div style={T.errorBox}>{error}</div> : <span style={{ color: C.muted }}>Loading…</span>}
    </div>
  );

  const myMembership = game.members.find((m) => m.username === user?.username);
  const isHost = myMembership != null && myMembership.userId === game.hostUserId;

  const filledSlots = game.members.length;
  const emptySlotCount = game.maxPlayers - filledSlots;

  const handleLeave = async () => {
    if (!gameId) return;
    setLeaving(true);
    try {
      await api.leaveGame(gameId);
      navigate('/lobby');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to leave');
      setLeaving(false);
    }
  };

  const handleStart = async () => {
    if (!gameId) return;
    setActionError('');
    setStarting(true);
    try {
      await api.startGame(gameId, emptyPolicy);
      navigate(`/games/${gameId}/select-territory`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to start');
      setStarting(false);
    }
  };

  return (
    <div style={{ ...T.page, padding: '1.5rem' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        {/* Back */}
        <button onClick={() => navigate('/lobby')} style={{ ...T.btnGhost, padding: '0.25rem 0.6rem', fontSize: '0.8rem', marginBottom: '1.5rem' }}>
          ← Lobby
        </button>

        <div style={{ marginBottom: '1.5rem' }}>
          <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.4rem', fontWeight: 700 }}>{game.name}</h1>
          <span style={{ ...statusBadge(game.status) }}>{game.status}</span>
          <span style={{ color: C.muted, marginLeft: '0.75rem', fontSize: '0.82rem' }}>
            {tickIntervalLabel(game.tickIntervalSeconds)} tick
          </span>
        </div>

        {error && <div style={{ ...T.errorBox, marginBottom: '1rem' }}>{error}</div>}
        {actionError && <div style={{ ...T.errorBox, marginBottom: '1rem' }}>{actionError}</div>}

        {/* Member list */}
        <div style={T.card}>
          <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: '0.88rem', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Players — {filledSlots}/{game.maxPlayers}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {Array.from({ length: game.maxPlayers }, (_, i) => {
              const member = game.members.find((m) => m.slotIndex === i);
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.4rem 0', borderBottom: i < game.maxPlayers - 1 ? `1px solid ${C.border}` : undefined }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', background: member ? C.accent : C.dim, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: '#fff', flexShrink: 0 }}>
                    {i + 1}
                  </span>
                  {member ? (
                    <>
                      <span style={{ fontWeight: member.username === user?.username ? 600 : 400 }}>
                        {member.username}
                      </span>
                      {i === 0 && <span style={{ fontSize: '0.72rem', color: C.muted, marginLeft: 'auto' }}>host</span>}
                      {member.username === user?.username && i !== 0 && <span style={{ fontSize: '0.72rem', color: C.accent, marginLeft: 'auto' }}>you</span>}
                    </>
                  ) : (
                    <span style={{ color: C.dim, fontStyle: 'italic', fontSize: '0.85rem' }}>open</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {isHost && (
            <div style={T.card}>
              <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: '0.88rem' }}>Start game</div>
              {emptySlotCount > 0 && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={T.label}>Empty slot resolution ({emptySlotCount} slot{emptySlotCount > 1 ? 's' : ''})</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {(['ai', 'removed'] as const).map((opt) => (
                      <button
                        key={opt}
                        onClick={() => setEmptyPolicy(opt)}
                        style={{
                          ...T.btnSm,
                          background: emptyPolicy === opt ? C.accent : 'transparent',
                          border: `1px solid ${emptyPolicy === opt ? C.accent : C.border}`,
                          color: emptyPolicy === opt ? '#fff' : C.muted,
                        }}
                      >
                        {opt === 'ai' ? 'Fill with AI' : 'Remove slot'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button
                onClick={handleStart}
                disabled={starting}
                style={{ ...T.btn, opacity: starting ? 0.7 : 1 }}
              >
                {starting ? 'Starting…' : 'Start → Territory selection'}
              </button>
            </div>
          )}

          {myMembership && !isHost && (
            <button onClick={handleLeave} disabled={leaving} style={{ ...T.btnGhost, opacity: leaving ? 0.7 : 1 }}>
              {leaving ? 'Leaving…' : 'Leave game'}
            </button>
          )}

          {!myMembership && (
            <button onClick={() => api.joinGame(gameId!).then(() => load())} style={T.btn}>
              Join game
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function statusBadge(status: string): React.CSSProperties {
  const colors: Record<string, string> = {
    lobby: '#1e3a5f',
    territory_selection: '#1a3a1a',
    active: '#14532d',
    ended: '#1f1f1f',
  };
  return {
    display: 'inline-block',
    background: colors[status] ?? '#1f1f1f',
    border: `1px solid ${C.border}`,
    borderRadius: 4,
    padding: '0.15rem 0.45rem',
    fontSize: '0.75rem',
    color: C.muted,
    fontWeight: 500,
  };
}

function tickIntervalLabel(s: number): string {
  if (s < 120) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
