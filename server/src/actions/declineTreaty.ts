import type { ActionContext, ActionHandler, ValidateResult } from './types';

export const declineTreatyHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as { proposalId?: number };
    if (typeof p?.proposalId !== 'number') return { ok: 'error', status: 400, reason: 'Missing proposalId' };

    const proposal = await ctx.prisma.proposal.findUnique({ where: { id: p.proposalId } });
    if (!proposal) return { ok: 'error', status: 404, reason: 'Proposal not found' };
    if (proposal.targetId !== ctx.nationId) return { ok: 'error', status: 403, reason: 'Not the target of this proposal' };
    if (proposal.status !== 'pending') return { ok: 'error', status: 400, reason: `Proposal is ${proposal.status}` };

    return { ok: 'ready', cost: 0, finalPayload: p as object };
  },

  async queue(ctx: ActionContext, _cost: number, finalPayload: object): Promise<void> {
    const p = finalPayload as { proposalId: number };
    await ctx.prisma.proposal.update({ where: { id: p.proposalId }, data: { status: 'declined' } });
  },
};
