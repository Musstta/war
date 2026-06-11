import { useState } from 'react';
import type { NationView, PrestigeHistoryPoint } from '../api';

interface Props {
  nations: Record<string, NationView>;
  myNationId: string;
  currentTick: number;
}

const SPARKLINE_W = 48;
const SPARKLINE_H = 16;

function Sparkline({ history }: { history: PrestigeHistoryPoint[] }) {
  if (history.length < 2) return <span style={{ display: 'inline-block', width: SPARKLINE_W }} />;

  const values = history.map((h) => h.prestige);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * SPARKLINE_W;
    const y = SPARKLINE_H - ((v - min) / range) * SPARKLINE_H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const last = values[values.length - 1]!;
  const secondLast = values[values.length - 2]!;
  const lineColor = last >= secondLast ? '#4caf50' : '#ff6b6b';

  return (
    <svg
      width={SPARKLINE_W}
      height={SPARKLINE_H}
      style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: '0.3rem' }}
    >
      <polyline
        points={pts}
        fill="none"
        stroke={lineColor}
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.8"
      />
    </svg>
  );
}

function deltaLabel(delta: number): { text: string; color: string } {
  if (delta > 0) return { text: `▲${delta}`, color: '#4caf50' };
  if (delta < 0) return { text: `▼${Math.abs(delta)}`, color: '#ff6b6b' };
  return { text: '—', color: '#444' };
}

/** Biggest prestige gain over the last 7 ticks. */
function biggestClimb7(history: PrestigeHistoryPoint[]): number {
  if (history.length < 2) return 0;
  const last7 = history.slice(-7);
  if (last7.length < 2) return last7[last7.length - 1]!.prestige - last7[0]!.prestige;
  return last7[last7.length - 1]!.prestige - last7[0]!.prestige;
}

/** Consecutive ticks at the top of a leaderboard snapshot (using the history array relative to ranked). */
function longestAtTop(history: PrestigeHistoryPoint[], allNationsHistory: PrestigeHistoryPoint[][]): number {
  // Count from the most recent tick backward how many ticks this nation was the top scorer.
  // We use the full history arrays of all nations to compare.
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const tick = history[i]!.tick;
    const myScore = history[i]!.prestige;
    const isTop = allNationsHistory.every((nh) => {
      const match = nh.find((h) => h.tick === tick);
      return match == null || myScore >= match.prestige;
    });
    if (!isTop) break;
    count++;
  }
  return count;
}

export function PrestigeLeaderboard({ nations, myNationId, currentTick }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const ranked = Object.values(nations)
    .sort((a, b) => b.prestige - a.prestige)
    .map((n, i) => ({ ...n, rank: i + 1 }));

  const allHistories = ranked.map((n) => n.prestigeHistory ?? []);

  return (
    <div style={{
      position: 'fixed',
      top: '2.8rem',
      right: 0,
      width: '13rem',
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
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span>PRESTIGE</span>
        <span style={{ color: '#333', fontSize: '0.6rem' }}>T{currentTick}</span>
      </div>

      {ranked.map((n) => {
        const dl = deltaLabel(n.prestigeDelta ?? 0);
        const isHovered = hoveredId === n.id;
        const climb7 = biggestClimb7(n.prestigeHistory ?? []);
        const atTop = longestAtTop(n.prestigeHistory ?? [], allHistories);

        return (
          <div key={n.id}>
            <div
              onMouseEnter={() => setHoveredId(n.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '0.2rem 0.4rem',
                background: n.id === myNationId ? '#0d1a0d' : isHovered ? '#131325' : 'transparent',
                borderBottom: '1px solid #111122',
                cursor: 'default',
              }}
            >
              {/* Rank */}
              <span style={{ color: '#444', width: '1rem', flexShrink: 0, fontSize: '0.65rem' }}>
                {n.rank}
              </span>

              {/* Dominant badge */}
              {n.isDominant && (
                <span style={{
                  color: '#c8a020',
                  fontSize: '0.62rem',
                  marginRight: '0.2rem',
                  flexShrink: 0,
                  letterSpacing: '-0.02em',
                }} title="Dominant nation">
                  ★
                </span>
              )}

              {/* Nation name */}
              <span style={{
                flex: 1,
                color: n.isDominant ? '#d4b040' : n.id === myNationId ? '#8a8' : '#778',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {n.name}
              </span>

              {/* Score */}
              <span style={{
                color: n.isDominant ? '#d4b040' : n.rank === 1 ? '#c8a' : '#556',
                fontWeight: n.rank === 1 ? 'bold' : 'normal',
                marginLeft: '0.2rem',
                flexShrink: 0,
                fontSize: '0.72rem',
              }}>
                {n.prestige}
              </span>

              {/* Delta */}
              <span style={{
                color: dl.color,
                marginLeft: '0.2rem',
                flexShrink: 0,
                fontSize: '0.6rem',
                minWidth: '1.8rem',
                textAlign: 'right',
              }}>
                {dl.text}
              </span>

              {/* Sparkline */}
              <Sparkline history={n.prestigeHistory ?? []} />
            </div>

            {/* Hover expand: secondary stats */}
            {isHovered && (
              <div style={{
                padding: '0.25rem 0.5rem 0.3rem',
                background: '#0a0a18',
                borderBottom: '1px solid #111122',
                fontSize: '0.65rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.1rem' }}>
                  <span style={{ color: '#555' }}>Treaties kept</span>
                  <span style={{ color: '#778' }}>{n.completedTreatiesKept}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.1rem' }}>
                  <span style={{ color: '#555' }}>Wars won</span>
                  <span style={{ color: '#778' }}>{n.warsWon}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.1rem' }}>
                  <span style={{ color: '#555' }}>Ticks at #1</span>
                  <span style={{ color: atTop > 0 ? '#c8a' : '#778' }}>{atTop}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#555' }}>Climb (7 ticks)</span>
                  <span style={{ color: climb7 > 0 ? '#4caf50' : climb7 < 0 ? '#ff6b6b' : '#778' }}>
                    {climb7 > 0 ? `+${climb7}` : climb7}
                  </span>
                </div>
                {n.isDominant && (
                  <div style={{ marginTop: '0.2rem', color: '#8a6010', fontSize: '0.62rem', borderTop: '1px solid #1a1a2a', paddingTop: '0.15rem' }}>
                    ★ Dominant nation — attackers gain bonus strength
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
