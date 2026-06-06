/**
 * Generates the adjacency list for the Americas territory set from Natural Earth GeoJSON data.
 *
 * Outputs: scripts/data/americas-adjacency.json
 *
 * Run: node scripts/generate-adjacency.mjs
 *
 * Algorithm:
 *   1. Load NE Admin-0 (countries, 110m) and Admin-1 (states/provinces, 50m) GeoJSON.
 *   2. For each territory in americas-territories.json, resolve named NE features:
 *      - First try Admin-1 (state/province) name match.
 *      - If not found and the name matches a country in Admin-0, use the country polygon.
 *      - Merge matched polygons into a single MultiPolygon geometry per territory.
 *   3. Territories with empty neFeatures are skipped (hand-placement required).
 *   4. For each pair of merged polygons, test if they intersect within TOLERANCE degrees
 *      (bbox expansion + turf booleanIntersects).
 *   5. Apply hardcoded sea adjacency overrides for island territories.
 *   6. Apply hardcoded hand-placement adjacency for sub-regional territories.
 *   7. Merge all adjacency, deduplicate, write americas-adjacency.json.
 */

import { createWriteStream, existsSync } from 'fs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { get } from 'https';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { booleanIntersects } from '@turf/boolean-intersects';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, '.cache');
const DATA  = join(__dirname, 'data');

const TERRITORIES_FILE = join(DATA, 'americas-territories.json');
const OUT_FILE         = join(DATA, 'americas-adjacency.json');

// 110m countries for country-level lookups; 50m states for province/state lookups.
const COUNTRY_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
const STATE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson';

// Tolerance in degrees — shared borders at 110m may only touch as lines.
// 0.15° ensures they are detected as intersecting.
const TOLERANCE = 0.15;

// ── Sea adjacency overrides ────────────────────────────────────────────────────
const SEA_ADJACENCY = {
  caribbean_west: ['caribbean_east', 'mexico_sur', 'usa_south', 'colombia_andes', 'venezuela'],
  caribbean_east: ['caribbean_west', 'venezuela', 'guianas'],
  guianas:        ['caribbean_east', 'brazil_nordeste'],
};

// ── Hand-placed adjacency for sub-regional territories (no NE polygon) ─────────
const HAND_PLACED = {
  colombia_orinoquia:    ['colombia_andes', 'venezuela', 'brazil_amazonia'],
  brazil_amazonia:       ['colombia_orinoquia', 'venezuela', 'guianas', 'brazil_nordeste', 'brazil_sul', 'peru_selva', 'bolivia'],
  brazil_nordeste:       ['brazil_amazonia', 'brazil_sul', 'guianas'],
  brazil_sul:            ['brazil_amazonia', 'brazil_nordeste', 'uruguay', 'argentina_pampa_norte', 'paraguay', 'bolivia'],
  peru_costa_sierra:     ['ecuador', 'colombia_andes', 'bolivia', 'chile', 'peru_selva'],
  peru_selva:            ['peru_costa_sierra', 'ecuador', 'colombia_orinoquia', 'brazil_amazonia', 'bolivia'],
  argentina_pampa_norte: ['chile', 'bolivia', 'paraguay', 'brazil_sul', 'uruguay', 'argentina_patagonia'],
  argentina_patagonia:   ['argentina_pampa_norte', 'chile'],
};

// ── Additional hand-placed land adjacency for intra-Canada and intra-Mexico ────
// These come from geographic knowledge since all Canada/Mexico sub-regions share
// their parent country's Admin-0 polygon and would otherwise produce too-broad
// cross-border adjacency. We enumerate the real borders explicitly.
const EXTRA_LAND = {
  // Canada internal + real cross-border with USA
  canada_northwest: ['canada_west', 'canada_central', 'usa_west'],    // Yukon borders Alaska (usa_west)
  canada_west:      ['canada_northwest', 'canada_central', 'usa_west'],
  canada_central:   ['canada_northwest', 'canada_west', 'canada_east', 'usa_midwest', 'usa_northeast'],
  canada_east:      ['canada_central', 'usa_northeast'],               // NB borders Maine
  // Mexico internal + real cross-border with USA
  mexico_norte:     ['mexico_centro', 'usa_west', 'usa_south'],
  mexico_centro:    ['mexico_norte', 'mexico_sur'],
  mexico_sur:       ['mexico_centro', 'belize', 'guatemala'],
};

