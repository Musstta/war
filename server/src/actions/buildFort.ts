import { BUILD_INDUSTRY } from '@war/engine';
import type { ActionContext, ActionHandler, ValidateResult } from './types';
import { FORT_MANDATE_COSTS } from '../phase';

export const buildFortHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as { territoryId?: string };
    if (!p?.territoryId) return { ok: 'error', status: 400, reason: 'Missing territoryId' };

    const territory = await ctx.prisma.territoryState.findUnique({ where: { id: p.territoryId } });
    if (!territory) return { ok: 'error', status: 404, reason: 'Territory not found' };
    if (territory.ownerId !== ctx.nationId) return { ok: 'error', status: 403, reason: 'Not your territory' };
    if (territory.fortificationLevel >= 3) return { ok: 'error', status: 400, reason: 'Fortification already at maximum level' };
    if (territory.pendingConstructionType !== null) return { ok: 'error', status: 400, reason: 'Next construction already queued' };

    const targetLevel = (territory.fortificationLevel + 1) as 1 | 2 | 3;
    const constructionType = `fort_l${targetLevel}` as const;
    const cost = FORT_MANDATE_COSTS[targetLevel];
    const indCost = BUILD_INDUSTRY[constructionType]!;

    if (ctx.nation.indStock < indCost) return { ok: 'error', status: 400, reason: 'Insufficient industry stockpile' };

    const finalPayload = { territoryId: p.territoryId, targetLevel };

    if (territory.constructionType !== null) {
      // DEFERRED PATH: mandate + industry pre-charged; fort starts when current construction finishes.
      if (ctx.nation.mandateUsed + cost > ctx.myBudget) return { ok: 'error', status: 400, reason: 'Insufficient mandates' };
      await ctx.prisma.$transaction([
        ctx.prisma.territoryState.update({ where: { id: p.territoryId }, data: { pendingConstructionType: constructionType } }),
        ctx.prisma.nation.update({ where: { id: ctx.nationId }, data: { mandateUsed: { increment: cost }, indStock: { decrement: indCost } } }),
      ]);
      return { ok: 'queued' };
    }

    const alreadyQueued = await ctx.prisma.queuedAction.findFirst({
      where: { payload: { path: ['territoryId'], equals: p.territoryId } },
    });
    if (alreadyQueued) return { ok: 'error', status: 400, reason: 'A build is already queued for this territory this tick' };

    return { ok: 'ready', cost, finalPayload };
  },

  async queue(ctx: ActionContext, cost: number, finalPayload: object): Promise<void> {
    await ctx.prisma.$transaction([
      ctx.prisma.queuedAction.create({
        data: { nationId: ctx.nationId, phase: ctx.currentPhase, type: 'build_fort', payload: finalPayload, tickQueued: ctx.currentTick },
      }),
      ctx.prisma.nation.update({ where: { id: ctx.nationId }, data: { mandateUsed: { increment: cost } } }),
    ]);
  },
};
