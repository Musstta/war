import { useCallback, useEffect, useState } from 'react';
import { api, DiplomacyView, TreatyClauseInput, ClauseType, WorldView, TerritoryView, ObjectiveClauseView, ObjectiveType, ResponsibleParty, TradeRouteAgreementView } from '../api';

interface Props {
  world: WorldView;
  onActionQueued: () => void;
  gameId: string;
  tradeRoutes?: TradeRouteAgreementView[];
}

const CLAUSE_TYPES: ClauseType[] = ['non_aggression', 'tribute', 'trade', 'military_access', 'defense_pact', 'objective'];

const clauseLabel: Record<ClauseType, string> = {
  non_aggression:  'Non-Aggression',
  tribute:         'Tribute',
  trade:           'Trade',
  military_access: 'Military Access',
  defense_pact:    'Defense Pact',
  objective:       'Objective',
  trade_route:     'Trade Route',
};

const clauseNote: Partial<Record<ClauseType, string>> = {
  trade:           'placeholder — lights up when Trade ships',
  military_access: 'placeholder — lights up when armies move',
  defense_pact:    'placeholder — degrades on inactivity; no auto-defense until War exists',
};

function objectiveDescription(obj: ObjectiveClauseView, partyNames: [string, string]): string {
  const [nameA, nameB] = partyNames;
  const responsible = obj.responsibleParty === 'partyA' ? nameA
    : obj.responsibleParty === 'partyB' ? nameB
    : `${nameA} and ${nameB}`;
  const target = obj.targetTerritoryId ?? obj.targetNationId ?? '?';
  switch (obj.objectiveType as ObjectiveType) {
    case 'build_port':
      return `${responsible} must build a port in ${target}`;
    case 'build_road_connection':
      return `${responsible} must connect ${target} by road to the other party`;
    case 'maintain_peace':
      return `${responsible} must not attack the other party`;
    case 'joint_invasion':
      return `[STUB] Both parties attack ${target} together`;
    case 'attack_player':
      return `[STUB] ${responsible} declares war on ${target}`;
    default:
      return obj.objectiveType;
  }
}

const objStatusColor = (s: string) =>
  s === 'met' ? '#5b5' : s === 'failed' ? '#e55' : s === 'waived' ? '#888' : '#fa6';

