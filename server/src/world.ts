import { Prisma } from '@prisma/client';
import type { TerritoryDef, Territory, Nation, WorldState } from '@war/engine';
import { prisma } from './db';

type TxClient = Prisma.TransactionClient;

// ── Loading ───────────────────────────────────────────────────────────────────

export async function loadWorldState(
  tx: TxClient,
  defs: TerritoryDef[],
): Promise<WorldState> {
  const meta = await tx.worldMeta.findUniqueOrThrow({ where: { id: 1 } });
  const nationRows = await tx.nation.findMany();
  const stateRows = await tx.territoryState.findMany();

  const stateById = new Map(stateRows.map((s) => [s.id, s]));

  const territories: Record<string, Territory> = {};
  for (const def of defs) {
    const s = stateById.get(def.id);
    if (!s) throw new Error(`No DB state row for territory "${def.id}"`);
    territories[def.id] = {
      def,
      state: {
        ownerId: s.ownerId,
        fortificationLevel: s.fortificationLevel,
        hasRoad: s.hasRoad,
        hasPort: s.hasPort,
        unrest: s.unrest,
        valueTraits: {
          individualist: s.individualist,
          progressive: s.progressive,
          militaristic: s.militaristic,
          expansionist: s.expansionist,
        },
      },
    };
  }

  const nations: Record<string, Nation> = {};
  for (const n of nationRows) {
    nations[n.id] = {
      id: n.id,
      name: n.name,
      isAI: n.isAI,
      stockpiles: {
        population: n.popStock,
        industry: n.indStock,
        wealth: n.wealthStock,
      },
      armySize: n.armySize,
      trust: n.trust,
      prestige: n.prestige,
    };
  }

  // Event log is write-only from the engine's perspective; we don't need to load
  // history — resolveTick emits only the new entries for the current tick.
  return { tick: meta.tick, rngSeed: meta.rngSeed, territories, nations, eventLog: [] };
}

// ── Saving ────────────────────────────────────────────────────────────────────

export async function saveWorldState(tx: TxClient, world: WorldState): Promise<void> {
  await tx.worldMeta.update({ where: { id: 1 }, data: { tick: world.tick } });

  for (const nation of Object.values(world.nations)) {
    await tx.nation.update({
      where: { id: nation.id },
      data: {
        popStock: nation.stockpiles.population,
        indStock: nation.stockpiles.industry,
        wealthStock: nation.stockpiles.wealth,
        armySize: nation.armySize,
        trust: nation.trust,
        prestige: nation.prestige,
      },
    });
  }

  for (const [id, { state }] of Object.entries(world.territories)) {
    await tx.territoryState.update({
      where: { id },
      data: {
        ownerId: state.ownerId,
        fortificationLevel: state.fortificationLevel,
        hasRoad: state.hasRoad,
        hasPort: state.hasPort,
        unrest: state.unrest,
        individualist: state.valueTraits.individualist,
        progressive: state.valueTraits.progressive,
        militaristic: state.valueTraits.militaristic,
        expansionist: state.valueTraits.expansionist,
      },
    });
  }

  if (world.eventLog.length > 0) {
    await tx.eventLog.createMany({ data: world.eventLog });
  }
}

// ── First-run initialization ──────────────────────────────────────────────────
// Phase 3: 5 player nations, each starting with 1 home territory.
// Unclaimed at start: mexico_yucatan, belize, el_salvador.
// To reset an existing world run POST /admin/reset-world (requires X-Admin-Key).

const INITIAL_NATIONS = [
  { id: 'nation_costa_rica', name: 'Costa Rica',  isAI: false, armySize: 50, territories: ['costa_rica'] },
  { id: 'nation_guatemala',  name: 'Guatemala',   isAI: false, armySize: 50, territories: ['guatemala'] },
  { id: 'nation_honduras',   name: 'Honduras',    isAI: false, armySize: 50, territories: ['honduras'] },
  { id: 'nation_nicaragua',  name: 'Nicaragua',   isAI: false, armySize: 50, territories: ['nicaragua'] },
  { id: 'nation_panama',     name: 'Panamá',      isAI: false, armySize: 50, territories: ['panama'] },
] as const;

export async function ensureWorldInitialized(defs: TerritoryDef[]): Promise<void> {
  const existing = await prisma.worldMeta.findUnique({ where: { id: 1 } });
  if (existing) return;

  console.log('[world] First run — initializing world state...');

  await prisma.$transaction(async (tx) => {
    await tx.worldMeta.create({ data: { id: 1, tick: 0, rngSeed: 42 } });

    const ownerOf = new Map<string, string>();
    for (const n of INITIAL_NATIONS) {
      await tx.nation.create({
        data: { id: n.id, name: n.name, isAI: n.isAI, armySize: n.armySize },
      });
      for (const tid of n.territories) ownerOf.set(tid, n.id);
    }

    for (const def of defs) {
      await tx.territoryState.create({
        data: {
          id: def.id,
          ownerId: ownerOf.get(def.id) ?? null,
          individualist: def.valueTraits.individualist,
          progressive: def.valueTraits.progressive,
          militaristic: def.valueTraits.militaristic,
          expansionist: def.valueTraits.expansionist,
        },
      });
    }
  });

  console.log('[world] World initialized at tick 0.');
}
