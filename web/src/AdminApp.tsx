import { useCallback, useEffect, useState } from 'react';
import { api, AdminWorldFull, AdminTerritoryRow, AdminNationRow } from './api';

// [DEFERRED SECURITY] Admin key lives in React state only — never persisted to
// localStorage or cookies. Disable this entire route before public deployment. §11.

const FONT = 'monospace';

const dark: React.CSSProperties = { background: '#0d0d1a', minHeight: '100vh', color: '#ccc', fontFamily: FONT, fontSize: '0.82rem' };
const sectionHead: React.CSSProperties = { fontSize: '0.68rem', color: '#555', letterSpacing: '0.08em', marginBottom: '0.35rem', marginTop: '1.1rem' };
const tblStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' };
const th: React.CSSProperties = { textAlign: 'left', color: '#444', fontWeight: 'normal', padding: '0.15rem 0.4rem', borderBottom: '1px solid #1a1a2e' };
const td: React.CSSProperties = { padding: '0.2rem 0.4rem', borderBottom: '1px solid #111' };
const btn: React.CSSProperties = { padding: '0.25rem 0.6rem', background: '#0f3460', border: '1px solid #1a5276', color: '#ccc', fontFamily: FONT, fontSize: '0.78rem', borderRadius: 3, cursor: 'pointer', marginRight: '0.3rem' };
const dangerBtn: React.CSSProperties = { ...btn, background: '#3a0000', border: '1px solid #7a0000', color: '#ff8080' };

function fmt(n: number, digits = 2): string { return (n >= 0 ? '+' : '') + n.toFixed(digits); }
function fmtU(n: number): string { return n.toFixed(3); }

function CultureAxes({ c }: { c: { individualist: number; progressive: number; militaristic: number; expansionist: number } }) {
  const axes: [string, number][] = [['I', c.individualist], ['P', c.progressive], ['M', c.militaristic], ['E', c.expansionist]];
  return (
    <span>
      {axes.map(([label, v]) => (
        <span key={label} style={{ marginRight: '0.25rem', color: v > 0.15 ? '#7ecfff' : v < -0.15 ? '#f0a500' : '#555' }}>
          {label}:{fmt(v, 1)}
        </span>
      ))}
    </span>
  );
}

function ConstructionCell({ row }: { row: AdminTerritoryRow }) {
  if (!row.constructionType) return <span style={{ color: '#333' }}>—</span>;
  return (
    <span style={{ color: '#f0a500' }}>
      {row.constructionType} ({row.constructionTicksLeft}t)
      {row.pendingConstructionType && <span style={{ color: '#7ecfff' }}> → {row.pendingConstructionType}</span>}
    </span>
  );
}

interface TerritoryRowProps {
  row: AdminTerritoryRow;
  nations: AdminNationRow[];
  adminKey: string;
  onRefresh: () => void;
}

