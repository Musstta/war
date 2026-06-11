import { Prisma } from '@prisma/client';
import type { ActionContext, ActionHandler, ValidateResult } from './types';
import { ACTION_COSTS } from '../phase';

// [PLACEHOLDER] Mandate cost to claim a territory.
const COST = ACTION_COSTS['claim_territory']!;

interface ClaimTerritoryPayload {
  territoryId?: string;
}

export const claimTerritoryHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as ClaimTerritoryPayload;
    if (!p?.territoryId) return { ok: 'error', status: 400, reason: 'Missing territoryId' };

    const terr = await ctx.prisma.territoryState.findUnique({ where: { id: p.territoryId } });
    if (!terr) return { ok: 'error', status: 404, reason: 'Territory not found' };
    if (terr.ownerId !== null) return { ok: 'error', status: 400, reason: 'Territory is not unclaimed' };

    // Must be adjacent to at least one owned territory.
    const def = ctx.defById.get(p.territoryId);
    if (!def) return { ok: 'error', status: 404, reason: 'Territory definition not found' };

    const ownedTerritories = await ctx.prisma.territoryState.findMany({
      where: { ownerId: ctx.nationId },
      select: { id: true },
    });
    const ownedIds = new Set(ownedTerritories.map((t) => t.id));
    const isAdjacent = def.adjacentIds.some((adjId) => ownedIds.has(adjId));
    if (!isAdjacent) {
      return { ok: 'error', status: 400, reason: 'Territory not adjacent to any of your territories' };
    }

    // No duplicate pending claim from this nation.
    const existingClaim = await ctx.prisma.territoryClaim.findFirst({
      where: { nationId: ctx.nationId, territoryId: p.territoryId },
    });
    if (existingClaim) {
      return { ok: 'error', status: 400, reason: 'You already have a claim on this territory' };
    }

    return { ok: 'ready', cost: COST, finalPayload: { territoryId: p.territoryId } };
  },

  async queue(ctx: ActionContext, cost: number, finalPayload: object): Promise<void> {
    const p = finalPayload as { territoryId: string };
    await ctx.prisma.$transaction(async (tx) => {
      await tx.territoryClaim.create({
        data: {
          nationId: ctx.nationId,
          territoryId: p.territoryId,
          claimedAtTick: ctx.currentTick,
          pacificationProgress: 0,
        },
      });
      await tx.queuedAction.create({
        data: {
          nationId: ctx.nationId,
          phase: ctx.currentPhase,
          type: 'claim_territory',
          payload: p as Prisma.InputJsonValue,
          tickQueued: ctx.currentTick,
        },
      });
      await tx.nation.update({
        where: { id: ctx.nationId },
        data: { mandateUsed: { increment: cost } },
      });
      const nation = await tx.nation.findUniqueOrThrow({ where: { id: ctx.nationId } });
      const def = ctx.defById.get(p.territoryId);
      await tx.eventLog.create({
        data: {
          tick: ctx.currentTick,
          message: `${nation.name} has claimed ${def?.name ?? p.territoryId}.`,
        },
      });
    });
  },
};