// ── Edges to suppress from auto-detection (false positives from country polygons) ──
// When Canada/Mexico use the full country polygon, all four Canada sub-regions
// appear to touch every US region that touches any point of Canada/Mexico.
// We explicitly drop the impossible cross-border pairs here; EXTRA_LAND above
// re-adds the correct ones.
const SUPPRESS_AUTO = new Set([
  // usa_northeast does NOT border canada_northwest or canada_west
  'usa_northeast:canada_northwest', 'canada_northwest:usa_northeast',
  'usa_northeast:canada_west',      'canada_west:usa_northeast',
  // usa_midwest does NOT border canada_east or canada_northwest
  'usa_midwest:canada_east',        'canada_east:usa_midwest',
  'usa_midwest:canada_northwest',   'canada_northwest:usa_midwest',
  // usa_west does NOT border canada_central or canada_east
  'usa_west:canada_central',        'canada_central:usa_west',
  'usa_west:canada_east',           'canada_east:usa_west',
  // usa_south does NOT border any Canada (south USA borders Mexico)
  'usa_south:canada_west',          'canada_west:usa_south',
  'usa_south:canada_central',       'canada_central:usa_south',
  'usa_south:canada_east',          'canada_east:usa_south',
  'usa_south:canada_northwest',     'canada_northwest:usa_south',
  // mexico_norte/centro/sur should not auto-detect — handled by EXTRA_LAND
  // (we suppress the ones that are wrong; correct ones already in EXTRA_LAND)
  'usa_west:mexico_sur',            'mexico_sur:usa_west',
  'usa_west:mexico_centro',         'mexico_centro:usa_west',
  'usa_south:mexico_sur',           'mexico_sur:usa_south',
  'usa_south:mexico_centro',        'mexico_centro:usa_south',
  'mexico_norte:belize',            'belize:mexico_norte',
  'mexico_norte:guatemala',         'guatemala:mexico_norte',
  'mexico_centro:belize',           'belize:mexico_centro',
  'mexico_centro:guatemala',        'guatemala:mexico_centro',
]);

// ────────────────────────────────────────────────────────────────────────────────

async function download(url, dest) {
  if (existsSync(dest)) {
    console.log(`  cached: ${dest}`);
    return;
  }
  console.log(`  downloading: ${url}`);
  return new Promise((resolve, reject) => {
    const handleResponse = (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        download(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    };
    get(url, handleResponse).on('error', reject);
  });
}

function expandBbox(bbox, delta) {
  return [bbox[0] - delta, bbox[1] - delta, bbox[2] + delta, bbox[3] + delta];
}

function bboxOf(geometry) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  function visit(arr, depth) {
    if (depth === 0) { const [x, y] = arr; if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; return; }
    for (const item of arr) visit(item, depth - 1);
  }
  if (geometry.type === 'Polygon')      visit(geometry.coordinates, 2);
  else if (geometry.type === 'MultiPolygon') visit(geometry.coordinates, 3);
  return [minX, minY, maxX, maxY];
}

function bboxOverlap(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function mergeGeometries(features) {
  const polygons = [];
  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon')           polygons.push(g.coordinates);
    else if (g.type === 'MultiPolygon') polygons.push(...g.coordinates);
  }
  return { type: 'MultiPolygon', coordinates: polygons };
}

