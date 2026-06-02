import type { ActionContext, ActionHandler, ValidateResult } from './types';

export const acceptInstantTradeHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as { tradeId?: number };
    if (typeof p?.tradeId !== 'number') return { ok: 'error', status: 400, reason: 'Missing tradeId' };

    const trade = await ctx.prisma.instantTrade.findUnique({ where: { id: p.tradeId } });
    if (!trade) return { ok: 'error', status: 404, reason: 'Instant trade not found' };
    if (trade.targetNationId !== ctx.nationId) return { ok: 'error', status: 403, reason: 'Not the target of this trade' };
    if (trade.status !== 'pending') return { ok: 'error', status: 400, reason: `Trade is already ${trade.status}` };

    return { ok: 'ready', cost: 0, finalPayload: p as object };
  },

  // Queue just writes the QueuedAction; the engine handles the actual transfer at tick time.
  async queue(ctx: ActionContext, _cost: number, finalPayload: object): Promise<void> {
    const p = finalPayload as { tradeId: number };
    await ctx.prisma.$transaction([
      ctx.prisma.queuedAction.create({
        data: { nationId: ctx.nationId, phase: ctx.currentPhase, type: 'accept_instant_trade', payload: p, tickQueued: ctx.currentTick },
      }),
    ]);
  },
};
