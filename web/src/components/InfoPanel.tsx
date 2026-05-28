import { TerritoryView, NationView, WorldView, api } from '../api';

interface Props {
  territoryId: string | null;
  world: WorldView;
  defNames: Record<string, string>;  // id → display name from geojson
  onActionQueued: () => void;
}

const FORT_MANDATE_COSTS: Record<number, number> = { 1: 2, 2: 3, 3: 4 };
const BUILD_IND: Record<string, number> = { port: 5, fort_l1: 3, fort_l2: 6, fort_l3: 10 };

function constructionLabel(type: string | null | undefined, ticksLeft: number | null | undefined): string | null {
  if (!type || ticksLeft == null) return null;
  const name =
    type === 'port' ? 'Port'
    : type === 'fort_l1' ? 'Fort L1'
    : type === 'fort_l2' ? 'Fort L2'
    : 'Fort L3';
  return `Building ${name} — ${ticksLeft} tick${ticksLeft !== 1 ? 's' : ''} left`;
}

export function InfoPanel({ territoryId, world, defNames, onActionQueued }: Props) {
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
  const nextFortLevel = (t?.fortificationLevel ?? 0) + 1;
  const fortMandateCost = FORT_MANDATE_COSTS[nextFortLevel] ?? 4;
  const fortIndCost = BUILD_IND[`fort_l${nextFortLevel}`] ?? 10;

  const myInd = myStockpiles?.industry ?? 0;

  const canBuildRoad =
    isOwn && !t?.hasRoad && phase === 'main' && mandateLeft >= 1 && constructing === null;
  const canBuildPort =
    isOwn && !!t?.isCoastal && !t?.hasPort && phase === 'main' && mandateLeft >= 2 && myInd >= BUILD_IND['port']! && constructing === null;
  const canBuildFort =
    isOwn && (t?.fortificationLevel ?? 0) < 3 && phase === 'main' && mandateLeft >= fortMandateCost && myInd >= fortIndCost && constructing === null;

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
      <Row label="Owner" value={owner ? owner.name : '— unclaimed'} />
      <Row label="Coastal" value={t?.isCoastal ? 'Yes' : 'No'} />
      <Row label="Road" value={t?.hasRoad ? 'Yes' : 'No'} />
      <Row label="Port" value={t?.hasPort ? 'Yes' : (t?.isCoastal ? 'No' : '—')} />

      {t?.fortificationLevel !== undefined && (
        <Row label="Fortification" value={String(t.fortificationLevel)} />
      )}
      {t?.unrest !== undefined && (
        <Row label="Unrest" value={t.unrest.toFixed(2)} />
      )}

      {constructionStatus && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#f0a500', padding: '0.3rem 0.4rem', background: '#1a1a2e', borderRadius: 3 }}>
          {constructionStatus}
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

      {isOwn && (
        <div style={{ marginTop: '0.75rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.4rem' }}>YOUR TERRITORY</div>

          <button
            onClick={buildRoad}
            disabled={!canBuildRoad}
            title={
              t?.hasRoad ? 'Already has a road'
              : constructing !== null ? 'Construction in progress'
              : phase !== 'main' ? 'Only during Main Phase'
              : mandateLeft < 1 ? 'No mandates left'
              : 'Queue: Build Road (1 mandate, instant)'
            }
            style={{ ...actionBtn, opacity: canBuildRoad ? 1 : 0.4, cursor: canBuildRoad ? 'pointer' : 'not-allowed', marginBottom: '0.3rem' }}
          >
            {t?.hasRoad ? 'Road built' : 'Build Road (1 mandate)'}
          </button>

          {t?.isCoastal && (
            <button
              onClick={buildPort}
              disabled={!canBuildPort}
              title={
                t?.hasPort ? 'Already has a port'
                : constructing !== null ? 'Construction in progress'
                : phase !== 'main' ? 'Only during Main Phase'
                : myInd < BUILD_IND['port']! ? `Need ${BUILD_IND['port']} industry (have ${Math.floor(myInd)})`
                : mandateLeft < 2 ? 'Not enough mandates'
                : `Queue: Build Port (2 mandates, ${BUILD_IND['port']} ind, 3 ticks)`
              }
              style={{ ...actionBtn, opacity: canBuildPort ? 1 : 0.4, cursor: canBuildPort ? 'pointer' : 'not-allowed', marginBottom: '0.3rem' }}
            >
              {t?.hasPort ? 'Port built' : `Build Port (2M / ${BUILD_IND['port']}ind)`}
            </button>
          )}

          {(t?.fortificationLevel ?? 0) < 3 && (
            <button
              onClick={buildFort}
              disabled={!canBuildFort}
              title={
                constructing !== null ? 'Construction in progress'
                : phase !== 'main' ? 'Only during Main Phase'
                : myInd < fortIndCost ? `Need ${fortIndCost} industry (have ${Math.floor(myInd)})`
                : mandateLeft < fortMandateCost ? 'Not enough mandates'
                : `Queue: Build Fort L${nextFortLevel} (${fortMandateCost} mandates, ${fortIndCost} ind)`
              }
              style={{ ...actionBtn, opacity: canBuildFort ? 1 : 0.4, cursor: canBuildFort ? 'pointer' : 'not-allowed' }}
            >
              {`Fort L${nextFortLevel} (${fortMandateCost}M / ${fortIndCost}ind)`}
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
  width: 220, flexShrink: 0, background: '#16213e', padding: '1rem',
  borderLeft: '1px solid #2a2a4a', overflowY: 'auto', fontFamily: 'monospace',
};

const actionBtn: React.CSSProperties = {
  width: '100%', padding: '0.4rem', background: '#0f3460', border: '1px solid #1a5276',
  borderRadius: 4, color: '#eee', fontFamily: 'monospace', fontSize: '0.82rem', display: 'block',
};
