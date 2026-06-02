import type { NationView } from '../api';

interface Props {
  nations: Record<string, NationView>;
  myNationId: string;
}

export function PrestigeLeaderboard({ nations, myNationId }: Props) {
  const ranked = Object.values(nations)
    .sort((a, b) => b.prestige - a.prestige)
    .map((n, i) => ({ ...n, rank: i + 1 }));

  return (
    <div style={{
      position: 'fixed',
      top: '2.8rem',
      right: 0,
      width: '11rem',
      background: '#0d0d1a',
      borderLeft: '1px solid #2a2a4a',
      borderBottom: '1px solid #2a2a4a',
      fontFamily: 'monospace',
      fontSize: '0.72rem',
      zIndex: 50,
    }}>
      <div style={{
        padding: '0.25rem 0.5rem',
        color: '#666',
        letterSpacing: '0.08em',
        borderBottom: '1px solid #1a1a3a',
        fontSize: '0.65rem',
      }}>
        PRESTIGE
      </div>
      {ranked.map((n) => (
        <div
          key={n.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '0.18rem 0.5rem',
            background: n.id === myNationId ? '#0d1a0d' : 'transparent',
            borderBottom: '1px solid #111122',
          }}
        >
          <span style={{ color: '#444', width: '1rem', flexShrink: 0 }}>{n.rank}</span>
          <span style={{
            flex: 1,
            color: n.id === myNationId ? '#8a8' : '#778',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {n.name}
          </span>
          <span style={{
            color: n.rank === 1 ? '#c8a' : '#556',
            fontWeight: n.rank === 1 ? 'bold' : 'normal',
            marginLeft: '0.3rem',
            flexShrink: 0,
          }}>
            {n.prestige}
          </span>
        </div>
      ))}
    </div>
  );
}
