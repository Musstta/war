import { resolve } from 'path';
import { loadTerritoryDefs, buildWorldState, resolveTick } from '@war/engine';

const TICKS = parseInt(process.argv[2] ?? '30', 10);
const DATA_FILE = process.argv[3] ?? resolve(__dirname, '../data/territories.seed.json');
const SEED = 42;

const defs = loadTerritoryDefs(DATA_FILE);
console.log(`Loaded ${defs.length} territories from ${DATA_FILE}`);

let world = buildWorldState(
  defs,
  [
    {
      id: 'nation_a',
      name: 'República A',
      isAI: false,
      startingTerritoryIds: ['costa_rica', 'panama'],
      armySize: 100,
    },
    {
      id: 'nation_b',
      name: 'Imperio B',
      isAI: true,
      startingTerritoryIds: ['guatemala', 'belize', 'honduras'],
      armySize: 200,
    },
  ],
  SEED,
);

const unclaimed = Object.values(world.territories)
  .filter((t) => t.state.ownerId === null)
  .map((t) => t.def.name)
  .join(', ');

console.log(`Unclaimed territories: ${unclaimed}`);
console.log(`\nRunning ${TICKS} ticks...\n`);

const header = 'Tick |   Pop    Ind   Wealth  (A)  |   Pop    Ind   Wealth  (B)';
const sep = '─'.repeat(header.length);
console.log(header);
console.log(sep);

const fmt = (n: number, w: number) => n.toFixed(1).padStart(w);

for (let i = 0; i < TICKS; i++) {
  world = resolveTick(world, []);
  const a = world.nations['nation_a'].stockpiles;
  const b = world.nations['nation_b'].stockpiles;
  console.log(
    `  ${String(world.tick).padStart(3)} |` +
    `  ${fmt(a.population, 6)}  ${fmt(a.industry, 6)}  ${fmt(a.wealth, 8)}  |` +
    `  ${fmt(b.population, 6)}  ${fmt(b.industry, 6)}  ${fmt(b.wealth, 8)}`,
  );
}

console.log(sep);
console.log('Done. All stockpile values are placeholder-number outputs — tune via simulation.');
