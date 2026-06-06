import { Prisma } from '@prisma/client';
import type { ActionContext, ActionHandler, ValidateResult } from './types';
import { ACTION_COSTS } from '../phase';

// §1.6 build_embassy — costs 1 Mandate [PLACEHOLDER]
const COST = ACTION_COSTS['build_embassy']!;

interface BuildEmbassyPayload {
  embassyId?: number;
}

export const buildEmbassyHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as BuildEmbassyPayload;
    if (typeof p?.embassyId !== 'number') return { ok: 'error', status: 400, reason: 'Missing embassyId' };

    const tx_any = ctx.prisma as any;
    const embassy = tx_any.embassy
      ? await tx_any.embassy.findUnique({ where: { id: p.embassyId } })
      : null;
    if (!embassy) return { ok: 'error', status: 404, reason: 'Embassy not found' };
    if (embassy.ownerNationId !== ctx.nationId) return { ok: 'error', status: 403, reason: 'Embassy does not belong to your nation' };
    if (embassy.status !== 'proposed') return { ok: 'error', status: 400, reason: `Embassy is already ${embassy.status}` };

    // Max one embassy per bilateral pair per host territory — already enforced at propose time.
    // Double-check no active embassy from this owner in this territory from a different embassy row.
    const duplicate = tx_any.embassy
      ? await tx_any.embassy.findFirst({
          where: {
            ownerNationId: ctx.nationId,
            hostTerritoryId: embassy.hostTerritoryId,
            status: { in: ['under_construction', 'active'] },
          },
        })
      : null;
    if (duplicate) {
      return { ok: 'error', status: 400, reason: 'Already have an active or under-construction embassy in this territory' };
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
          type: 'build_embassy',
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
