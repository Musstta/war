/**
 * App.tsx — top-level router (v0.38)
 *
 * Route map:
 *   /                         → redirect: /lobby if logged in, /login if not
 *   /login                    → LoginScreen
 *   /register                 → RegisterScreen
 *   /lobby                    → LobbyScreen (auth required)
 *   /games/:id                → GameLobbyScreen (status=lobby; auto-redirects for other statuses)
 *   /games/:id/select-territory → TerritorySelectionScreen (status=territory_selection)
 *   /games/:id/play           → legacy single-game map view (status=active/ended)
 *
 * Styling note (v0.38): clean dark theme, no custom illustration or thematic chrome.
 * Phase 8 will introduce a full visual identity pass — inline styles here are intentionally
 * easy to replace, not built around.
 */

import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { LoginScreen } from './screens/LoginScreen';
import { RegisterScreen } from './screens/RegisterScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { GameLobbyScreen } from './screens/GameLobbyScreen';
import { TerritorySelectionScreen } from './screens/TerritorySelectionScreen';

// Legacy single-game components (kept for active/ended game view)
import { api, type MeResponse, type WorldView } from './api';
import { PhaseBar } from './components/PhaseBar';
import { GameMap } from './components/GameMap';
import { InfoPanel } from './components/InfoPanel';
import { DiplomacyPanel } from './components/DiplomacyPanel';
import { PrestigeLeaderboard } from './components/PrestigeLeaderboard';
import { WarCouncilPanel } from './components/WarCouncilPanel';
import { GameSwitcher } from './components/GameSwitcher';

// ── Auth guard ─────────────────────────────────────────────────────────────────

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#111827', color: '#9ca3af', fontFamily: 'system-ui' }}>
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// ── Root redirect ──────────────────────────────────────────────────────────────

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={user ? '/lobby' : '/login'} replace />;
}

// ── Legacy map view (active / ended games) ─────────────────────────────────────

const REFRESH_MS = 5_000;

function GamePlayScreen() {
  const { id: gameId } = useParams<{ id: string }>();
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [authState, setAuthState] = useState<'loading' | 'logged-in' | 'logged-out'>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [world, setWorld] = useState<WorldView | null>(null);
  const [selectedTerritoryId, setSelectedTerritoryId] = useState<string | null>(null);
  const [showDiplomacy, setShowDiplomacy] = useState(false);
  const [defNames, setDefNames] = useState<Record<string, string>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadWorld = useCallback(async () => {
    try {
      const [meData, worldData] = await Promise.all([
        api.me(),
        api.gameWorld(gameId ?? 'legacy-world'),
      ]);
      setMe(meData);
      setWorld(worldData);
      setAuthState('logged-in');
    } catch {
      setAuthState('logged-out');
    }
  }, [gameId]);

  useEffect(() => { loadWorld().catch(() => setAuthState('logged-out')); }, [loadWorld]);

  useEffect(() => {
    fetch('/territories.geojson')
      .then((r) => r.json())
      .then((data: { features: Array<{ id: string; properties: { name: string } }> }) => {
        const names: Record<string, string> = {};
        for (const f of data.features) names[f.id] = f.properties.name;
        setDefNames(names);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (authState !== 'logged-in') {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => loadWorld(), REFRESH_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [authState, loadWorld]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  if (authState === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#1a1a2e', color: '#888', fontFamily: 'monospace' }}>
        Loading…
      </div>
    );
  }
  if (authState === 'logged-out') return <Navigate to="/login" replace />;
  if (!world || !me) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <PhaseBar world={world} myName={me.name} onLogout={handleLogout} />
      <GameSwitcher currentGameId={gameId ?? 'legacy-world'} />
      <PrestigeLeaderboard nations={world.nations} myNationId={world.myNationId} currentTick={world.tick} />
      <WarCouncilPanel world={world} gameId={gameId ?? 'legacy-world'} />
      <div style={{ position: 'fixed', bottom: '1rem', right: '1rem', zIndex: 100 }}>
        <button
          onClick={() => setShowDiplomacy((v) => !v)}
          style={{
            background: showDiplomacy ? '#2a4a3a' : '#1a1a2e',
            border: '1px solid #3a3a6a', color: '#aab', padding: '0.4rem 0.8rem',
            cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.78rem', borderRadius: '3px',
          }}
        >
          {showDiplomacy ? '✕ Diplomacy' : '🤝 Diplomacy'}
        </button>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', marginRight: '13rem' }}>
        <GameMap world={world} selectedId={selectedTerritoryId} onSelect={setSelectedTerritoryId} />
        {showDiplomacy
          ? <DiplomacyPanel world={world} onActionQueued={loadWorld} gameId={gameId ?? 'legacy-world'} />
          : <InfoPanel territoryId={selectedTerritoryId} world={world} defNames={defNames} onActionQueued={loadWorld} gameId={gameId ?? 'legacy-world'} />
        }
      </div>
      {world.recentEvents.length > 0 && (
        <div style={{
          background: '#0d0d1a', borderTop: '1px solid #2a2a4a', padding: '0.25rem 1rem',
          fontFamily: 'monospace', fontSize: '0.73rem', color: '#888', flexShrink: 0,
          maxHeight: '5rem', overflowY: 'auto',
        }}>
          <span style={{ color: '#444', marginRight: '0.4rem', letterSpacing: '0.05em' }}>LOG</span>
          {world.recentEvents.map((e, i) => (
            <div key={i} style={{ color: i === 0 ? '#aaa' : '#666', padding: '0.05rem 0' }}>
              <span style={{ color: '#333', marginRight: '0.35rem' }}>[T{e.tick}]</span>{e.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Router ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/register" element={<RegisterScreen />} />

      <Route path="/lobby" element={<RequireAuth><LobbyScreen /></RequireAuth>} />
      <Route path="/games/:id" element={<RequireAuth><GameLobbyScreen /></RequireAuth>} />
      <Route path="/games/:id/select-territory" element={<RequireAuth><TerritorySelectionScreen /></RequireAuth>} />
      <Route path="/games/:id/play" element={<RequireAuth><GamePlayScreen /></RequireAuth>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
