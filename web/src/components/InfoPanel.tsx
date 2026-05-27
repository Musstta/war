import { TerritoryView, NationView, WorldView, api } from '../api';

interface Props {
  territoryId: string | null;
  world: WorldView;
  defNames: Record<string, string>;  // id → display name from geojson
  onActionQueued: () => void;
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

  const canBuildRoad =
    isOwn && !t?.hasRoad && phase === 'main' && mandateLeft >= 1;

  const buildRoad = async () => {
    try {
      await api.action('build_road', { territoryId });
      onActionQueued();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Action failed');
    }
  };

  return (
    <div style={panelStyle}>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#eee' }}>
        {defNames[territoryId] ?? territoryId}
      </h3>
      <Row label="Owner" value={owner ? owner.name : '— unclaimed'} />
      <Row label="Road" value={t?.hasRoad ? 'Yes' : 'No'} />
      <Row label="Port" value={t?.hasPort ? 'Yes' : 'No'} />

      {t?.fortificationLevel !== undefined && (
        <Row label="Fortification" value={String(t.fortificationLevel)} />
      )}
      {t?.unrest !== undefined && (
        <Row label="Unrest" value={t.unrest.toFixed(2)} />
      )}

      {isOwn && (
        <div style={{ marginTop: '1rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.4rem' }}>YOUR TERRITORY</div>
          <button
            onClick={buildRoad}
            disabled={!canBuildRoad}
            title={
              !isOwn ? 'Not your territory'
              : t?.hasRoad ? 'Already has a road'
              : phase !== 'main' ? 'Only during Main Phase'
              : mandateLeft < 1 ? 'No mandates left'
              : 'Queue: Build Road (1 mandate)'
            }
            style={{
              ...actionBtn,
              opacity: canBuildRoad ? 1 : 0.4,
              cursor: canBuildRoad ? 'pointer' : 'not-allowed',
            }}
          >
            {t?.hasRoad ? 'Road built' : 'Build Road (1 mandate)'}
          </button>
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
  borderRadius: 4, color: '#eee', fontFamily: 'monospace', fontSize: '0.82rem',
};