function normName(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const NAME_KEYS_STATE   = ['name', 'NAME', 'name_en', 'NAME_EN', 'gn_name', 'woe_name', 'abbrev'];
const NAME_KEYS_COUNTRY = ['NAME', 'ADMIN', 'NAME_EN', 'name', 'admin'];

function findByName(features, nameKeys, targets) {
  const normTargets = new Set(targets.map(normName));
  return features.filter(f => {
    for (const k of nameKeys) {
      const v = f.properties?.[k];
      if (v && normTargets.has(normName(String(v)))) return true;
    }
    return false;
  });
}

function areAdjacent(geomA, geomB, bboxA, bboxB) {
  if (!bboxOverlap(expandBbox(bboxA, TOLERANCE), expandBbox(bboxB, TOLERANCE))) return false;
  const featA = { type: 'Feature', geometry: geomA, properties: {} };
  const featB = { type: 'Feature', geometry: geomB, properties: {} };
  try { return booleanIntersects(featA, featB); }
  catch { return true; }
}

function addEdge(adj, a, b) {
  if (!adj.has(a)) adj.set(a, new Set());
  if (!adj.has(b)) adj.set(b, new Set());
  adj.get(a).add(b);
  adj.get(b).add(a);
}

// ────────────────────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(CACHE, { recursive: true });

  const countryFile = join(CACHE, 'ne_110m_countries.geojson');
  const stateFile   = join(CACHE, 'ne_50m_states.geojson');

  await download(COUNTRY_URL, countryFile);
  await download(STATE_URL, stateFile);

  console.log('\nLoading GeoJSON...');
  const countries = JSON.parse(await readFile(countryFile, 'utf8'));
  const states    = JSON.parse(await readFile(stateFile,   'utf8'));
  console.log(`  ${countries.features.length} country features (Admin-0 110m)`);
  console.log(`  ${states.features.length}   state features   (Admin-1 50m)`);

  const { territories } = JSON.parse(await readFile(TERRITORIES_FILE, 'utf8'));
  console.log(`  ${territories.length} territories in americas-territories.json\n`);

  // ── Build merged geometry per territory ──────────────────────────────────────
  const geometries = new Map();   // id → { geometry, bbox }
  const handPlacementRequired = [];
  const warnings = [];

  // Territories that are whole-country or country-level (will use Admin-0)
  // vs those where we need state-level data.
  // We try Admin-1 (states) first for each name, then fall back to Admin-0 (countries).
  const COUNTRY_LEVEL_IDS = new Set([
    'canada_west', 'canada_central', 'canada_east', 'canada_northwest',
    'mexico_norte', 'mexico_centro', 'mexico_sur',
  ]);

  for (const terr of territories) {
    if (!terr.neFeatures || terr.neFeatures.length === 0) {
      console.log(`  SKIP (hand-place): ${terr.id}`);
      handPlacementRequired.push(terr.id);
      continue;
    }

    // Canada/Mexico sub-regions: use the country polygon as a single merged geometry.
    // This gives correct adjacency with neighbours; intra-Canada/Mexico borders are
    // handled via EXTRA_LAND overrides below.
    if (COUNTRY_LEVEL_IDS.has(terr.id)) {
      // Map territory → parent country name
      const parentCountry = terr.id.startsWith('canada') ? 'Canada' : 'Mexico';
      const countryFeats = findByName(countries.features, NAME_KEYS_COUNTRY, [parentCountry]);
      if (countryFeats.length === 0) {
        warnings.push(`${terr.id}: country "${parentCountry}" not found in Admin-0`);
        handPlacementRequired.push(terr.id);
        continue;
      }
      const geometry = mergeGeometries(countryFeats);
      const bbox = bboxOf(geometry);
      geometries.set(terr.id, { geometry, bbox, source: `country:${parentCountry}` });
      console.log(`  built: ${terr.id} (country-level: ${parentCountry})`);
      continue;
    }

    // Try Admin-1 (states) first, then Admin-0 (countries) for each name.
    const matched = [];
    const notFound = [];

    for (const name of terr.neFeatures) {
      const stateMatch = findByName(states.features, NAME_KEYS_STATE, [name]);
      if (stateMatch.length > 0) {
        matched.push(...stateMatch);
        continue;
      }
      const countryMatch = findByName(countries.features, NAME_KEYS_COUNTRY, [name]);
      if (countryMatch.length > 0) {
        matched.push(...countryMatch);
        continue;
      }
      notFound.push(name);
    }

    if (notFound.length > 0) {
      warnings.push(`${terr.id}: NE features not found: ${notFound.join(', ')}`);
    }

    if (matched.length === 0) {
      warnings.push(`${terr.id}: NO features found — adding to hand-placement list`);
      handPlacementRequired.push(terr.id);
      continue;
    }

    const geometry = mergeGeometries(matched);
    if (geometry.coordinates.length === 0) {
      warnings.push(`${terr.id}: merged geometry is empty`);
      continue;
    }
    const bbox = bboxOf(geometry);
    geometries.set(terr.id, { geometry, bbox, matchedCount: matched.length });
    const src = `${matched.length}/${terr.neFeatures.length} features`;
    console.log(`  built: ${terr.id} (${src}${notFound.length ? ', ' + notFound.length + ' missing' : ''})`);
  }

  // ── Auto-detect land adjacency ────────────────────────────────────────────────
  console.log('\nDetecting land adjacency...');
  const adj     = new Map();  // territoryId → Set<neighborId>
  const seaAdj  = new Map();  // territoryId → Set<seaNeighborId>

  for (const id of territories.map(t => t.id)) {
    adj.set(id, new Set());
    seaAdj.set(id, new Set());
  }

  const ids = [...geometries.keys()];
  let pairsChecked = 0, pairsFound = 0;

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const idA = ids[i], idB = ids[j];
      const { geometry: gA, bbox: bboxA } = geometries.get(idA);
      const { geometry: gB, bbox: bboxB } = geometries.get(idB);
      pairsChecked++;
      if (areAdjacent(gA, gB, bboxA, bboxB)) {
        // Skip intra-Canada and intra-Mexico adjacency — handled by EXTRA_LAND
        const sameParent =
          (idA.startsWith('canada') && idB.startsWith('canada')) ||
          (idA.startsWith('mexico') && idB.startsWith('mexico'));
        if (sameParent) continue;

        // Skip false-positive cross-border pairs (from country-polygon over-detection)
        if (SUPPRESS_AUTO.has(`${idA}:${idB}`) || SUPPRESS_AUTO.has(`${idB}:${idA}`)) {
          console.log(`  suppress: ${idA} ↔ ${idB}`);
          continue;
        }

        addEdge(adj, idA, idB);
        pairsFound++;
        console.log(`  auto: ${idA} ↔ ${idB}`);
      }
    }
  }
  console.log(`  checked ${pairsChecked} pairs, found ${pairsFound} auto-adjacencies`);

  // ── Apply EXTRA_LAND (Canada/Mexico internal + cross-border) ─────────────────
  console.log('\nApplying extra land adjacency (Canada/Mexico borders)...');
  for (const [id, neighbors] of Object.entries(EXTRA_LAND)) {
    for (const n of neighbors) {
      addEdge(adj, id, n);
      console.log(`  extra: ${id} ↔ ${n}`);
    }
  }

  // ── Apply hand-placed adjacency ───────────────────────────────────────────────
  console.log('\nApplying hand-placed adjacency (sub-regional territories)...');
  for (const [id, neighbors] of Object.entries(HAND_PLACED)) {
    for (const n of neighbors) {
      addEdge(adj, id, n);
      console.log(`  hand: ${id} ↔ ${n}`);
    }
  }

  // ── Apply sea adjacency ───────────────────────────────────────────────────────
  console.log('\nApplying sea adjacency...');
  for (const [id, neighbors] of Object.entries(SEA_ADJACENCY)) {
    for (const n of neighbors) {
      // Ensure both IDs exist in seaAdj
      if (!seaAdj.has(id)) seaAdj.set(id, new Set());
      if (!seaAdj.has(n))  seaAdj.set(n, new Set());
      seaAdj.get(id).add(n);
      seaAdj.get(n).add(id);
      console.log(`  sea: ${id} ↔ ${n}`);
    }
  }

  // ── Build output ──────────────────────────────────────────────────────────────
  const adjacencyOutput = {};
  const allIds = new Set(territories.map(t => t.id));

  for (const id of [...allIds].sort()) {
    const land = [...(adj.get(id) ?? new Set())].sort();
    const sea  = [...(seaAdj.get(id) ?? new Set())].sort();
    // Sea links that also appear as land (should not happen but guard anyway)
    const seaSet  = new Set(sea);
    const landOnly = land.filter(n => !seaSet.has(n));

    if (sea.length > 0) {
      adjacencyOutput[id] = { land: landOnly, sea };
    } else {
      adjacencyOutput[id] = landOnly;
    }
  }

  // Verify all 37 territories are present
  const missingIds = territories.map(t => t.id).filter(id => !(id in adjacencyOutput));
  if (missingIds.length > 0) warnings.push(`Missing from output: ${missingIds.join(', ')}`);

  const output = {
    adjacency: adjacencyOutput,
    handPlacementRequired,
    generatedAt: new Date().toISOString(),
    stats: {
      territoriesTotal:        territories.length,
      territoriesWithGeometry: geometries.size,
      territoriesHandPlaced:   handPlacementRequired.length,
      autoAdjacencyPairs:      pairsFound,
    },
  };

  await writeFile(OUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nWrote: ${OUT_FILE}`);

  // ── GeoJSON output for MapLibre ───────────────────────────────────────────────
  // Approximate bounding-box polygons for hand-placed territories (no NE polygon).
  const HAND_PLACED_BBOX = {
    colombia_orinoquia:    [[-75,3],  [-67,3],  [-67,8],  [-75,8],  [-75,3]],
    brazil_amazonia:       [[-73,-10],[-50,-10],[-50,5],  [-73,5],  [-73,-10]],
    brazil_nordeste:       [[-48,-18],[-35,-18],[-35,-2], [-48,-2], [-48,-18]],
    brazil_sul:            [[-57,-34],[-44,-34],[-44,-20],[-57,-20],[-57,-34]],
    peru_costa_sierra:     [[-82,-18],[-72,-18],[-72,-0], [-82,-0], [-82,-18]],
    peru_selva:            [[-76,-14],[-70,-14],[-70,-0], [-76,-0], [-76,-14]],
    argentina_pampa_norte: [[-68,-38],[-53,-38],[-53,-22],[-68,-22],[-68,-38]],
    argentina_patagonia:   [[-73,-55],[-62,-55],[-62,-38],[-73,-38],[-73,-55]],
  };

  const mapFeatures = [];
  const defsByIdMap = Object.fromEntries(territories.map(t => [t.id, t]));

  for (const terr of territories) {
    let geometry = null;
    if (geometries.has(terr.id)) {
      geometry = geometries.get(terr.id).geometry;
    } else if (HAND_PLACED_BBOX[terr.id]) {
      geometry = {
        type: 'Polygon',
        coordinates: [HAND_PLACED_BBOX[terr.id]],
      };
    }
    if (!geometry) continue;

    mapFeatures.push({
      type: 'Feature',
      id: terr.id,
      properties: {
        id:   terr.id,
        name: terr.name,
        culturalFamily: terr.culturalFamily,
        geographyType:  terr.geographyType,
      },
      geometry,
    });
  }

  const MAP_FILE = join(DATA, 'americas-map.geojson');
  const mapGeojson = { type: 'FeatureCollection', features: mapFeatures };
  await writeFile(MAP_FILE, JSON.stringify(mapGeojson));
  console.log(`Wrote: ${MAP_FILE} (${mapFeatures.length} features)`);

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log('\n═══ SUMMARY ═══════════════════════════════════════════════════════════');
  console.log(`Territories total:         ${territories.length}`);
  console.log(`Polygons built:            ${geometries.size}`);
  console.log(`Hand-placement required:   ${handPlacementRequired.length}`);
  if (handPlacementRequired.length) console.log(`  → ${handPlacementRequired.join(', ')}`);
  console.log(`Auto land adjacency pairs: ${pairsFound}`);

  if (warnings.length > 0) {
    console.log('\nWARNINGS:');
    for (const w of warnings) console.warn(`  ⚠  ${w}`);
  } else {
    console.log('\nNo warnings.');
  }

  console.log('\n═══ SPOT CHECK ═════════════════════════════════════════════════════════');
  for (const spot of ['costa_rica', 'brazil_amazonia', 'caribbean_west']) {
    const entry = adjacencyOutput[spot];
    if (!entry) { console.log(`  ${spot}: NOT FOUND`); continue; }
    if (Array.isArray(entry)) {
      console.log(`  ${spot}:\n    land=[${entry.join(', ')}]`);
    } else {
      const parts = [];
      if (entry.land?.length) parts.push(`land=[${entry.land.join(', ')}]`);
      if (entry.sea?.length)  parts.push(`sea=[${entry.sea.join(', ')}]`);
      console.log(`  ${spot}:\n    ${parts.join('\n    ')}`);
    }
  }

  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
