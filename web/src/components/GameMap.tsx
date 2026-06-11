import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { WorldView, VisibilityTier } from '../api';

// Fixed color per nation — matches INITIAL_NATIONS + INITIAL_AI_NATIONS in server/src/world.ts
const NATION_COLORS: Record<string, string> = {
  // Player nations
  nation_costa_rica: '#2196F3',
  nation_guatemala:  '#4CAF50',
  nation_honduras:   '#FF9800',
  nation_nicaragua:  '#9C27B0',
  nation_panama:     '#F44336',
  // AI nations (Phase 7 Americas)
  nation_north_atlantic: '#00BCD4',
  nation_gran_norte:     '#8BC34A',
  nation_sul_grande:     '#E91E63',
  nation_nueva_granada:  '#FF5722',
  nation_rio_de_plata:   '#3F51B5',
  nation_antilles:       '#009688',
  nation_dominion:       '#795548',
  nation_llanos:         '#FFC107',
};

/** Desaturate a hex color for LightFog rendering. */
function desaturate(hex: string, amount = 0.65): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  const nr = Math.round(r + (gray - r) * amount);
  const ng = Math.round(g + (gray - g) * amount);
  const nb = Math.round(b + (gray - b) * amount);
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

function ownerColor(ownerId: string | null): string {
  return ownerId ? (NATION_COLORS[ownerId] ?? '#607D8B') : '#546E7A';
}

/** TrueFog base color — muted grey, no owner information. */
const TRUE_FOG_COLOR = '#2a2a35';

interface GeoFeature {
  type: 'Feature';
  id: string;
  properties: Record<string, unknown>;
  // geometry typed as any to avoid strict GeoJSON constraint mismatch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  geometry: any;
}
interface GeoCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

interface Props {
  world: WorldView;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function GameMap({ world, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const geojsonRef = useRef<GeoCollection | null>(null);

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          carto: {
            type: 'raster',
            tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© CARTO © OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'carto-tiles', type: 'raster', source: 'carto' }],
      },
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl(), 'top-left');

    map.on('load', () => {
      map.fitBounds([[-170, -55], [-30, 75]], { padding: 20, animate: false });

      // Load territories geojson then paint with current world state
      fetch('/territories.geojson')
        .then((r) => r.json())
        .then((data: GeoCollection) => {
          geojsonRef.current = data;
          const enriched = enrichGeojson(data, world);

          map.addSource('territories', { type: 'geojson', data: enriched as any });

          map.addLayer({
            id: 'territory-fill',
            type: 'fill',
            source: 'territories',
            paint: {
              'fill-color': ['get', 'fillColor'],
              'fill-opacity': [
                'case',
                ['==', ['get', 'id'], selectedId ?? ''], 0.78,
                ['get', 'fillOpacityBase'],
              ],
            },
          });

          map.addLayer({
            id: 'territory-outline',
            type: 'line',
            source: 'territories',
            paint: {
              'line-color': [
                'case',
                // TrueFog: very dim border so it doesn't distract
                ['==', ['get', 'visibilityTier'], VisibilityTier.TrueFog], '#3a3a4a',
                '#fff',
              ],
              'line-width': ['case', ['==', ['get', 'id'], selectedId ?? ''], 2.5, 1],
              'line-opacity': [
                'case',
                ['==', ['get', 'visibilityTier'], VisibilityTier.TrueFog], 0.35,
                0.8,
              ],
            },
          });

          map.on('click', 'territory-fill', (e) => {
            const id = e.features?.[0]?.properties?.id;
            if (id) onSelect(String(id));
          });

          map.on('mouseenter', 'territory-fill', () => {
            map.getCanvas().style.cursor = 'pointer';
          });
          map.on('mouseleave', 'territory-fill', () => {
            map.getCanvas().style.cursor = '';
          });
        });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-paint when world state or selection changes
  useEffect(() => {
    const map = mapRef.current;
    const geojson = geojsonRef.current;
    if (!map || !geojson || !map.isStyleLoaded()) return;

    const source = map.getSource('territories') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    source.setData(enrichGeojson(geojson, world) as any);

    // Update selection highlight via paint property
    if (map.getLayer('territory-fill')) {
      map.setPaintProperty('territory-fill', 'fill-opacity', [
        'case',
        ['==', ['get', 'id'], selectedId ?? ''], 0.78,
        ['get', 'fillOpacityBase'],
      ]);
    }
    if (map.getLayer('territory-outline')) {
      map.setPaintProperty('territory-outline', 'line-width', [
        'case', ['==', ['get', 'id'], selectedId ?? ''], 2.5, 1,
      ]);
    }
  }, [world, selectedId]);

  return (
    <div ref={containerRef} style={{ flex: 1, position: 'relative' }} />
  );
}

function enrichGeojson(base: GeoCollection, world: WorldView): GeoCollection {
  return {
    ...base,
    features: base.features.map((f) => {
      const t = world.territories[f.id];
      const tier = t?.visibilityTier ?? VisibilityTier.TrueFog;

      let fillColor: string;
      let fillOpacityBase: number;
      let labelVisible: boolean;

      if (tier === VisibilityTier.TrueFog) {
        // Muted grey — no political information.
        fillColor = TRUE_FOG_COLOR;
        fillOpacityBase = 0.55;
        labelVisible = false;
      } else if (tier === VisibilityTier.LightFog) {
        // Desaturated owner color — owner identity only.
        const base64Color = ownerColor(t?.ownerId ?? null);
        fillColor = desaturate(base64Color);
        fillOpacityBase = 0.45;
        labelVisible = true;
      } else {
        // Clear — full owner color.
        fillColor = ownerColor(t?.ownerId ?? null);
        fillOpacityBase = 0.45;
        labelVisible = true;
      }

      return {
        ...f,
        properties: {
          ...f.properties,
          visibilityTier: tier,
          ownerId: t?.ownerId ?? null,
          hasRoad: t?.hasRoad ?? false,
          hasPort: t?.hasPort ?? false,
          fillColor,
          fillOpacityBase,
          labelVisible,
        },
      };
    }),
  };
}
