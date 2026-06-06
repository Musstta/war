import { Prisma } from '@prisma/client';
import type { ActionContext, ActionHandler, ValidateResult } from './types';
import { MIN_TREATY_TERM, PROPOSAL_EXPIRY_TICKS, CESSION_MIN_FUTURE_TICKS, MAINTAIN_PEACE_MAX_CONSECUTIVE, MAINTAIN_PEACE_CONSECUTIVE_WINDOW } from '@war/engine';
import { ACTION_COSTS } from '../phase';

const COST = ACTION_COSTS['propose_treaty']!;

export interface TreatyClauseInput {
  type: string;
  collateral?: number;
  payload?: Record<string, unknown>;
}

interface ProposeTreatyPayload {
  targetNationId?: string;
  termTicks?: number;
  clauses?: TreatyClauseInput[];
  proposerCollateral?: number;
  targetCollateral?: number;
}

const VALID_CLAUSE_TYPES = new Set([
  'non_aggression', 'tribute', 'trade', 'military_access', 'defense_pact', 'objective',
  'territory_cession',   // §1.5
  'army_lending',        // §1.1
  'population_transfer', // §1.2
  'outpost',             // §1.11
]);

const VALID_OBJECTIVE_TYPES = new Set([
  'build_road_connection', 'build_port', 'maintain_peace',
  'joint_invasion', 'attack_player',
]);

const VALID_RESPONSIBLE_PARTIES = new Set(['partyA', 'partyB', 'both']);

