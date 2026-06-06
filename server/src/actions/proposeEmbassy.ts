import { Prisma } from '@prisma/client';
import type { ActionContext, ActionHandler, ValidateResult } from './types';
import { ACTION_COSTS } from '../phase';

// §1.6 propose_embassy — costs 1 Mandate [PLACEHOLDER]
const COST = ACTION_COSTS['propose_embassy']!;

interface ProposeEmbassyPayload {
  targetNationId?: string;
  hostTerritoryId?: string;
}

export const proposeEmbassyHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as ProposeEmbassyPayload;
    if (!p?.targetNationId) return { ok: 'error', status: 400, reason: 'Missing targetNationId' };
    if (!p?.hostTerritoryId) return { ok: 'error', status: 400, reason: 'Missing hostTerritoryId' };

    // Target nation must exist.
    const targetNation = await ctx.prisma.nation.findUnique({ where: { id: p.targetNationId } });
    if (!targetNation) return { ok: 'error', status: 404, reason: 'Target nation not found' };

    // hostTerritoryId must be owned by the target nation.
    const terrState = await ctx.prisma.territoryState.findUnique({ where: { id: p.hostTerritoryId } });
    if (!terrState) return { ok: 'error', status: 404, reason: 'Host territory not found' };
    if (terrState.ownerId !== p.targetNationId) {
      return { ok: 'error', status: 400, reason: 'Host territory not owned by target nation' };
    }

    // No duplicate active/proposed/under_construction embassy from this owner in this territory.
    const tx_any = ctx.prisma as any;
    const existing = tx_any.embassy
      ? await tx_any.embassy.findFirst({
          where: {
            ownerNationId: ctx.nationId,
            hostTerritoryId: p.hostTerritoryId,
            status: { in: ['proposed', 'under_construction', 'active'] },
          },
        })
      : null;
    if (existing) {
      return { ok: 'error', status: 400, reason: 'An embassy already exists or is in progress for this territory' };
    }

    return { ok: 'ready', cost: COST, finalPayload: { targetNationId: p.targetNationId, hostTerritoryId: p.hostTerritoryId } };
  },

  async queue(ctx: ActionContext, cost: number, finalPayload: object): Promise<void> {
    const p = finalPayload as { targetNationId: string; hostTerritoryId: string };
    const tx_any = ctx.prisma as any;

    await ctx.prisma.$transaction(async (tx) => {
      // Create the Embassy row in 'proposed' status.
      if ((tx as any).embassy) {
        await (tx as any).embassy.create({
          data: {
            ownerNationId: ctx.nationId,
            hostTerritoryId: p.hostTerritoryId,
            status: 'proposed',
            constructionTicksLeft: 0,
            startedAtTick: ctx.currentTick,
          },
        });
      }

      // Queue the propose_embassy action (for engine pass-through + event log).
      await (tx as Prisma.TransactionClient).queuedAction.create({
        data: {
          nationId: ctx.nationId,
          phase: ctx.currentPhase,
          type: 'propose_embassy',
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

    void tx_any; // suppress unused warning
  },
};
