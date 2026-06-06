import { Prisma } from '@prisma/client';
import type { ActionContext, ActionHandler, ValidateResult } from './types';
import { ACTION_COSTS } from '../phase';

// §1.6 expel_embassy — costs 0 Mandate [PLACEHOLDER]
const COST = ACTION_COSTS['expel_embassy']!;

interface ExpelEmbassyPayload {
  embassyId?: number;
}

export const expelEmbassyHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as ExpelEmbassyPayload;
    if (typeof p?.embassyId !== 'number') return { ok: 'error', status: 400, reason: 'Missing embassyId' };

    const tx_any = ctx.prisma as any;
    const embassy = tx_any.embassy
      ? await tx_any.embassy.findUnique({ where: { id: p.embassyId } })
      : null;
    if (!embassy) return { ok: 'error', status: 404, reason: 'Embassy not found' };
    if (embassy.status !== 'active' && embassy.status !== 'under_construction') {
      return { ok: 'error', status: 400, reason: `Cannot expel embassy with status ${embassy.status}` };
    }

    // Validate: action nation must own the host territory.
    const terrState = await ctx.prisma.territoryState.findUnique({ where: { id: embassy.hostTerritoryId } });
    if (!terrState || terrState.ownerId !== ctx.nationId) {
      return { ok: 'error', status: 403, reason: 'Only the host territory owner may expel an embassy' };
    }

    return { ok: 'ready', cost: COST, finalPayload: { embassyId: p.embassyId } };
  },

  async queue(ctx: ActionContext, cost: number, finalPayload: object): Promise<void> {
    const p = finalPayload as { embassyId: number };

    await ctx.prisma.$transaction(async (tx) => {
      await (tx as Prisma.TransactionClient).queuedAction.create({
        data: {
          nationId: ctx.nationId,
          phase: ctx.currentPhase,
          type: 'expel_embassy',
          payload: p as Prisma.InputJsonValue,
          tickQueued: ctx.currentTick,
        },
      });
      if (cost > 0) {
        await (tx as Prisma.TransactionClient).nation.update({
          where: { id: ctx.nationId },
          data: { mandateUsed: { increment: cost } },
        });
      }
    });
  },
};
