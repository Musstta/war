import { Prisma } from '@prisma/client';
import type { ActionContext, ActionHandler, ValidateResult } from './types';
import { ACTION_COSTS } from '../phase';

const COST = ACTION_COSTS['retreat_army']!; // 0 — retreat is free

interface RetreatArmyPayload {
  fromTerritoryId?: string;
  toTerritoryId?: string;
}

export const retreatArmyHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as RetreatArmyPayload;
    if (!p?.fromTerritoryId) return { ok: 'error', status: 400, reason: 'Missing fromTerritoryId' };
    if (!p?.toTerritoryId) return { ok: 'error', status: 400, reason: 'Missing toTerritoryId' };
    if (p.fromTerritoryId === p.toTerritoryId) return { ok: 'error', status: 400, reason: 'from and to must be different' };

    // toTerritoryId must be owned by the retreating nation.
    const toTerritory = await ctx.prisma.territoryState.findUnique({ where: { id: p.toTerritoryId } });
    if (!toTerritory) return { ok: 'error', status: 404, reason: 'Destination territory not found' };
    if (toTerritory.ownerId !== ctx.nationId) return { ok: 'error', status: 400, reason: 'Destination must be owned by your nation' };

    // toTerritoryId must be adjacent to fromTerritoryId.
    const fromDef = ctx.defById.get(p.fromTerritoryId);
    if (!fromDef) return { ok: 'error', status: 404, reason: 'Source territory definition not found' };
    if (!fromDef.adjacentIds.includes(p.toTerritoryId)) {
      return { ok: 'error', status: 400, reason: 'Destination must be adjacent to source territory' };
    }

    return { ok: 'ready', cost: COST, finalPayload: p as object };
  },

  async queue(ctx: ActionContext, _cost: number, finalPayload: object): Promise<void> {
    const p = finalPayload as RetreatArmyPayload;
    await ctx.prisma.$transaction(async (tx) => {
      await tx.queuedAction.create({
        data: {
          nationId: ctx.nationId,
          phase: ctx.currentPhase,
          type: 'retreat_army',
          payload: p as Prisma.InputJsonValue,
          tickQueued: ctx.currentTick,
        },
      });
      // Retreat costs 0 Mandate — no mandateUsed increment.
    });
  },
};
