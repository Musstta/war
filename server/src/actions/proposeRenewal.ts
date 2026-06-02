import { Prisma } from '@prisma/client';
import type { ActionContext, ActionHandler, ValidateResult } from './types';
import { MIN_TREATY_TERM, PROPOSAL_EXPIRY_TICKS } from '@war/engine';
import { ACTION_COSTS } from '../phase';

const COST = ACTION_COSTS['propose_renewal']!;

export const proposeRenewalHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as { treatyId?: number; termTicks?: number; proposerCollateral?: number; targetCollateral?: number };
    if (typeof p?.treatyId !== 'number') return { ok: 'error', status: 400, reason: 'Missing treatyId' };

    const treaty = await ctx.prisma.treaty.findUnique({
      where: { id: p.treatyId },
      include: { parties: true, clauses: true },
    });
    if (!treaty) return { ok: 'error', status: 404, reason: 'Treaty not found' };
    if (!treaty.parties.some((party) => party.nationId === ctx.nationId)) {
      return { ok: 'error', status: 403, reason: 'Not a party to this treaty' };
    }
    if (treaty.status !== 'active' && treaty.status !== 'degraded') {
      return { ok: 'error', status: 400, reason: `Cannot renew a ${treaty.status} treaty` };
    }

    const termTicks = p.termTicks ?? treaty.termTicks;
    if (termTicks < MIN_TREATY_TERM) {
      return { ok: 'error', status: 400, reason: `Term must be at least ${MIN_TREATY_TERM} ticks` };
    }

    return { ok: 'ready', cost: COST, finalPayload: { ...p, termTicks, treaty } as object };
  },

  async queue(ctx: ActionContext, cost: number, finalPayload: object): Promise<void> {
    const { treatyId, termTicks, proposerCollateral, targetCollateral, treaty } = finalPayload as {
      treatyId: number;
      termTicks: number;
      proposerCollateral?: number;
      targetCollateral?: number;
      treaty: { parties: Array<{ nationId: string; collateralDeposited: number }>; clauses: Array<{ type: string; collateral: number; payload: unknown }> };
    };

    const targetParty = treaty.parties.find((p) => p.nationId !== ctx.nationId)!;
    const originalProposerParty = treaty.parties.find((p) => p.nationId === ctx.nationId)!;

    await ctx.prisma.$transaction(async (tx) => {
      // Check no pending renewal already exists.
      const existing = await tx.proposal.findFirst({
        where: {
          status: 'pending',
          OR: [
            { proposerId: ctx.nationId, targetId: targetParty.nationId },
            { proposerId: targetParty.nationId, targetId: ctx.nationId },
          ],
        },
      });
      if (existing) throw new Error('A pending proposal already exists between these nations');

      await tx.proposal.create({
        data: {
          proposerId: ctx.nationId,
          targetId: targetParty.nationId,
          status: 'pending',
          termTicks,
          proposerCollateral: proposerCollateral ?? originalProposerParty.collateralDeposited,
          targetCollateral:   targetCollateral   ?? targetParty.collateralDeposited,
          tickProposed: ctx.currentTick,
          expiresAtTick: ctx.currentTick + PROPOSAL_EXPIRY_TICKS,
          clauses: {
            create: treaty.clauses.map((c) => ({
              type: c.type,
              collateral: c.collateral,
              payload: c.payload as Prisma.InputJsonValue,
            })),
          },
        },
      });
      await tx.nation.update({ where: { id: ctx.nationId }, data: { mandateUsed: { increment: cost } } });
    });
  },
};
