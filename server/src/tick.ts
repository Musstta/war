import cron from 'node-cron';
import { resolveTick } from '@war/engine';
import type { TerritoryDef, QueuedAction, ActionResult } from '@war/engine';
import { prisma } from './db';
import { loadWorldState, saveWorldState } from './world';
import { TICK_SCHEDULE } from './config';
import { ACTION_COSTS, FORT_MANDATE_COSTS } from './phase';

let tickInProgress = false;

// Maps an action result to the mandate cost that should be refunded if discarded.
function mandateCostFor(result: ActionResult): number {
  if (result.type === 'build_fort') {
    const { targetLevel } = result.payload as { targetLevel: 1 | 2 | 3 };
    return FORT_MANDATE_COSTS[targetLevel] ?? 0;
  }
  return ACTION_COSTS[result.type] ?? 0;
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

      const { world: newWorld, actionResults } = resolveTick(world, actions);

      // Refund mandates for any action the engine discarded.
      // Queue-time validation prevents this in normal play; this is the safety net.
      for (const result of actionResults) {
        if (result.status !== 'discarded') continue;
        const cost = mandateCostFor(result);
        if (cost === 0) continue;
        console.warn(`[tick] mandate refund: nation=${result.nationId} type=${result.type} amount=${cost} reason=${result.reason}`);
        await tx.nation.update({ where: { id: result.nationId }, data: { mandateUsed: { decrement: cost } } });
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
