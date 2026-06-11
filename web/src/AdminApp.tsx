import { useCallback, useEffect, useState } from 'react';
import { api, AdminWorldFull, AdminTerritoryRow, AdminNationRow, TradeRouteAgreementView } from './api';
import { CULTURE_AXES, poleShort, poleName } from './cultureAxes';

// ── Trade Route Agreements Section ───────────────────────────────────────────
function TradeRouteAgreementsSection({ routes }: { routes: TradeRouteAgreementView[] }) {
  return (
    <>
      <div style={sectionHead}>TRADE ROUTE AGREEMENTS ({routes.length})</div>
      {routes.length === 0
        ? <div style={{ color: '#333', fontSize: '0.75rem', marginBottom: '0.5rem' }}>No active route agreements.</div>
        : (
          <table style={tblStyle}>
            <thead>
              <tr>
                {['#', 'Type', 'Owner', 'Partner', 'Source', 'Destination', 'Cap / GrowthCap', 'Cycles', 'Upkeep/t', 'Profit×', 'Shipments', 'Status'].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => {
                const growthPct = r.growthCap > 0 ? ((r.currentCapacity / r.growthCap) * 100).toFixed(0) : '?';
                const statusColor = r.status === 'active' ? '#5be' : r.status === 'suspended' ? '#fa6' : '#555';
                return (
                  <tr key={r.id}>
                    <td style={td}>{r.id}</td>
                    <td style={{ ...td, color: r.type === 'international_port' ? '#7ecfff' : r.type === 'international_market' ? '#a8e6cf' : '#888' }}>
                      {r.type === 'domestic' ? 'dom' : r.type === 'international_port' ? 'port L' + r.portLevel : 'mkt'}
                    </td>
                    <td style={td}>{r.ownerNationName ?? r.ownerNationId}</td>
                    <td style={{ ...td, color: '#666' }}>{r.partnerNationName ?? r.partnerNationId ?? '—'}</td>
                    <td style={td}>{r.sourceTerritoryName ?? r.sourceTerritoryId}</td>
                    <td style={td}>{r.destinationTerritoryName ?? r.destinationTerritoryId}</td>
                    <td style={td}>
                      <span style={{ color: r.currentCapacity > r.baseCapacity ? '#5be' : '#888' }}>{r.currentCapacity.toFixed(1)}</span>
                      <span style={{ color: '#333' }}> / {r.growthCap.toFixed(1)}</span>
                      <span style={{ color: '#444', fontSize: '0.68rem' }}> ({growthPct}%)</span>
                    </td>
                    <td style={{ ...td, color: '#888' }}>{r.cyclesCompleted}</td>
                    <td style={{ ...td, color: '#fa6' }}>{r.upkeepPerTick.toFixed(2)}</td>
                    <td style={{ ...td, color: r.profitMultiplier > 1 ? '#5be' : '#555' }}>×{r.profitMultiplier.toFixed(2)}</td>
                    <td style={{ ...td, color: r.shipments.length > 0 ? '#aaa' : '#333' }}>
                      {r.shipments.length > 0
                        ? r.shipments.map((s) => `${s.cargoAmount.toFixed(1)} (${s.transitTicksRemaining}t)`).join(', ')
                        : '—'}
                    </td>
                    <td style={{ ...td, color: statusColor }}>{r.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
    </>
  );
}

// ── Admin Diplomacy Section ───────────────────────────────────────────────────
interface DiplomacySectionProps {
  nations: AdminNationRow[];
  adminKey: string;
  onRefresh: () => void;
}

function DiplomacySection({ nations, adminKey, onRefresh }: DiplomacySectionProps) {
  const [diplData, setDiplData] = useState<{ treaties: any[]; proposals: any[]; nations: any[]; instantTrades: any[]; tradeRoutes: any[] } | null>(null);
  const [loadErr, setLoadErr] = useState('');

  const loadDipl = useCallback(async () => {
    try {
      const d = await api.admin.diplomacy(adminKey);
      setDiplData(d);
    } catch (e: unknown) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, [adminKey]);

  useEffect(() => { loadDipl(); }, [loadDipl]);

  const doAction = async (fn: () => Promise<unknown>) => {
    try { await fn(); await loadDipl(); onRefresh(); }
    catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); }
  };

  const TIERS = ['active', 'dormant', 'autopilot', 'abandoned'];

  return (
    <>
      <div style={sectionHead}>DIPLOMACY — NATIONS TRUST &amp; TIER</div>
      <table style={tblStyle}>
        <thead>
          <tr>
            {['Nation', 'Trust', 'Tier', 'Last Break Tick', 'Actions'].map((h) => <th key={h} style={th}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {(diplData?.nations ?? nations).map((n: any) => (
            <tr key={n.id}>
              <td style={td}>{n.name}</td>
              <td style={td}>
                <span style={{ color: (n.trust ?? 50) >= 50 ? '#5be' : '#e55' }}>{(n.trust ?? 50).toFixed(1)}</span>
                <button style={{ ...btn, marginLeft: '0.5rem', padding: '0.1rem 0.3rem', fontSize: '0.68rem' }}
                  onClick={() => {
                    const v = parseFloat(prompt('New Trust (0–100):', String((n.trust ?? 50).toFixed(1))) ?? '');
                    if (!isNaN(v)) doAction(() => api.admin.setTrust(adminKey, n.id, v));
                  }}>Set</button>
              </td>
              <td style={td}>
                <select
                  value={n.inactivityTier ?? 'active'}
                  onChange={(e) => doAction(() => api.admin.setTier(adminKey, n.id, e.target.value))}
                  style={{ background: '#1a1a2e', color: '#bbb', border: '1px solid #2a2a4a', fontFamily: FONT, fontSize: '0.72rem', padding: '0.1rem' }}
                >
                  {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </td>
              <td style={td}>{n.lastBrokenPromiseTick !== null ? `T${n.lastBrokenPromiseTick}` : '—'}</td>
              <td style={td}>
                {n.activityTier === 'abandoned' && (
                  <button
                    style={{ ...dangerBtn, padding: '0.1rem 0.35rem', fontSize: '0.68rem' }}
                    onClick={() => { if (window.confirm(`Convert ${n.name} to AI nation? This is permanent.`)) doAction(() => api.admin.convertToAi(adminKey, n.id)); }}
                  >
                    → AI
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={sectionHead}>DIPLOMACY — TREATIES</div>
      {loadErr && <div style={{ color: '#e55', fontSize: '0.72rem' }}>{loadErr}</div>}
      {!diplData ? <div style={{ color: '#444', fontSize: '0.75rem' }}>Loading…</div> : (
        <table style={tblStyle}>
          <thead>
            <tr>
              {['#', 'Status', 'Parties', 'Clauses', 'Term', 'Ends', 'Collateral', 'Actions'].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {diplData.treaties.map((t: any) => (
              <>
                <tr key={t.id}>
                  <td style={td}>{t.id}</td>
                  <td style={{ ...td, color: t.status === 'active' ? '#5be' : t.status === 'degraded' ? '#fa6' : '#888' }}>{t.status}</td>
                  <td style={td}>{t.parties?.map((p: any) => p.nationId).join(' ↔ ')}</td>
                  <td style={td}>{t.clauses?.map((c: any) => c.type).join(', ')}</td>
                  <td style={td}>{t.termTicks}t</td>
                  <td style={td}>T{t.tickEnds}</td>
                  <td style={td}>{t.totalCollateral}</td>
                  <td style={td}>
                    {(t.status === 'active' || t.status === 'degraded') && (
                      <button style={{ ...dangerBtn, padding: '0.1rem 0.3rem', fontSize: '0.68rem' }}
                        onClick={() => { if (window.confirm(`Force-break treaty #${t.id}?`)) doAction(() => api.admin.forceBreakTreaty(adminKey, t.id)); }}>
                        Break
                      </button>
                    )}
                  </td>
                </tr>
                {/* Objective clause sub-rows */}
                {(t.clauses ?? []).filter((c: any) => c.type === 'objective' && c.objectiveClause).map((c: any) => {
                  const obj = c.objectiveClause;
                  const statusColor = obj.status === 'met' ? '#5b5' : obj.status === 'failed' ? '#e55' : obj.status === 'waived' ? '#555' : '#fa6';
                  return (
                    <tr key={`obj-${obj.id}`} style={{ background: '#080812' }}>
                      <td style={{ ...td, color: '#333' }}>└ obj#{obj.id}</td>
                      <td style={{ ...td, color: statusColor }}>{obj.status}</td>
                      <td colSpan={3} style={{ ...td, color: '#777', fontSize: '0.70rem' }}>
                        {obj.objectiveType} · resp: {obj.responsibleParty} · deadline +{obj.deadlineTicks}t
                        {obj.targetTerritoryId && ` · terr: ${obj.targetTerritoryId}`}
                        {obj.targetNationId && ` · nation: ${obj.targetNationId}`}
                      </td>
                      <td style={td}></td>
                      <td style={td}></td>
                      <td style={td}>
                        {obj.status === 'pending' && (
                          <>
                            <button style={{ ...btn, padding: '0.1rem 0.3rem', fontSize: '0.68rem', background: '#003300', border: '1px solid #006600' }}
                              onClick={() => doAction(() => api.admin.forceMeetObjective(adminKey, obj.id))}>
                              Met
                            </button>
                            <button style={{ ...dangerBtn, padding: '0.1rem 0.3rem', fontSize: '0.68rem', marginLeft: '0.2rem' }}
                              onClick={() => doAction(() => api.admin.forceFailObjective(adminKey, obj.id))}>
                              Fail
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </>
            ))}
            {diplData.treaties.length === 0 && <tr><td colSpan={8} style={{ ...td, color: '#333' }}>No treaties.</td></tr>}
          </tbody>
        </table>
      )}

      <div style={sectionHead}>DIPLOMACY — PROPOSALS</div>
      {!diplData ? null : (
        <table style={tblStyle}>
          <thead>
            <tr>
              {['#', 'Status', 'From', 'To', 'Term', 'Expires', 'Clauses'].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {diplData.proposals.map((p: any) => (
              <tr key={p.id}>
                <td style={td}>{p.id}</td>
                <td style={{ ...td, color: p.status === 'pending' ? '#5be' : '#555' }}>{p.status}</td>
                <td style={td}>{p.proposerId}</td>
                <td style={td}>{p.targetId}</td>
                <td style={td}>{p.termTicks}t</td>
                <td style={td}>T{p.expiresAtTick}</td>
                <td style={td}>{p.clauses?.map((c: any) => c.type).join(', ')}</td>
              </tr>
            ))}
            {diplData.proposals.length === 0 && <tr><td colSpan={7} style={{ ...td, color: '#333' }}>No proposals.</td></tr>}
          </tbody>
        </table>
      )}

      <div style={sectionHead}>TRADE — INSTANT TRADES (last 50)</div>
      {!diplData ? null : (
        <table style={tblStyle}>
          <thead>
            <tr>
              {['#', 'Status', 'From', 'To', 'Resource', 'Amount', 'Source Terr', 'Proposed', 'Expires'].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {(diplData.instantTrades ?? []).map((t: any) => (
              <tr key={t.id}>
                <td style={td}>{t.id}</td>
                <td style={{ ...td, color: t.status === 'pending' ? '#5be' : t.status === 'accepted' ? '#4c4' : t.status === 'expired' ? '#555' : '#e55' }}>{t.status}</td>
                <td style={td}>{t.proposerNationId}</td>
                <td style={td}>{t.targetNationId}</td>
                <td style={td}>{t.resource}</td>
                <td style={td}>{t.amount}</td>
                <td style={td}>{t.sourceTerritoryId}</td>
                <td style={td}>T{t.tickProposed}</td>
                <td style={td}>T{t.expiresAtTick}</td>
              </tr>
            ))}
            {(diplData.instantTrades ?? []).length === 0 && <tr><td colSpan={9} style={{ ...td, color: '#333' }}>No instant trades.</td></tr>}
          </tbody>
        </table>
      )}

      <div style={sectionHead}>TRADE — ROUTES</div>
      {!diplData ? null : (
        <table style={tblStyle}>
          <thead>
            <tr>
              {['Treaty', 'Clause', 'Source Terr', 'Dest Nation', 'Type', 'Hops', 'Stale', 'Capacity', 'Friction'].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {(diplData.tradeRoutes ?? []).map((r: any) => (
              <tr key={r.id}>
                <td style={td}>#{r.treatyClause?.treatyId ?? '?'}</td>
                <td style={td}>{r.treatyClause?.clauseIndex ?? '?'} ({r.treatyClause?.type ?? '?'})</td>
                <td style={td}>{r.sourceTerritoryId}</td>
                <td style={td}>{r.destinationNationId}</td>
                <td style={{ ...td, color: r.isSeaRoute ? '#5be' : '#888' }}>{r.isSeaRoute ? 'sea' : 'land'}</td>
                <td style={td}>{Array.isArray(r.path) ? r.path.length - 1 : '?'}</td>
                <td style={{ ...td, color: r.pathStale ? '#fa6' : '#555' }}>{r.pathStale ? 'YES' : 'no'}</td>
                <td style={{ ...td, color: '#555' }}>{r.capacity ?? '[PLACEHOLDER]'}</td>
                <td style={{ ...td, color: '#555' }}>{r.friction ?? '[PLACEHOLDER]'}</td>
              </tr>
            ))}
            {(diplData.tradeRoutes ?? []).length === 0 && <tr><td colSpan={9} style={{ ...td, color: '#333' }}>No trade routes.</td></tr>}
          </tbody>
        </table>
      )}
    </>
  );
}

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
  return (
    <span>
      {CULTURE_AXES.map((axis) => {
        const v = c[axis.key];
        const color = v > 0.1 ? '#7ecfff' : v < -0.1 ? '#f0a500' : '#555';
        const shortLabel = poleShort(axis, v);
        return (
          <span key={axis.key} style={{ marginRight: '0.4rem', color }}
            title={`${axis.label}: ${poleName(axis, v)} (${v >= 0 ? '+' : ''}${v.toFixed(2)})`}>
            {shortLabel}:{fmt(v, 1)}
          </span>
        );
      })}
    </span>
  );
}

const CNAMES: Record<string, string> = { port: 'Port', fort_l1: 'Fort L1', fort_l2: 'Fort L2', fort_l3: 'Fort L3', road: 'Road' };

function ConstructionCell({ row }: { row: AdminTerritoryRow }) {
  if (!row.constructionType) return <span style={{ color: '#333' }}>—</span>;
  return (
    <span style={{ color: '#f0a500' }}>
      {CNAMES[row.constructionType] ?? row.constructionType} ({row.constructionTicksLeft}t left)
      {row.pendingConstructionType && (
        <span style={{ color: '#7ecfff' }}> → {CNAMES[row.pendingConstructionType] ?? row.pendingConstructionType}</span>
      )}
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

  const toggleMarket = async () => {
    if (row.isCoastal && !row.hasMarket) { alert('Territory is coastal — build a port instead'); return; }
    try { await api.admin.toggleMarket(adminKey, row.id); onRefresh(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  const promptPortLevel = async () => {
    if (!row.hasPort) { alert('Territory has no port'); return; }
    const raw = window.prompt(`Set port level for ${row.name} (0–3):`, String(row.portLevel ?? 1));
    if (raw === null) return;
    const v = parseInt(raw, 10);
    if (isNaN(v) || v < 0 || v > 3) { alert('Must be 0–3'); return; }
    try { await api.admin.setPortLevel(adminKey, row.id, v); onRefresh(); }
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
        <span style={{ cursor: 'pointer', color: row.hasRoad ? '#4caf50' : '#444' }} onClick={toggleRoad} title="Toggle road">
          {row.hasRoad ? 'Road✓' : 'Road✗'}
        </span>
        {row.isCoastal && (
          <>
            <span style={{ cursor: 'pointer', color: row.hasPort ? '#7ecfff' : '#444', marginLeft: '0.4rem' }} onClick={togglePort} title="Toggle port">
              {row.hasPort ? 'Port✓' : 'Port✗'}
            </span>
            {row.hasPort && (
              <span style={{ cursor: 'pointer', color: '#5be', marginLeft: '0.2rem', fontSize: '0.68rem' }} onClick={promptPortLevel} title="Click to set port level (0–3)">
                L{row.portLevel ?? 1}
              </span>
            )}
          </>
        )}
        {!row.isCoastal && (
          <span style={{ cursor: 'pointer', color: row.hasMarket ? '#a8e6cf' : '#444', marginLeft: '0.4rem' }} onClick={toggleMarket} title="Toggle market">
            {row.hasMarket ? 'Mkt✓' : 'Mkt✗'}
          </span>
        )}
        <span style={{ cursor: 'pointer', color: row.fortificationLevel > 0 ? '#f0a500' : '#444', marginLeft: '0.4rem' }} onClick={promptFort} title="Click to set fort level (0–3)">
          Fort {row.fortificationLevel}
        </span>
      </td>
      <td style={{ ...td, cursor: row.constructionType ? 'pointer' : 'default' }} onClick={clearConstruction} title={row.constructionType ? 'Click to clear construction' : undefined}>
        <ConstructionCell row={row} />
      </td>
      <td style={{ ...td, cursor: 'pointer' }} title="Click any axis label to nudge; click family to change">
        {CULTURE_AXES.map((axis) => {
          const v = row.culture[axis.key];
          const color = v > 0.1 ? '#7ecfff' : v < -0.1 ? '#f0a500' : '#555';
          return (
            <span key={axis.key} onClick={() => promptTrait(axis.key)} style={{ marginRight: '0.4rem', cursor: 'pointer', color }}
              title={`${axis.label}: ${poleName(axis, v)}. Click to set.`}>
              {poleShort(axis, v)}:{fmt(v, 1)}
            </span>
          );
        })}
        <span onClick={promptFamily} style={{ cursor: 'pointer', color: '#666', marginLeft: '0.1rem' }} title="Click to change cultural family">
          [{row.culture.family}]
        </span>
      </td>
      <td style={td}>
        {row.compatibility !== null
          ? <span style={{ color: row.compatibility.total < 0.4 ? '#ff6b6b' : row.compatibility.total > 0.7 ? '#4caf50' : '#f0a500' }}>{row.compatibility.total.toFixed(2)}</span>
          : <span style={{ color: '#333' }}>—</span>}
      </td>
      <td style={td}>
        {row.fragmentationRisk !== null
          ? <span style={{ color: row.fragmentationRisk >= 0.8 ? '#ff4444' : row.fragmentationRisk >= 0.5 ? '#f0a500' : '#555' }}>{row.fragmentationRisk.toFixed(2)}</span>
          : <span style={{ color: '#222' }}>—</span>}
      </td>
    </tr>
  );
}

function NationsTable({ nations, territories }: { nations: AdminNationRow[]; territories: AdminTerritoryRow[] }) {
  return (
    <>
      <div style={sectionHead}>NATIONS</div>
      <table style={tblStyle}>
        <thead>
          <tr>
            {['Name', 'Pop / Ind / Wealth', 'Army', 'Mandate', 'Culture  [family]', 'Unrest factors', 'Capital'].map((h) => (
              <th key={h} style={th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {nations.map((n) => {
            const ownedTerrs = territories.filter((t) => t.ownerId === n.id);
            const avgUnrest = ownedTerrs.length
              ? ownedTerrs.reduce((s, t) => s + t.unrest, 0) / ownedTerrs.length
              : null;
            const maxUnrest = ownedTerrs.length
              ? Math.max(...ownedTerrs.map((t) => t.unrest))
              : null;
            const revolting = ownedTerrs.filter((t) => t.isInRevolt).length;
            const withCauses = ownedTerrs.filter((t) => t.unrestCauses !== null);
            const sample = ownedTerrs[0]?.unrestCauses;

            // Aggregate named unrest factors across owned territories.
            const avgCompat = withCauses.length
              ? withCauses.reduce((s, t) => s + t.unrestCauses!.compatibilityPressure, 0) / withCauses.length : 0;
            const avgDist = withCauses.length
              ? withCauses.reduce((s, t) => s + t.unrestCauses!.distancePressure, 0) / withCauses.length : 0;
            const avgInfra = withCauses.length
              ? withCauses.reduce((s, t) => s + t.unrestCauses!.infrastructureBonus, 0) / withCauses.length : 0;
            const maxShock = withCauses.length
              ? Math.max(...withCauses.map((t) => t.unrestCauses!.ownershipShock)) : 0;
            const shockedCount = withCauses.filter((t) => t.unrestCauses!.ownershipShock > 0.01).length;
            // Nation-wide (same for all territories):
            const empireSize = sample?.overexpansionPressure ?? 0;
            const rapidExp = sample?.recentConquestPressure ?? 0;
            return (
              <tr key={n.id}>
                <td style={td}>{n.name}{n.isAI && <span style={{ color: '#444', marginLeft: '0.3rem' }}>[AI]</span>}</td>
                <td style={td}>
                  <span style={{ color: '#aaa' }}>{Math.floor(n.stockpiles.population)}</span>
                  <span style={{ color: '#444' }}> / </span>
                  <span style={{ color: '#f0a500' }}>{Math.floor(n.stockpiles.industry)}</span>
                  <span style={{ color: '#444' }}> / </span>
                  <span style={{ color: '#aaa' }}>{Math.floor(n.stockpiles.wealth)}</span>
                </td>
                <td style={td}>
                  {(n.armies ?? []).length > 0
                    ? (n.armies ?? []).map((a) => (
                        <div key={a.id} style={{ fontSize: '0.8em', lineHeight: 1.3 }}>
                          <span style={{ color: a.status === 'besieging' ? '#ff9900' : a.status === 'moving' ? '#66aaff' : '#ccc' }}>
                            {a.size}
                          </span>
                          <span style={{ color: '#555' }}> @ {a.territoryId}</span>
                          {a.status !== 'stationed' && <span style={{ color: '#777' }}> [{a.status}]</span>}
                        </div>
                      ))
                    : <span style={{ color: '#333' }}>—</span>}
                </td>
                <td style={td}>
                  <span style={{ color: n.mandateUsed >= n.mandateBudget ? '#ff6b6b' : '#ccc' }}>{n.mandateUsed}</span>
                  <span style={{ color: '#444' }}>/</span>
                  <span style={{ color: '#888' }}>{n.mandateBudget}</span>
                </td>
                <td style={td}>
                  {n.culture
                    ? <><CultureAxes c={n.culture} /><span style={{ color: '#555' }}>[{n.culture.primaryFamily ?? '?'}]</span></>
                    : <span style={{ color: '#333' }}>—</span>}
                </td>
                <td style={td}>
                  {avgUnrest !== null ? (
                    <div>
                      <span style={{ color: maxUnrest! > 0.6 ? '#ff6b6b' : maxUnrest! > 0.3 ? '#f0a500' : '#888' }}>
                        avg {avgUnrest.toFixed(2)} · max {maxUnrest!.toFixed(2)}
                        {revolting > 0 && <span style={{ color: '#ff4444', marginLeft: '0.4rem' }}>· {revolting} in revolt</span>}
                      </span>
                      <div style={{ fontSize: '0.68rem', marginTop: '0.15rem', lineHeight: '1.5' }}>
                        {avgCompat > 0.01 && <div style={{ color: '#f0a500' }}>Cultural clash: +{avgCompat.toFixed(3)} avg</div>}
                        {avgDist > 0.01 && <div style={{ color: '#888' }}>Distance: +{avgDist.toFixed(3)} avg</div>}
                        {avgInfra < -0.001 && <div style={{ color: '#4caf50' }}>Infrastructure: {avgInfra.toFixed(3)} avg</div>}
                        {shockedCount > 0 && <div style={{ color: '#ff8c42' }}>Conquest shock: {shockedCount} terr, max +{maxShock.toFixed(3)}</div>}
                        {rapidExp > 0.001 && <div style={{ color: '#f0a500' }}>Rapid expansion: +{rapidExp.toFixed(3)}</div>}
                        {empireSize > 0.001 && <div style={{ color: '#888' }}>Empire size: +{empireSize.toFixed(3)}</div>}
                      </div>
                    </div>
                  ) : <span style={{ color: '#333' }}>no territories</span>}
                </td>
                <td style={{ ...td, color: n.capital ? '#f0a500' : '#333' }}>
                  {n.capital ? <span>★ {n.capital}</span> : '—'}
                </td>
              </tr>
            );
          })}
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
      <div style={sectionHead}>TERRITORIES <span style={{ color: '#333' }}>(click any cell to edit)</span></div>
      <div style={{ overflowX: 'auto' }}>
        <table style={tblStyle}>
          <thead>
            <tr>
              {['Name', 'Owner', 'Unrest → Equilibrium', 'Revolt', 'Infrastructure', 'Construction', 'Culture  [family]', 'Compat', 'Frag'].map((h) => (
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
      const data = await api.admin.world(k, 'legacy-world');
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
      const data = await api.admin.world(keyInput, 'legacy-world');
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
      for (let i = 0; i < nTicks; i++) await api.admin.tick(key, 'legacy-world');
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

        <button style={btn} onClick={() => withRefresh(() => api.admin.setPhase(key, 'main', 'legacy-world'))}>→ Main</button>
        <button style={btn} onClick={() => withRefresh(() => api.admin.setPhase(key, 'prep', 'legacy-world'))}>→ Prep</button>
        <button style={btn} onClick={() => withRefresh(() => api.admin.setPhase(key, undefined, 'legacy-world'))}>→ Clock</button>

        <button style={btn} onClick={() => withRefresh(() => api.admin.tick(key, 'legacy-world'))}>⚡ Tick</button>

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
          onClick={() => { if (window.confirm('Reset world to tick 0? This destroys all data.')) withRefresh(() => api.admin.resetWorld(key, 'legacy-world')); }}
        >
          ↺ Reset
        </button>

        {error && <span style={{ color: '#ff6b6b', fontSize: '0.75rem', marginLeft: '0.5rem' }}>{error}</span>}
      </div>

      {/* Body */}
      <div style={{ padding: '0 1rem 2rem' }}>
        <NationsTable nations={world.nations} territories={world.territories} />
        <TerritoriesTable territories={world.territories} nations={world.nations} adminKey={key} onRefresh={() => loadWorld(key)} />
        <DiplomacySection nations={world.nations} adminKey={key} onRefresh={() => loadWorld(key)} />
        <TradeRouteAgreementsSection routes={world.tradeRouteAgreements ?? []} />
        <EventLog events={world.recentEvents} />
      </div>
    </div>
  );
}
