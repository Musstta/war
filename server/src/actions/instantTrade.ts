import type { ActionContext, ActionHandler, ValidateResult } from './types';
import type { TradeResource } from '@war/engine';
import { ACTION_COSTS } from '../phase';

const COST = ACTION_COSTS['instant_trade']!;
const VALID_RESOURCES: TradeResource[] = ['population', 'industry', 'wealth'];

// The instant trade expires after the very next tick if not accepted.
export const INSTANT_TRADE_EXPIRY_TICKS = 1;

interface InstantTradePayload {
  resource?: string;
  amount?: number;
  sourceTerritoryId?: string;
  targetNationId?: string;
}

export const instantTradeHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as InstantTradePayload;
    if (!p.resource || !VALID_RESOURCES.includes(p.resource as TradeResource)) {
      return { ok: 'error', status: 400, reason: `resource must be one of: ${VALID_RESOURCES.join(', ')}` };
    }
    if (typeof p.amount !== 'number' || p.amount <= 0) {
      return { ok: 'error', status: 400, reason: 'amount must be a positive number' };
    }
    if (!p.sourceTerritoryId) return { ok: 'error', status: 400, reason: 'Missing sourceTerritoryId' };
    if (!p.targetNationId) return { ok: 'error', status: 400, reason: 'Missing targetNationId' };
    if (p.targetNationId === ctx.nationId) return { ok: 'error', status: 400, reason: 'Cannot trade with yourself' };

    const [territory, targetNation] = await Promise.all([
      ctx.prisma.territoryState.findUnique({ where: { id: p.sourceTerritoryId } }),
      ctx.prisma.nation.findUnique({ where: { id: p.targetNationId } }),
    ]);
    if (!territory) return { ok: 'error', status: 404, reason: 'Source territory not found' };
    if (territory.ownerId !== ctx.nationId) return { ok: 'error', status: 403, reason: 'Source territory not owned by you' };
    if (!targetNation) return { ok: 'error', status: 404, reason: 'Target nation not found' };

    // Check nation general stockpile — speculative deduction at queue time
    // (same pattern as construction industry pre-deduction).
    const genField = p.resource === 'population' ? 'popStock' : p.resource === 'industry' ? 'indStock' : 'wealthStock';
    const available = ctx.nation[genField as keyof typeof ctx.nation] as number;
    if (available < p.amount!) {
      return { ok: 'error', status: 400, reason: `Insufficient ${p.resource} stockpile (have ${(available as number).toFixed(1)}, need ${p.amount})` };
    }

    return { ok: 'ready', cost: COST, finalPayload: p as object };
  },

  async queue(ctx: ActionContext, cost: number, finalPayload: object): Promise<void> {
    const p = finalPayload as InstantTradePayload;
    const genField = p.resource === 'population' ? 'popStock' : p.resource === 'industry' ? 'indStock' : 'wealthStock';

    await ctx.prisma.$transaction([
      // Pre-deduct from proposer's nation general stockpile.
      ctx.prisma.nation.update({
        where: { id: ctx.nationId },
        data: {
          [genField]: { decrement: p.amount! },
          mandateUsed: { increment: cost },
        },
      }),
      // Create the pending instant trade record.
      ctx.prisma.instantTrade.create({
        data: {
          proposerNationId: ctx.nationId,
          targetNationId: p.targetNationId!,
          resource: p.resource!,
          amount: p.amount!,
          sourceTerritoryId: p.sourceTerritoryId!,
          status: 'pending',
          tickProposed: ctx.currentTick,
          expiresAtTick: ctx.currentTick + INSTANT_TRADE_EXPIRY_TICKS,
        },
      }),
    ]);
  },
};
