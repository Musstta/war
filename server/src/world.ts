import { Prisma } from '@prisma/client';

import type { TerritoryDef, TerritoryState, Territory, Nation, WorldState, CulturalFamily, Treaty, Proposal, TreatyClause, ClauseType, InstantTrade, TradeRoute, InstantTradeStatus, TradeResource, ObjectiveClause, ObjectiveType, ObjectiveStatus, ResponsibleParty, War, WarType, WarStatus, OccupiedTerritory, PeaceDeal } from '@war/engine';
import { prisma } from './db';

type TxClient = Prisma.TransactionClient;

// ── Loading ───────────────────────────────────────────────────────────────────

export async function loadWorldState(
  tx: TxClient,
  defs: TerritoryDef[],
): Promise<WorldState> {
  const meta = await tx.worldMeta.findUniqueOrThrow({ where: { id: 1 } });
  const nationRows = await tx.nation.findMany();
  const stateRows = await tx.territoryState.findMany();

  const stateById = new Map(stateRows.map((s) => [s.id, s]));

  const territories: Record<string, Territory> = {};
  for (const def of defs) {
    const s = stateById.get(def.id);
    if (!s) throw new Error(`No DB state row for territory "${def.id}"`);
    // Apply DB override for culturalFamily if set (admin tuning tool).
    const effectiveDef: TerritoryDef = s.culturalFamily
      ? { ...def, culturalFamily: s.culturalFamily as CulturalFamily }
      : def;
    territories[def.id] = {
      def: effectiveDef,
      state: {
        ownerId: s.ownerId,
        fortificationLevel: s.fortificationLevel,
        hasRoad: s.hasRoad,
        hasPort: s.hasPort,
        unrest: s.unrest,
        isInRevolt: s.isInRevolt,
        valueTraits: {
          individualist: s.individualist,
          progressive: s.progressive,
          militaristic: s.militaristic,
          expansionist: s.expansionist,
        },
        constructionType: (s.constructionType ?? null) as TerritoryState['constructionType'],
        constructionTicksLeft: s.constructionTicksLeft ?? null,
        pendingConstructionType: (s.pendingConstructionType ?? null) as TerritoryState['pendingConstructionType'],
        ownershipShock: s.ownershipShock,
        acquiredTick: s.acquiredTick ?? null,
        localPopStock: s.localPopStock,
        localIndStock: s.localIndStock,
        localWltStock: s.localWltStock,
      },
    };
  }

  const nations: Record<string, Nation> = {};
  for (const n of nationRows) {
    nations[n.id] = {
      id: n.id,
      name: n.name,
      isAI: n.isAI,
      stockpiles: {
        population: n.popStock,
        industry: n.indStock,
        wealth: n.wealthStock,
      },
      armySize: n.armySize,
      trust: n.trust,
      prestige: n.prestige,
      capitalTerritoryId: n.capitalTerritoryId ?? null,
      inactivityTier: n.inactivityTier,
      lastBrokenPromiseTick: n.lastBrokenPromiseTick ?? null,
    };
  }

  // Load active/degraded treaties and their parties/clauses (including objective clauses).
  const treatyRows = await tx.treaty.findMany({
    where: { status: { in: ['active', 'degraded'] } },
    include: { parties: true, clauses: { include: { objectiveClause: true } } },
  });
  const treaties: Treaty[] = treatyRows.map((t) => {
    const partyIds = t.parties.map((p) => p.nationId) as [string, string];
    const collateralByParty: Record<string, number> = {};
    const refundRemainingByParty: Record<string, number> = {};
    const refundStartTickByParty: Record<string, number | null> = {};
    const escrowAmountByParty: Record<string, number> = {};
    const escrowStartTickByParty: Record<string, number | null> = {};
    for (const p of t.parties) {
      collateralByParty[p.nationId] = p.collateralDeposited;
      refundRemainingByParty[p.nationId] = p.refundRemaining;
      refundStartTickByParty[p.nationId] = p.refundStartTick ?? null;
      escrowAmountByParty[p.nationId] = p.escrowAmount;
      escrowStartTickByParty[p.nationId] = p.escrowStartTick ?? null;
    }
    return {
      id: t.id,
      proposalId: t.proposalId,
      partyIds,
      clauses: t.clauses.map((c) => {
        const oc = (c as any).objectiveClause ?? null;
        const objective: ObjectiveClause | null = oc ? {
          id: oc.id,
          treatyClauseId: oc.treatyClauseId,
          objectiveType: oc.objectiveType as ObjectiveType,
          targetNationId: oc.targetNationId ?? null,
          targetTerritoryId: oc.targetTerritoryId ?? null,
          deadlineTicks: oc.deadlineTicks,
          status: oc.status as ObjectiveStatus,
          responsibleParty: oc.responsibleParty as ResponsibleParty,
        } : null;
        return {
          id: c.id,
          clauseIndex: c.clauseIndex,
          type: c.type as ClauseType,
          collateral: c.collateral,
          payload: c.payload as Record<string, unknown>,
          clauseStatus: c.clauseStatus,
          missedPayments: c.missedPayments,
          objective,
        };
      }),
      status: t.status,
      termTicks: t.termTicks,
      tickStarted: t.tickStarted,
      tickEnds: t.tickEnds,
      totalCollateral: t.totalCollateral,
      breakerNationId: t.breakerNationId,
      collateralByParty,
      refundRemainingByParty,
      refundStartTickByParty,
      escrowAmountByParty,
      escrowStartTickByParty,
    };
  });

  // Load pending proposals.
  const proposalRows = await tx.proposal.findMany({
    where: { status: 'pending' },
    include: { clauses: true },
  });
  const proposals: Proposal[] = proposalRows.map((p) => ({
    id: p.id,
    proposerId: p.proposerId,
    targetId: p.targetId,
    status: p.status,
    termTicks: p.termTicks,
    clauses: p.clauses.map((c, idx) => ({
      id: c.id,
      clauseIndex: idx,
      type: c.type as ClauseType,
      collateral: c.collateral,
      payload: c.payload as Record<string, unknown>,
      clauseStatus: 'active',
      missedPayments: 0,
      // Objective clause data for proposals is carried in the payload JSON;
      // the full ObjectiveClause record is created at treaty-acceptance time.
      objective: null,
    })),
    proposerCollateral: p.proposerCollateral,
    targetCollateral: p.targetCollateral,
    tickProposed: p.tickProposed,
    expiresAtTick: p.expiresAtTick,
    parentProposalId: p.parentProposalId,
  }));

  // Load pending instant trades (proposer queued, recipient hasn't responded yet).
  const itRows = await tx.instantTrade.findMany({ where: { status: 'pending' } });
  const instantTrades: InstantTrade[] = itRows.map((r) => ({
    id: r.id,
    proposerNationId: r.proposerNationId,
    targetNationId: r.targetNationId,
    resource: r.resource as TradeResource,
    amount: r.amount,
    sourceTerritoryId: r.sourceTerritoryId,
    status: r.status as InstantTradeStatus,
    tickProposed: r.tickProposed,
    expiresAtTick: r.expiresAtTick,
  }));

  // Load trade routes for active treaties.
  const activeTreatyIds = treaties.map((t) => t.id);
  const tradeRouteRows = activeTreatyIds.length > 0
    ? await tx.tradeRoute.findMany({
        where: { treatyClause: { treatyId: { in: activeTreatyIds } } },
      })
    : [];
  const tradeRoutes: TradeRoute[] = tradeRouteRows.map((r) => ({
    id: r.id,
    treatyClauseId: r.treatyClauseId,
    sourceTerritoryId: r.sourceTerritoryId,
    destinationNationId: r.destinationNationId,
    path: r.path as string[],
    pathComputedAtTick: r.pathComputedAtTick,
    pathStale: r.pathStale,
    capacity: r.capacity,
    friction: r.friction,
    isSeaRoute: r.isSeaRoute,
  }));

  // Load active wars (and recently-ended wars that may still have occupied territories).
  const warRows = await tx.war.findMany({
    where: { status: { in: ['active', 'peace_negotiation'] } },
  });
  const wars: War[] = warRows.map((w) => ({
    id: w.id,
    attackerId: w.attackerId,
    defenderId: w.defenderId,
    type: w.type as WarType,
    hasCasusBelli: w.hasCasusBelli,
    status: w.status as WarStatus,
    startTick: w.startTick,
    declaredTick: w.declaredTick,
    endTick: w.endTick ?? null,
    occupiedTerritories: (w.occupiedTerritories as OccupiedTerritory[]) ?? [],
    pendingPeaceDeal: (w.pendingPeaceDeal as PeaceDeal | null) ?? null,
    exhaustionByNation: ((w as any).exhaustionByNation as Record<string, number>) ?? {},
  }));

  // Event log is write-only from the engine's perspective; we don't need to load
  // history — resolveTick emits only the new entries for the current tick.
  return { tick: meta.tick, rngSeed: meta.rngSeed, territories, nations, eventLog: [], treaties, proposals, instantTrades, tradeRoutes, wars };
}

