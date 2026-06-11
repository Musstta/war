import cron from 'node-cron';
import { Prisma } from '@prisma/client';
import { resolveTick } from '@war/engine';
import type { TerritoryDef, QueuedAction, ActionResult } from '@war/engine';
import { prisma } from './db';
import { loadWorldState, saveWorldState } from './world';
import { TICK_SCHEDULE } from './config';
import { ACTION_COSTS, FORT_MANDATE_COSTS } from './phase';
import { runCaretaker } from './caretaker';
import { runAiNations } from './ai';
import { createWarCouncils, addNationToDefenderCouncil } from './council';

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

      // ── Defense pact auto-defense ─────────────────────────────────────────────
      // For each declare_war action that applied this tick: check if the defender
      // has an active defense_pact with any third-party nation. If so, automatically
      // create a War row and queue a declare_war action on behalf of that ally.
      const appliedWarDeclarations = actionResults.filter(
        (r) => r.type === 'declare_war' && r.status === 'applied',
      );

      for (const decl of appliedWarDeclarations) {
        const p = decl.payload as { targetNationId?: string; warId?: number };
        const attackerId = decl.nationId;
        const defenderId = p.targetNationId;
        if (!defenderId) continue;

        // Find treaties where the defender is a party and a defense_pact clause is active.
        const defenderTreaties = await tx.treaty.findMany({
          where: {
            status: { in: ['active'] }, // degraded defense_pact → non_aggression; not triggered
            parties: { some: { nationId: defenderId } },
          },
          include: { parties: true, clauses: true },
        });

        for (const treaty of defenderTreaties) {
          const hasPact = treaty.clauses.some((c) => c.type === 'defense_pact' && c.clauseStatus === 'active');
          if (!hasPact) continue;

          // Find the third party (not the defender and not the attacker).
          const thirdPartyId = treaty.parties
            .map((p) => p.nationId)
            .find((id) => id !== defenderId && id !== attackerId);
          if (!thirdPartyId) continue;

          // Don't auto-declare if already at war with the attacker.
          const existingWar = await tx.war.findFirst({
            where: {
              status: { in: ['active', 'peace_negotiation'] },
              OR: [
                { attackerId: thirdPartyId, defenderId: attackerId },
                { attackerId: attackerId, defenderId: thirdPartyId },
              ],
            },
          });
          if (existingWar) continue;

          // Create the auto-war row.
          const autoWar = await tx.war.create({
            data: {
              attackerId: thirdPartyId,
              defenderId: attackerId,
              type: 'conquest',
              hasCasusBelli: true, // defending an ally is always justified
              status: 'active',
              startTick: newWorld.tick,
              declaredTick: newWorld.tick,
              occupiedTerritories: [] as Prisma.InputJsonValue,
              pendingPeaceDeal: Prisma.JsonNull,
              exhaustionByNation: {} as Prisma.InputJsonValue,
            },
          });

          // Add the defense pact ally to the original war's defender council.
          // The original war's council is the coordination layer for all co-defenders.
          const originalWarId = p.warId;
          if (originalWarId) {
            await addNationToDefenderCouncil(tx, originalWarId, thirdPartyId);
          }
          // Also create councils for the auto-war itself (thirdParty vs original attacker).
          await createWarCouncils(tx, autoWar.id, thirdPartyId, attackerId);

          // Queue the declare_war action for the third party (engine acknowledges next tick).
          await tx.queuedAction.create({
            data: {
              nationId: thirdPartyId,
              phase: 'main',
              type: 'declare_war',
              payload: { targetNationId: attackerId, warId: autoWar.id, autoDefense: true } as Prisma.InputJsonValue,
              tickQueued: newWorld.tick,
            },
          });

          const [thirdNation, defenderNation, attackerNation] = await Promise.all([
            tx.nation.findUnique({ where: { id: thirdPartyId }, select: { name: true } }),
            tx.nation.findUnique({ where: { id: defenderId }, select: { name: true } }),
            tx.nation.findUnique({ where: { id: attackerId }, select: { name: true } }),
          ]);
          await tx.eventLog.create({
            data: {
              tick: newWorld.tick,
              message: `${thirdNation?.name ?? thirdPartyId} honored their defense pact with ${defenderNation?.name ?? defenderId} — war declared on ${attackerNation?.name ?? attackerId}.`,
            },
          });
        }
      }

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

      // Clear per-tick council action mirrors — they're stale after resolution.
      await tx.councilQueuedAction.deleteMany();

      // Remove councils for wars that ended this tick (no further coordination needed).
      const endedWarIds = newWorld.wars
        .filter((w) => w.status === 'ended')
        .map((w) => w.id);
      if (endedWarIds.length > 0) {
        await tx.warCouncil.deleteMany({ where: { warId: { in: endedWarIds } } });
      }

      // ── Caretaker: tier transitions, caretaker AI queuing, abandoned fragmentation.
      // Runs after the tick's actions are cleared so caretaker queues start fresh.
      await runCaretaker(tx, newWorld.tick, defs);

      // ── AI nations: doctrine-driven action selection.
      // Runs after caretaker so both get a fresh mandate budget each tick.
      await runAiNations(tx, newWorld.tick, defs);

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
