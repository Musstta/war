import { Prisma } from '@prisma/client';
import type { ActionContext, ActionHandler, ValidateResult } from './types';
import { ACTION_COSTS } from '../phase';
import type { PeaceDeal, PeaceDealType, Territorycessation } from '@war/engine';

const COST = ACTION_COSTS['propose_peace']!;

interface TerritoryCession {
  territoryId: string;
  fromNationId: string;
  toNationId: string;
}

interface ProposePeacePayload {
  warId?: number;
  terms?: {
    territoryCessions?: TerritoryCession[];
    tributeWealth?: number;
    tributeTicks?: number;
    warType?: PeaceDealType;
  };
}

export const proposePeaceHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as ProposePeacePayload;
    if (!p?.warId) return { ok: 'error', status: 400, reason: 'Missing warId' };
    if (!p.terms) return { ok: 'error', status: 400, reason: 'Missing terms' };
    if (!p.terms.warType) return { ok: 'error', status: 400, reason: 'Missing terms.warType' };

    const war = await ctx.prisma.war.findUnique({ where: { id: p.warId } });
    if (!war) return { ok: 'error', status: 404, reason: 'War not found' };

    // Must be a belligerent.
    if (war.attackerId !== ctx.nationId && war.defenderId !== ctx.nationId) {
      return { ok: 'error', status: 403, reason: 'You are not a belligerent in this war' };
    }

    // War must be active (not already ended, not already in peace_negotiation).
    if (war.status === 'ended') return { ok: 'error', status: 400, reason: 'War has already ended' };
    if (war.status === 'peace_negotiation') {
      return { ok: 'error', status: 400, reason: 'A peace proposal is already pending — wait for response or lapse' };
    }

    // Raid war: no territory cessions allowed.
    const cessions = p.terms.territoryCessions ?? [];
    if (war.type === 'raid' && cessions.length > 0) {
      return { ok: 'error', status: 400, reason: 'Raid wars may not include territory cessions' };
    }

    // Validate each cession territory exists and belongs to one of the belligerents.
    for (const c of cessions) {
      const terr = await ctx.prisma.territoryState.findUnique({ where: { id: c.territoryId } });
      if (!terr) return { ok: 'error', status: 404, reason: `Territory ${c.territoryId} not found` };
      if (c.fromNationId !== war.attackerId && c.fromNationId !== war.defenderId) {
        return { ok: 'error', status: 400, reason: `Cession fromNationId ${c.fromNationId} is not a belligerent` };
      }
      if (c.toNationId !== war.attackerId && c.toNationId !== war.defenderId) {
        return { ok: 'error', status: 400, reason: `Cession toNationId ${c.toNationId} is not a belligerent` };
      }
    }

    const tributeWealth = p.terms.tributeWealth ?? 0;
    const tributeTicks = p.terms.tributeTicks ?? 0;
    if (tributeWealth < 0) return { ok: 'error', status: 400, reason: 'tributeWealth must be >= 0' };
    if (tributeTicks < 0) return { ok: 'error', status: 400, reason: 'tributeTicks must be >= 0' };

    return {
      ok: 'ready',
      cost: COST,
      finalPayload: {
        warId: p.warId,
        terms: {
          warType: p.terms.warType,
          territoryCessions: cessions,
          tributeWealth,
          tributeTicks,
        },
      },
    };
  },

  async queue(ctx: ActionContext, cost: number, finalPayload: object): Promise<void> {
    const p = finalPayload as {
      warId: number;
      terms: {
        warType: PeaceDealType;
        territoryCessions: Territorycessation[];
        tributeWealth: number;
        tributeTicks: number;
      };
    };

    await ctx.prisma.$transaction(async (tx) => {
      const deal: PeaceDeal = {
        proposingNationId: ctx.nationId,
        proposedAtTick: ctx.currentTick,
        warType: p.terms.warType,
        territoryCessions: p.terms.territoryCessions,
        tributeWealth: p.terms.tributeWealth,
        tributeTicks: p.terms.tributeTicks,
      };

      // Transition war to peace_negotiation and attach the deal.
      await tx.war.update({
        where: { id: p.warId },
        data: {
          status: 'peace_negotiation',
          pendingPeaceDeal: deal as unknown as Prisma.InputJsonValue,
        },
      });

      await tx.queuedAction.create({
        data: {
          nationId: ctx.nationId,
          phase: ctx.currentPhase,
          type: 'propose_peace',
          payload: { warId: p.warId } as Prisma.InputJsonValue,
          tickQueued: ctx.currentTick,
        },
      });

      await tx.nation.update({
        where: { id: ctx.nationId },
        data: { mandateUsed: { increment: cost } },
      });

      const war = await tx.war.findUniqueOrThrow({ where: { id: p.warId } });
      const otherNationId = war.attackerId === ctx.nationId ? war.defenderId : war.attackerId;
      const [proposerNation, otherNation] = await Promise.all([
        tx.nation.findUniqueOrThrow({ where: { id: ctx.nationId } }),
        tx.nation.findUniqueOrThrow({ where: { id: otherNationId } }),
      ]);

      await tx.eventLog.create({
        data: {
          tick: ctx.currentTick,
          message: `${proposerNation.name} proposed peace with ${otherNation.name} (${p.terms.warType}).`,
        },
      });
    });
  },
};
