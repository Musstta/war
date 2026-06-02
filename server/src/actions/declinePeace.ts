import { Prisma } from '@prisma/client';
import type { ActionContext, ActionHandler, ValidateResult } from './types';
import type { PeaceDeal } from '@war/engine';

// decline_peace costs 0 Mandate.
const COST = 0;

interface DeclinePeacePayload {
  warId?: number;
}

export const declinePeaceHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as DeclinePeacePayload;
    if (!p?.warId) return { ok: 'error', status: 400, reason: 'Missing warId' };

    const war = await ctx.prisma.war.findUnique({ where: { id: p.warId } });
    if (!war) return { ok: 'error', status: 404, reason: 'War not found' };

    if (war.attackerId !== ctx.nationId && war.defenderId !== ctx.nationId) {
      return { ok: 'error', status: 403, reason: 'You are not a belligerent in this war' };
    }
    if (war.status !== 'peace_negotiation') {
      return { ok: 'error', status: 400, reason: 'No peace proposal is currently pending for this war' };
    }

    const deal = war.pendingPeaceDeal as unknown as PeaceDeal | null;
    if (!deal) return { ok: 'error', status: 400, reason: 'No pending deal found' };

    // Only the NON-proposing party may decline.
    if (deal.proposingNationId === ctx.nationId) {
      return { ok: 'error', status: 400, reason: 'You proposed this deal — you cannot decline your own proposal' };
    }

    return { ok: 'ready', cost: COST, finalPayload: { warId: p.warId } };
  },

  async queue(ctx: ActionContext, _cost: number, finalPayload: object): Promise<void> {
    const p = finalPayload as { warId: number };
    await ctx.prisma.$transaction(async (tx) => {
      await tx.queuedAction.create({
        data: {
          nationId: ctx.nationId,
          phase: ctx.currentPhase,
          type: 'decline_peace',
          payload: p as Prisma.InputJsonValue,
          tickQueued: ctx.currentTick,
        },
      });
      // No mandateUsed increment — free action.
    });
  },
};
