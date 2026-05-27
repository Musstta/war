/**
 * Downloads Natural Earth 50m country + Mexico state boundaries and produces
 * web/public/territories.geojson with feature IDs matching territory seed data.
 *
 * Territories: guatemala, belize, honduras, el_salvador, nicaragua, costa_rica,
 *   panama, mexico_yucatan (merged from Yucatán + Campeche + Quintana Roo states).
 *
 * Run once: node scripts/make-geodata.mjs
 */

import { createWriteStream, existsSync } from 'fs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { get } from 'https';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE = join(__dirname, '.cache');
const OUT = join(ROOT, 'web', 'public', 'territories.geojson');

const COUNTRY_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const STATE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson';

// ISO A3 codes for Central American countries
const COUNTRY_MAP = {
  GTM: 'guatemala',
  BLZ: 'belize',
  HND: 'honduras',
  SLV: 'el_salvador',
  NIC: 'nicaragua',
  CRI: 'costa_rica',
  PAN: 'panama',
};

// Mexican state names that form the Yucatan Peninsula
const YUCATAN_STATES = new Set(['Yucatán', 'Campeche', 'Quintana Roo']);

async function download(url, dest) {
  if (existsSync(dest)) {
    console.log(`  cached: ${dest}`);
    return;
  }
  console.log(`  downloading: ${url}`);
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        download(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject);
  });
}

function mergePolygons(features) {
  // Collect all polygon rings into a MultiPolygon
  const polygons = [];
  for (const f of features) {
    const g = f.geometry;
    if (g.type === 'Polygon') {
      polygons.push(g.coordinates);
    } else if (g.type === 'MultiPolygon') {
      polygons.push(...g.coordinates);
    }
  }
  return { type: 'MultiPolygon', coordinates: polygons };
}

async function main() {
  await mkdir(CACHE, { recursive: true });

  const countryFile = join(CACHE, 'ne_50m_countries.geojson');
  const stateFile = join(CACHE, 'ne_50m_states.geojson');

  await download(COUNTRY_URL, countryFile);
  await download(STATE_URL, stateFile);

  console.log('Processing countries...');
  const countries = JSON.parse(await readFile(countryFile, 'utf8'));
  const states = JSON.parse(await readFile(stateFile, 'utf8'));

  const features = [];

  // Central American countries
  for (const f of countries.features) {
    const iso = f.properties?.ISO_A3 || f.properties?.ADM0_A3;
    const territoryId = COUNTRY_MAP[iso];
    if (!territoryId) continue;
    features.push({
      type: 'Feature',
      id: territoryId,
      properties: { id: territoryId, name: f.properties.NAME || f.properties.ADMIN },
      geometry: f.geometry,
    });
    console.log(`  added: ${territoryId} (${iso})`);
  }

  // Yucatan Peninsula — merge three Mexican states
  console.log('Processing Yucatan Peninsula...');
  const yucatanFeatures = states.features.filter((f) => {
    const name = f.properties?.name || f.properties?.NAME;
    const country = f.properties?.admin || f.properties?.ADM0_A3 || f.properties?.iso_a2;
    // Must be a Mexican state with the right name
    return (
      (country === 'Mexico' || country === 'MEX' || country === 'MX') &&
      YUCATAN_STATES.has(name)
    );
  });

  if (yucatanFeatures.length === 0) {
    console.warn('  WARNING: No Yucatan states found — check property names in state data');
    // Dump available Mexican state names for debugging
    const mexicanStates = states.features
      .filter((f) => {
        const c = f.properties?.admin || f.properties?.ADM0_A3 || f.properties?.iso_a2;
        return c === 'Mexico' || c === 'MEX' || c === 'MX';
      })
      .map((f) => f.properties?.name || f.properties?.NAME);
    console.warn('  Mexican states found:', mexicanStates.slice(0, 20));
  } else {
    console.log(`  found ${yucatanFeatures.length} Yucatan state(s):`,
      yucatanFeatures.map(f => f.properties?.name || f.properties?.NAME));
    features.push({
      type: 'Feature',
      id: 'mexico_yucatan',
      properties: { id: 'mexico_yucatan', name: 'Mexico (Yucatán & South)' },
      geometry: mergePolygons(yucatanFeatures),
    });
  }

  const geojson = { type: 'FeatureCollection', features };
  await writeFile(OUT, JSON.stringify(geojson, null, 2));
  console.log(`\nWrote ${features.length} features to ${OUT}`);

  const missing = ['guatemala','belize','honduras','el_salvador','nicaragua','costa_rica','panama','mexico_yucatan']
    .filter(id => !features.some(f => f.id === id));
  if (missing.length > 0) {
    console.warn('MISSING territories:', missing);
  } else {
    console.log('All 8 territories present.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