// ── Saving ────────────────────────────────────────────────────────────────────

export async function saveWorldState(tx: TxClient, world: WorldState): Promise<void> {
  await tx.worldMeta.update({ where: { id: 1 }, data: { tick: world.tick } });

  for (const nation of Object.values(world.nations)) {
    await tx.nation.update({
      where: { id: nation.id },
      data: {
        popStock: nation.stockpiles.population,
        indStock: nation.stockpiles.industry,
        wealthStock: nation.stockpiles.wealth,
        armySize: nation.armySize,
        trust: nation.trust,
        prestige: nation.prestige,
        capitalTerritoryId: nation.capitalTerritoryId,
        inactivityTier: nation.inactivityTier,
        lastBrokenPromiseTick: nation.lastBrokenPromiseTick,
      },
    });
  }

  // Persist treaty status changes from the engine (expiry, breaking) and escrow/refund progress.
  for (const treaty of world.treaties) {
    await tx.treaty.update({
      where: { id: treaty.id },
      data: {
        status: treaty.status,
        breakerNationId: treaty.breakerNationId,
      },
    });
    for (const [nationId, refundRemaining] of Object.entries(treaty.refundRemainingByParty)) {
      await tx.treatyParty.updateMany({
        where: { treatyId: treaty.id, nationId },
        data: {
          refundRemaining,
          escrowAmount: treaty.escrowAmountByParty[nationId] ?? 0,
          escrowStartTick: treaty.escrowStartTickByParty[nationId] ?? null,
          refundStartTick: treaty.refundStartTickByParty[nationId] ?? null,
        },
      });
    }
    // Persist clause status, missed payment changes, and objective clause status.
    for (const clause of treaty.clauses) {
      await tx.treatyClause.update({
        where: { id: clause.id },
        data: {
          clauseStatus: clause.clauseStatus,
          missedPayments: clause.missedPayments,
        },
      });
      if (clause.objective) {
        await tx.objectiveClause.update({
          where: { id: clause.objective.id },
          data: { status: clause.objective.status },
        });
      }
    }
  }

  // Persist proposal status changes (expired proposals updated by engine).
  for (const proposal of world.proposals) {
    if (proposal.status !== 'pending') {
      await tx.proposal.update({
        where: { id: proposal.id },
        data: { status: proposal.status },
      });
    }
  }

  // Persist instant trade status changes (accepted/declined/expired updated by engine).
  for (const trade of world.instantTrades) {
    if (trade.status !== 'pending') {
      await tx.instantTrade.update({
        where: { id: trade.id },
        data: { status: trade.status },
      });
    }
  }

  for (const [id, { state }] of Object.entries(world.territories)) {
    await tx.territoryState.update({
      where: { id },
      data: {
        ownerId: state.ownerId,
        fortificationLevel: state.fortificationLevel,
        hasRoad: state.hasRoad,
        hasPort: state.hasPort,
        unrest: state.unrest,
        isInRevolt: state.isInRevolt,
        individualist: state.valueTraits.individualist,
        progressive: state.valueTraits.progressive,
        militaristic: state.valueTraits.militaristic,
        expansionist: state.valueTraits.expansionist,
        constructionType: state.constructionType,
        constructionTicksLeft: state.constructionTicksLeft,
        pendingConstructionType: state.pendingConstructionType,
        ownershipShock: state.ownershipShock,
        acquiredTick: state.acquiredTick,
        localPopStock: state.localPopStock,
        localIndStock: state.localIndStock,
        localWltStock: state.localWltStock,
      },
    });
  }

  // Persist war state changes (occupied territories, status, army sizes already persisted via Nation).
  for (const war of world.wars) {
    await tx.war.update({
      where: { id: war.id },
      data: {
        status: war.status,
        endTick: war.endTick,
        occupiedTerritories: war.occupiedTerritories as Prisma.InputJsonValue,
        pendingPeaceDeal: war.pendingPeaceDeal != null
          ? war.pendingPeaceDeal as unknown as Prisma.InputJsonValue
          : Prisma.JsonNull,
        exhaustionByNation: war.exhaustionByNation as Prisma.InputJsonValue,
      },
    });
  }

  // Tribute-treaty creation: engine emits a structured [TRIBUTE_TREATY] event log entry
  // when a peace deal includes tribute. Parse and create the Treaty row here.
  for (const entry of world.eventLog) {
    if (!entry.message.startsWith('[TRIBUTE_TREATY]')) continue;
    // Parse: [TRIBUTE_TREATY] warId=N fromNationId=X toNationId=Y amount=Z ticks=W
    const m = entry.message.match(
      /\[TRIBUTE_TREATY\] warId=(\d+) fromNationId=(\S+) toNationId=(\S+) amount=([\d.]+) ticks=(\d+)/,
    );
    if (!m) continue;
    const [, , fromNationId, toNationId, amountStr, ticksStr] = m;
    const amount = parseFloat(amountStr!);
    const termTicks = parseInt(ticksStr!, 10);
    const currentTick = world.tick;

    // Create a minimal tribute-only treaty via the Proposal→Treaty path.
    // We create a Proposal row and immediately accept it in one transaction.
    const proposal = await tx.proposal.create({
      data: {
        proposerId: fromNationId!,
        targetId: toNationId!,
        status: 'accepted',
        termTicks,
        proposerCollateral: 0,
        targetCollateral: 0,
        tickProposed: currentTick,
        expiresAtTick: currentTick, // already accepted
      },
    });

    await tx.proposalClause.create({
      data: {
        proposalId: proposal.id,
        type: 'tribute',
        collateral: 0,
        payload: { amount, fromNationId, toNationId } as Prisma.InputJsonValue,
      },
    });

    const treaty = await tx.treaty.create({
      data: {
        proposalId: proposal.id,
        status: 'active',
        termTicks,
        tickStarted: currentTick,
        tickEnds: currentTick + termTicks,
        totalCollateral: 0,
      },
    });

    // TreatyParty rows for both nations.
    for (const nationId of [fromNationId!, toNationId!]) {
      await tx.treatyParty.create({
        data: {
          treatyId: treaty.id,
          nationId,
          collateralDeposited: 0,
        },
      });
    }

    // TreatyClause row.
    await tx.treatyClause.create({
      data: {
        treatyId: treaty.id,
        clauseIndex: 0,
        type: 'tribute',
        collateral: 0,
        payload: { amount, fromNationId, toNationId } as Prisma.InputJsonValue,
        clauseStatus: 'active',
      },
    });
  }

  // Delete queued attack_territory actions for ended wars so they don't fire next tick.
  const endedWarIds = world.wars
    .filter((w) => w.status === 'ended')
    .map((w) => w.id);
  if (endedWarIds.length > 0) {
    // Find belligerents for ended wars and delete their pending attack actions.
    const endedWars = world.wars.filter((w) => w.status === 'ended');
    for (const war of endedWars) {
      await tx.queuedAction.deleteMany({
        where: {
          type: 'attack_territory',
          nationId: { in: [war.attackerId, war.defenderId] },
        },
      });
    }
  }

  if (world.eventLog.length > 0) {
    await tx.eventLog.createMany({ data: world.eventLog });
  }

  // ── Prestige computation ──────────────────────────────────────────────────────
  // Computed from fresh DB state after all other saves have committed.
  // All weights [PLACEHOLDER] — tune once full action set exists.
  const [allTerritories, allTreaties, allWars] = await Promise.all([
    tx.territoryState.findMany({ select: { ownerId: true, unrest: true } }),
    tx.treaty.findMany({ where: { status: { in: ['active', 'degraded'] } }, include: { parties: true } }),
    tx.war.findMany({ where: { status: 'ended' }, select: { attackerId: true, defenderId: true, occupiedTerritories: true } }),
  ]);

  // Territory count + average unrest per nation.
  const territoryCounts: Record<string, number> = {};
  const unrestSumByNation: Record<string, number> = {};
  for (const t of allTerritories) {
    if (!t.ownerId) continue;
    territoryCounts[t.ownerId] = (territoryCounts[t.ownerId] ?? 0) + 1;
    unrestSumByNation[t.ownerId] = (unrestSumByNation[t.ownerId] ?? 0) + t.unrest;
  }

  // Active treaty count per nation.
  const treatyCountByNation: Record<string, number> = {};
  for (const treaty of allTreaties) {
    for (const party of treaty.parties) {
      treatyCountByNation[party.nationId] = (treatyCountByNation[party.nationId] ?? 0) + 1;
    }
  }
  // Avoid double-counting (each treaty has 2 parties → counted twice, divide by 2 via distinct treaty).
  // Actually each nation-party is stored separately so the count is correct as-is.
  // But treaties with 2 parties each contribute 1 to each nation's count, which is correct.

  // Wars won: ended wars where the nation was the attacker and gained territory
  // (has non-empty occupiedTerritories that were transferred via cession).
  // Simpler proxy: attacker of an ended war where they captured at least one territory
  // (occupiedTerritories empty at end means capture resolved — use separate query).
  // Best proxy available without richer data: count ended wars by attackerId.
  const warsWonByNation: Record<string, number> = {};
  for (const war of allWars) {
    // A war win is when the attacker achieved something — check ended wars.
    // [PLACEHOLDER] full "won" detection deferred; for now: attacker of any ended war.
    warsWonByNation[war.attackerId] = (warsWonByNation[war.attackerId] ?? 0) + 1;
  }

  // Compute and save prestige for each nation.
  for (const nation of Object.values(world.nations)) {
    const tCount = territoryCounts[nation.id] ?? 0;
    const tTreaties = treatyCountByNation[nation.id] ?? 0;
    const avgUnrest = tCount > 0 ? (unrestSumByNation[nation.id] ?? 0) / tCount : 0;
    const warsWon = warsWonByNation[nation.id] ?? 0;

    const prestige = Math.round(
      tCount * 10 +                   // [PLACEHOLDER] territory weight
      tTreaties * 5 +                  // [PLACEHOLDER] diplomacy weight
      (avgUnrest < 0.3 ? 20 : 0) +    // [PLACEHOLDER] stability bonus
      warsWon * 15,                    // [PLACEHOLDER] war-win weight
    );

    await tx.nation.update({
      where: { id: nation.id },
      data: { prestige },
    });
  }
}