export const proposeTreatyHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as ProposeTreatyPayload;
    if (!p?.targetNationId) return { ok: 'error', status: 400, reason: 'Missing targetNationId' };
    if (p.targetNationId === ctx.nationId) return { ok: 'error', status: 400, reason: 'Cannot propose treaty with yourself' };
    if (typeof p.termTicks !== 'number' || p.termTicks < MIN_TREATY_TERM) {
      return { ok: 'error', status: 400, reason: `Term must be at least ${MIN_TREATY_TERM} ticks` };
    }
    if (!Array.isArray(p.clauses) || p.clauses.length === 0) {
      return { ok: 'error', status: 400, reason: 'Treaty must have at least one clause' };
    }
    for (const c of p.clauses) {
      if (!VALID_CLAUSE_TYPES.has(c.type)) {
        return { ok: 'error', status: 400, reason: `Unknown clause type: ${c.type}` };
      }
      if (c.type === 'objective') {
        const obj = c.payload as Record<string, unknown>;
        if (!obj?.objectiveType || !VALID_OBJECTIVE_TYPES.has(obj.objectiveType as string)) {
          return { ok: 'error', status: 400, reason: `Invalid or missing objectiveType for objective clause` };
        }
        if (typeof obj.deadlineTicks !== 'number' || obj.deadlineTicks < 1) {
          return { ok: 'error', status: 400, reason: `objective clause requires deadlineTicks >= 1` };
        }
        if (!obj.responsibleParty || !VALID_RESPONSIBLE_PARTIES.has(obj.responsibleParty as string)) {
          return { ok: 'error', status: 400, reason: `objective clause requires responsibleParty: partyA | partyB | both` };
        }
      }
      if (c.type === 'territory_cession') {
        // §1.5 — validate transferAtTick is sufficiently in the future.
        const cp = c.payload as Record<string, unknown>;
        if (!cp?.territoryId || typeof cp.territoryId !== 'string') {
          return { ok: 'error', status: 400, reason: `territory_cession clause requires territoryId` };
        }
        if (!cp?.fromNationId || !cp?.toNationId) {
          return { ok: 'error', status: 400, reason: `territory_cession clause requires fromNationId and toNationId` };
        }
        if (typeof cp.transferAtTick !== 'number') {
          return { ok: 'error', status: 400, reason: `territory_cession clause requires transferAtTick (absolute tick)` };
        }
        // Validate transferAtTick is at least CESSION_MIN_FUTURE_TICKS in the future.
        const currentTickVal = ctx.currentTick;
        if (cp.transferAtTick < currentTickVal + CESSION_MIN_FUTURE_TICKS) {
          return { ok: 'error', status: 400, reason: `territory_cession transferAtTick must be at least ${CESSION_MIN_FUTURE_TICKS} ticks from now [PLACEHOLDER: CESSION_MIN_FUTURE_TICKS]` };
        }
      }
      if (c.type === 'army_lending') {
        const ap = c.payload as Record<string, unknown>;
        if (!ap?.deliveryTerritoryId || !ap?.returnTerritoryId) {
          return { ok: 'error', status: 400, reason: `army_lending clause requires deliveryTerritoryId and returnTerritoryId` };
        }
        if (typeof ap.armySize !== 'number' || ap.armySize < 1) {
          return { ok: 'error', status: 400, reason: `army_lending clause requires armySize >= 1` };
        }
        if (typeof ap.loanDurationTicks !== 'number' || ap.loanDurationTicks < 1) {
          return { ok: 'error', status: 400, reason: `army_lending clause requires loanDurationTicks >= 1` };
        }
      }
      if (c.type === 'population_transfer') {
        const pp = c.payload as Record<string, unknown>;
        if (!pp?.fromNationId || !pp?.toNationId) {
          return { ok: 'error', status: 400, reason: `population_transfer clause requires fromNationId and toNationId` };
        }
        if (typeof pp.amount !== 'number' || pp.amount <= 0) {
          return { ok: 'error', status: 400, reason: `population_transfer clause requires amount > 0` };
        }
        if (typeof pp.transferAtTick !== 'number') {
          return { ok: 'error', status: 400, reason: `population_transfer clause requires transferAtTick (absolute tick)` };
        }
      }
      if (c.type === 'outpost') {
        const op = c.payload as Record<string, unknown>;
        if (!op?.targetTerritoryId || typeof op.targetTerritoryId !== 'string') {
          return { ok: 'error', status: 400, reason: `outpost clause requires targetTerritoryId` };
        }
        if (!op?.grantedToNationId || typeof op.grantedToNationId !== 'string') {
          return { ok: 'error', status: 400, reason: `outpost clause requires grantedToNationId` };
        }
        if (op.type !== 'sentry' && op.type !== 'outpost') {
          return { ok: 'error', status: 400, reason: `outpost clause type must be 'sentry' or 'outpost'` };
        }
      }
    }

    // Target nation must exist.
    const targetNation = await ctx.prisma.nation.findUnique({ where: { id: p.targetNationId } });
    if (!targetNation) return { ok: 'error', status: 404, reason: 'Target nation not found' };

    // No duplicate pending proposal between same parties.
    const existing = await ctx.prisma.proposal.findFirst({
      where: {
        status: 'pending',
        OR: [
          { proposerId: ctx.nationId, targetId: p.targetNationId },
          { proposerId: p.targetNationId, targetId: ctx.nationId },
        ],
      },
    });
    if (existing) return { ok: 'error', status: 400, reason: 'A pending proposal already exists between these nations' };

    // §1.9 maintain_peace consecutive limit: at most MAINTAIN_PEACE_MAX_CONSECUTIVE
    // maintain_peace treaties between the same pair within MAINTAIN_PEACE_CONSECUTIVE_WINDOW ticks.
    const hasMaintainPeace = p.clauses!.some(
      (c) => c.type === 'objective' && (c.payload as Record<string, unknown>)?.objectiveType === 'maintain_peace',
    );
    if (hasMaintainPeace) {
      const windowStart = ctx.currentTick - MAINTAIN_PEACE_CONSECUTIVE_WINDOW;
      const [idA, idB] = [ctx.nationId, p.targetNationId].sort();
      const recentCount = await (ctx.prisma as any).treatyHistory?.count?.({
        where: {
          nationAId: idA,
          nationBId: idB,
          clauseType: 'maintain_peace',
          signedAtTick: { gte: windowStart },
        },
      }) ?? 0;
      if (recentCount >= MAINTAIN_PEACE_MAX_CONSECUTIVE) {
        return {
          ok: 'error', status: 400,
          reason: `Cannot propose maintain_peace: ${recentCount} treaties already signed within the last ${MAINTAIN_PEACE_CONSECUTIVE_WINDOW} ticks [MAINTAIN_PEACE_MAX_CONSECUTIVE=${MAINTAIN_PEACE_MAX_CONSECUTIVE}]`,
        };
      }
    }

    return { ok: 'ready', cost: COST, finalPayload: p as object };
  },

  async queue(ctx: ActionContext, cost: number, finalPayload: object): Promise<void> {
    const p = finalPayload as ProposeTreatyPayload;
    const proposerCollateral = p.proposerCollateral ?? 0;
    const targetCollateral = p.targetCollateral ?? 0;

    await ctx.prisma.$transaction(async (tx) => {
      await tx.proposal.create({
        data: {
          proposerId: ctx.nationId,
          targetId: p.targetNationId!,
          status: 'pending',
          termTicks: p.termTicks!,
          proposerCollateral,
          targetCollateral,
          tickProposed: ctx.currentTick,
          expiresAtTick: ctx.currentTick + PROPOSAL_EXPIRY_TICKS,
          clauses: {
            create: p.clauses!.map((c) => ({
              type: c.type,
              collateral: c.collateral ?? 0,
              payload: (c.payload ?? {}) as Prisma.InputJsonValue,
            })),
          },
        },
      });
      await tx.nation.update({ where: { id: ctx.nationId }, data: { mandateUsed: { increment: cost } } });
    });
  },
};
