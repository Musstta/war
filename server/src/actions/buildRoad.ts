import type { ActionContext, ActionHandler, ValidateResult } from './types';
import { ACTION_COSTS } from '../phase';

const COST = ACTION_COSTS['build_road']!;

export const buildRoadHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as { territoryId?: string };
    if (!p?.territoryId) return { ok: 'error', status: 400, reason: 'Missing territoryId' };

    const territory = await ctx.prisma.territoryState.findUnique({ where: { id: p.territoryId } });
    if (!territory) return { ok: 'error', status: 404, reason: 'Territory not found' };
    if (territory.ownerId !== ctx.nationId) return { ok: 'error', status: 403, reason: 'Not your territory' };
    if (territory.hasRoad) return { ok: 'error', status: 400, reason: 'Territory already has a road' };
    if (territory.pendingConstructionType !== null) return { ok: 'error', status: 400, reason: 'Next construction already queued' };

    if (territory.constructionType !== null) {
      // DEFERRED PATH: mandate pre-charged; road starts when current construction finishes.
      if (ctx.nation.mandateUsed + COST > ctx.myBudget) return { ok: 'error', status: 400, reason: 'Insufficient mandates' };
      await ctx.prisma.$transaction([
        ctx.prisma.territoryState.update({ where: { id: p.territoryId }, data: { pendingConstructionType: 'road' } }),
        ctx.prisma.nation.update({ where: { id: ctx.nationId }, data: { mandateUsed: { increment: COST } } }),
      ]);
      return { ok: 'queued' };
    }

    const alreadyQueued = await ctx.prisma.queuedAction.findFirst({
      where: { payload: { path: ['territoryId'], equals: p.territoryId } },
    });
    if (alreadyQueued) return { ok: 'error', status: 400, reason: 'A build is already queued for this territory this tick' };

    return { ok: 'ready', cost: COST, finalPayload: p as object };
  },

  async queue(ctx: ActionContext, cost: number, finalPayload: object): Promise<void> {
    await ctx.prisma.$transaction([
      ctx.prisma.queuedAction.create({
        data: { nationId: ctx.nationId, phase: ctx.currentPhase, type: 'build_road', payload: finalPayload, tickQueued: ctx.currentTick },
      }),
      ctx.prisma.nation.update({ where: { id: ctx.nationId }, data: { mandateUsed: { increment: cost } } }),
    ]);
  },
};
