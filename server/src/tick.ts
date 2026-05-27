import cron from 'node-cron';
import { resolveTick } from '@war/engine';
import type { TerritoryDef, QueuedAction, WorldState } from '@war/engine';
import type { QueuedAction as QueuedActionRow } from '@prisma/client';
import { prisma } from './db';
import { loadWorldState, saveWorldState } from './world';
import { TICK_SCHEDULE } from './config';
import { ACTION_COSTS } from './phase';

let tickInProgress = false;

// Compares pre- and post-tick world states to find actions the engine silently discarded.
// Returns a map of nationId → mandate units to refund.
// Add a block here for each new action type introduced in Phase 4+.
function computeRefunds(
  rows: QueuedActionRow[],
  before: WorldState,
  after: WorldState,
): Map<string, number> {
  const refunds = new Map<string, number>();

  // build_road: one road per territory per tick. Queue order determines which action
  // applied; all others are discarded.
  const roadsByTerritory = new Map<string, string[]>(); // territoryId → nationId[]
  for (const row of rows) {
    if (row.type !== 'build_road') continue;
    const tid = (row.payload as { territoryId: string }).territoryId;
    if (!roadsByTerritory.has(tid)) roadsByTerritory.set(tid, []);
    roadsByTerritory.get(tid)!.push(row.nationId);
  }

  for (const [tid, nationIds] of roadsByTerritory) {
    const builtThisTick =
      before.territories[tid]?.state.hasRoad === false &&
      after.territories[tid]?.state.hasRoad === true;
    // If built: first entry applied, rest discarded. If not built: all discarded.
    const discarded = builtThisTick ? nationIds.slice(1) : nationIds;
    const cost = ACTION_COSTS['build_road'] ?? 1;
    for (const nid of discarded) {
      refunds.set(nid, (refunds.get(nid) ?? 0) + cost);
    }
  }

  return refunds;
}

/**
 * Runs one full game tick inside a single database transaction.
 *
 * The transaction guarantees atomicity: if the process dies or any step throws,
 * Postgres rolls back to the state before the tick started — the tick counter
 * does not advance and queued actions are not cleared. (design doc §17)
 */
export async function runTick(defs: TerritoryDef[]): Promise<{ tick: number }> {
  if (tickInProgress) throw new Error('Tick already in progress — concurrent ticks are not allowed');
  tickInProgress = true;

  try {
    return await prisma.$transaction(async (tx) => {
      const world = await loadWorldState(tx, defs);

      const rows = await tx.queuedAction.findMany({ orderBy: { id: 'asc' } });
      const actions: QueuedAction[] = rows.map((r) => ({
        nationId: r.nationId,
        type: r.type,
        payload: r.payload,
      }));

      const newWorld = resolveTick(world, actions);

      // Safety-net refunds: credit back mandates for any action the engine discarded.
      // Fix A (queue-time validation) prevents this from firing in normal play.
      const refunds = computeRefunds(rows, world, newWorld);
      for (const [nid, amount] of refunds) {
        console.warn(`[tick] mandate refund: nation=${nid} amount=${amount} (action discarded at resolution)`);
        await tx.nation.update({ where: { id: nid }, data: { mandateUsed: { decrement: amount } } });
      }

      await saveWorldState(tx, newWorld);
      await tx.nation.updateMany({ data: { mandateUsed: 0 } }); // reset per-tick budget
      await tx.queuedAction.deleteMany(); // clear processed intents inside same tx

      return { tick: newWorld.tick };
    });
  } finally {
    tickInProgress = false;
  }
}

export function startScheduler(defs: TerritoryDef[]): void {
  cron.schedule(
    TICK_SCHEDULE,
    async () => {
      console.log(`[scheduler] Tick starting at ${new Date().toISOString()}`);
      try {
        const result = await runTick(defs);
        console.log(`[scheduler] Tick ${result.tick} complete`);
      } catch (err) {
        console.error('[scheduler] Tick failed:', err);
      }
    },
    { timezone: 'America/Costa_Rica' },
  );

  console.log(`[scheduler] Daily tick scheduled: "${TICK_SCHEDULE}" (America/Costa_Rica)`);
}
