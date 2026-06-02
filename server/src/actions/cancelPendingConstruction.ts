import { BUILD_INDUSTRY } from '@war/engine';
import type { ActionContext, ActionHandler, ValidateResult } from './types';
import { ACTION_COSTS, FORT_MANDATE_COSTS } from '../phase';

/**
 * Mandate refunded when a pending construction is cancelled.
 * Must stay in sync with costs charged in the deferred paths of each build handler.
 */
const PENDING_MANDATE_COST: Record<string, number> = {
  road:    ACTION_COSTS['build_road']!,
  port:    ACTION_COSTS['build_port']!,
  fort_l1: FORT_MANDATE_COSTS[1],
  fort_l2: FORT_MANDATE_COSTS[2],
  fort_l3: FORT_MANDATE_COSTS[3],
};

export const cancelPendingConstructionHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as { territoryId?: string };
    if (!p?.territoryId) return { ok: 'error', status: 400, reason: 'Missing territoryId' };

    const territory = await ctx.prisma.territoryState.findUnique({ where: { id: p.territoryId } });
    if (!territory) return { ok: 'error', status: 404, reason: 'Territory not found' };
    if (territory.ownerId !== ctx.nationId) return { ok: 'error', status: 403, reason: 'Not your territory' };
    if (!territory.pendingConstructionType) return { ok: 'error', status: 400, reason: 'No pending construction to cancel' };

    const pendingType = territory.pendingConstructionType;
    const mandateRefund = PENDING_MANDATE_COST[pendingType] ?? 0;
    const industryRefund = BUILD_INDUSTRY[pendingType] ?? 0;

    // cancel_pending_construction is immediate — no QueuedAction row is created.
    // Commit the refund here inside validate and return 'queued' to short-circuit the route.
    await ctx.prisma.$transaction([
      ctx.prisma.territoryState.update({ where: { id: p.territoryId }, data: { pendingConstructionType: null } }),
      ctx.prisma.nation.update({ where: { id: ctx.nationId }, data: {
        mandateUsed: { decrement: mandateRefund },
        indStock:    { increment: industryRefund },
      }}),
    ]);
    return { ok: 'queued' };
  },

  // queue() is never called for this handler (validate always returns 'queued' or 'error').
  async queue(_ctx: ActionContext, _cost: number, _finalPayload: object): Promise<void> {
    throw new Error('cancelPendingConstruction.queue() should never be called');
  },
};
