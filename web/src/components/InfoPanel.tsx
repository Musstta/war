import { useState, useEffect } from 'react';
import { TerritoryView, NationView, WorldView, CompatibilityBreakdown, UnrestCauses, api } from '../api';
import { CULTURE_AXES, poleName, poleShort } from '../cultureAxes';

interface Props {
  territoryId: string | null;
  world: WorldView;
  defNames: Record<string, string>;
  onActionQueued: () => void;
}

const FORT_MANDATE_COSTS: Record<number, number> = { 1: 2, 2: 3, 3: 4 };
const BUILD_IND: Record<string, number> = { port: 5, fort_l1: 3, fort_l2: 6, fort_l3: 10 };
const BUILD_TICKS: Record<string, number> = { port: 3, fort_l1: 3, fort_l2: 7, fort_l3: 14 };

const CONSTRUCTION_NAMES: Record<string, string> = {
  port: 'Port', fort_l1: 'Fort L1', fort_l2: 'Fort L2', fort_l3: 'Fort L3', road: 'Road',
};


const CAUSE_LABELS: Record<keyof UnrestCauses, string> = {
  base: 'Base floor',
  compatibilityPressure: 'Cultural clash',
  distancePressure: 'Distance from capital',
  infrastructureBonus: 'Infrastructure investment',
  overexpansionPressure: 'Empire size',
  ownershipShock: 'Conquest shock',
  recentConquestPressure: 'Rapid expansion',
  militaryBonus: 'Military presence',
  equilibrium: 'Equilibrium',
};

function constructionLabel(type: string | null | undefined, ticksLeft: number | null | undefined): string | null {
  if (!type || ticksLeft == null) return null;
  return `Building ${CONSTRUCTION_NAMES[type] ?? type} — ${ticksLeft} tick${ticksLeft !== 1 ? 's' : ''} left`;
}

function queuedActionLabel(type: string, payload: unknown): string {
  const p = payload as { targetLevel?: number };
  if (type === 'build_road') return 'Road — resolves at next tick';
  if (type === 'build_port') return `Port — ${BUILD_TICKS['port']} ticks to complete`;
  if (type === 'build_fort') return `Fort L${p.targetLevel ?? '?'} — ${BUILD_TICKS[`fort_l${p.targetLevel}`] ?? '?'} ticks`;
  return type;
}

function fmt2(n: number): string { return (n >= 0 ? '+' : '') + n.toFixed(2); }
function fmtCompat(n: number): string { return n.toFixed(2); }

interface ConfirmState {
  title: string;
  costLine: string;
  timingLine: string;
  execute: () => Promise<void>;
}

