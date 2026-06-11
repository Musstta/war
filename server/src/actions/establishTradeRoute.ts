import { Prisma } from '@prisma/client';
import type { ActionContext, ActionHandler, ValidateResult } from './types';
import { ESTABLISH_DOMESTIC_ROUTE_MANDATE, computeBaseCapacity, computeProfitMultiplier, ROUTE_GROWTH_CAP_MULTIPLIER } from '@war/engine';
import { ACTION_COSTS } from '../phase';

const COST = ACTION_COSTS['establish_trade_route']!;

export const establishTradeRouteHandler: ActionHandler = {
  async validate(ctx: ActionContext): Promise<ValidateResult> {
    const p = ctx.payload as { sourceTerritoryId?: string; destinationTerritoryId?: string };
    if (!p?.sourceTerritoryId) return { ok: 'error', status: 400, reason: 'Missing sourceTerritoryId' };
    if (!p?.destinationTerritoryId) return { ok: 'error', status: 400, reason: 'Missing destinationTerritoryId' };
    if (p.sourceTerritoryId === p.destinationTerritoryId) return { ok: 'error', status: 400, reason: 'Source and destination must be different territories' };

    const [source, dest] = await Promise.all([
      ctx.prisma.territoryState.findUnique({ where: { id: p.sourceTerritoryId } }),
      ctx.prisma.territoryState.findUnique({ where: { id: p.destinationTerritoryId } }),
    ]);
    if (!source) return { ok: 'error', status: 404, reason: 'Source territory not found' };
    if (!dest) return { ok: 'error', status: 404, reason: 'Destination territory not found' };
    if (source.ownerId !== ctx.nationId) return { ok: 'error', status: 403, reason: 'Source territory not owned by you' };
    if (dest.ownerId !== ctx.nationId) return { ok: 'error', status: 403, reason: 'Destination territory not owned by you' };
    if (!(source.hasPort || source.hasMarket || dest.hasPort || dest.hasMarket)) {
      return { ok: 'error', status: 400, reason: 'At least one endpoint must have a port or market' };
    }

    // No duplicate active domestic route between these territories (either direction).
    const existing = await (ctx.prisma as any).tradeRouteAgreement?.findFirst?.({
      where: {
        type: 'domestic',
        status: 'active',
        OR: [
          { sourceTerritoryId: p.sourceTerritoryId, destinationTerritoryId: p.destinationTerritoryId },
          { sourceTerritoryId: p.destinationTerritoryId, destinationTerritoryId: p.sourceTerritoryId },
        ],
      },
    });
    if (existing) return { ok: 'error', status: 400, reason: 'An active domestic route already exists between these territories' };

    if (ctx.nation.mandateUsed + COST > ctx.myBudget) return { ok: 'error', status: 400, reason: 'Insufficient mandates' };

    return { ok: 'ready', cost: COST, finalPayload: p as object };
  },

  async queue(ctx: ActionContext, cost: number, finalPayload: object): Promise<void> {
    const p = finalPayload as { sourceTerritoryId: string; destinationTerritoryId: string };

    await ctx.prisma.$transaction(async (tx) => {
      const [source, dest] = await Promise.all([
        tx.territoryState.findUniqueOrThrow({ where: { id: p.sourceTerritoryId } }),
        tx.territoryState.findUniqueOrThrow({ where: { id: p.destinationTerritoryId } }),
      ]);

      const portLevel = (source as any).portLevel ?? 1;
      const hasPort = source.hasPort || dest.hasPort;
      const type = 'domestic';
      const baseCapacity = computeBaseCapacity(type, hasPort ? portLevel : 0);
      const growthCap = baseCapacity * ROUTE_GROWTH_CAP_MULTIPLIER;
      const profitMultiplier = computeProfitMultiplier(type, 0);
      const path: string[] = [p.sourceTerritoryId, p.destinationTerritoryId];

      const tx_any = tx as any;
      const route = await tx_any.tradeRouteAgreement.create({
        data: {
          treatyClauseId: null,
          ownerNationId: ctx.nationId,
          partnerNationId: null,
          type,
          sourceTerritoryId: p.sourceTerritoryId,
          destinationTerritoryId: p.destinationTerritoryId,
          path: path as Prisma.InputJsonValue,
          pathComputedAtTick: ctx.currentTick,
          portLevel,
          baseCapacity,
          currentCapacity: baseCapacity,
          growthCap,
          cyclesCompleted: 0,
          profitMultiplier,
          upkeepRate: 0.1,
          status: 'active',
          startedAtTick: ctx.currentTick,
        },
      });

      // First shipment departs immediately.
      await tx_any.tradeShipment.create({
        data: {
          routeId: route.id,
          path: [p.destinationTerritoryId] as Prisma.InputJsonValue,
          transitTicksRemaining: path.length - 1,
          cargoAmount: baseCapacity,
          cargoResource: 'wealth',
          direction: 'forward',
          departedAtTick: ctx.currentTick,
        },
      });

      // Queue engine action so tick.ts processes it.
      await tx.queuedAction.create({
        data: {
          nationId: ctx.nationId,
          phase: ctx.currentPhase,
          type: 'establish_trade_route',
          payload: {
            ...route,
            path,
            shipments: [],
          } as Prisma.InputJsonValue,
          tickQueued: ctx.currentTick,
        },
      });
      await tx.nation.update({ where: { id: ctx.nationId }, data: { mandateUsed: { increment: cost } } });
    });
  },
};
