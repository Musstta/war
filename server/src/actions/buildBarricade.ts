import { Prisma } from '@prisma/client';
import type { ActionContext, ActionHandler, ValidateResult } from './types';
import { ACTION_COSTS } from '../phase';

// [PLACEHOLDER] Mandate cost to build a barricade.
const COST = ACTION_COSTS['build_barricade'] ?? 1;

export const buildBarricadeHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as { territoryId?: string };
    if (!p?.territoryId) return { ok: 'error', status: 400, reason: 'Missing territoryId' };

    const terrState = await ctx.prisma.territoryState.findUnique({ where: { id: p.territoryId } });
    if (!terrState) return { ok: 'error', status: 404, reason: 'Territory not found' };
    if (terrState.ownerId !== ctx.nationId) return { ok: 'error', status: 403, reason: 'Not owner of this territory' };

    return { ok: 'ready', cost: COST, finalPayload: { territoryId: p.territoryId } };
  },

  async queue(ctx: ActionContext, cost: number, finalPayload: object): Promise<void> {
    const p = finalPayload as { territoryId: string };
    await ctx.prisma.$transaction(async (tx) => {
      await tx.queuedAction.create({
        data: {
          nationId: ctx.nationId,
          phase: ctx.currentPhase,
          type: 'build_barricade',
          payload: p as Prisma.InputJsonValue,
          tickQueued: ctx.currentTick,
        },
      });
      if (cost > 0) {
        await tx.nation.update({ where: { id: ctx.nationId }, data: { mandateUsed: { increment: cost } } });
      }
    });
  },
};