function UnrestPanel({ unrest, causes }: { unrest: number; causes: UnrestCauses }) {
  const direction = unrest < causes.equilibrium ? '↑' : unrest > causes.equilibrium ? '↓' : '=';
  const causeKeys: (keyof UnrestCauses)[] = [
    'base', 'compatibilityPressure', 'distancePressure',
    'infrastructureBonus', 'overexpansionPressure', 'ownershipShock',
    'recentConquestPressure', 'militaryBonus',
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
    ['individualistGap', 'Ind gap'], ['progressiveGap', 'Prog gap'],
    ['militaristicGap', 'Mil gap'], ['expansionistGap', 'Exp gap'],
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
  const [confirming, setConfirming] = useState<ConfirmState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Clear confirm state when the selected territory changes.
  useEffect(() => { setConfirming(null); }, [territoryId]);

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
  const slotAvailable = pending === null;

  const canBuildRoad = isOwn && !t?.hasRoad && phase === 'main' && mandateLeft >= 1 && slotAvailable;
  const canBuildPort = isOwn && !!t?.isCoastal && !t?.hasPort && phase === 'main' && mandateLeft >= 2 && myInd >= BUILD_IND['port']! && slotAvailable;
  const canBuildFort = isOwn && (t?.fortificationLevel ?? 0) < 3 && phase === 'main' && mandateLeft >= fortMandateCost && myInd >= fortIndCost && slotAvailable;

  // Actions queued by this player for the current territory this tick.
  const territoryQueued = world.myQueuedActions.filter(
    (a) => (a.payload as { territoryId?: string }).territoryId === territoryId,
  );

  // Stage an action for confirmation instead of firing immediately.
  const stage = (s: ConfirmState) => setConfirming(s);

  const executeConfirmed = async () => {
    if (!confirming) return;
    setSubmitting(true);
    try {
      await confirming.execute();
      setConfirming(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setSubmitting(false);
    }
  };

  const constructionStatus = constructionLabel(t?.constructionType, t?.constructionTicksLeft);

  const isDeferred = constructing !== null;

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

      {/* Active construction + deferred queue */}
      {constructionStatus && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#f0a500', padding: '0.3rem 0.4rem', background: '#1a1a2e', borderRadius: 3 }}>
          {constructionStatus}
          {pending && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.15rem' }}>
              <span style={{ color: '#7ecfff' }}>↳ Queued next: {CONSTRUCTION_NAMES[pending] ?? pending}</span>
              {isOwn && (
                <button
                  onClick={() => stage({
                    title: 'Cancel queued build',
                    costLine: `Refunds mandate + industry for ${CONSTRUCTION_NAMES[pending] ?? pending}`,
                    timingLine: 'Takes effect immediately',
                    execute: async () => {
                      await api.action('cancel_pending_construction', { territoryId });
                      onActionQueued();
                    },
                  })}
                  style={{ marginLeft: '0.4rem', padding: '0.1rem 0.35rem', background: 'transparent', border: '1px solid #5a2222', borderRadius: 3, color: '#cc4444', fontFamily: 'monospace', fontSize: '0.68rem', cursor: 'pointer' }}
                >
                  ✕ Cancel
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Queued-this-tick indicator */}
      {territoryQueued.length > 0 && (
        <div style={{ marginTop: '0.35rem' }}>
          {territoryQueued.map((a, i) => (
            <div key={i} style={{ fontSize: '0.73rem', color: '#4caf50', padding: '0.1rem 0.4rem', background: '#0a1a0a', borderRadius: 3, marginBottom: '0.1rem' }}>
              ✓ Queued: {queuedActionLabel(a.type, a.payload)}
            </div>
          ))}
        </div>
      )}

      {/* Unrest & causes */}
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

      {/* Nation culture axes */}
      {isOwn && owner?.culture && (
        <div style={{ marginTop: '0.4rem', padding: '0.35rem 0.4rem', background: '#0d0d1a', borderRadius: 3 }}>
          <div style={{ fontSize: '0.7rem', color: '#555', marginBottom: '0.2rem', letterSpacing: '0.05em' }}>
            NATION CULTURE <span style={{ color: '#333' }}>({owner.culture.primaryFamily ?? '—'})</span>
          </div>
          {CULTURE_AXES.map((axis) => {
            const v = (owner.culture as NonNullable<typeof owner.culture>)[axis.key];
            const pole = poleName(axis, v);
            const color = v > 0.1 ? '#7ecfff' : v < -0.1 ? '#f0a500' : '#888';
            return (
              <div key={axis.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '0.05rem 0' }}>
                <span style={{ color: '#555' }}>{axis.label}</span>
                <span style={{ color }} title={pole}>
                  {v >= 0 ? '+' : ''}{v.toFixed(2)} <span style={{ color: '#444', fontSize: '0.65rem' }}>({pole})</span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Stockpiles */}
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

      {/* Build actions */}
      {isOwn && (
        <div style={{ marginTop: '0.75rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.4rem' }}>YOUR TERRITORY</div>

          {/* Confirm box — appears when an action is staged */}
          {confirming && (
            <div style={{ marginBottom: '0.5rem', padding: '0.5rem 0.55rem', background: '#09142a', border: '1px solid #1a4a7a', borderRadius: 4 }}>
              <div style={{ fontSize: '0.68rem', color: '#4a8aba', letterSpacing: '0.07em', marginBottom: '0.25rem' }}>CONFIRM</div>
              <div style={{ fontSize: '0.83rem', color: '#ddd', marginBottom: '0.1rem' }}>{confirming.title}</div>
              <div style={{ fontSize: '0.72rem', color: '#888', marginBottom: '0.06rem' }}>{confirming.costLine}</div>
              <div style={{ fontSize: '0.72rem', color: '#555', marginBottom: '0.4rem' }}>{confirming.timingLine}</div>
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                <button
                  onClick={executeConfirmed}
                  disabled={submitting}
                  style={{ flex: 1, padding: '0.3rem', background: '#0f3460', border: '1px solid #1a5276', borderRadius: 3, color: '#7ecfff', fontFamily: 'monospace', fontSize: '0.78rem', cursor: 'pointer' }}
                >
                  {submitting ? '…' : '✓ Confirm'}
                </button>
                <button
                  onClick={() => setConfirming(null)}
                  disabled={submitting}
                  style={{ flex: 1, padding: '0.3rem', background: 'transparent', border: '1px solid #3a3a5a', borderRadius: 3, color: '#666', fontFamily: 'monospace', fontSize: '0.78rem', cursor: 'pointer' }}
                >
                  ✗ Cancel
                </button>
              </div>
            </div>
          )}

          {/* Road */}
          <button
            onClick={() => stage({
              title: isDeferred ? 'Queue next: Road' : 'Build Road',
              costLine: '1 mandate',
              timingLine: isDeferred
                ? `Starts after ${CONSTRUCTION_NAMES[constructing!] ?? constructing} completes`
                : 'Instant — resolves at next tick',
              execute: async () => { await api.action('build_road', { territoryId }); onActionQueued(); },
            })}
            disabled={!canBuildRoad}
            title={
              t?.hasRoad ? 'Already has a road'
              : pending !== null ? 'Next construction already queued'
              : phase !== 'main' ? 'Only during Main Phase'
              : mandateLeft < 1 ? 'No mandates left'
              : undefined
            }
            style={{ ...actionBtn, opacity: canBuildRoad ? 1 : 0.4, cursor: canBuildRoad ? 'pointer' : 'not-allowed', marginBottom: '0.3rem' }}
          >
            {t?.hasRoad ? 'Road built' : isDeferred ? 'Queue next: Road (1M)' : 'Build Road (1 mandate)'}
          </button>

          {/* Port */}
          {t?.isCoastal && (
            <button
              onClick={() => stage({
                title: isDeferred ? 'Queue next: Port' : 'Build Port',
                costLine: `2 mandates · ${BUILD_IND['port']} industry`,
                timingLine: isDeferred
                  ? `Starts after ${CONSTRUCTION_NAMES[constructing!] ?? constructing} completes · ${BUILD_TICKS['port']} ticks to build`
                  : `${BUILD_TICKS['port']} ticks to complete`,
                execute: async () => { await api.action('build_port', { territoryId }); onActionQueued(); },
              })}
              disabled={!canBuildPort}
              title={
                t?.hasPort ? 'Already has a port'
                : pending !== null ? 'Next construction already queued'
                : phase !== 'main' ? 'Only during Main Phase'
                : myInd < BUILD_IND['port']! ? `Need ${BUILD_IND['port']} industry (have ${Math.floor(myInd)})`
                : mandateLeft < 2 ? 'Not enough mandates'
                : undefined
              }
              style={{ ...actionBtn, opacity: canBuildPort ? 1 : 0.4, cursor: canBuildPort ? 'pointer' : 'not-allowed', marginBottom: '0.3rem' }}
            >
              {t?.hasPort ? 'Port built' : isDeferred ? `Queue next: Port (2M / ${BUILD_IND['port']}ind)` : `Build Port (2M / ${BUILD_IND['port']}ind)`}
            </button>
          )}

          {/* Fort */}
          {(t?.fortificationLevel ?? 0) < 3 && (
            <button
              onClick={() => stage({
                title: isDeferred ? `Queue next: Fort L${nextFortLevel}` : `Build Fort L${nextFortLevel}`,
                costLine: `${fortMandateCost} mandates · ${fortIndCost} industry`,
                timingLine: isDeferred
                  ? `Starts after ${CONSTRUCTION_NAMES[constructing!] ?? constructing} completes · ${BUILD_TICKS[`fort_l${nextFortLevel}`] ?? '?'} ticks to build`
                  : `${BUILD_TICKS[`fort_l${nextFortLevel}`] ?? '?'} ticks to complete`,
                execute: async () => { await api.action('build_fort', { territoryId }); onActionQueued(); },
              })}
              disabled={!canBuildFort}
              title={
                pending !== null ? 'Next construction already queued'
                : phase !== 'main' ? 'Only during Main Phase'
                : myInd < fortIndCost ? `Need ${fortIndCost} industry (have ${Math.floor(myInd)})`
                : mandateLeft < fortMandateCost ? 'Not enough mandates'
                : undefined
              }
              style={{ ...actionBtn, opacity: canBuildFort ? 1 : 0.4, cursor: canBuildFort ? 'pointer' : 'not-allowed' }}
            >
              {isDeferred ? `Queue next: Fort L${nextFortLevel} (${fortMandateCost}M / ${fortIndCost}ind)` : `Fort L${nextFortLevel} (${fortMandateCost}M / ${fortIndCost}ind)`}
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
