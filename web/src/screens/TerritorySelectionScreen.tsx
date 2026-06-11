import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api, type CandidateView, type CandidatesResponse, type GameDetail } from '../api';
import { useAuth } from '../AuthContext';
import { C, T } from '../styles';

// Colors for candidate slots 0, 1, 2
const CANDIDATE_COLORS = ['#f59e0b', '#22d3ee', '#a78bfa'] as const;
const TIER_LABEL: Record<number, string> = { 1: 'Low', 2: 'Mid', 3: 'High' };
const TIER_COLOR: Record<number, string> = { 1: C.muted, 2: '#fbbf24', 3: C.success };

const POLL_MS = 3000;

interface GeoFeature { type: 'Feature'; id: string; properties: Record<string, unknown>; geometry: unknown; }
interface GeoCollection { type: 'FeatureCollection'; features: GeoFeature[]; }

export function TerritorySelectionScreen() {
  const { id: gameId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [game, setGame] = useState<GameDetail | null>(null);
  const [candidateState, setCandidateState] = useState<CandidatesResponse | null>(null);
  const [snipeMsg, setSnipeMsg] = useState('');
  const [actionError, setActionError] = useState('');
  const [rolling, setRolling] = useState(false);
  const [rerolling, setRerolling] = useState(false);
  const [confirming, setConfirming] = useState<number | null>(null);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const geojsonRef = useRef<GeoCollection | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Data loading ───────────────────────────────────────────────────────────

  const loadState = useCallback(async () => {
    if (!gameId) return;
    try {
      const g = await api.getGame(gameId);
      setGame(g);
      if (g.status === 'active' || g.status === 'ended') {
        navigate(`/games/${gameId}/play`, { replace: true });
        return;
      }
      if (g.status !== 'territory_selection') return;
      const c = await api.getCandidates(gameId);
      setCandidateState(c);
    } catch {
      // Silently ignore poll errors
    }
  }, [gameId, navigate]);

  useEffect(() => {
    loadState();
    pollRef.current = setInterval(loadState, POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadState]);

  // ── Map initialization ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          carto: {
            type: 'raster',
            tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© CARTO © OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'carto-tiles', type: 'raster', source: 'carto' }],
      },
      bounds: [[-120, -55], [-30, 75]],
      fitBoundsOptions: { padding: 20 },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', () => {

      fetch('/territories.geojson')
        .then((r) => r.json())
        .then((data: GeoCollection) => {
          geojsonRef.current = data;
          map.addSource('territories', { type: 'geojson', data: buildGeodata(data, []) as unknown as GeoJSON.FeatureCollection });
          map.addLayer({
            id: 'territory-fill',
            type: 'fill',
            source: 'territories',
            paint: { 'fill-color': ['get', 'fillColor'], 'fill-opacity': ['get', 'fillOpacity'] },
          });
          map.addLayer({
            id: 'territory-outline',
            type: 'line',
            source: 'territories',
            paint: { 'line-color': ['get', 'lineColor'], 'line-width': ['get', 'lineWidth'], 'line-opacity': 0.8 },
          });
        });
    });

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ── Re-paint map when candidates change ───────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    const geojson = geojsonRef.current;
    if (!map || !geojson || !map.isStyleLoaded()) return;
    const source = map.getSource('territories') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const candidates = candidateState?.candidates ?? [];
    source.setData(buildGeodata(geojson, candidates) as unknown as GeoJSON.FeatureCollection);
  }, [candidateState]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleRoll = async () => {
    if (!gameId) return;
    setRolling(true); setActionError('');
    try {
      const res = await api.rollTerritories(gameId);
      setCandidateState((prev) => prev ? { ...prev, candidates: res.candidates } : null);
      await loadState();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Roll failed');
    } finally {
      setRolling(false);
    }
  };

  const handleReroll = async () => {
    if (!gameId) return;
    setRerolling(true); setActionError('');
    try {
      const res = await api.rerollTerritories(gameId);
      setCandidateState((prev) => prev ? { ...prev, candidates: res.candidates, rerollUsed: true } : null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Reroll failed');
    } finally {
      setRerolling(false);
    }
  };

  const handleConfirm = async (slotIndex: number) => {
    if (!gameId) return;
    setConfirming(slotIndex); setActionError(''); setSnipeMsg('');
    try {
      const res = await api.confirmTerritory(gameId, slotIndex);
      if (res.sniped) {
        setSnipeMsg('That territory was just claimed by another player — here are fresh options.');
        setCandidateState((prev) => prev ? { ...prev, candidates: res.candidates } : null);
      } else {
        await loadState();
        if (res.transitioned) {
          navigate(`/games/${gameId}/play`, { replace: true });
        }
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Confirm failed');
    } finally {
      setConfirming(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const cs = candidateState;
  const hasCandidates = cs && cs.candidates.length > 0;
  const isConfirmed = !!cs?.confirmedTerritoryId;

  // Find this user's membership
  const myMembership = game?.members.find((m) => m.username === user?.username);
  const isHost = myMembership?.slotIndex === 0;

  return (
    <div style={{ ...T.page, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{ flexShrink: 0, padding: '0.75rem 1rem', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: C.surface }}>
        <div>
          <span style={{ fontWeight: 700, marginRight: '0.5rem' }}>{game?.name ?? '…'}</span>
          <span style={{ color: C.muted, fontSize: '0.82rem' }}>Choose your starting territory</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.83rem', color: C.muted }}>
          {cs && (
            <span>
              <span style={{ color: cs.allConfirmed ? C.success : C.text, fontWeight: 600 }}>{cs.confirmedCount}</span>
              /{cs.totalHuman} confirmed
            </span>
          )}
          <span>{user?.username}</span>
        </div>
      </div>

      {/* Main split: left = controls, right = map */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left panel */}
        <div style={{ width: 300, flexShrink: 0, overflow: 'auto', padding: '1rem', borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

          {actionError && <div style={T.errorBox}>{actionError}</div>}
          {snipeMsg && <div style={{ ...T.infoBox }}>{snipeMsg}</div>}

          {isConfirmed ? (
            <div style={{ ...T.card, textAlign: 'center', padding: '1.5rem 1rem' }}>
              <div style={{ color: C.success, fontSize: '1.1rem', marginBottom: '0.4rem' }}>✓ Territory confirmed</div>
              <div style={{ color: C.muted, fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                {cs?.confirmedTerritoryId}
              </div>
              <div style={{ color: C.muted, fontSize: '0.82rem' }}>
                Waiting for other players ({cs?.confirmedCount}/{cs?.totalHuman})…
              </div>
            </div>
          ) : !hasCandidates ? (
            <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
              <p style={{ color: C.muted, marginBottom: '1rem', fontSize: '0.88rem' }}>
                Roll to see 3 candidate territories — you'll pick one as your nation's capital.
              </p>
              <button onClick={handleRoll} disabled={rolling} style={{ ...T.btn, width: '100%', opacity: rolling ? 0.7 : 1 }}>
                {rolling ? 'Rolling…' : '🎲 Roll territories'}
              </button>
            </div>
          ) : (
            <>
              <div style={{ fontSize: '0.82rem', color: C.muted }}>
                Pick one of the 3 candidates below as your starting capital.
                {cs && !cs.rerollUsed && <span style={{ color: C.accent }}> You have one reroll available.</span>}
              </div>

              {cs?.candidates.map((c) => (
                <CandidateCard
                  key={c.slotIndex}
                  candidate={c}
                  color={CANDIDATE_COLORS[c.slotIndex] ?? '#888'}
                  confirming={confirming === c.slotIndex}
                  onConfirm={() => handleConfirm(c.slotIndex)}
                />
              ))}

              {cs && !cs.rerollUsed && (
                <button
                  onClick={handleReroll}
                  disabled={rerolling}
                  style={{ ...T.btnGhost, textAlign: 'center', opacity: rerolling ? 0.7 : 1 }}
                >
                  {rerolling ? 'Rerolling…' : '↺ Re-roll all 3 (once)'}
                </button>
              )}
            </>
          )}

          {/* Host force-resolve */}
          {isHost && !isConfirmed && hasCandidates && (
            <div style={{ marginTop: 'auto', paddingTop: '0.5rem', borderTop: `1px solid ${C.border}` }}>
              <div style={{ color: C.dim, fontSize: '0.78rem', marginBottom: '0.4rem' }}>Host controls</div>
              <button
                onClick={async () => {
                  if (!gameId) return;
                  try { await api.forceResolve(gameId); await loadState(); } catch (err) { setActionError(String(err)); }
                }}
                style={{ ...T.btnGhost, width: '100%', fontSize: '0.8rem', color: '#fbbf24', borderColor: '#92400e' }}
              >
                Force-resolve AFK players
              </button>
            </div>
          )}
        </div>

        {/* Map */}
        <div ref={mapContainerRef} style={{ flex: 1, position: 'relative' }} />
      </div>

      {/* Other players' status bar */}
      {game && game.members.length > 1 && (
        <div style={{ flexShrink: 0, borderTop: `1px solid ${C.border}`, background: C.surface, padding: '0.4rem 1rem', display: 'flex', gap: '1.25rem', fontSize: '0.8rem', color: C.muted }}>
          {game.members.map((m) => (
            <span key={m.slotIndex}>
              <span style={{ color: m.username === user?.username ? C.accent : C.text }}>{m.username}</span>
              {' '}
              <span style={{ color: m.confirmedTerritoryId ? C.success : C.dim }}>
                {m.confirmedTerritoryId ? `✓ ${m.confirmedTerritoryId}` : '…'}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateCard({ candidate, color, confirming, onConfirm }: {
  candidate: CandidateView;
  color: string;
  confirming: boolean;
  onConfirm: () => void;
}) {
  return (
    <div style={{
      background: C.surface,
      border: `2px solid ${color}`,
      borderRadius: 8,
      padding: '0.75rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.4rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: '0.9rem', flex: 1 }}>{candidate.name}</span>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.78rem' }}>
        <span style={{ color: TIER_COLOR[candidate.qualityTier] ?? C.muted, fontWeight: 600 }}>
          {TIER_LABEL[candidate.qualityTier] ?? `T${candidate.qualityTier}`} quality
        </span>
        <span style={{ color: C.dim }}>·</span>
        <span style={{ color: C.muted }}>{candidate.isCoastal ? 'Coastal' : 'Inland'}</span>
      </div>
      <button
        onClick={onConfirm}
        disabled={confirming}
        style={{ ...T.btnSm, background: color, border: 'none', marginTop: '0.25rem', opacity: confirming ? 0.7 : 1 }}
      >
        {confirming ? 'Confirming…' : 'Confirm this territory'}
      </button>
    </div>
  );
}

// ── Map painting ───────────────────────────────────────────────────────────────

function buildGeodata(base: GeoCollection, candidates: CandidateView[]): GeoCollection {
  const candidateMap = new Map(candidates.map((c) => [c.territoryId, c]));

  return {
    ...base,
    features: base.features.map((f) => {
      const c = candidateMap.get(f.id as string);
      let fillColor: string;
      let fillOpacity: number;
      let lineColor: string;
      let lineWidth: number;

      if (c) {
        fillColor = CANDIDATE_COLORS[c.slotIndex] ?? '#888';
        fillOpacity = 0.65;
        lineColor = CANDIDATE_COLORS[c.slotIndex] ?? '#888';
        lineWidth = 3;
      } else {
        fillColor = '#1e2433';
        fillOpacity = 0.55;
        lineColor = '#334155';
        lineWidth = 0.8;
      }

      return {
        ...f,
        properties: { ...f.properties, fillColor, fillOpacity, lineColor, lineWidth },
      };
    }),
  };
}
