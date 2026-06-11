import { useEffect, useState, useCallback } from 'react';
import { api, WarCouncilView, WorldView } from '../api';

interface Props {
  world: WorldView;
  gameId: string;
}

const panel: React.CSSProperties = {
  position: 'fixed',
  bottom: 0,
  left: 0,
  right: '13rem', // stay left of the PrestigeLeaderboard
  maxHeight: '14rem',
  background: '#0d0d1a',
  borderTop: '1px solid #2a2a4a',
  fontFamily: 'monospace',
  fontSize: '0.72rem',
  zIndex: 40,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const sectionHead: React.CSSProperties = {
  padding: '0.2rem 0.6rem',
  color: '#666',
  letterSpacing: '0.07em',
  fontSize: '0.62rem',
  background: '#090912',
  borderBottom: '1px solid #1a1a2e',
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  flexShrink: 0,
};

function actionLabel(actionType: string, targetTerritoryId: string | null): string {
  const target = targetTerritoryId ?? '?';
  if (actionType === 'attack_territory') return `⚔ attack ${target}`;
  if (actionType === 'move_army') return `→ move to ${target}`;
  if (actionType === 'retreat_army') return `↩ retreat from ${target}`;
  return actionType;
}

export function WarCouncilPanel({ world, gameId }: Props) {
  const [council, setCouncil] = useState<WarCouncilView | null>(null);
  const [activeWarId, setActiveWarId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Detect active war involving the current player.
  const myNationId = world.myNationId;

  // We don't have wars in WorldView yet, so we check via the council API — try each war
  // the player may be in by looking at all nations' war state. For now, we need a different
  // signal. We'll add wars to WorldView in a later pass; for now poll the council endpoint
  // with the war IDs we learn from a separate light query.
  // Short-term: expose active wars on the /api/world response via myActiveWarIds (see below).
  // We use the `myActiveWarIds` field if present, otherwise show nothing.
  const myActiveWarIds: number[] = (world as any).myActiveWarIds ?? [];

  const fetchCouncil = useCallback(async () => {
    if (myActiveWarIds.length === 0) {
      setCouncil(null);
      setActiveWarId(null);
      return;
    }
    const warId = myActiveWarIds[0]!;
    setActiveWarId(warId);
    try {
      const data = await api.gameWarCouncil(gameId, warId);
      setCouncil(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load council');
    }
  }, [myActiveWarIds.join(','), gameId]);

  useEffect(() => {
    fetchCouncil();
  }, [fetchCouncil]);

  if (myActiveWarIds.length === 0 || !council) return null;

  return (
    <div style={panel}>
      {/* Header */}
      <div style={sectionHead}>
        <span style={{ color: council.councilSide === 'attacker' ? '#ff8c00' : '#4a9eff' }}>
          {council.councilSide === 'attacker' ? '⚔ WAR COUNCIL' : '🛡 WAR COUNCIL'}
        </span>
        <span style={{ color: '#444' }}>War #{council.warId}</span>
        <span style={{ color: council.warStatus === 'peace_negotiation' ? '#f0a500' : '#555' }}>
          {council.warStatus === 'peace_negotiation' ? '— PEACE NEGOTIATION' : ''}
        </span>
        <span style={{ color: '#2a2a4a', marginLeft: 'auto' }}>T{council.tick}</span>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Column 1: Members + this tick's moves */}
        <div style={{ flex: '0 0 11rem', borderRight: '1px solid #1a1a2e', padding: '0.3rem 0.5rem', overflow: 'auto' }}>
          <div style={{ color: '#444', fontSize: '0.6rem', letterSpacing: '0.06em', marginBottom: '0.2rem' }}>MEMBERS</div>
          {council.members.map((m) => (
            <div key={m.nationId} style={{
              marginBottom: '0.25rem',
              padding: '0.15rem 0.25rem',
              background: m.isMe ? '#0d1a0d' : 'transparent',
              borderRadius: 2,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <span style={{ color: m.isMe ? '#8a8' : '#778' }}>{m.name}</span>
                <span style={{
                  fontSize: '0.6rem',
                  color: m.hasQueuedMilitary ? '#4caf50' : '#444',
                  marginLeft: 'auto',
                }}>
                  {m.hasQueuedMilitary ? '✓ queued' : 'waiting'}
                </span>
              </div>
              {m.queuedActions.map((a, i) => (
                <div key={i} style={{ fontSize: '0.64rem', color: '#5a8a5a', paddingLeft: '0.4rem', marginTop: '0.05rem' }}>
                  {actionLabel(a.actionType, a.targetTerritoryId)}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Column 2: Contested territories */}
        <div style={{ flex: '0 0 12rem', borderRight: '1px solid #1a1a2e', padding: '0.3rem 0.5rem', overflow: 'auto' }}>
          <div style={{ color: '#444', fontSize: '0.6rem', letterSpacing: '0.06em', marginBottom: '0.2rem' }}>CONTESTED</div>
          {council.contestedTerritories.length === 0 && (
            <div style={{ color: '#333', fontSize: '0.65rem' }}>None</div>
          )}
          {council.contestedTerritories.map((t) => (
            <div key={t.territoryId} style={{ marginBottom: '0.3rem' }}>
              <div style={{ color: '#aaa', fontSize: '0.68rem' }}>
                {t.name}
                {t.siegeProgress != null && (
                  <span style={{ color: '#f0a500', marginLeft: '0.3rem' }}>
                    siege {t.siegeProgress}
                  </span>
                )}
              </div>
              {t.councilArmiesPresent.map((a) => {
                const nation = council.members.find((m) => m.nationId === a.nationId);
                return (
                  <div key={a.nationId} style={{ fontSize: '0.62rem', color: '#4a7a4a', paddingLeft: '0.4rem' }}>
                    {nation?.name ?? a.nationId}: {a.size}
                    {a.status === 'moving' && <span style={{ color: '#66aaff' }}> (→)</span>}
                    {a.status === 'besieging' && <span style={{ color: '#ff9900' }}> (⚔)</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Column 3: Joint invasion objectives */}
        {council.jointInvasionObjectives.length > 0 && (
          <div style={{ flex: 1, padding: '0.3rem 0.5rem', overflow: 'auto' }}>
            <div style={{ color: '#444', fontSize: '0.6rem', letterSpacing: '0.06em', marginBottom: '0.2rem' }}>JOINT OBJECTIVES</div>
            {council.jointInvasionObjectives.map((obj, i) => (
              <div key={i} style={{ marginBottom: '0.35rem' }}>
                <div style={{ color: '#778', fontSize: '0.65rem', marginBottom: '0.1rem' }}>
                  ⚔ {obj.targetTerritoryId ?? '?'}
                  <span style={{ color: '#444', marginLeft: '0.3rem' }}>({obj.deadlineTicks - council.tick}t left)</span>
                </div>
                {obj.checklist.map((c) => (
                  <div key={c.nationId} style={{ display: 'flex', gap: '0.3rem', fontSize: '0.62rem', paddingLeft: '0.4rem' }}>
                    <span style={{ color: c.hasQueuedAttack ? '#4caf50' : '#ff6b6b' }}>
                      {c.hasQueuedAttack ? '✓' : '○'}
                    </span>
                    <span style={{ color: c.hasQueuedAttack ? '#4caf50' : '#666' }}>{c.name}</span>
                    <span style={{ color: '#444', marginLeft: 'auto' }}>
                      {c.hasQueuedAttack ? 'queued' : 'waiting'}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div style={{ flex: 1, padding: '0.3rem 0.5rem', color: '#7a2222', fontSize: '0.65rem' }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
