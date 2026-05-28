import { useState, useEffect } from 'react';
import { TerritoryView, NationView, WorldView, TerritoryDevState, CompatibilityBreakdown, UnrestCauses, api } from '../api';

interface Props {
  territoryId: string | null;
  world: WorldView;
  defNames: Record<string, string>;  // id → display name from geojson
  onActionQueued: () => void;
}

const FORT_MANDATE_COSTS: Record<number, number> = { 1: 2, 2: 3, 3: 4 };
const BUILD_IND: Record<string, number> = { port: 5, fort_l1: 3, fort_l2: 6, fort_l3: 10 };

const CONSTRUCTION_NAMES: Record<string, string> = {
  port: 'Port', fort_l1: 'Fort L1', fort_l2: 'Fort L2', fort_l3: 'Fort L3', road: 'Road',
};

function constructionLabel(type: string | null | undefined, ticksLeft: number | null | undefined): string | null {
  if (!type || ticksLeft == null) return null;
  const name = CONSTRUCTION_NAMES[type] ?? type;
  return `Building ${name} — ${ticksLeft} tick${ticksLeft !== 1 ? 's' : ''} left`;
}

function pendingLabel(type: string | null | undefined): string | null {
  if (!type) return null;
  return `Queued next: ${CONSTRUCTION_NAMES[type] ?? type}`;
}

const TRAIT_LABELS: Record<string, string> = {
  individualist: 'Ind', progressive: 'Prog', militaristic: 'Mil', expansionist: 'Exp',
};

const CAUSE_LABELS: Record<keyof UnrestCauses, string> = {
  base: 'Base floor',
  compatibilityPressure: 'Compat clash',
  distancePressure: 'Distance from capital',
  noRoadPressure: 'No road',
  overexpansionPressure: 'Overexpansion',
  roadBonus: 'Road integration',
  militaryBonus: 'Military presence',
  equilibrium: 'Equilibrium',
};

function fmt2(n: number): string { return (n >= 0 ? '+' : '') + n.toFixed(2); }
function fmtCompat(n: number): string { return n.toFixed(2); }

