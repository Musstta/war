import { Prisma } from '@prisma/client';
import type { ActionContext, ActionHandler, ValidateResult } from './types';
import { getNonAggressionPairs, breachMaintainPeaceObjectives, TRUST_BREAK_PENALTY } from '@war/engine';
import type { Treaty, TreatyClause, ClauseType, ObjectiveClause, ObjectiveType, ObjectiveStatus, ResponsibleParty } from '@war/engine';
import { ACTION_COSTS } from '../phase';

// [PLACEHOLDER] Mandate cost to declare war.
const COST = ACTION_COSTS['declare_war']!;

// [PLACEHOLDER] Trust penalty for unjustified (no-CB) war declaration, on top of normal war effects.
const NO_CB_TRUST_PENALTY = 10;

interface DeclareWarPayload {
  targetNationId?: string;
  casusBelli?: boolean;
  justification?: string;
}

export const declareWarHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as DeclareWarPayload;
    if (!p?.targetNationId) return { ok: 'error', status: 400, reason: 'Missing targetNationId' };
    if (p.targetNationId === ctx.nationId) return { ok: 'error', status: 400, reason: 'Cannot declare war on yourself' };

    const targetNation = await ctx.prisma.nation.findUnique({ where: { id: p.targetNationId } });
    if (!targetNation) return { ok: 'error', status: 404, reason: 'Target nation not found' };

    // No active war already between these two nations.
    const existingWar = await ctx.prisma.war.findFirst({
      where: {
        status: { in: ['active', 'peace_negotiation'] },
        OR: [
          { attackerId: ctx.nationId, defenderId: p.targetNationId },
          { attackerId: p.targetNationId, defenderId: ctx.nationId },
        ],
      },
    });
    if (existingWar) return { ok: 'error', status: 400, reason: 'An active war already exists between these nations' };

    // Check non-aggression pairs — gate declaration if a non-aggression clause is active.
    const activeTreaties = await ctx.prisma.treaty.findMany({
      where: {
        status: { in: ['active', 'degraded'] },
        parties: { some: { nationId: ctx.nationId } },
      },
      include: { parties: true, clauses: { include: { objectiveClause: true } } },
    });

    // Reconstruct minimal Treaty objects for the engine helper.
    const engineTreaties: Treaty[] = activeTreaties.map((t) => ({
      id: t.id,
      proposalId: t.proposalId,
      partyIds: t.parties.map((p) => p.nationId) as [string, string],
      clauses: t.clauses.map((c) => ({
        id: c.id,
        clauseIndex: c.clauseIndex,
        type: c.type as ClauseType,
        collateral: c.collateral,
        payload: c.payload as Record<string, unknown>,
        clauseStatus: c.clauseStatus,
        missedPayments: c.missedPayments,
        objective: (c as any).objectiveClause ? {
          id: (c as any).objectiveClause.id,
          treatyClauseId: (c as any).objectiveClause.treatyClauseId,
          objectiveType: (c as any).objectiveClause.objectiveType as ObjectiveType,
          targetNationId: (c as any).objectiveClause.targetNationId ?? null,
          targetTerritoryId: (c as any).objectiveClause.targetTerritoryId ?? null,
          deadlineTicks: (c as any).objectiveClause.deadlineTicks,
          status: (c as any).objectiveClause.status as ObjectiveStatus,
          responsibleParty: (c as any).objectiveClause.responsibleParty as ResponsibleParty,
        } : null,
      })) as TreatyClause[],
      status: t.status,
      termTicks: t.termTicks,
      tickStarted: t.tickStarted,
      tickEnds: t.tickEnds,
      totalCollateral: t.totalCollateral,
      breakerNationId: t.breakerNationId,
      collateralByParty: Object.fromEntries(t.parties.map((p) => [p.nationId, p.collateralDeposited])),
      refundRemainingByParty: Object.fromEntries(t.parties.map((p) => [p.nationId, p.refundRemaining])),
      refundStartTickByParty: Object.fromEntries(t.parties.map((p) => [p.nationId, p.refundStartTick ?? null])),
      escrowAmountByParty: Object.fromEntries(t.parties.map((p) => [p.nationId, p.escrowAmount])),
      escrowStartTickByParty: Object.fromEntries(t.parties.map((p) => [p.nationId, p.escrowStartTick ?? null])),
    }));

    const nonAggressionPairs = getNonAggressionPairs(engineTreaties);
    const pairKey = ctx.nationId < p.targetNationId
      ? `${ctx.nationId}|${p.targetNationId}`
      : `${p.targetNationId}|${ctx.nationId}`;
    if (nonAggressionPairs.has(pairKey)) {
      return { ok: 'error', status: 400, reason: 'non-aggression treaty active — cannot declare war' };
    }

    return { ok: 'ready', cost: COST, finalPayload: p as object };
  },

  async queue(ctx: ActionContext, cost: number, finalPayload: object): Promise<void> {
    const p = finalPayload as DeclareWarPayload;
    const hasCB = p.casusBelli !== false; // default true if omitted

    await ctx.prisma.$transaction(async (tx) => {
      // Create the War row.
      const war = await tx.war.create({
        data: {
          attackerId: ctx.nationId,
          defenderId: p.targetNationId!,
          type: 'conquest',
          hasCasusBelli: hasCB,
          status: 'active',
          startTick: ctx.currentTick,
          declaredTick: ctx.currentTick,
          occupiedTerritories: [] as Prisma.InputJsonValue,
          pendingPeaceDeal: Prisma.JsonNull,
        },
      });

      // Apply no-CB Trust penalty immediately (the unrest spike fires in resolveTick).
      if (!hasCB) {
        await tx.nation.update({
          where: { id: ctx.nationId },
          data: { trust: { decrement: NO_CB_TRUST_PENALTY } },
        });
      }

      // maintain_peace objective breach fires in resolveTick (engine-side) so it has
      // access to the full world state and can update clause.objective.status there.
      // saveWorldState then persists the status change via the normal clause loop.

      // Queue the declare_war action row (engine acknowledges it as pass-through).
      await tx.queuedAction.create({
        data: {
          nationId: ctx.nationId,
          phase: ctx.currentPhase,
          type: 'declare_war',
          payload: { targetNationId: p.targetNationId, warId: war.id } as Prisma.InputJsonValue,
          tickQueued: ctx.currentTick,
        },
      });

      // Event log entry.
      const attackerNation = await tx.nation.findUniqueOrThrow({ where: { id: ctx.nationId } });
      const defenderNation = await tx.nation.findUniqueOrThrow({ where: { id: p.targetNationId! } });
      const cbNote = hasCB ? '' : ' without justification';
      await tx.eventLog.create({
        data: {
          tick: ctx.currentTick,
          message: `${attackerNation.name} declared war on ${defenderNation.name}${cbNote}.`,
        },
      });

      // Deduct mandate.
      await tx.nation.update({
        where: { id: ctx.nationId },
        data: { mandateUsed: { increment: cost } },
      });
    });
  },
};
