import { WorldView } from '../api';

interface Props {
  world: WorldView;
  myName: string;
  onLogout: () => void;
}

export function PhaseBar({ world, myName, onLogout }: Props) {
  const phaseLabel = world.phase === 'main' ? 'Main Phase' : 'Prep Phase';
  const phaseColor = world.phase === 'main' ? '#4CAF50' : '#FF9800';
  const mandateLeft = world.mandateBudget - world.mandateUsed;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '1.5rem',
      background: '#1a1a2e', color: '#eee', padding: '0.5rem 1rem',
      fontFamily: 'monospace', fontSize: '0.85rem', borderBottom: '1px solid #333',
      flexShrink: 0,
    }}>
      <span style={{ fontWeight: 'bold', letterSpacing: '0.05em' }}>WAR</span>
      <span style={{ color: '#888' }}>Tick {world.tick}</span>
      <span style={{
        background: phaseColor, color: '#000', borderRadius: 3,
        padding: '0.1rem 0.4rem', fontWeight: 'bold', fontSize: '0.75rem',
      }}>
        {phaseLabel}
      </span>
      <span style={{ color: '#aaa' }}>
        Mandates: <strong style={{ color: mandateLeft > 0 ? '#4CAF50' : '#f44' }}>
          {mandateLeft}
        </strong>/{world.mandateBudget} left
      </span>
      <span style={{ marginLeft: 'auto', color: '#888' }}>{myName}</span>
      <button onClick={onLogout} style={{
        background: 'transparent', border: '1px solid #555', borderRadius: 3,
        color: '#aaa', padding: '0.15rem 0.5rem', fontFamily: 'monospace',
        fontSize: '0.75rem', cursor: 'pointer',
      }}>
        logout
      </button>
    </div>
  );
}
