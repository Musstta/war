import { Prisma } from '@prisma/client';
import type { ActionContext, ActionHandler, ValidateResult } from './types';
import { ACTION_COSTS } from '../phase';
import { mirrorMilitaryAction } from '../council';

// [PLACEHOLDER] Mandate cost to queue an attack.
const COST = ACTION_COSTS['attack_territory']!;

interface AttackTerritoryPayload {
  targetTerritoryId?: string;
}

export const attackTerritoryHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as AttackTerritoryPayload;
    if (!p?.targetTerritoryId) return { ok: 'error', status: 400, reason: 'Missing targetTerritoryId' };

    const targetTerritory = await ctx.prisma.territoryState.findUnique({
      where: { id: p.targetTerritoryId },
    });
    if (!targetTerritory) return { ok: 'error', status: 404, reason: 'Territory not found' };

    const targetOwnerId = targetTerritory.ownerId;
    if (!targetOwnerId) return { ok: 'error', status: 400, reason: 'Target territory is unclaimed' };
    if (targetOwnerId === ctx.nationId) return { ok: 'error', status: 400, reason: 'Cannot attack your own territory' };

    // An active war must exist between the queuing nation and the territory's owner.
    const activeWar = await ctx.prisma.war.findFirst({
      where: {
        status: { in: ['active', 'peace_negotiation'] },
        OR: [
          { attackerId: ctx.nationId, defenderId: targetOwnerId },
          { attackerId: targetOwnerId, defenderId: ctx.nationId },
        ],
      },
    });
    if (!activeWar) return { ok: 'error', status: 400, reason: 'No active war with the territory owner' };

    // Target must be reachable by the attacker.
    // Primary: the nation has an army adjacent to or already in the target territory.
    // Fallback (backward compat): territory adjacency check.
    // [DEFERRED: amphibious] — sea crossing not supported in v1.
    const targetDef = ctx.defById.get(p.targetTerritoryId);
    if (!targetDef) return { ok: 'error', status: 404, reason: 'Territory definition not found' };

    // Check if any army of this nation is in a territory adjacent to the target.
    const nationArmies = await ctx.prisma.army.findMany({ where: { nationId: ctx.nationId } });
    const armyIsReachable = nationArmies.some((army) => {
      if (army.territoryId === p.targetTerritoryId) return true; // army already in target (besieging)
      const armyTerr = ctx.defById.get(army.territoryId);
      return armyTerr?.adjacentIds.includes(p.targetTerritoryId) ?? false;
    });

    const ownedTerritories = await ctx.prisma.territoryState.findMany({
      where: { ownerId: ctx.nationId },
      select: { id: true },
    });
    const ownedIds = new Set(ownedTerritories.map((t) => t.id));
    const isDirectlyAdjacent = targetDef.adjacentIds.some((adjId) => ownedIds.has(adjId));
    // Reachable if army is adjacent OR territory is adjacent (backward compat for no-army scenarios).
    const isReachable = armyIsReachable || isDirectlyAdjacent;

    if (!isReachable) {
      // Check for reachability via military_access clause with an intermediate nation.
      // The intermediate nation must own at least one territory adjacent to the target,
      // and the attacker must have an active military_access clause with that nation.
      // [DEFERRED: full movement model — army positioning built v0.20, multi-territory pathing and logistics deferred to Phase 7+]
      const militaryAccessTreaties = await ctx.prisma.treaty.findMany({
        where: {
          status: { in: ['active'] },
          parties: { some: { nationId: ctx.nationId } },
        },
        include: { parties: true, clauses: true },
      });
      const militaryAccessPartners = new Set<string>();
      for (const treaty of militaryAccessTreaties) {
        const hasAccess = treaty.clauses.some((c) => c.type === 'military_access' && c.clauseStatus === 'active');
        if (!hasAccess) continue;
        for (const party of treaty.parties) {
          if (party.nationId !== ctx.nationId) militaryAccessPartners.add(party.nationId);
        }
      }

      // Check if any adjacent territory of the target is owned by a military_access partner.
      let reachableViaAccess = false;
      if (militaryAccessPartners.size > 0) {
        const adjOwners = await ctx.prisma.territoryState.findMany({
          where: { id: { in: targetDef.adjacentIds } },
          select: { id: true, ownerId: true },
        });
        reachableViaAccess = adjOwners.some((t) => t.ownerId && militaryAccessPartners.has(t.ownerId));
      }

      if (!reachableViaAccess) {
        return { ok: 'error', status: 400, reason: 'Target territory is not reachable — no army adjacent and no military access through an intermediate nation ([DEFERRED: full movement model])' };
      }
    }

    return { ok: 'ready', cost: COST, finalPayload: { targetTerritoryId: p.targetTerritoryId } };
  },

  async queue(ctx: ActionContext, cost: number, finalPayload: object): Promise<void> {
    const p = finalPayload as { targetTerritoryId: string };
    await ctx.prisma.$transaction(async (tx) => {
      await tx.queuedAction.create({
        data: {
          nationId: ctx.nationId,
          phase: ctx.currentPhase,
          type: 'attack_territory',
          payload: p as Prisma.InputJsonValue,
          tickQueued: ctx.currentTick,
        },
      });
      await tx.nation.update({
        where: { id: ctx.nationId },
        data: { mandateUsed: { increment: cost } },
      });
      // Mirror into war council for allied visibility.
      await mirrorMilitaryAction(tx, ctx.nationId, 'attack_territory', p.targetTerritoryId, ctx.currentTick);
    });
  },
};
