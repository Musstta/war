import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, GameListItem } from '../api';

interface Props {
  currentGameId: string;
}

export function GameSwitcher({ currentGameId }: Props) {
  const [games, setGames] = useState<GameListItem[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.listGames().then(setGames).catch(() => {});
  }, []);

  const myGames = games.filter((g) => g.status === 'active' || g.status === 'territory_selection' || g.status === 'lobby' || g.status === 'ended');
  if (myGames.length <= 1) return null;

  const goToGame = (g: GameListItem) => {
    if (g.status === 'active' || g.status === 'ended') navigate(`/games/${g.id}/play`);
    else if (g.status === 'territory_selection') navigate(`/games/${g.id}/select-territory`);
    else navigate(`/games/${g.id}`);
  };

  return (
    <div style={containerStyle}>
      <span style={labelStyle}>GAME</span>
      {myGames.map((g) => (
        <button
          key={g.id}
          onClick={() => goToGame(g)}
          style={{
            ...btnStyle,
            background: g.id === currentGameId ? '#1a2a4a' : 'transparent',
            border: `1px solid ${g.id === currentGameId ? '#2a5a9a' : '#2a2a4a'}`,
            color: g.id === currentGameId ? '#7ecfff' : '#666',
          }}
          title={`${g.name} (${g.status})`}
        >
          {g.name.length > 14 ? g.name.slice(0, 13) + '…' : g.name}
          <span style={{ marginLeft: '0.25rem', fontSize: '0.62rem', color: g.id === currentGameId ? '#4a8aba' : '#444' }}>
            {g.status === 'active' ? '▶' : g.status === 'ended' ? '■' : g.status === 'territory_selection' ? '⬡' : '○'}
          </span>
        </button>
      ))}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.25rem',
  padding: '0.15rem 0.5rem',
  background: '#090912',
  borderBottom: '1px solid #1a1a2e',
  fontFamily: 'monospace',
  flexShrink: 0,
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.62rem',
  color: '#333',
  letterSpacing: '0.07em',
  marginRight: '0.2rem',
};

const btnStyle: React.CSSProperties = {
  padding: '0.1rem 0.45rem',
  borderRadius: 3,
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: '0.72rem',
};
