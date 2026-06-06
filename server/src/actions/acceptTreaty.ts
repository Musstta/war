import { Prisma } from '@prisma/client';
import type { ActionContext, ActionHandler, ValidateResult } from './types';
import { findTradePath, computeTradeCapacity, computeTradeFriction, UNDERDOG_PRESTIGE_BONUS } from '@war/engine';
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

          // Compute capacity and friction from geography and path. [PLACEHOLDER callsite: computeTradeCapacity, computeTradeFriction, 2.3]
          const sourceTerr = territories[payload.sourceTerritoryId];
          const destTerrId = pathResult?.path[pathResult.path.length - 1];
          const destTerr = destTerrId ? territories[destTerrId] : undefined;
          const routeCapacity = (sourceTerr && destTerr && pathResult)
            ? computeTradeCapacity(sourceTerr, destTerr, pathResult.isSeaRoute) // [PLACEHOLDER callsite: computeTradeCapacity, 2.3]
            : null;
          const routeFriction = (pathResult && pathResult.path.length > 0)
            ? computeTradeFriction( // [PLACEHOLDER callsite: computeTradeFriction, 2.3]
                pathResult.path,
                territories,
                payload.sourceTerritoryId,
                payload.toNationId,
              )
            : null;

          await tx.tradeRoute.create({
            data: {
              treatyClauseId: clause.id,
              sourceTerritoryId: payload.sourceTerritoryId,
              destinationNationId: payload.toNationId,
              path: (pathResult?.path ?? []) as Prisma.InputJsonValue,
              pathComputedAtTick: ctx.currentTick,
              pathStale: pathResult === null,
              isSeaRoute: pathResult?.isSeaRoute ?? false,
              capacity: routeCapacity,   // [PLACEHOLDER: computed from geography + infrastructure, 2.3]
              friction: routeFriction,   // [PLACEHOLDER: computed from path terrain + hostile crossings, 2.3]
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

      // §1.9 Write TreatyHistory entry for each maintain_peace objective clause (consecutive limit tracking).
      for (const clause of proposal.clauses) {
        if (clause.type !== 'objective') continue;
        const payload = clause.payload as Record<string, unknown>;
        if (payload?.objectiveType !== 'maintain_peace') continue;
        const [idA, idB] = [proposal.proposerId, proposal.targetId].sort();
        await (tx as any).treatyHistory?.create?.({
          data: {
            nationAId: idA,
            nationBId: idB,
            clauseType: 'maintain_peace',
            signedAtTick: ctx.currentTick,
          },
        });
      }

      // Mark proposal accepted.
      await tx.proposal.update({ where: { id: proposal.id }, data: { status: 'accepted' } });

      // Deduct collateral from both parties' Wealth.
      await tx.nation.update({ where: { id: proposal.proposerId }, data: { wealthStock: { decrement: proposal.proposerCollateral } } });
      await tx.nation.update({ where: { id: proposal.targetId }, data: {
        wealthStock: { decrement: proposal.targetCollateral },
        mandateUsed: { increment: cost },
      }});

      const targetNation = await tx.nation.findUniqueOrThrow({ where: { id: proposal.targetId } });
      await tx.eventLog.create({
        data: {
          tick: ctx.currentTick,
          message: `Treaty #${treaty.id} signed between ${proposerNation.name} and ${targetNation.name}. Term: ${proposal.termTicks} ticks.`,
        },
      });

      // Underdog negotiation bonus: non-Dominant accepts a Dominant proposer's treaty.
      // Dominant party receives nothing extra — no double-dipping. [PLACEHOLDER callsite: UNDERDOG_PRESTIGE_BONUS]
      const proposerIsDominant = (proposerNation as any).isDominant ?? false;
      const targetIsDominant = (targetNation as any).isDominant ?? false;
      if (proposerIsDominant && !targetIsDominant) {
        await tx.nation.update({
          where: { id: proposal.targetId },
          data: { prestige: { increment: UNDERDOG_PRESTIGE_BONUS } },
        });
        await tx.eventLog.create({
          data: {
            tick: ctx.currentTick,
            message: `${targetNation.name} gains Prestige for securing a treaty with the Dominant ${proposerNation.name}. [UNDERDOG_PRESTIGE_BONUS +${UNDERDOG_PRESTIGE_BONUS}]`,
          },
        });
        // Unrest reduction applied via engine UnrestCauses at next tick via the WorldState.
        // The UNDERDOG_UNREST_REDUCTION equilibrium effect is handled server-side:
        // store the expiry tick so the /api/world endpoint can pass it to computeUnrestEquilibrium.
        // [DEFERRED: underdog unrest buff requires storing the buff end tick on Nation — scaffolded, not yet wired into equilibrium]
      }
    });
  },
};
