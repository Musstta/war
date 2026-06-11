// [DEV-ONLY] Shown only when logged in as player1 (nation_costa_rica).
// Provides in-browser shortcuts for the /api/dev/* endpoints so curl is not required.
import { useState } from 'react';
import { WorldView, api } from '../api';

interface Props {
  world: WorldView;
  onRefresh: () => void;
  gameId: string;
}

export function DevToolbar({ world, onRefresh, gameId }: Props) {
  if (world.myNationId !== 'nation_costa_rica') return null;

  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); await onRefresh(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Dev action failed'); }
    finally { setBusy(false); }
  };

  const phaseLabel = world.phase === 'main' ? 'Main' : 'Prep';

  return (
    <div style={barStyle}>
      <span style={{ color: '#f0a500', fontWeight: 'bold', marginRight: '0.6rem', fontSize: '0.7rem' }}>DEV</span>

      <span style={groupLabel}>Phase ({phaseLabel}):</span>
      <Btn label="→ Main" onClick={() => run(() => api.dev.setPhase(gameId, 'main'))} busy={busy} />
      <Btn label="→ Prep" onClick={() => run(() => api.dev.setPhase(gameId, 'prep'))} busy={busy} />
      <Btn label="→ Clock" onClick={() => run(() => api.dev.setPhase(gameId))} busy={busy} title="Clear override, return to real clock" />

      <Sep />

      <Btn label="⚡ Tick" onClick={() => run(() => api.dev.tick(gameId))} busy={busy} highlight />

      <Sep />

      <Btn
        label="↺ Reset"
        busy={busy}
        danger
        onClick={() => {
          if (!confirm('Wipe all game data and restart from tick 0?')) return;
          run(() => api.dev.resetWorld(gameId));
        }}
      />
    </div>
  );
}

function Btn({ label, onClick, busy, highlight, danger, title }: {
  label: string; onClick: () => void; busy: boolean;
  highlight?: boolean; danger?: boolean; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={title}
      style={{
        background: danger ? '#3a0000' : highlight ? '#0f3460' : '#1a1a2e',
        border: `1px solid ${danger ? '#7a0000' : highlight ? '#1a5276' : '#333'}`,
        color: danger ? '#ff6b6b' : highlight ? '#7ecfff' : '#aaa',
        borderRadius: 3, padding: '0.1rem 0.4rem', fontFamily: 'monospace',
        fontSize: '0.72rem', cursor: busy ? 'not-allowed' : 'pointer', marginRight: '0.2rem',
      }}
    >
      {label}
    </button>
  );
}

function Sep() {
  return <span style={{ color: '#333', margin: '0 0.3rem' }}>│</span>;
}

const groupLabel: React.CSSProperties = {
  color: '#555', fontSize: '0.7rem', marginRight: '0.3rem',
};

const barStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', flexWrap: 'wrap',
  background: '#0d0d1a', borderBottom: '1px solid #1a1a2e',
  padding: '0.2rem 0.75rem', fontFamily: 'monospace', flexShrink: 0,
};
