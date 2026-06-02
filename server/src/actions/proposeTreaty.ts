import { Prisma } from '@prisma/client';
import type { ActionContext, ActionHandler, ValidateResult } from './types';
import { MIN_TREATY_TERM, PROPOSAL_EXPIRY_TICKS } from '@war/engine';
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

const VALID_CLAUSE_TYPES = new Set(['non_aggression', 'tribute', 'trade', 'military_access', 'defense_pact', 'objective']);

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
