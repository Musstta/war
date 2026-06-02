import { Prisma } from '@prisma/client';
import type { ActionContext, ActionHandler, ValidateResult } from './types';
import { findTradePath } from '@war/engine';
import type { Territory, TerritoryState, CulturalFamily } from '@war/engine';
import { ACTION_COSTS } from '../phase';

const COST = ACTION_COSTS['accept_treaty']!;

export const acceptTreatyHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as { proposalId?: number };
    if (typeof p?.proposalId !== 'number') return { ok: 'error', status: 400, reason: 'Missing proposalId' };

    const proposal = await ctx.prisma.proposal.findUnique({
      where: { id: p.proposalId },
      include: { clauses: true },
    });
    if (!proposal) return { ok: 'error', status: 404, reason: 'Proposal not found' };
    if (proposal.targetId !== ctx.nationId) return { ok: 'error', status: 403, reason: 'Not the target of this proposal' };
    if (proposal.status !== 'pending') return { ok: 'error', status: 400, reason: `Proposal is ${proposal.status}` };

    // Target's collateral must be in their Wealth stockpile.
    if (ctx.nation.wealthStock < proposal.targetCollateral) {
      return { ok: 'error', status: 400, reason: `Insufficient Wealth for collateral (need ${proposal.targetCollateral})` };
    }

    return { ok: 'ready', cost: COST, finalPayload: p as object };
  },

  async queue(ctx: ActionContext, cost: number, finalPayload: object): Promise<void> {
    const p = finalPayload as { proposalId: number };

    await ctx.prisma.$transaction(async (tx) => {
      const proposal = await tx.proposal.findUniqueOrThrow({
        where: { id: p.proposalId },
        include: { clauses: true },
      });

      // Verify proposer still has their collateral.
      const proposerNation = await tx.nation.findUniqueOrThrow({ where: { id: proposal.proposerId } });
      if (proposerNation.wealthStock < proposal.proposerCollateral) {
        throw new Error(`Proposer no longer has sufficient Wealth for collateral`);
      }

      const totalCollateral = proposal.clauses.reduce((sum, c) => sum + c.collateral, 0);

      // Create the treaty with clause index tracking.
      const treaty = await tx.treaty.create({
        data: {
          proposalId: proposal.id,
          status: 'active',
          termTicks: proposal.termTicks,
          tickStarted: ctx.currentTick,
          tickEnds: ctx.currentTick + proposal.termTicks,
          totalCollateral,
          parties: {
            create: [
              { nationId: proposal.proposerId, collateralDeposited: proposal.proposerCollateral },
              { nationId: proposal.targetId,   collateralDeposited: proposal.targetCollateral },
            ],
          },
          clauses: {
            create: proposal.clauses.map((c, idx) => ({
              clauseIndex: idx,
              type: c.type,
              collateral: c.collateral,
              payload: c.payload as Prisma.InputJsonValue,
              clauseStatus: 'active',
              missedPayments: 0,
            })),
          },
        },
        include: { clauses: true },
      });

      // Compute trade routes for trade clauses at signing time.
      // Fetch current territory ownership for pathfinding.
      const terrRows = await tx.territoryState.findMany();
      const territories: Record<string, Territory> = {};
      for (const row of terrRows) {
        const def = ctx.defById.get(row.id);
        if (!def) continue;
        territories[row.id] = {
          def: row.culturalFamily ? { ...def, culturalFamily: row.culturalFamily as CulturalFamily } : def,
          state: {
            ownerId: row.ownerId,
            fortificationLevel: row.fortificationLevel,
            hasRoad: row.hasRoad,
            hasPort: row.hasPort,
            unrest: row.unrest,
            isInRevolt: row.isInRevolt,
            valueTraits: { individualist: row.individualist, progressive: row.progressive, militaristic: row.militaristic, expansionist: row.expansionist },
            constructionType: (row.constructionType ?? null) as TerritoryState['constructionType'],
            constructionTicksLeft: row.constructionTicksLeft ?? null,
            pendingConstructionType: (row.pendingConstructionType ?? null) as TerritoryState['pendingConstructionType'],
            ownershipShock: row.ownershipShock,
            acquiredTick: row.acquiredTick ?? null,
            localPopStock: row.localPopStock,
            localIndStock: row.localIndStock,
            localWltStock: row.localWltStock,
          },
        };
      }

      for (const clause of treaty.clauses) {
        if (clause.type === 'trade') {
          const payload = clause.payload as { sourceTerritoryId?: string; toNationId?: string };
          if (!payload.sourceTerritoryId || !payload.toNationId) continue;

          const pathResult = findTradePath(
            payload.sourceTerritoryId,
            payload.toNationId,
            territories,
            ctx.allDefs,
          );

          await tx.tradeRoute.create({
            data: {
              treatyClauseId: clause.id,
              sourceTerritoryId: payload.sourceTerritoryId,
              destinationNationId: payload.toNationId,
              path: (pathResult?.path ?? []) as Prisma.InputJsonValue,
              pathComputedAtTick: ctx.currentTick,
              pathStale: pathResult === null,
              isSeaRoute: pathResult?.isSeaRoute ?? false,
              // capacity and friction are [PLACEHOLDER] — null until formulas are defined.
              capacity: null,
              friction: null,
            },
          });
        }

        if (clause.type === 'objective') {
          const payload = clause.payload as {
            objectiveType?: string;
            targetNationId?: string;
            targetTerritoryId?: string;
            deadlineTicks?: number;
            responsibleParty?: string;
          };
          await tx.objectiveClause.create({
            data: {
              treatyClauseId: clause.id,
              objectiveType: payload.objectiveType ?? 'maintain_peace',
              targetNationId: payload.targetNationId ?? null,
              targetTerritoryId: payload.targetTerritoryId ?? null,
              deadlineTicks: payload.deadlineTicks ?? proposal.termTicks,
              status: 'pending',
              responsibleParty: payload.responsibleParty ?? 'partyA',
            },
          });
        }
      }

      // Mark proposal accepted.
      await tx.proposal.update({ where: { id: proposal.id }, data: { status: 'accepted' } });

      // Deduct collateral from both parties' Wealth.
      await tx.nation.update({ where: { id: proposal.proposerId }, data: { wealthStock: { decrement: proposal.proposerCollateral } } });
      await tx.nation.update({ where: { id: proposal.targetId }, data: {
        wealthStock: { decrement: proposal.targetCollateral },
        mandateUsed: { increment: cost },
      }});

      const targetNationName = (await tx.nation.findUniqueOrThrow({ where: { id: proposal.targetId } })).name;
      await tx.eventLog.create({
        data: {
          tick: ctx.currentTick,
          message: `Treaty #${treaty.id} signed between ${proposerNation.name} and ${targetNationName}. Term: ${proposal.termTicks} ticks.`,
        },
      });
    });
  },
};
