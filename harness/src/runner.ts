/**
 * Core scenario runner — pure engine, no DB, no HTTP.
 */
import { resolve } from 'path';
import type { WorldState, QueuedAction, TerritoryDef, CulturalFamily, Treaty, ClauseType } from '@war/engine';
import {
  loadTerritoryDefs,
  buildWorldState,
  resolveTick,
  computeNationCulture,
  computeCompatibility,
  computeConquestShock,
  TRUST_BREAK_PENALTY,
  ESCROW_SKIM_RATE,
  DEGRADATION_REFUND_TICKS,
} from '@war/engine';
import type { Scenario, RunResult } from './types';
import { captureSnapshot } from './snapshot';

const DATA_FILE = process.env.WAR_DATA_FILE ?? resolve(__dirname, '../../data/territories.seed.json');

export function run(scenario: Scenario): RunResult {
  const defs = loadTerritoryDefs(DATA_FILE);
  const defById = new Map(defs.map((d) => [d.id, d]));

  // Build initial world from scenario nations.
  const nationInits = scenario.world.nations.map((n) => ({
    id: n.id,
    name: n.name,
    isAI: false,
    startingTerritoryIds: n.territories,
    armySize: n.armySize ?? 50,
  }));

  let world = buildWorldState(defs, nationInits, scenario.rngSeed ?? 42);

  // Apply capital and stockpile overrides.
  for (const n of scenario.world.nations) {
    const nation = world.nations[n.id];
    if (!nation) continue;
    const hasOverride = n.capitalTerritoryId || n.wealthStock !== undefined || n.industryStock !== undefined || n.populationStock !== undefined;
    if (hasOverride) {
      world = {
        ...world,
        nations: {
          ...world.nations,
          [n.id]: {
            ...nation,
            capitalTerritoryId: n.capitalTerritoryId ?? nation.capitalTerritoryId,
            stockpiles: {
              population: n.populationStock ?? nation.stockpiles.population,
              industry:   n.industryStock   ?? nation.stockpiles.industry,
              wealth:     n.wealthStock     ?? nation.stockpiles.wealth,
            },
          },
        },
      };
    }
  }

  // Apply per-territory attribute overrides.
  if (scenario.world.territoryOverrides) {
    for (const [tid, overrides] of Object.entries(scenario.world.territoryOverrides)) {
      const t = world.territories[tid];
      if (!t) continue;
      const newDef = overrides.culturalFamily
        ? { ...t.def, culturalFamily: overrides.culturalFamily as CulturalFamily }
        : t.def;
      const newState = {
        ...t.state,
        valueTraits: {
          individualist: overrides.individualist ?? t.state.valueTraits.individualist,
          progressive: overrides.progressive ?? t.state.valueTraits.progressive,
          militaristic: overrides.militaristic ?? t.state.valueTraits.militaristic,
          expansionist: overrides.expansionist ?? t.state.valueTraits.expansionist,
        },
        unrest: overrides.unrest ?? t.state.unrest,
      };
      world = { ...world, territories: { ...world.territories, [tid]: { def: newDef, state: newState } } };
    }
  }

  const snapshots: RunResult['snapshots'] = [];
  snapshots.push(captureSnapshot(world, 0, defs));

  // Group actions by tick for fast lookup.
  const actionsByTick = new Map<number, typeof scenario.actions extends undefined ? never[] : NonNullable<typeof scenario.actions>>();
  for (const action of scenario.actions ?? []) {
    if (!actionsByTick.has(action.tick)) actionsByTick.set(action.tick, []);
    actionsByTick.get(action.tick)!.push(action);
  }

  for (let i = 1; i <= scenario.ticks; i++) {
    const tickActions = actionsByTick.get(i) ?? [];
    const engineActions: QueuedAction[] = [];

    for (const action of tickActions) {
      const p = action.payload;

      if (action.type === 'create_treaty') {
        // Directly place an active treaty into world state.
        // payload: { id, partyIds: [nA, nB], clauses: [{type, collateral, payload}], termTicks, collateralByParty: {nA: x, nB: y} }
        const p = action.payload;
        const partyIds = p['partyIds'] as [string, string];
        const termTicks = p['termTicks'] as number;
        const clauseDefs = (p['clauses'] as Array<{ type: string; collateral?: number; payload?: Record<string, unknown> }>) ?? [];
        const collateralByParty = (p['collateralByParty'] as Record<string, number>) ?? {};
        const totalCollateral = Object.values(collateralByParty).reduce((s, v) => s + v, 0);

        let clauseAutoId = 1000; // stable IDs for harness-created clauses
        const treaty: Treaty = {
          id: (p['id'] as number) ?? (world.treaties.length + 1),
          proposalId: 0,
          partyIds,
          clauses: clauseDefs.map((c) => {
            const clauseId = clauseAutoId++;
            const isObjective = c.type === 'objective';
            const objPayload = c.payload as Record<string, unknown> | undefined;
            const objective = isObjective && objPayload ? {
              id: clauseAutoId++,
              treatyClauseId: clauseId,
              objectiveType: (objPayload['objectiveType'] as import('@war/engine').ObjectiveType) ?? 'maintain_peace',
              targetNationId: (objPayload['targetNationId'] as string | undefined) ?? null,
              targetTerritoryId: (objPayload['targetTerritoryId'] as string | undefined) ?? null,
              deadlineTicks: (objPayload['deadlineTicks'] as number) ?? termTicks,
              status: 'pending' as import('@war/engine').ObjectiveStatus,
              responsibleParty: (objPayload['responsibleParty'] as import('@war/engine').ResponsibleParty) ?? 'partyA',
            } : null;
            return {
              id: clauseId,
              clauseIndex: clauseAutoId - 1001,
              type: c.type as ClauseType,
              collateral: c.collateral ?? 0,
              payload: c.payload ?? {},
              clauseStatus: 'active',
              missedPayments: 0,
              objective,
            };
          }),
          status: 'active',
          termTicks,
          tickStarted: world.tick,
          tickEnds: world.tick + termTicks,
          totalCollateral,
          breakerNationId: null,
          collateralByParty,
          refundRemainingByParty: Object.fromEntries(partyIds.map((id) => [id, 0])),
          refundStartTickByParty: Object.fromEntries(partyIds.map((id) => [id, null])),
          escrowAmountByParty: Object.fromEntries(partyIds.map((id) => [id, 0])),
          escrowStartTickByParty: Object.fromEntries(partyIds.map((id) => [id, null])),
        };

        // Deduct collateral from each party's Wealth stockpile.
        const newNations = { ...world.nations };
        for (const [nid, amount] of Object.entries(collateralByParty)) {
          const n = newNations[nid];
          if (n) newNations[nid] = { ...n, stockpiles: { ...n.stockpiles, wealth: Math.max(0, n.stockpiles.wealth - amount) } };
        }

        world = { ...world, nations: newNations, treaties: [...world.treaties, treaty] };

      } else if (action.type === 'break_treaty') {
        // Voluntarily break a treaty: Trust penalty, collateral transfer.
        const p = action.payload;
        const treatyId = p['treatyId'] as number;
        const breakerNationId = p['breakerNationId'] as string;

        const tIdx = world.treaties.findIndex((t) => t.id === treatyId);
        if (tIdx === -1) { console.warn(`[harness] break_treaty: treaty ${treatyId} not found`); continue; }

        const treaty = world.treaties[tIdx]!;
        const wrongedNationId = treaty.partyIds.find((id) => id !== breakerNationId);
        if (!wrongedNationId) { console.warn(`[harness] break_treaty: breaker not in treaty ${treatyId}`); continue; }

        const newNations = { ...world.nations };

        // Trust penalty for breaker.
        const breaker = newNations[breakerNationId];
        if (breaker) newNations[breakerNationId] = { ...breaker, trust: Math.max(0, breaker.trust - TRUST_BREAK_PENALTY), lastBrokenPromiseTick: world.tick };

        // Collateral: breaker's deposit goes to wronged party; wronged party's deposit returned.
        const breakerCollateral = treaty.collateralByParty[breakerNationId] ?? 0;
        const wrongedCollateral = treaty.collateralByParty[wrongedNationId] ?? 0;
        const wronged = newNations[wrongedNationId];
        if (wronged) newNations[wrongedNationId] = { ...wronged, stockpiles: { ...wronged.stockpiles, wealth: wronged.stockpiles.wealth + breakerCollateral + wrongedCollateral } };

        const brokenTreaty: Treaty = { ...treaty, status: 'broken', breakerNationId };
        const newTreaties = [...world.treaties];
        newTreaties[tIdx] = brokenTreaty;

        world = { ...world, nations: newNations, treaties: newTreaties };

        // Emit event log entry.
        world = { ...world, eventLog: [...world.eventLog, { tick: world.tick + 1, message: `[harness] ${breakerNationId} broke treaty #${treatyId}. Trust −${TRUST_BREAK_PENALTY}. Collateral transferred.` }] };

      } else if (action.type === 'set_nation_tier') {
        // Set inactivityTier; apply degradation (Dormant) or upgrade (active) logic.
        const p = action.payload;
        const nationId = p['nationId'] as string;
        const tier = p['tier'] as string;

        const newNations = { ...world.nations };
        const nation = newNations[nationId];
        if (!nation) { console.warn(`[harness] set_nation_tier: nation ${nationId} not found`); continue; }
        newNations[nationId] = { ...nation, inactivityTier: tier };

        const newTreaties = [...world.treaties];

        if (tier === 'dormant') {
          // Degrade active treaties: move inactive party's collateral to escrow, start active partner's refund.
          for (let idx = 0; idx < newTreaties.length; idx++) {
            const t = newTreaties[idx]!;
            if (t.status !== 'active') continue;
            if (!t.partyIds.includes(nationId)) continue;
            const activePartnerId = t.partyIds.find((id) => id !== nationId)!;
            const inactiveCollateral = t.collateralByParty[nationId] ?? 0;
            const activeCollateral = t.collateralByParty[activePartnerId] ?? 0;
            newTreaties[idx] = {
              ...t,
              status: 'degraded',
              collateralByParty: { ...t.collateralByParty, [nationId]: 0, [activePartnerId]: 0 },
              escrowAmountByParty: { ...t.escrowAmountByParty, [nationId]: inactiveCollateral },
              escrowStartTickByParty: { ...t.escrowStartTickByParty, [nationId]: world.tick },
              refundRemainingByParty: { ...t.refundRemainingByParty, [activePartnerId]: activeCollateral },
              refundStartTickByParty: { ...t.refundStartTickByParty, [activePartnerId]: world.tick },
            };
          }
        } else if (tier === 'active') {
          // Upgrade degraded treaties: apply escrow skim, return remainder.
          for (let idx = 0; idx < newTreaties.length; idx++) {
            const t = newTreaties[idx]!;
            if (t.status !== 'degraded') continue;
            if (!t.partyIds.includes(nationId)) continue;
            const escrow = t.escrowAmountByParty[nationId] ?? 0;
            const skim = escrow * ESCROW_SKIM_RATE;
            const refund = escrow - skim;
            const n = newNations[nationId];
            if (n) newNations[nationId] = { ...n, stockpiles: { ...n.stockpiles, wealth: n.stockpiles.wealth + refund } };
            newTreaties[idx] = {
              ...t,
              status: 'active',
              collateralByParty: { ...t.collateralByParty, [nationId]: refund },
              escrowAmountByParty: { ...t.escrowAmountByParty, [nationId]: 0 },
              escrowStartTickByParty: { ...t.escrowStartTickByParty, [nationId]: null },
            };
          }
        }

        world = { ...world, nations: newNations, treaties: newTreaties };

      } else if (action.type === 'assign_territory') {
        const tid = p['territoryId'] as string;
        const newOwnerId = (p['ownerId'] as string | null) ?? null;
        const t = world.territories[tid];
        if (!t) continue;

        // Compute compat-scaled shock from the NEW owner's existing culture.
        let shock = 0;
        if (newOwnerId) {
          const nc = computeNationCulture(newOwnerId, world.territories, world.nations[newOwnerId]?.capitalTerritoryId ?? null);
          const compat = computeCompatibility(t.state.valueTraits, t.def.culturalFamily, nc);
          shock = computeConquestShock(compat);
        }

        world = {
          ...world,
          territories: {
            ...world.territories,
            [tid]: {
              ...t,
              state: { ...t.state, ownerId: newOwnerId, ownershipShock: shock, acquiredTick: world.tick },
            },
          },
        };

      } else if (action.type === 'set_unrest') {
        const tid = p['territoryId'] as string;
        const value = p['value'] as number;
        const t = world.territories[tid];
        if (t) {
          world = {
            ...world,
            territories: { ...world.territories, [tid]: { ...t, state: { ...t.state, unrest: value } } },
          };
        }

      } else {
        // Pass-through to engine: derive nationId from territory owner.
        const tid = p['territoryId'] as string | undefined;
        const nationId = tid ? (world.territories[tid]?.state.ownerId ?? null) : null;
        if (!nationId) continue;

        let payload = { ...p, nationId };
        if (action.type === 'build_fort' && !payload['targetLevel']) {
          const fortLevel = (world.territories[tid!]?.state.fortificationLevel ?? 0) + 1;
          payload = { ...payload, targetLevel: fortLevel };
        }

        engineActions.push({ nationId, type: action.type, payload });
      }
    }

    const result = resolveTick(world, engineActions);
    world = result.world;

    snapshots.push(captureSnapshot(world, world.tick, defs));
  }

  return { scenario, snapshots };
}