const S = {
  panel: {
    background: '#0d0d1a',
    borderLeft: '1px solid #2a2a4a',
    width: '360px',
    minWidth: '280px',
    height: '100%',
    overflowY: 'auto' as const,
    fontFamily: 'monospace',
    fontSize: '0.78rem',
    color: '#aaa',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  header: {
    padding: '0.6rem 0.8rem 0.4rem',
    borderBottom: '1px solid #2a2a4a',
    color: '#ddd',
    fontWeight: 700,
    fontSize: '0.82rem',
    letterSpacing: '0.06em',
  },
  section: { padding: '0.5rem 0.8rem', borderBottom: '1px solid #1a1a2e' },
  label: { color: '#666', fontSize: '0.72rem', marginBottom: '0.2rem' },
  value: { color: '#bbb' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' },
  btn: (color = '#3a3a6a') => ({
    background: color, border: 'none', color: '#ccc', padding: '0.18rem 0.5rem',
    cursor: 'pointer', borderRadius: '2px', fontSize: '0.72rem', marginLeft: '0.3rem',
  }),
  error: { color: '#e05555', marginTop: '0.3rem', fontSize: '0.72rem' },
  success: { color: '#55bb55', marginTop: '0.3rem', fontSize: '0.72rem' },
  tag: (status: string) => ({
    color: status === 'active' ? '#5be' : status === 'degraded' ? '#fa6' : '#888',
    fontSize: '0.70rem',
  }),
};

export function DiplomacyPanel({ world, onActionQueued, gameId, tradeRoutes = [] }: Props) {
  const [dipl, setDipl] = useState<DiplomacyView | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [showPropose, setShowPropose] = useState(false);
  const [showInstantTrade, setShowInstantTrade] = useState(false);

  // Treaty propose form state
  const [propTarget, setPropTarget] = useState('');
  const [propTerm, setPropTerm] = useState(10);
  const [propClauses, setPropClauses] = useState<TreatyClauseInput[]>([{ type: 'non_aggression', collateral: 0 }]);
  const [propMyCollateral, setPropMyCollateral] = useState(0);
  const [propTheirCollateral, setPropTheirCollateral] = useState(0);

  // Instant trade form state
  const [itResource, setItResource] = useState<'population' | 'industry' | 'wealth'>('wealth');
  const [itAmount, setItAmount] = useState(10);
  const [itSourceTerr, setItSourceTerr] = useState('');
  const [itTargetNation, setItTargetNation] = useState('');

  const loadDipl = useCallback(async () => {
    try {
      setDipl(await api.gameDiplomacy(gameId));
    } catch { /* silent — panel still renders */ }
  }, [gameId]);

  useEffect(() => { loadDipl(); }, [loadDipl, world.tick]);

  const feedback = (err: string, ok: string) => { setError(err); setMsg(ok); };

  const doAction = async (action: () => Promise<unknown>) => {
    setError(''); setMsg('');
    try {
      await action();
      setMsg('Done.');
      onActionQueued();
      await loadDipl();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addClause = () => setPropClauses([...propClauses, { type: 'non_aggression', collateral: 0 }]);
  const removeClause = (i: number) => setPropClauses(propClauses.filter((_, j) => j !== i));
  const updateClause = (i: number, field: 'type' | 'collateral', val: string | number) => {
    const next = [...propClauses];
    next[i] = { ...next[i], [field]: val };
    setPropClauses(next);
  };

  const otherNations = Object.entries(world.nations)
    .filter(([id]) => id !== world.myNationId)
    .map(([id, n]) => ({ id, name: n.name }));

  if (!dipl) return (
    <div style={S.panel}>
      <div style={S.header}>DIPLOMACY</div>
      <div style={{ ...S.section, color: '#555' }}>Loading…</div>
    </div>
  );

  return (
    <div style={S.panel}>
      <div style={S.header}>DIPLOMACY</div>

      {/* Trust bar */}
      <div style={S.section}>
        <div style={S.row}>
          <span style={S.label}>YOUR TRUST</span>
          <span style={{ color: dipl.myTrust >= 50 ? '#5be' : '#e55', fontWeight: 700 }}>
            {dipl.myTrust.toFixed(1)} / 100
          </span>
        </div>
        {dipl.myTrust < 50 && (
          <div style={{ color: '#fa6', fontSize: '0.70rem' }}>
            ⚠ Below baseline — paying {dipl.treaties.length} Wealth/tick in low-Trust fines
          </div>
        )}
        <div style={{ ...S.label, marginTop: '0.3rem' }}>PARTNER TRUST</div>
        {Object.entries(dipl.nationTrust)
          .filter(([id]) => id !== world.myNationId)
          .map(([id, nt]) => (
            <div key={id} style={S.row}>
              <span>{nt.name}</span>
              <span style={{ color: nt.trust >= 50 ? '#888' : '#e55' }}>{nt.trust.toFixed(1)}</span>
            </div>
          ))}
      </div>

      {/* Active treaties */}
      <div style={S.section}>
        <div style={{ ...S.label, marginBottom: '0.35rem' }}>ACTIVE TREATIES ({dipl.treaties.length})</div>
        {dipl.treaties.length === 0 && <div style={{ color: '#444' }}>No active treaties.</div>}
        {dipl.treaties.map((t) => {
          const partner = t.parties.find((p) => p.nationId !== world.myNationId);
          const ticksLeft = t.tickEnds - world.tick;
          // Build party name tuple for objective descriptions.
          const partyNames: [string, string] = [
            t.parties[0]?.nationName ?? t.parties[0]?.nationId ?? '?',
            t.parties[1]?.nationName ?? t.parties[1]?.nationId ?? '?',
          ];
          return (
            <div key={t.id} style={{ marginBottom: '0.5rem', paddingBottom: '0.4rem', borderBottom: '1px solid #1a1a2e' }}>
              <div style={S.row}>
                <span style={{ color: '#ddd' }}>#{t.id} with {partner?.nationName ?? '?'}</span>
                <span style={S.tag(t.status)}>{t.status}</span>
              </div>
              <div style={{ color: '#777', fontSize: '0.70rem' }}>
                {t.clauses.map((c, i) => {
                  const label = clauseLabel[c.type as ClauseType] ?? c.type;
                  const statusColor = c.clauseStatus === 'active' ? '#777' : c.clauseStatus === 'degraded' ? '#fa6' : '#e55';
                  const routeInfo = c.tradeRoute ? ` [${c.tradeRoute.isSeaRoute ? 'sea' : `land ${c.tradeRoute.path.length - 1}h`}${c.tradeRoute.pathStale ? ' ⚠stale' : ''}]` : '';
                  const missed = c.missedPayments > 0 ? ` ⚠${c.missedPayments}miss` : '';
                  return <span key={i} style={{ color: statusColor, marginRight: '0.4rem' }}>{label}{routeInfo}{missed}</span>;
                })}
                · {ticksLeft} ticks left
              </div>
              {/* Objective clause details */}
              {t.clauses.filter((c) => c.type === 'objective' && c.objectiveClause).map((c, i) => {
                const obj = c.objectiveClause!;
                const deadlineAbsolute = t.tickStarted + obj.deadlineTicks;
                const ticksToDeadline = deadlineAbsolute - world.tick;
                const isOverdue = ticksToDeadline < 0 && obj.status === 'pending';
                return (
                  <div key={`obj-${i}`} style={{ background: '#0a0a18', border: '1px solid #2a2a3a', borderRadius: 2, padding: '0.2rem 0.4rem', marginTop: '0.2rem', fontSize: '0.70rem' }}>
                    <span style={{ color: objStatusColor(obj.status), marginRight: '0.35rem' }}>
                      {obj.status.toUpperCase()}
                    </span>
                    <span style={{ color: '#999' }}>{objectiveDescription(obj, partyNames)}</span>
                    {obj.status === 'pending' && (
                      <span style={{ color: isOverdue ? '#e55' : '#666', marginLeft: '0.35rem' }}>
                        · {isOverdue ? `⚠ overdue ${Math.abs(ticksToDeadline)}t` : `${ticksToDeadline}t to deadline`}
                      </span>
                    )}
                    {obj.status === 'failed' && <span style={{ color: '#e55', marginLeft: '0.35rem' }}>· collateral forfeited, Trust −20</span>}
                  </div>
                );
              })}
              <div style={{ color: '#555', fontSize: '0.70rem' }}>
                Collateral: {t.totalCollateral} · Partner Trust: {t.partnerTrust[0]?.trust.toFixed(1) ?? '?'}
              </div>
              <div style={{ marginTop: '0.25rem' }}>
                <button style={S.btn('#4a2a2a')} onClick={() => doAction(() => api.breakTreaty(gameId, t.id))}>Break</button>
                <button style={S.btn('#2a3a2a')} onClick={() => doAction(() => api.proposeRenewal(gameId, t.id))}>Renew</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Incoming proposals */}
      <div style={S.section}>
        <div style={{ ...S.label, marginBottom: '0.35rem' }}>INCOMING PROPOSALS ({dipl.incomingProposals.length})</div>
        {dipl.incomingProposals.length === 0 && <div style={{ color: '#444' }}>No incoming proposals.</div>}
        {dipl.incomingProposals.map((p) => (
          <div key={p.id} style={{ marginBottom: '0.5rem', paddingBottom: '0.4rem', borderBottom: '1px solid #1a1a2e' }}>
            <div style={{ color: '#ddd' }}>From {p.proposerName} (Trust {p.proposerTrust?.toFixed(1)})</div>
            <div style={{ color: '#777', fontSize: '0.70rem' }}>
              {p.clauses.map((c) => clauseLabel[c.type as ClauseType] ?? c.type).join(' · ')} · {p.termTicks} ticks
            </div>
            {/* Objective clause summary on proposal confirm screen */}
            {p.clauses.filter((c) => c.type === 'objective').map((c, i) => {
              const obj = c.payload as { objectiveType?: string; deadlineTicks?: number; responsibleParty?: string; targetTerritoryId?: string; targetNationId?: string };
              return (
                <div key={`pobj-${i}`} style={{ background: '#0d0d1a', border: '1px solid #2a2a4a', borderRadius: 2, padding: '0.18rem 0.35rem', marginTop: '0.15rem', fontSize: '0.68rem', color: '#aaa' }}>
                  <span style={{ color: '#fa6' }}>Objective: </span>
                  {obj.objectiveType ?? '?'} — {obj.targetTerritoryId ?? obj.targetNationId ?? 'n/a'} · deadline in {obj.deadlineTicks ?? '?'}t · responsible: {obj.responsibleParty ?? '?'}
                  <span style={{ color: '#e55', marginLeft: '0.3rem' }}>· fail = collateral forfeited + Trust −20</span>
                </div>
              );
            })}
            <div style={{ color: '#555', fontSize: '0.70rem' }}>
              Their collateral: {p.proposerCollateral} · Your collateral: {p.targetCollateral} · Expires T{p.expiresAtTick}
            </div>
            <div style={{ marginTop: '0.25rem' }}>
              <button style={S.btn('#2a4a2a')} onClick={() => doAction(() => api.acceptTreaty(gameId, p.id))}>Accept</button>
              <button style={S.btn('#4a2a2a')} onClick={() => doAction(() => api.declineTreaty(gameId, p.id))}>Decline</button>
            </div>
          </div>
        ))}
      </div>

      {/* Outgoing proposals */}
      <div style={S.section}>
        <div style={{ ...S.label, marginBottom: '0.35rem' }}>OUTGOING PROPOSALS ({dipl.outgoingProposals.length})</div>
        {dipl.outgoingProposals.length === 0 && <div style={{ color: '#444' }}>No outgoing proposals.</div>}
        {dipl.outgoingProposals.map((p) => (
          <div key={p.id} style={{ marginBottom: '0.4rem' }}>
            <div style={{ color: '#bbb' }}>→ {p.targetName} · {p.termTicks} ticks · Expires T{p.expiresAtTick}</div>
            <div style={{ color: '#666', fontSize: '0.70rem' }}>{p.clauses.map((c) => clauseLabel[c.type]).join(' · ')}</div>
          </div>
        ))}
      </div>

      {/* Incoming instant trades */}
      <div style={S.section}>
        <div style={{ ...S.label, marginBottom: '0.35rem' }}>INCOMING TRADES ({dipl.incomingInstantTrades?.length ?? 0})</div>
        {(dipl.incomingInstantTrades ?? []).length === 0 && <div style={{ color: '#444' }}>No incoming trades.</div>}
        {(dipl.incomingInstantTrades ?? []).map((t) => (
          <div key={t.id} style={{ marginBottom: '0.4rem' }}>
            <div style={{ color: '#ddd' }}>From {t.proposerName}: {t.amount} {t.resource}</div>
            <div style={{ color: '#555', fontSize: '0.70rem' }}>Source: {t.sourceTerritoryId} · Expires T{t.expiresAtTick}</div>
            <div style={{ marginTop: '0.2rem' }}>
              <button style={S.btn('#2a4a2a')} onClick={() => doAction(() => api.acceptInstantTrade(gameId, t.id))}>Accept</button>
              <button style={S.btn('#4a2a2a')} onClick={() => doAction(() => api.declineInstantTrade(gameId, t.id))}>Decline</button>
            </div>
          </div>
        ))}
      </div>

      {/* Outgoing instant trades */}
      <div style={S.section}>
        <div style={{ ...S.label, marginBottom: '0.35rem' }}>OUTGOING TRADES ({dipl.outgoingInstantTrades?.length ?? 0})</div>
        {(dipl.outgoingInstantTrades ?? []).length === 0 && <div style={{ color: '#444' }}>No outgoing trades.</div>}
        {(dipl.outgoingInstantTrades ?? []).map((t) => (
          <div key={t.id} style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
            → {t.targetName}: {t.amount} {t.resource} from {t.sourceTerritoryId} · Expires T{t.expiresAtTick}
          </div>
        ))}
      </div>

      {/* Instant trade form */}
      <div style={S.section}>
        <div style={S.row}>
          <div style={S.label}>INSTANT TRADE</div>
          <button style={S.btn()} onClick={() => setShowInstantTrade((v) => !v)}>{showInstantTrade ? 'Cancel' : '+ Trade'}</button>
        </div>
        {showInstantTrade && (() => {
          const myTerritories = Object.entries(world.territories)
            .filter(([, t]) => t.ownerId === world.myNationId)
            .map(([id, t]) => ({ id, t: t as TerritoryView }));
          const selectedTerr = myTerritories.find((t) => t.id === itSourceTerr)?.t;
          const localStock = selectedTerr
            ? itResource === 'population' ? selectedTerr.localPopStock
            : itResource === 'industry' ? selectedTerr.localIndStock
            : selectedTerr.localWltStock
            : undefined;
          return (
            <div style={{ marginTop: '0.4rem' }}>
              <div style={S.label}>Resource</div>
              <select value={itResource} onChange={(e) => setItResource(e.target.value as any)}
                style={{ width: '100%', background: '#1a1a2e', color: '#bbb', border: '1px solid #2a2a4a', padding: '0.15rem', marginBottom: '0.3rem' }}>
                <option value='population'>Population</option>
                <option value='industry'>Industry</option>
                <option value='wealth'>Wealth</option>
              </select>
              <div style={S.label}>Amount</div>
              <input type='number' min={1} value={itAmount} onChange={(e) => setItAmount(parseFloat(e.target.value) || 1)}
                style={{ width: '100%', background: '#1a1a2e', color: '#bbb', border: '1px solid #2a2a4a', padding: '0.15rem', marginBottom: '0.3rem' }} />
              <div style={S.label}>Source territory</div>
              <select value={itSourceTerr} onChange={(e) => setItSourceTerr(e.target.value)}
                style={{ width: '100%', background: '#1a1a2e', color: '#bbb', border: '1px solid #2a2a4a', padding: '0.15rem', marginBottom: '0.3rem' }}>
                <option value=''>— select —</option>
                {myTerritories.map(({ id }) => <option key={id} value={id}>{id}</option>)}
              </select>
              {localStock !== undefined && (
                <div style={{ color: '#555', fontSize: '0.70rem', marginBottom: '0.25rem' }}>
                  Available local {itResource}: {localStock?.toFixed(1) ?? '?'}
                </div>
              )}
              <div style={S.label}>Target nation</div>
              <select value={itTargetNation} onChange={(e) => setItTargetNation(e.target.value)}
                style={{ width: '100%', background: '#1a1a2e', color: '#bbb', border: '1px solid #2a2a4a', padding: '0.15rem', marginBottom: '0.3rem' }}>
                <option value=''>— select —</option>
                {otherNations.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
              <div style={{ color: '#666', fontSize: '0.70rem', marginBottom: '0.3rem' }}>
                Cost: 1 Mandate · No term, no collateral · Expires next tick if not accepted
              </div>
              <button
                style={{ ...S.btn('#2a4a3a'), width: '100%' }}
                disabled={!itSourceTerr || !itTargetNation || itAmount <= 0}
                onClick={() => doAction(async () => {
                  await api.instantTrade(gameId, itResource, itAmount, itSourceTerr, itTargetNation);
                  setShowInstantTrade(false);
                })}
              >
                Send Trade Offer
              </button>
            </div>
          );
        })()}
      </div>

      {/* Trade route agreements */}
      {tradeRoutes.length > 0 && (
        <div style={S.section}>
          <div style={{ ...S.label, marginBottom: '0.35rem' }}>TRADE ROUTES ({tradeRoutes.length})</div>
          {tradeRoutes.map((r) => {
            const growthPct = r.growthCap > 0 ? ((r.currentCapacity / r.growthCap) * 100).toFixed(0) : '?';
            const typeLabel = r.type === 'domestic' ? 'dom' : r.type === 'international_port' ? 'port' : 'mkt';
            const statusColor = r.status === 'active' ? '#5be' : r.status === 'suspended' ? '#fa6' : '#555';
            return (
              <div key={r.id} style={{ marginBottom: '0.4rem', paddingBottom: '0.3rem', borderBottom: '1px solid #111' }}>
                <div style={S.row}>
                  <span style={{ color: '#ddd' }}>
                    {r.sourceTerritoryName ?? r.sourceTerritoryId} → {r.destinationTerritoryName ?? r.destinationTerritoryId}
                  </span>
                  <span style={{ ...S.tag(r.status), color: statusColor }}>[{typeLabel}] {r.status}</span>
                </div>
                <div style={{ color: '#666', fontSize: '0.70rem' }}>
                  Cap: {r.currentCapacity.toFixed(1)} / {r.growthCap.toFixed(1)} ({growthPct}%) · {r.cyclesCompleted} cycles · upkeep {r.upkeepPerTick.toFixed(2)}/tick
                  {r.shipments.length > 0 && <span style={{ color: '#555' }}> · {r.shipments.length} in transit</span>}
                  {r.profitMultiplier > 1 && <span style={{ color: '#5be' }}> · ×{r.profitMultiplier.toFixed(2)} profit</span>}
                </div>
                {r.treatyClauseId && (
                  <div style={{ color: '#444', fontSize: '0.68rem' }}>
                    Partner: {r.partnerNationName ?? r.partnerNationId} · treaty clause #{r.treatyClauseId}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Propose new treaty */}
      <div style={S.section}>
        <div style={S.row}>
          <div style={S.label}>PROPOSE TREATY</div>
          <button style={S.btn()} onClick={() => setShowPropose((v) => !v)}>{showPropose ? 'Cancel' : '+ New'}</button>
        </div>
        {showPropose && (
          <div style={{ marginTop: '0.4rem' }}>
            <div style={S.label}>Target nation</div>
            <select
              value={propTarget}
              onChange={(e) => setPropTarget(e.target.value)}
              style={{ width: '100%', background: '#1a1a2e', color: '#bbb', border: '1px solid #2a2a4a', padding: '0.15rem', marginBottom: '0.35rem' }}
            >
              <option value=''>— select —</option>
              {otherNations.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>

            <div style={S.label}>Term (ticks, min 3)</div>
            <input type='number' min={3} value={propTerm}
              onChange={(e) => setPropTerm(parseInt(e.target.value, 10))}
              style={{ width: '100%', background: '#1a1a2e', color: '#bbb', border: '1px solid #2a2a4a', padding: '0.15rem', marginBottom: '0.35rem' }} />

            <div style={S.label}>Clauses</div>
            {propClauses.map((c, i) => (
              <div key={i} style={{ marginBottom: '0.35rem', paddingBottom: '0.3rem', borderBottom: '1px solid #111' }}>
                <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', marginBottom: '0.2rem' }}>
                  <select
                    value={c.type}
                    onChange={(e) => updateClause(i, 'type', e.target.value as ClauseType)}
                    style={{ flex: 2, background: '#1a1a2e', color: '#bbb', border: '1px solid #2a2a4a', padding: '0.15rem' }}
                  >
                    {CLAUSE_TYPES.map((t) => <option key={t} value={t}>{clauseLabel[t]}</option>)}
                  </select>
                  <input type='number' min={0} value={c.collateral ?? 0} placeholder='collateral'
                    onChange={(e) => updateClause(i, 'collateral', parseFloat(e.target.value) || 0)}
                    style={{ flex: 1, background: '#1a1a2e', color: '#bbb', border: '1px solid #2a2a4a', padding: '0.15rem' }} />
                  <button style={S.btn('#3a1a1a')} onClick={() => removeClause(i)}>×</button>
                </div>
                {c.type === 'trade' && (
                  <div style={{ display: 'flex', gap: '0.3rem', fontSize: '0.70rem', flexWrap: 'wrap' }}>
                    <select
                      value={(c.payload?.resource as string) ?? 'wealth'}
                      onChange={(e) => setPropClauses(prev => { const n=[...prev]; n[i]={...n[i], payload:{...n[i].payload, resource: e.target.value}}; return n; })}
                      style={{ flex: 1, background: '#1a1a2e', color: '#bbb', border: '1px solid #2a2a4a', padding: '0.12rem' }}
                    >
                      <option value='population'>Pop</option>
                      <option value='industry'>Ind</option>
                      <option value='wealth'>Wealth</option>
                    </select>
                    <input type='number' min={1} value={(c.payload?.amount as number) ?? 5} placeholder='flow/tick'
                      onChange={(e) => setPropClauses(prev => { const n=[...prev]; n[i]={...n[i], payload:{...n[i].payload, amount: parseFloat(e.target.value)||1}}; return n; })}
                      style={{ flex: 1, background: '#1a1a2e', color: '#bbb', border: '1px solid #2a2a4a', padding: '0.12rem' }} />
                    <input type='text' value={(c.payload?.sourceTerritoryId as string) ?? ''} placeholder='source territory ID'
                      onChange={(e) => setPropClauses(prev => { const n=[...prev]; n[i]={...n[i], payload:{...n[i].payload, sourceTerritoryId: e.target.value, fromNationId: propTarget ? world.myNationId : '', toNationId: propTarget}}; return n; })}
                      style={{ flex: 2, background: '#1a1a2e', color: '#bbb', border: '1px solid #2a2a4a', padding: '0.12rem' }} />
                  </div>
                )}
                {c.type === 'objective' && (
                  <div style={{ display: 'flex', gap: '0.3rem', fontSize: '0.70rem', flexWrap: 'wrap' }}>
                    <select
                      value={(c.payload?.objectiveType as string) ?? 'maintain_peace'}
                      onChange={(e) => setPropClauses(prev => { const n=[...prev]; n[i]={...n[i], payload:{...n[i].payload, objectiveType: e.target.value}}; return n; })}
                      style={{ flex: 2, background: '#1a1a2e', color: '#bbb', border: '1px solid #2a2a4a', padding: '0.12rem' }}
                    >
                      <option value='maintain_peace'>Maintain Peace</option>
                      <option value='build_port'>Build Port</option>
                      <option value='build_road_connection'>Build Road Connection</option>
                      <option value='joint_invasion'>[STUB] Joint Invasion</option>
                      <option value='attack_player'>[STUB] Attack Player</option>
                    </select>
                    <select
                      value={(c.payload?.responsibleParty as string) ?? 'partyA'}
                      onChange={(e) => setPropClauses(prev => { const n=[...prev]; n[i]={...n[i], payload:{...n[i].payload, responsibleParty: e.target.value}}; return n; })}
                      style={{ flex: 1, background: '#1a1a2e', color: '#bbb', border: '1px solid #2a2a4a', padding: '0.12rem' }}
                    >
                      <option value='partyA'>Me (A)</option>
                      <option value='partyB'>Them (B)</option>
                      <option value='both'>Both</option>
                    </select>
                    <input type='number' min={1} value={(c.payload?.deadlineTicks as number) ?? propTerm}
                      placeholder='deadline ticks'
                      onChange={(e) => setPropClauses(prev => { const n=[...prev]; n[i]={...n[i], payload:{...n[i].payload, deadlineTicks: parseInt(e.target.value)||propTerm}}; return n; })}
                      style={{ flex: 1, background: '#1a1a2e', color: '#bbb', border: '1px solid #2a2a4a', padding: '0.12rem' }} />
                    <input type='text' value={(c.payload?.targetTerritoryId as string) ?? ''} placeholder='target territory (if any)'
                      onChange={(e) => setPropClauses(prev => { const n=[...prev]; n[i]={...n[i], payload:{...n[i].payload, targetTerritoryId: e.target.value||undefined}}; return n; })}
                      style={{ flex: 2, background: '#1a1a2e', color: '#bbb', border: '1px solid #2a2a4a', padding: '0.12rem' }} />
                    <div style={{ width: '100%', color: '#555', marginTop: '0.1rem' }}>
                      Failure = collateral forfeited + Trust −20
                    </div>
                  </div>
                )}
              </div>
            ))}
            {propClauses.some((c) => clauseNote[c.type]) && (
              <div style={{ color: '#555', fontSize: '0.69rem', marginBottom: '0.2rem' }}>
                {propClauses.filter((c) => clauseNote[c.type]).map((c, i) => <div key={i}>{clauseLabel[c.type]}: {clauseNote[c.type]}</div>)}
              </div>
            )}
            <button style={{ ...S.btn('#2a2a5a'), marginBottom: '0.35rem' }} onClick={addClause}>+ Clause</button>

            <div style={S.label}>Your collateral (Wealth)</div>
            <input type='number' min={0} value={propMyCollateral}
              onChange={(e) => setPropMyCollateral(parseFloat(e.target.value) || 0)}
              style={{ width: '100%', background: '#1a1a2e', color: '#bbb', border: '1px solid #2a2a4a', padding: '0.15rem', marginBottom: '0.25rem' }} />

            <div style={S.label}>Their collateral (Wealth)</div>
            <input type='number' min={0} value={propTheirCollateral}
              onChange={(e) => setPropTheirCollateral(parseFloat(e.target.value) || 0)}
              style={{ width: '100%', background: '#1a1a2e', color: '#bbb', border: '1px solid #2a2a4a', padding: '0.15rem', marginBottom: '0.35rem' }} />

            <div style={{ color: '#666', fontSize: '0.70rem', marginBottom: '0.3rem' }}>
              Cost: 1 Mandate · Collateral locked until treaty ends or breaks
            </div>
            <button
              style={{ ...S.btn('#2a4a3a'), width: '100%' }}
              disabled={!propTarget || propClauses.length === 0 || propTerm < 3}
              onClick={() => doAction(async () => {
                await api.proposeTreaty(gameId, propTarget, propTerm, propClauses, propMyCollateral, propTheirCollateral);
                setShowPropose(false);
              })}
            >
              Send Proposal
            </button>
          </div>
        )}
        {error && <div style={S.error}>{error}</div>}
        {msg && <div style={S.success}>{msg}</div>}
      </div>
    </div>
  );
}