function TerritoryTableRow({ row, nations, adminKey, onRefresh }: TerritoryRowProps) {
  const eq = row.unrestCauses?.equilibrium ?? null;
  const dir = eq !== null ? (row.unrest < eq ? '↑' : row.unrest > eq ? '↓' : '=') : '';
  const unrestColor = row.unrest > 0.6 ? '#ff6b6b' : row.unrest > 0.3 ? '#f0a500' : '#888';
  const isCapital = nations.some((n) => n.id === row.ownerId && n.capital === row.id);

  // Build tooltip showing all named unrest components.
  const unrestTooltip = row.unrestCauses ? [
    `Now: ${fmtU(row.unrest)}  Eq: ${fmtU(row.unrestCauses.equilibrium)}`,
    `  base: +${row.unrestCauses.base.toFixed(3)}`,
    `  cultural clash: +${row.unrestCauses.compatibilityPressure.toFixed(3)}`,
    `  distance: +${row.unrestCauses.distancePressure.toFixed(3)}`,
    `  infrastructure: ${row.unrestCauses.infrastructureBonus.toFixed(3)}`,
    `  empire size: +${row.unrestCauses.overexpansionPressure.toFixed(3)}`,
    `  conquest shock: +${row.unrestCauses.ownershipShock.toFixed(3)}`,
    `  rapid expansion: +${row.unrestCauses.recentConquestPressure.toFixed(3)}`,
    `  military: ${row.unrestCauses.militaryBonus.toFixed(3)}`,
  ].join('\n') : undefined;

  const promptUnrest = async () => {
    const raw = window.prompt(`Set unrest for ${row.name} (0.00–1.00):`, fmtU(row.unrest));
    if (raw === null) return;
    const v = parseFloat(raw);
    if (isNaN(v) || v < 0 || v > 1) { alert('Must be 0.0–1.0'); return; }
    try { await api.admin.setUnrest(adminKey, row.id, v); onRefresh(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  const VALID_FAMILIES = ['latin', 'european', 'arab', 'slavic', 'east_asian', 'african', 'south_asian', 'indigenous'];

  const promptTrait = async (trait: 'individualist' | 'progressive' | 'militaristic' | 'expansionist') => {
    const cur = row.culture[trait];
    const raw = window.prompt(`Set ${trait} for ${row.name} (−1.00–+1.00):`, fmt(cur));
    if (raw === null) return;
    const v = parseFloat(raw);
    if (isNaN(v) || v < -1 || v > 1) { alert('Must be −1.0–+1.0'); return; }
    try { await api.admin.setTrait(adminKey, row.id, trait, v); onRefresh(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  const promptFamily = async () => {
    const raw = window.prompt(
      `Set cultural family for ${row.name}:\n${VALID_FAMILIES.join(', ')}\n(leave blank to clear override)`,
      row.culture.family,
    );
    if (raw === null) return;
    const val = raw.trim() === '' ? null : raw.trim();
    if (val && !VALID_FAMILIES.includes(val)) { alert(`Invalid family. Must be one of: ${VALID_FAMILIES.join(', ')}`); return; }
    try { await api.admin.setFamily(adminKey, row.id, val); onRefresh(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  const promptOwner = async (nations: AdminNationRow[]) => {
    const ids = nations.map((n) => `${n.id} (${n.name})`).join('\n');
    const raw = window.prompt(`Set owner for ${row.name}:\n${ids}\n\nEnter nation ID, or leave blank to unclaim:`, row.ownerId ?? '');
    if (raw === null) return;
    const val = raw.trim() === '' ? null : raw.trim();
    try { await api.admin.setOwner(adminKey, row.id, val); onRefresh(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  const promptFort = async () => {
    const raw = window.prompt(`Set fort level for ${row.name} (0–3):`, String(row.fortificationLevel));
    if (raw === null) return;
    const v = parseInt(raw, 10);
    if (isNaN(v) || v < 0 || v > 3) { alert('Must be 0–3'); return; }
    try { await api.admin.setFort(adminKey, row.id, v); onRefresh(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  const toggleRevolt = async () => {
    try { await api.admin.toggleRevolt(adminKey, row.id); onRefresh(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  const toggleRoad = async () => {
    try { await api.admin.toggleRoad(adminKey, row.id); onRefresh(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  const togglePort = async () => {
    if (!row.isCoastal && !row.hasPort) { alert('Territory is not coastal'); return; }
    try { await api.admin.togglePort(adminKey, row.id); onRefresh(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  const clearConstruction = async () => {
    if (!row.constructionType && !row.pendingConstructionType) return;
    try { await api.admin.clearConstruction(adminKey, row.id); onRefresh(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  return (
    <tr style={{ background: row.isInRevolt ? '#1a0000' : 'transparent' }}>
      <td style={td}>
        {isCapital && <span style={{ color: '#f0a500', marginRight: '0.3rem' }}>★</span>}
        {row.name}
      </td>
      <td style={{ ...td, cursor: 'pointer' }} onClick={() => promptOwner(nations)} title="Click to reassign">
        <span style={{ color: '#888' }}>{row.ownerName ?? <span style={{ color: '#333' }}>unclaimed</span>}</span>
      </td>
      <td style={{ ...td, cursor: 'pointer' }} onClick={promptUnrest} title={unrestTooltip}>
        <span style={{ color: unrestColor }}>{fmtU(row.unrest)}</span>
        {eq !== null && <span style={{ color: '#444' }}> {dir} {fmtU(eq)}</span>}
      </td>
      <td style={{ ...td, cursor: 'pointer' }} onClick={toggleRevolt} title="Click to toggle">
        {row.isInRevolt ? <span style={{ color: '#ff4444' }}>REVOLT</span> : <span style={{ color: '#333' }}>—</span>}
      </td>
      <td style={td}>
        <span style={{ cursor: 'pointer', color: row.hasRoad ? '#4caf50' : '#444' }} onClick={toggleRoad} title="Click to toggle road">R</span>
        {row.isCoastal && <span style={{ cursor: 'pointer', color: row.hasPort ? '#7ecfff' : '#444', marginLeft: '0.3rem' }} onClick={togglePort} title="Click to toggle port">P</span>}
        <span style={{ cursor: 'pointer', color: row.fortificationLevel > 0 ? '#f0a500' : '#444', marginLeft: '0.3rem' }} onClick={promptFort} title="Click to set fort level">F{row.fortificationLevel}</span>
      </td>
      <td style={{ ...td, cursor: row.constructionType ? 'pointer' : 'default' }} onClick={clearConstruction} title={row.constructionType ? 'Click to clear construction' : undefined}>
        <ConstructionCell row={row} />
      </td>
      <td style={{ ...td, cursor: 'pointer' }} title="Click any axis to nudge">
        {(['individualist', 'progressive', 'militaristic', 'expansionist'] as const).map((t) => (
          <span key={t} onClick={() => promptTrait(t)} style={{ marginRight: '0.25rem', cursor: 'pointer', color: row.culture[t] > 0.15 ? '#7ecfff' : row.culture[t] < -0.15 ? '#f0a500' : '#555' }}>
            {t[0].toUpperCase()}:{fmt(row.culture[t], 1)}
          </span>
        ))}
        <span onClick={promptFamily} style={{ cursor: 'pointer', color: '#444', marginLeft: '0.1rem' }} title="Click to change family">
          [{row.culture.family}]
        </span>
      </td>
      <td style={td}>
        {row.compatibility !== null
          ? <span style={{ color: row.compatibility.total < 0.4 ? '#ff6b6b' : row.compatibility.total > 0.7 ? '#4caf50' : '#f0a500' }}>{row.compatibility.total.toFixed(2)}</span>
          : <span style={{ color: '#333' }}>—</span>}
      </td>
    </tr>
  );
}

function NationsTable({ nations }: { nations: AdminNationRow[] }) {
  return (
    <>
      <div style={sectionHead}>NATIONS</div>
      <table style={tblStyle}>
        <thead>
          <tr>
            {['Name', 'Pop / Ind / Wealth', 'Army', 'Mandate', 'Culture', 'Capital'].map((h) => (
              <th key={h} style={th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {nations.map((n) => (
            <tr key={n.id}>
              <td style={td}>{n.name}{n.isAI && <span style={{ color: '#444', marginLeft: '0.3rem' }}>[AI]</span>}</td>
              <td style={td}>
                <span style={{ color: '#aaa' }}>{Math.floor(n.stockpiles.population)}</span>
                <span style={{ color: '#444' }}> / </span>
                <span style={{ color: '#f0a500' }}>{Math.floor(n.stockpiles.industry)}</span>
                <span style={{ color: '#444' }}> / </span>
                <span style={{ color: '#aaa' }}>{Math.floor(n.stockpiles.wealth)}</span>
              </td>
              <td style={td}>{n.armySize}</td>
              <td style={td}>
                <span style={{ color: n.mandateUsed >= n.mandateBudget ? '#ff6b6b' : '#ccc' }}>{n.mandateUsed}</span>
                <span style={{ color: '#444' }}>/</span>
                <span style={{ color: '#888' }}>{n.mandateBudget}</span>
              </td>
              <td style={td}>
                {n.culture ? <CultureAxes c={n.culture} /> : <span style={{ color: '#333' }}>—</span>}
                {n.culture?.primaryFamily && <span style={{ color: '#444', marginLeft: '0.2rem' }}>{n.culture.primaryFamily.slice(0, 4)}</span>}
              </td>
              <td style={{ ...td, color: n.capital ? '#f0a500' : '#333' }}>
                {n.capital ? <span>★ {n.capital}</span> : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

interface TerritoriesTableProps {
  territories: AdminTerritoryRow[];
  nations: AdminNationRow[];
  adminKey: string;
  onRefresh: () => void;
}

function TerritoriesTable({ territories, nations, adminKey, onRefresh }: TerritoriesTableProps) {
  return (
    <>
      <div style={sectionHead}>TERRITORIES <span style={{ color: '#333' }}>(all cells are clickable — owner, unrest, revolt, infra R/P/F, construction, culture axes, family, compat)</span></div>
      <div style={{ overflowX: 'auto' }}>
        <table style={tblStyle}>
          <thead>
            <tr>
              {['Name', 'Owner ✎', 'Unrest → Eq. ✎', 'Revolt ✎', 'R/P/F ✎', 'Construction ✎', 'Culture axes ✎ [family ✎]', 'Compat'].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {territories.map((row) => (
              <TerritoryTableRow key={row.id} row={row} nations={nations} adminKey={adminKey} onRefresh={onRefresh} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function EventLog({ events }: { events: Array<{ tick: number; message: string }> }) {
  return (
    <>
      <div style={sectionHead}>EVENT LOG</div>
      <div style={{ background: '#060610', border: '1px solid #1a1a2e', borderRadius: 3, padding: '0.4rem 0.6rem', maxHeight: '14rem', overflowY: 'auto' }}>
        {events.length === 0
          ? <span style={{ color: '#333' }}>No events yet.</span>
          : events.map((e, i) => (
            <div key={i} style={{ padding: '0.06rem 0', color: i === 0 ? '#aaa' : '#555' }}>
              <span style={{ color: '#333', marginRight: '0.35rem' }}>[T{e.tick}]</span>{e.message}
            </div>
          ))}
      </div>
    </>
  );
}

export default function AdminApp() {
  const [keyInput, setKeyInput] = useState('');
  const [key, setKey] = useState('');
  const [world, setWorld] = useState<AdminWorldFull | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nTicks, setNTicks] = useState(5);
  const [running, setRunning] = useState(false);

  const loadWorld = useCallback(async (k: string) => {
    try {
      const data = await api.admin.world(k);
      setWorld(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, []);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.admin.world(keyInput);
      setWorld(data);
      setKey(keyInput);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid key or server error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!key) return;
    const interval = setInterval(() => loadWorld(key), 5_000);
    return () => clearInterval(interval);
  }, [key, loadWorld]);

  const withRefresh = async (fn: () => Promise<unknown>) => {
    try { await fn(); await loadWorld(key); }
    catch (err) { alert(err instanceof Error ? err.message : 'Action failed'); }
  };

  const runNTicks = async () => {
    setRunning(true);
    try {
      for (let i = 0; i < nTicks; i++) await api.admin.tick(key);
      await loadWorld(key);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Tick failed');
    } finally {
      setRunning(false);
    }
  };

  // ── Login screen ─────────────────────────────────────────────────────────────
  if (!key) {
    return (
      <div style={{ ...dark, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ padding: '2rem', border: '1px solid #2a2a4a', borderRadius: 4, minWidth: 320 }}>
          <div style={{ color: '#f0a500', marginBottom: '1rem', letterSpacing: '0.12em' }}>WAR ADMIN PANEL</div>
          {error && <div style={{ color: '#ff6b6b', marginBottom: '0.5rem', fontSize: '0.78rem' }}>{error}</div>}
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            placeholder="Admin key"
            style={{ width: '100%', padding: '0.4rem', background: '#1a1a2e', border: '1px solid #2a2a4a', color: '#ccc', fontFamily: FONT, borderRadius: 3, boxSizing: 'border-box' }}
          />
          <button
            onClick={handleLogin}
            disabled={loading}
            style={{ ...btn, marginTop: '0.5rem', width: '100%', marginRight: 0 }}
          >
            {loading ? 'Checking…' : 'Authenticate'}
          </button>
        </div>
      </div>
    );
  }

  if (!world) {
    return <div style={dark}><div style={{ padding: '2rem', color: '#555' }}>Loading…</div></div>;
  }

  // ── Main panel ───────────────────────────────────────────────────────────────
  return (
    <div style={dark}>
      {/* Header */}
      <div style={{ background: '#060610', borderBottom: '1px solid #1a1a2e', padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ color: '#f0a500', marginRight: '0.75rem', letterSpacing: '0.08em' }}>WAR ADMIN</span>
        <span style={{ color: '#555', marginRight: '0.75rem' }}>T{world.tick} · {world.phase.toUpperCase()}</span>

        <button style={btn} onClick={() => withRefresh(() => api.admin.setPhase(key, 'main'))}>→ Main</button>
        <button style={btn} onClick={() => withRefresh(() => api.admin.setPhase(key, 'prep'))}>→ Prep</button>
        <button style={btn} onClick={() => withRefresh(() => api.admin.setPhase(key))}>→ Clock</button>

        <button style={btn} onClick={() => withRefresh(() => api.admin.tick(key))}>⚡ Tick</button>

        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <input
            type="number"
            min={1} max={100}
            value={nTicks}
            onChange={(e) => setNTicks(Math.max(1, parseInt(e.target.value) || 1))}
            style={{ width: 48, padding: '0.2rem 0.3rem', background: '#1a1a2e', border: '1px solid #2a2a4a', color: '#ccc', fontFamily: FONT, borderRadius: 3, textAlign: 'center' }}
          />
          <button style={btn} onClick={runNTicks} disabled={running}>
            {running ? `Running…` : `Run ${nTicks} ticks`}
          </button>
        </span>

        <button
          style={dangerBtn}
          onClick={() => { if (window.confirm('Reset world to tick 0? This destroys all data.')) withRefresh(() => api.admin.resetWorld(key)); }}
        >
          ↺ Reset
        </button>

        {error && <span style={{ color: '#ff6b6b', fontSize: '0.75rem', marginLeft: '0.5rem' }}>{error}</span>}
      </div>

      {/* Body */}
      <div style={{ padding: '0 1rem 2rem' }}>
        <NationsTable nations={world.nations} />
        <TerritoriesTable territories={world.territories} nations={world.nations} adminKey={key} onRefresh={() => loadWorld(key)} />
        <EventLog events={world.recentEvents} />
      </div>
    </div>
  );
}
