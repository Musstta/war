/**
 * Per-game tick scheduler (v0.36 + v0.37).
 *
 * Active games: setTimeout chain via scheduleGameTick.
 * Territory-selection games: single deadline timer via scheduleSelectionDeadline.
 * On server restart: resumeActiveGames re-arms both.
 */

import type { TerritoryDef } from '@war/engine';
import { resolveTick } from '@war/engine';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { loadWorldState, saveWorldState } from './world';
import { ACTION_COSTS, FORT_MANDATE_COSTS } from './phase';
import { runCaretaker } from './caretaker';
import { runAiNations } from './ai';
import { createWarCouncils, addNationToDefenderCouncil } from './council';
import { computeDominantNations, computePrestige, PRESTIGE_PER_TRADE_CAPACITY } from '@war/engine';
import type { ActionResult } from '@war/engine';

// ── State ─────────────────────────────────────────────────────────────────────

const gameTimers = new Map<string, ReturnType<typeof setTimeout>>();
const tickInProgress = new Set<string>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function mandateCostFor(result: ActionResult): number {
  if (result.type === 'build_fort') {
    const { targetLevel } = result.payload as { targetLevel: 1 | 2 | 3 };
    return FORT_MANDATE_COSTS[targetLevel] ?? 0;
  }
  return ACTION_COSTS[result.type] ?? 0;
}

// ── Core tick runner (scoped to one game) ─────────────────────────────────────

export async function runGameTick(gameId: string, defs: TerritoryDef[]): Promise<{ tick: number }> {
  if (tickInProgress.has(gameId)) {
    throw new Error(`Tick already in progress for game ${gameId}`);
  }
  tickInProgress.add(gameId);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Load world state scoped to this game.
      const world = await loadWorldState(tx, defs, gameId);

      const rows = await tx.queuedAction.findMany({
        where: { gameId },
        orderBy: { id: 'asc' },
      });
      const actions = rows.map((r) => ({
        nationId: r.nationId,
        type: r.type,
        payload: r.payload,
      }));

      const { world: newWorld, actionResults } = resolveTick(world, actions as any);

      // ── Defense pact auto-defense ─────────────────────────────────────────
      const appliedWarDeclarations = actionResults.filter(
        (r) => r.type === 'declare_war' && r.status === 'applied',
      );

      for (const decl of appliedWarDeclarations) {
        const p = decl.payload as { targetNationId?: string; warId?: number };
        const attackerId = decl.nationId;
        const defenderId = p.targetNationId;
        if (!defenderId) continue;

        const defenderTreaties = await tx.treaty.findMany({
          where: {
            status: { in: ['active'] },
            parties: { some: { nationId: defenderId } },
          },
          include: { parties: true, clauses: true },
        });

        for (const treaty of defenderTreaties) {
          const hasPact = treaty.clauses.some((c) => c.type === 'defense_pact' && c.clauseStatus === 'active');
          if (!hasPact) continue;

          const thirdPartyId = treaty.parties
            .map((p2) => p2.nationId)
            .find((id) => id !== defenderId && id !== attackerId);
          if (!thirdPartyId) continue;

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

          const autoWar = await tx.war.create({
            data: {
              gameId,
              attackerId: thirdPartyId,
              defenderId: attackerId,
              type: 'conquest',
              hasCasusBelli: true,
              status: 'active',
              startTick: newWorld.tick,
              declaredTick: newWorld.tick,
              occupiedTerritories: [] as Prisma.InputJsonValue,
              pendingPeaceDeal: Prisma.JsonNull,
              exhaustionByNation: {} as Prisma.InputJsonValue,
            },
          });

          const originalWarId = p.warId;
          if (originalWarId) {
            await addNationToDefenderCouncil(tx, originalWarId, thirdPartyId);
          }
          await createWarCouncils(tx, autoWar.id, thirdPartyId, attackerId);

          await tx.queuedAction.create({
            data: {
              gameId,
              nationId: thirdPartyId,
              phase: 'main',
              type: 'declare_war',
              payload: { targetNationId: attackerId, warId: autoWar.id, autoDefense: true } as Prisma.InputJsonValue,
              tickQueued: newWorld.tick,
            },
          });

          const [thirdNation, defenderNation, attackerNation] = await Promise.all([
            tx.nation.findFirst({ where: { id: thirdPartyId, gameId }, select: { name: true } }),
            tx.nation.findFirst({ where: { id: defenderId, gameId }, select: { name: true } }),
            tx.nation.findFirst({ where: { id: attackerId, gameId }, select: { name: true } }),
          ]);
          await tx.eventLog.create({
            data: {
              gameId,
              tick: newWorld.tick,
              message: `${thirdNation?.name ?? thirdPartyId} honored their defense pact with ${defenderNation?.name ?? defenderId} — war declared on ${attackerNation?.name ?? attackerId}.`,
            },
          });
        }
      }

      // Refund mandates for discarded actions.
      for (const r of actionResults) {
        if (r.status !== 'discarded') continue;
        const cost = mandateCostFor(r);
        if (cost === 0) continue;
        await tx.nation.updateMany({
          where: { id: r.nationId, gameId },
          data: { mandateUsed: { decrement: cost } },
        });
      }

      await saveWorldState(tx, newWorld, gameId);
      await tx.nation.updateMany({ where: { gameId }, data: { mandateUsed: 0 } });
      await tx.queuedAction.deleteMany({ where: { gameId } });
      await (tx as any).councilQueuedAction?.deleteMany?.({
        where: { council: { gameId } },
      });

      const endedWarIds = newWorld.wars.filter((w) => w.status === 'ended').map((w) => w.id);
      if (endedWarIds.length > 0) {
        await tx.warCouncil.deleteMany({ where: { warId: { in: endedWarIds } } });
      }

      await runCaretaker(tx, newWorld.tick, defs);
      await runAiNations(tx, newWorld.tick, defs);

      // Update lastTickAt on Game row.
      await tx.game.update({ where: { id: gameId }, data: { lastTickAt: new Date() } });

      // Clear fast-forward votes for this tick.
      await (tx as any).fastForwardVote?.deleteMany?.({ where: { gameId } });

      return { tick: newWorld.tick, nations: newWorld.nations };
    });

    // ── Win condition check (outside transaction — read-only) ─────────────────
    await checkWinCondition(gameId, result.tick);

    return { tick: result.tick };
  } finally {
    tickInProgress.delete(gameId);
  }
}