// ── First-run initialization ──────────────────────────────────────────────────
// Phase 3: 5 player nations, each starting with 1 home territory.
// Unclaimed at start: mexico_yucatan, belize, el_salvador.
// To reset an existing world run POST /admin/reset-world (requires X-Admin-Key).

const INITIAL_NATIONS = [
  { id: 'nation_costa_rica', name: 'Costa Rica',  isAI: false, armySize: 50, territories: ['costa_rica'] },
  { id: 'nation_guatemala',  name: 'Guatemala',   isAI: false, armySize: 50, territories: ['guatemala'] },
  { id: 'nation_honduras',   name: 'Honduras',    isAI: false, armySize: 50, territories: ['honduras'] },
  { id: 'nation_nicaragua',  name: 'Nicaragua',   isAI: false, armySize: 50, territories: ['nicaragua'] },
  { id: 'nation_panama',     name: 'Panamá',      isAI: false, armySize: 50, territories: ['panama'] },
] as const;

export async function ensureWorldInitialized(defs: TerritoryDef[]): Promise<void> {
  const existing = await prisma.worldMeta.findUnique({ where: { id: 1 } });
  if (existing) return;

  console.log('[world] First run — initializing world state...');

  await prisma.$transaction(async (tx) => {
    await tx.worldMeta.create({ data: { id: 1, tick: 0, rngSeed: 42 } });

    const ownerOf = new Map<string, string>();
    for (const n of INITIAL_NATIONS) {
      await tx.nation.create({
        data: {
          id: n.id,
          name: n.name,
          isAI: n.isAI,
          armySize: n.armySize,
          capitalTerritoryId: n.territories[0],
          inactivityTier: 'active',
        },
      });
      for (const tid of n.territories) ownerOf.set(tid, n.id);
    }

    for (const def of defs) {
      await tx.territoryState.create({
        data: {
          id: def.id,
          ownerId: ownerOf.get(def.id) ?? null,
          individualist: def.valueTraits.individualist,
          progressive: def.valueTraits.progressive,
          militaristic: def.valueTraits.militaristic,
          expansionist: def.valueTraits.expansionist,
        },
      });
    }
  });

  console.log('[world] World initialized at tick 0.');
}