function UnrestPanel({ unrest, causes }: { unrest: number; causes: UnrestCauses }) {
  const direction = unrest < causes.equilibrium ? '↑' : unrest > causes.equilibrium ? '↓' : '=';
  const causeKeys: (keyof UnrestCauses)[] = [
    'base', 'compatibilityPressure', 'distancePressure',
    'noRoadPressure', 'overexpansionPressure', 'roadBonus', 'militaryBonus',
  ];
  return (
    <div style={{ marginTop: '0.5rem', padding: '0.35rem 0.4rem', background: '#0d0d1a', borderRadius: 3 }}>
      <div style={{ fontSize: '0.7rem', color: '#555', marginBottom: '0.2rem', letterSpacing: '0.05em' }}>UNREST</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.25rem' }}>
        <span style={{ color: '#888' }}>Now → Eq.</span>
        <span style={{ color: unrest > 0.6 ? '#ff6b6b' : unrest > 0.3 ? '#f0a500' : '#ccc' }}>
          {unrest.toFixed(3)} {direction} {causes.equilibrium.toFixed(3)}
        </span>
      </div>
      {causeKeys.map((k) => {
        const v = causes[k];
        if (v === 0) return null;
        return (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '0.05rem 0' }}>
            <span style={{ color: '#555' }}>{CAUSE_LABELS[k]}</span>
            <span style={{ color: v < 0 ? '#4caf50' : '#f0a500' }}>{fmt2(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

function CompatPanel({ compat }: { compat: CompatibilityBreakdown }) {
  const gapKeys: [keyof CompatibilityBreakdown, string][] = [
    ['individualistGap', 'Ind gap'],
    ['progressiveGap', 'Prog gap'],
    ['militaristicGap', 'Mil gap'],
    ['expansionistGap', 'Exp gap'],
  ];
  return (
    <div style={{ marginTop: '0.4rem', padding: '0.35rem 0.4rem', background: '#0d0d1a', borderRadius: 3 }}>
      <div style={{ fontSize: '0.7rem', color: '#555', marginBottom: '0.2rem', letterSpacing: '0.05em' }}>COMPATIBILITY</div>
      {gapKeys.map(([k, label]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '0.05rem 0' }}>
          <span style={{ color: '#555' }}>{label}</span>
          <span style={{ color: (compat[k] as number) > 0.4 ? '#ff6b6b' : '#888' }}>{fmtCompat(compat[k] as number)}</span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '0.05rem 0' }}>
        <span style={{ color: '#555' }}>Family match</span>
        <span style={{ color: compat.familyCloseness > 0.5 ? '#4caf50' : '#f0a500' }}>{fmtCompat(compat.familyCloseness)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.1rem 0', borderTop: '1px solid #1a1a2e', marginTop: '0.1rem' }}>
        <span style={{ color: '#777' }}>Total compat</span>
        <span style={{ color: compat.total > 0.6 ? '#4caf50' : compat.total > 0.35 ? '#f0a500' : '#ff6b6b' }}>{fmtCompat(compat.total)}</span>
      </div>
    </div>
  );
}

export function InfoPanel({ territoryId, world, defNames, onActionQueued }: Props) {
  const isDev = world.myNationId === 'nation_costa_rica';
  const [devState, setDevState] = useState<TerritoryDevState | null>(null);

  useEffect(() => {
    if (!isDev || !territoryId) { setDevState(null); return; }
    api.dev.territory(territoryId).then(setDevState).catch(() => setDevState(null));
  }, [isDev, territoryId]);

  const refreshDevState = () => {
    if (!isDev || !territoryId) return;
    api.dev.territory(territoryId).then(setDevState).catch(() => setDevState(null));
  };

  const devPromptTrait = async (
    label: string,
    current: number,
    fn: (v: number) => Promise<unknown>,
  ) => {
    const raw = window.prompt(`Set ${label} (−1.00 to +1.00):`, current.toFixed(3));
    if (raw === null) return;
    const v = parseFloat(raw);
    if (isNaN(v) || v < -1 || v > 1) { alert('Invalid value — must be −1.0 to +1.0'); return; }
    try { await fn(v); onActionQueued(); refreshDevState(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  const devPromptUnrest = async (current: number) => {
    const raw = window.prompt('Set unrest (0.00 to 1.00):', current.toFixed(3));
    if (raw === null) return;
    const v = parseFloat(raw);
    if (isNaN(v) || v < 0 || v > 1) { alert('Invalid value — must be 0.0 to 1.0'); return; }
    try { await api.dev.setUnrest(territoryId!, v); onActionQueued(); refreshDevState(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  if (!territoryId) {
    return (
      <div style={panelStyle}>
        <p style={{ color: '#666', fontSize: '0.85rem', marginTop: '1rem' }}>
          Click a territory to inspect it.
        </p>
      </div>
    );
  }

  const t: TerritoryView | undefined = world.territories[territoryId];
  const owner: NationView | undefined = t?.ownerId ? world.nations[t.ownerId] : undefined;
  const isOwn = t?.ownerId === world.myNationId;
  const phase = world.phase;
  const mandateLeft = world.mandateBudget - world.mandateUsed;
  const myStockpiles = world.nations[world.myNationId]?.stockpiles;

  const constructing = t?.constructionType ?? null;
  const pending = t?.pendingConstructionType ?? null;
  const nextFortLevel = (t?.fortificationLevel ?? 0) + 1;
  const fortMandateCost = FORT_MANDATE_COSTS[nextFortLevel] ?? 4;
  const fortIndCost = BUILD_IND[`fort_l${nextFortLevel}`] ?? 10;

  const myInd = myStockpiles?.industry ?? 0;
  // Slot is free for a NEW queue entry only when no pending is already set.
  // If constructing=null and no pending: same-tick queue. If constructing≠null and no pending: deferred queue.
  const slotAvailable = pending === null;

  const canBuildRoad =
    isOwn && !t?.hasRoad && phase === 'main' && mandateLeft >= 1 && slotAvailable;
  const canBuildPort =
    isOwn && !!t?.isCoastal && !t?.hasPort && phase === 'main' && mandateLeft >= 2 && myInd >= BUILD_IND['port']! && slotAvailable;
  const canBuildFort =
    isOwn && (t?.fortificationLevel ?? 0) < 3 && phase === 'main' && mandateLeft >= fortMandateCost && myInd >= fortIndCost && slotAvailable;

  const buildRoad = async () => {
    try {
      await api.action('build_road', { territoryId });
      onActionQueued();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const buildPort = async () => {
    try {
      await api.action('build_port', { territoryId });
      onActionQueued();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const buildFort = async () => {
    try {
      await api.action('build_fort', { territoryId });
      onActionQueued();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const constructionStatus = constructionLabel(t?.constructionType, t?.constructionTicksLeft);

  return (
    <div style={panelStyle}>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#eee' }}>
        {defNames[territoryId] ?? territoryId}
      </h3>

      {t?.isInRevolt && (
        <div style={{ marginBottom: '0.5rem', padding: '0.25rem 0.4rem', background: '#3a0000', border: '1px solid #7a0000', borderRadius: 3, fontSize: '0.75rem', color: '#ff6b6b' }}>
          IN REVOLT — not producing
        </div>
      )}

      <Row label="Owner" value={owner ? owner.name : '— unclaimed'} />
      <Row label="Coastal" value={t?.isCoastal ? 'Yes' : 'No'} />
      <Row label="Road" value={t?.hasRoad ? 'Yes' : 'No'} />
      <Row label="Port" value={t?.hasPort ? 'Yes' : (t?.isCoastal ? 'No' : '—')} />

      {t?.fortificationLevel !== undefined && (
        <Row label="Fortification" value={String(t.fortificationLevel)} />
      )}

      {constructionStatus && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#f0a500', padding: '0.3rem 0.4rem', background: '#1a1a2e', borderRadius: 3 }}>
          {constructionStatus}
          {pending && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.15rem' }}>
              <span style={{ color: '#7ecfff' }}>↳ {pendingLabel(pending)}</span>
              {isOwn && (
                <button
                  onClick={async () => {
                    try { await api.action('cancel_pending_construction', { territoryId }); onActionQueued(); }
                    catch (err) { alert(err instanceof Error ? err.message : 'Cancel failed'); }
                  }}
                  style={{ marginLeft: '0.4rem', padding: '0.1rem 0.35rem', background: 'transparent', border: '1px solid #5a2222', borderRadius: 3, color: '#cc4444', fontFamily: 'monospace', fontSize: '0.68rem', cursor: 'pointer' }}
                  title="Refunds mandate and industry"
                >
                  ✕ Cancel
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Unrest & causes — shown whenever we have the data */}
      {t?.unrest !== undefined && t?.unrestCauses && (
        <UnrestPanel unrest={t.unrest} causes={t.unrestCauses} />
      )}
      {t?.unrest !== undefined && !t?.unrestCauses && (
        <div style={{ marginTop: '0.4rem' }}>
          <Row label="Unrest" value={t.unrest.toFixed(3)} />
        </div>
      )}

      {/* Compatibility breakdown */}
      {t?.compatibility && <CompatPanel compat={t.compatibility} />}

      {/* Nation culture axes (own nation only for now) */}
      {isOwn && owner?.culture && (
        <div style={{ marginTop: '0.4rem', padding: '0.35rem 0.4rem', background: '#0d0d1a', borderRadius: 3 }}>
          <div style={{ fontSize: '0.7rem', color: '#555', marginBottom: '0.2rem', letterSpacing: '0.05em' }}>
            NATION CULTURE <span style={{ color: '#333' }}>({owner.culture.primaryFamily ?? '—'})</span>
          </div>
          {(['individualist', 'progressive', 'militaristic', 'expansionist'] as const).map((axis) => {
            const v = (owner.culture as NonNullable<typeof owner.culture>)[axis];
            return (
              <div key={axis} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '0.05rem 0' }}>
                <span style={{ color: '#555' }}>{TRAIT_LABELS[axis]}</span>
                <span style={{ color: v > 0.2 ? '#7ecfff' : v < -0.2 ? '#f0a500' : '#888' }}>{v >= 0 ? '+' : ''}{v.toFixed(3)}</span>
              </div>
            );
          })}
        </div>
      )}

      {isOwn && myStockpiles && (
        <div style={{ marginTop: '0.75rem', padding: '0.4rem 0.5rem', background: '#0d0d1a', borderRadius: 3 }}>
          <div style={{ fontSize: '0.7rem', color: '#555', marginBottom: '0.25rem', letterSpacing: '0.05em' }}>STOCKPILES</div>
          <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.8rem' }}>
            <span><span style={{ color: '#555' }}>Pop </span><span style={{ color: '#ccc' }}>{Math.floor(myStockpiles.population)}</span></span>
            <span><span style={{ color: '#555' }}>Ind </span><span style={{ color: '#f0a500' }}>{Math.floor(myStockpiles.industry)}</span></span>
            <span><span style={{ color: '#555' }}>Wlth </span><span style={{ color: '#ccc' }}>{Math.floor(myStockpiles.wealth)}</span></span>
          </div>
        </div>
      )}

      {/* Dev: territory raw culture state (player1 only) */}
      {isDev && devState && (
        <div style={{ marginTop: '0.75rem', padding: '0.4rem 0.5rem', background: '#0d0d1a', borderRadius: 3 }}>
          <div style={{ fontSize: '0.7rem', color: '#f0a500', marginBottom: '0.25rem', letterSpacing: '0.05em' }}>DEV — TERRITORY RAW</div>
          <div
            onClick={() => devPromptUnrest(devState.unrest)}
            style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', cursor: 'pointer', padding: '0.1rem 0' }}
            title="Click to set unrest (0–1)"
          >
            <span style={{ color: '#666' }}>Unrest</span>
            <span style={{ color: '#7ecfff' }}>{devState.unrest.toFixed(3)}</span>
          </div>
          {(['individualist', 'progressive', 'militaristic', 'expansionist'] as const).map((tr) => (
            <div
              key={tr}
              onClick={() => devPromptTrait(TRAIT_LABELS[tr]!, devState[tr], (v) => api.dev.setTrait(territoryId, tr, v))}
              style={{ display: 'flex', justifyContent: 'space-between', padding: '0.1rem 0', fontSize: '0.78rem', cursor: 'pointer' }}
              title={`Click to set ${TRAIT_LABELS[tr]} (−1 to +1)`}
            >
              <span style={{ color: '#666' }}>{TRAIT_LABELS[tr]}</span>
              <span style={{ color: '#7ecfff' }}>{devState[tr] >= 0 ? '+' : ''}{devState[tr].toFixed(3)}</span>
            </div>
          ))}
        </div>
      )}

      {isOwn && (
        <div style={{ marginTop: '0.75rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.4rem' }}>YOUR TERRITORY</div>

          <button
            onClick={buildRoad}
            disabled={!canBuildRoad}
            title={
              t?.hasRoad ? 'Already has a road'
              : pending !== null ? 'Next construction already queued'
              : phase !== 'main' ? 'Only during Main Phase'
              : mandateLeft < 1 ? 'No mandates left'
              : constructing !== null ? 'Queue next: Road starts when current build finishes (1 mandate)'
              : 'Queue: Build Road (1 mandate, instant)'
            }
            style={{ ...actionBtn, opacity: canBuildRoad ? 1 : 0.4, cursor: canBuildRoad ? 'pointer' : 'not-allowed', marginBottom: '0.3rem' }}
          >
            {t?.hasRoad ? 'Road built' : constructing !== null ? 'Queue next: Road (1M)' : 'Build Road (1 mandate)'}
          </button>

          {t?.isCoastal && (
            <button
              onClick={buildPort}
              disabled={!canBuildPort}
              title={
                t?.hasPort ? 'Already has a port'
                : pending !== null ? 'Next construction already queued'
                : phase !== 'main' ? 'Only during Main Phase'
                : myInd < BUILD_IND['port']! ? `Need ${BUILD_IND['port']} industry (have ${Math.floor(myInd)})`
                : mandateLeft < 2 ? 'Not enough mandates'
                : constructing !== null ? `Queue next: Port starts when current build finishes (2M / ${BUILD_IND['port']}ind)`
                : `Queue: Build Port (2 mandates, ${BUILD_IND['port']} ind, 3 ticks)`
              }
              style={{ ...actionBtn, opacity: canBuildPort ? 1 : 0.4, cursor: canBuildPort ? 'pointer' : 'not-allowed', marginBottom: '0.3rem' }}
            >
              {t?.hasPort ? 'Port built' : constructing !== null ? `Queue next: Port (2M/${BUILD_IND['port']}ind)` : `Build Port (2M / ${BUILD_IND['port']}ind)`}
            </button>
          )}

          {(t?.fortificationLevel ?? 0) < 3 && (
            <button
              onClick={buildFort}
              disabled={!canBuildFort}
              title={
                pending !== null ? 'Next construction already queued'
                : phase !== 'main' ? 'Only during Main Phase'
                : myInd < fortIndCost ? `Need ${fortIndCost} industry (have ${Math.floor(myInd)})`
                : mandateLeft < fortMandateCost ? 'Not enough mandates'
                : constructing !== null ? `Queue next: Fort L${nextFortLevel} starts when current build finishes`
                : `Queue: Build Fort L${nextFortLevel} (${fortMandateCost} mandates, ${fortIndCost} ind)`
              }
              style={{ ...actionBtn, opacity: canBuildFort ? 1 : 0.4, cursor: canBuildFort ? 'pointer' : 'not-allowed' }}
            >
              {constructing !== null ? `Queue next: Fort L${nextFortLevel} (${fortMandateCost}M/${fortIndCost}ind)` : `Fort L${nextFortLevel} (${fortMandateCost}M / ${fortIndCost}ind)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.2rem 0', fontSize: '0.82rem' }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ color: '#ccc' }}>{value}</span>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  width: 240, flexShrink: 0, background: '#16213e', padding: '1rem',
  borderLeft: '1px solid #2a2a4a', overflowY: 'auto', fontFamily: 'monospace',
};

const actionBtn: React.CSSProperties = {
  width: '100%', padding: '0.4rem', background: '#0f3460', border: '1px solid #1a5276',
  borderRadius: 4, color: '#eee', fontFamily: 'monospace', fontSize: '0.82rem', display: 'block',
};