// ── Win condition ─────────────────────────────────────────────────────────────

async function checkWinCondition(gameId: string, tick: number): Promise<void> {
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game || game.status !== 'active') return;

  const nations = await prisma.nation.findMany({ where: { gameId }, select: { id: true, prestige: true } });
  const prestigeByNation = new Map(nations.map((n) => [n.id, n.prestige]));
  const dominant = computeDominantNations(prestigeByNation);

  if (dominant.size > 0) {
    await prisma.game.update({
      where: { id: gameId },
      data: { status: 'ended', endedAt: new Date(), endReason: 'win_condition' },
    });
    deregisterGame(gameId);
    console.log(`[scheduler] Game ${gameId} ended at tick ${tick}: win condition met (${[...dominant].join(', ')})`);
  }
}

// ── Scheduling ────────────────────────────────────────────────────────────────

export function scheduleGameTick(gameId: string, defs: TerritoryDef[], delayMs: number): void {
  // Cancel any existing timer for this game.
  deregisterGame(gameId);

  const timer = setTimeout(async () => {
    gameTimers.delete(gameId);
    console.log(`[scheduler] Game ${gameId} tick starting...`);
    try {
      const result = await runGameTick(gameId, defs);
      console.log(`[scheduler] Game ${gameId} tick ${result.tick} complete`);

      // Re-arm if game is still active.
      const game = await prisma.game.findUnique({ where: { id: gameId }, select: { status: true, tickIntervalSeconds: true } });
      if (game?.status === 'active') {
        scheduleGameTick(gameId, defs, game.tickIntervalSeconds * 1000);
      }
    } catch (err) {
      console.error(`[scheduler] Game ${gameId} tick failed:`, err);
      // Re-arm anyway so a transient error doesn't permanently kill the scheduler.
      const game = await prisma.game.findUnique({ where: { id: gameId }, select: { status: true, tickIntervalSeconds: true } });
      if (game?.status === 'active') {
        scheduleGameTick(gameId, defs, game.tickIntervalSeconds * 1000);
      }
    }
  }, delayMs);

  gameTimers.set(gameId, timer);
}

export function deregisterGame(gameId: string): void {
  const existing = gameTimers.get(gameId);
  if (existing !== undefined) {
    clearTimeout(existing);
    gameTimers.delete(gameId);
  }
}

export function isGameScheduled(gameId: string): boolean {
  return gameTimers.has(gameId);
}

// ── Territory selection deadline ──────────────────────────────────────────────

/**
 * Arm the AFK deadline for a game in territory_selection.
 * When it fires: calls autoAssignUnconfirmed (from territorySelection.ts), which
 * auto-confirms all unconfirmed players then transitions to active.
 * Uses the same gameTimers map so deregisterGame cancels it too.
 */
export function scheduleSelectionDeadline(gameId: string, defs: TerritoryDef[], delayMs: number): void {
  deregisterGame(gameId);

  const timer = setTimeout(async () => {
    gameTimers.delete(gameId);
    console.log(`[scheduler] Game ${gameId} territory-selection deadline fired — auto-assigning unconfirmed`);
    try {
      // Lazy import to avoid circular dependency (territorySelection imports world + scheduler).
      const { autoAssignUnconfirmed } = await import('./territorySelection');
      await autoAssignUnconfirmed(gameId, defs);
    } catch (err) {
      console.error(`[scheduler] Game ${gameId} auto-assign failed:`, err);
    }
  }, delayMs);

  gameTimers.set(gameId, timer);
}

// ── Resume on server restart ──────────────────────────────────────────────────

export async function resumeActiveGames(defs: TerritoryDef[]): Promise<void> {
  const games = await prisma.game.findMany({
    where: { status: { in: ['active', 'territory_selection'] }, id: { not: 'legacy-world' } },
  });

  let activeCount = 0;
  let selectionCount = 0;

  for (const game of games) {
    const intervalMs = game.tickIntervalSeconds * 1000;
    const elapsed = game.lastTickAt ? Date.now() - game.lastTickAt.getTime() : intervalMs;
    const remaining = Math.max(0, intervalMs - elapsed);

    if (game.status === 'active') {
      scheduleGameTick(game.id, defs, remaining);
      console.log(`[scheduler] Resumed active game ${game.id} — next tick in ${Math.round(remaining / 1000)}s`);
      activeCount++;
    } else {
      // territory_selection: re-arm the AFK deadline
      scheduleSelectionDeadline(game.id, defs, remaining);
      console.log(`[scheduler] Resumed territory-selection game ${game.id} — deadline in ${Math.round(remaining / 1000)}s`);
      selectionCount++;
    }
  }

  if (activeCount + selectionCount > 0) {
    console.log(`[scheduler] Resumed ${activeCount} active, ${selectionCount} territory-selection game(s)`);
  }
}
