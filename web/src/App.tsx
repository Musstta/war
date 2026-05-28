import { useCallback, useEffect, useRef, useState } from 'react';
import { api, MeResponse, WorldView } from './api';
import { LoginForm } from './components/LoginForm';
import { PhaseBar } from './components/PhaseBar';
import { GameMap } from './components/GameMap';
import { InfoPanel } from './components/InfoPanel';
import { DevToolbar } from './components/DevToolbar';

type AuthState = 'loading' | 'logged-out' | 'logged-in';

const REFRESH_INTERVAL_MS = 5_000;

export default function App() {
  const [auth, setAuth] = useState<AuthState>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [world, setWorld] = useState<WorldView | null>(null);
  const [selectedTerritoryId, setSelectedTerritoryId] = useState<string | null>(null);
  // Territory display names loaded from geojson
  const [defNames, setDefNames] = useState<Record<string, string>>({});

  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadWorld = useCallback(async () => {
    try {
      const [meData, worldData] = await Promise.all([api.me(), api.world()]);
      setMe(meData);
      setWorld(worldData);
      setAuth('logged-in');
    } catch {
      setAuth('logged-out');
    }
  }, []);

  // On mount: check if already logged in
  useEffect(() => {
    loadWorld().catch(() => setAuth('logged-out'));
  }, [loadWorld]);

  // Load territory names from geojson once
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

  // Periodic world refresh
  useEffect(() => {
    if (auth !== 'logged-in') {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
      return;
    }
    refreshTimerRef.current = setInterval(() => loadWorld(), REFRESH_INTERVAL_MS);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [auth, loadWorld]);

  const handleLogin = () => loadWorld();

  const handleLogout = async () => {
    await api.logout().catch(() => {});
    setAuth('logged-out');
    setMe(null);
    setWorld(null);
  };

  const handleActionQueued = () => loadWorld();

  if (auth === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#1a1a2e', color: '#888', fontFamily: 'monospace' }}>
        Loading…
      </div>
    );
  }

  if (auth === 'logged-out') {
    return <LoginForm onLogin={handleLogin} />;
  }

  if (!world || !me) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <PhaseBar world={world} myName={me.name} onLogout={handleLogout} />
      <DevToolbar world={world} onRefresh={loadWorld} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <GameMap
          world={world}
          selectedId={selectedTerritoryId}
          onSelect={setSelectedTerritoryId}
        />
        <InfoPanel
          territoryId={selectedTerritoryId}
          world={world}
          defNames={defNames}
          onActionQueued={handleActionQueued}
        />
      </div>
      {world.recentEvents.length > 0 && (
        <div style={{
          background: '#0d0d1a', borderTop: '1px solid #2a2a4a', padding: '0.25rem 1rem',
          fontFamily: 'monospace', fontSize: '0.73rem', color: '#888', flexShrink: 0,
          maxHeight: '5rem', overflowY: 'auto',
        }}>
          <span style={{ color: '#444', marginRight: '0.4rem', letterSpacing: '0.05em' }}>LOG</span>
          {world.recentEvents.map((e, i) => (
            <div key={i} style={{ color: i === 0 ? '#aaa' : '#666', padding: '0.05rem 0' }}>{e}</div>
          ))}
        </div>
      )}
    </div>
  );
}
