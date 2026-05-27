import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { WorldView } from '../api';

// Fixed color per nation — matches INITIAL_NATIONS in server/src/world.ts
const NATION_COLORS: Record<string, string> = {
  nation_costa_rica: '#2196F3',
  nation_guatemala:  '#4CAF50',
  nation_honduras:   '#FF9800',
  nation_nicaragua:  '#9C27B0',
  nation_panama:     '#F44336',
};

function ownerColor(ownerId: string | null): string {
  return ownerId ? (NATION_COLORS[ownerId] ?? '#607D8B') : '#546E7A';
}

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
      center: [-86, 14.5],
      zoom: 5.2,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl(), 'top-left');

    map.on('load', () => {
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
              'fill-opacity': ['case', ['==', ['get', 'id'], selectedId ?? ''], 0.75, 0.45],
            },
          });

          map.addLayer({
            id: 'territory-outline',
            type: 'line',
            source: 'territories',
            paint: {
              'line-color': '#fff',
              'line-width': ['case', ['==', ['get', 'id'], selectedId ?? ''], 2.5, 1],
              'line-opacity': 0.8,
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
        'case', ['==', ['get', 'id'], selectedId ?? ''], 0.75, 0.45,
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
      return {
        ...f,
        properties: {
          ...f.properties,
          ownerId: t?.ownerId ?? null,
          hasRoad: t?.hasRoad ?? false,
          hasPort: t?.hasPort ?? false,
          fillColor: ownerColor(t?.ownerId ?? null),
        },
      };
    }),
  };
}
