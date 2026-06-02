import type { ActionContext, ActionHandler, ValidateResult } from './types';
import { TRUST_BREAK_PENALTY } from '@war/engine';

export const breakTreatyHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as { treatyId?: number };
    if (typeof p?.treatyId !== 'number') return { ok: 'error', status: 400, reason: 'Missing treatyId' };

    const treaty = await ctx.prisma.treaty.findUnique({
      where: { id: p.treatyId },
      include: { parties: true },
    });
    if (!treaty) return { ok: 'error', status: 404, reason: 'Treaty not found' };
    if (!treaty.parties.some((party) => party.nationId === ctx.nationId)) {
      return { ok: 'error', status: 403, reason: 'Not a party to this treaty' };
    }
    if (treaty.status !== 'active' && treaty.status !== 'degraded') {
      return { ok: 'error', status: 400, reason: `Treaty is already ${treaty.status}` };
    }

    // Active partner may break a degraded treaty for free — check if this is a free break.
    const isDegradedFreeBreak = treaty.status === 'degraded' &&
      treaty.parties.some((p) => p.nationId === ctx.nationId && p.escrowAmount === 0);

    return { ok: 'ready', cost: 0, finalPayload: { ...p, isDegradedFreeBreak } as object };
  },

  async queue(ctx: ActionContext, _cost: number, finalPayload: object): Promise<void> {
    const { treatyId, isDegradedFreeBreak } = finalPayload as { treatyId: number; isDegradedFreeBreak: boolean };

    await ctx.prisma.$transaction(async (tx) => {
      const treaty = await tx.treaty.findUniqueOrThrow({
        where: { id: treatyId },
        include: { parties: true },
      });

      const breakerParty   = treaty.parties.find((p) => p.nationId === ctx.nationId)!;
      const wrongedParty   = treaty.parties.find((p) => p.nationId !== ctx.nationId)!;

      // Mark treaty broken.
      await tx.treaty.update({
        where: { id: treatyId },
        data: { status: 'broken', breakerNationId: ctx.nationId },
      });

      if (isDegradedFreeBreak) {
        // Free break — no Trust hit, no collateral penalty.
        // Return any remaining escrow from the now-returned inactive player (edge: they returned
        // after degradation before breaker chose to break — handle cleanly).
        const inactiveEscrow = breakerParty.escrowAmount;
        if (inactiveEscrow > 0) {
          await tx.nation.update({ where: { id: ctx.nationId }, data: { wealthStock: { increment: inactiveEscrow } } });
        }
      } else {
        // Voluntary break: Trust penalty + collateral transferred to wronged party.
        await tx.nation.update({
          where: { id: ctx.nationId },
          data: {
            trust: { decrement: TRUST_BREAK_PENALTY },
            lastBrokenPromiseTick: ctx.currentTick,
          },
        });
        const transferAmount = breakerParty.collateralDeposited + (breakerParty.escrowAmount ?? 0);
        if (transferAmount > 0) {
          await tx.nation.update({ where: { id: wrongedParty.nationId }, data: { wealthStock: { increment: transferAmount } } });
        }
        // Return wronged party's collateral (plus any pending refund).
        const returnToWronged = wrongedParty.collateralDeposited + (wrongedParty.refundRemaining ?? 0);
        if (returnToWronged > 0) {
          await tx.nation.update({ where: { id: wrongedParty.nationId }, data: { wealthStock: { increment: returnToWronged } } });
        }
      }

      // Name lookup for event log.
      const breakerNation = await tx.nation.findUniqueOrThrow({ where: { id: ctx.nationId } });
      const wrongedNation  = await tx.nation.findUniqueOrThrow({ where: { id: wrongedParty.nationId } });
      const suffix = isDegradedFreeBreak ? ' (degraded treaty, no penalty).' : ` ${breakerNation.name} loses Trust and forfeits collateral.`;
      await tx.eventLog.create({
        data: {
          tick: ctx.currentTick,
          message: `${breakerNation.name} has broken Treaty #${treatyId} with ${wrongedNation.name}.${suffix}`,
        },
      });
    });
  },
};
