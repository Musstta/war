import { Prisma } from '@prisma/client';
import type { ActionContext, ActionHandler, ValidateResult } from './types';
import { ACTION_COSTS } from '../phase';
import { mirrorMilitaryAction } from '../council';
import { computeArmyPath } from '@war/engine';
import type { TerritoryDef, TerritoryState, CulturalFamily } from '@war/engine';

// [PLACEHOLDER] Mandate cost to move an army.
const COST = ACTION_COSTS['move_army']!;

interface MoveArmyPayload {
  armyId?: number;
  toTerritoryId?: string;
}

export const moveArmyHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as MoveArmyPayload;
    if (typeof p?.armyId !== 'number') return { ok: 'error', status: 400, reason: 'Missing armyId' };
    if (!p?.toTerritoryId) return { ok: 'error', status: 400, reason: 'Missing toTerritoryId' };

    const army = await ctx.prisma.army.findUnique({ where: { id: p.armyId } });
    if (!army) return { ok: 'error', status: 404, reason: 'Army not found' };
    if (army.nationId !== ctx.nationId) return { ok: 'error', status: 403, reason: 'Army does not belong to your nation' };
    if (army.movedThisTick) return { ok: 'error', status: 400, reason: 'Army already moved this tick' };
    if ((army as any).transitTicksRemaining > 0) {
      return { ok: 'error', status: 400, reason: 'Army is already in transit' };
    }

    const destDef = ctx.defById.get(p.toTerritoryId);
    if (!destDef) return { ok: 'error', status: 404, reason: 'Destination territory definition not found' };

    // Build adjacency map + minimal territory map for BFS path computation.
    const terrRows = await ctx.prisma.territoryState.findMany();
    const territories: Record<string, { def: TerritoryDef; state: TerritoryState }> = {};
    for (const row of terrRows) {
      const def = ctx.defById.get(row.id);
      if (!def) continue;
      territories[row.id] = {
        def: row.culturalFamily ? { ...def, culturalFamily: row.culturalFamily as CulturalFamily } : def,
        state: {
          ownerId: row.ownerId,
          fortificationLevel: row.fortificationLevel,
          hasRoad: row.hasRoad,
          hasPort: row.hasPort,
          unrest: row.unrest,
          isInRevolt: row.isInRevolt,
          valueTraits: { individualist: row.individualist, progressive: row.progressive, militaristic: row.militaristic, expansionist: row.expansionist },
          constructionType: (row.constructionType ?? null) as TerritoryState['constructionType'],
          constructionTicksLeft: row.constructionTicksLeft ?? null,
          pendingConstructionType: (row.pendingConstructionType ?? null) as TerritoryState['pendingConstructionType'],
          ownershipShock: row.ownershipShock,
          acquiredTick: row.acquiredTick ?? null,
          localPopStock: row.localPopStock,
          localIndStock: row.localIndStock,
          localWltStock: row.localWltStock,
          hasEmbassy: (row as any).hasEmbassy ?? false,
          populationTransferShockTicksLeft: (row as any).populationTransferShockTicksLeft ?? 0,
        },
      };
    }
    const adjacency: Record<string, readonly string[]> = Object.fromEntries(
      ctx.allDefs.map((d) => [d.id, d.adjacentIds]),
    );

    const pathResult = computeArmyPath(army.territoryId, p.toTerritoryId, territories, adjacency, []);
    if (!pathResult) {
      return { ok: 'error', status: 400, reason: 'No valid path to destination' };
    }

    // Military access check for each foreign-owned territory along the path (except origin and final dest).
    const allTerritoryOwners = Object.fromEntries(terrRows.map((r) => [r.id, r.ownerId]));
    const foreignTerrIds = pathResult.path.slice(1).filter((tid) => {
      const ownerId = allTerritoryOwners[tid];
      return ownerId && ownerId !== ctx.nationId;
    });

    for (const terrId of foreignTerrIds) {
      const terrOwnerId = allTerritoryOwners[terrId]!;
      const activeWar = await ctx.prisma.war.findFirst({
        where: {
          status: { in: ['active', 'peace_negotiation'] },
          OR: [
            { attackerId: ctx.nationId, defenderId: terrOwnerId },
            { attackerId: terrOwnerId, defenderId: ctx.nationId },
          ],
        },
      });
      if (!activeWar) {
        const accessTreaty = await ctx.prisma.treaty.findFirst({
          where: {
            status: { in: ['active'] },
            AND: [
              { parties: { some: { nationId: ctx.nationId } } },
              { parties: { some: { nationId: terrOwnerId } } },
            ],
          },
          include: { clauses: true },
        });
        const hasAccess = accessTreaty?.clauses.some(
          (c) => c.type === 'military_access' && c.clauseStatus === 'active',
        );
        if (!hasAccess) {
          return { ok: 'error', status: 400, reason: `Path passes through ${terrId} (owned by ${terrOwnerId}) — requires military_access clause` };
        }
      }
    }

    return { ok: 'ready', cost: COST, finalPayload: { armyId: p.armyId, toTerritoryId: p.toTerritoryId } };
  },

  async queue(ctx: ActionContext, cost: number, finalPayload: object): Promise<void> {
    const p = finalPayload as { armyId: number; toTerritoryId: string };
    await ctx.prisma.$transaction(async (tx) => {
      await tx.queuedAction.create({
        data: {
          nationId: ctx.nationId,
          phase: ctx.currentPhase,
          type: 'move_army',
          payload: p as Prisma.InputJsonValue,
          tickQueued: ctx.currentTick,
        },
      });
      if (cost > 0) {
        await tx.nation.update({ where: { id: ctx.nationId }, data: { mandateUsed: { increment: cost } } });
      }
      // Mirror into war council for allied visibility (destination territory).
      await mirrorMilitaryAction(tx, ctx.nationId, 'move_army', p.toTerritoryId, ctx.currentTick);
    });
  },
};
