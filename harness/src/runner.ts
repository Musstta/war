/**
 * Core scenario runner — pure engine, no DB, no HTTP.
 */
import { resolve } from 'path';
import type { WorldState, QueuedAction, TerritoryDef, CulturalFamily, Treaty, ClauseType, War, PeaceDeal, PeaceDealType, Territorycessation, DoctrineBlend, EmbassyStatus, VisEmbassyInput, TradeRoute } from '@war/engine';
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
  PROPOSAL_EXPIRY_TICKS,
  scoreAction,
  BALANCED_DOCTRINE,
  deriveDoctrineBlend,
  computeVisibility,
  VisibilityTier,
} from '@war/engine';
import type { Scenario, RunResult, AssertionError } from './types';
import { captureSnapshot } from './snapshot';

const DATA_FILE = process.env.WAR_DATA_FILE ?? resolve(__dirname, '../../data/territories.seed.json');

export function run(scenario: Scenario): RunResult {
  const defs = loadTerritoryDefs(DATA_FILE);
  const defById = new Map(defs.map((d) => [d.id, d]));

  // Build initial world from scenario nations.
  const nationInits = scenario.world.nations.map((n) => ({
    id: n.id,
    name: n.name,
    isAI: n.isAI ?? false,
    startingTerritoryIds: n.territories,
    armySize: n.armySize ?? 50,
  }));

  let world = buildWorldState(defs, nationInits, scenario.rngSeed ?? 42);

  // Seed one army per nation from armySize (harness backward compat). // migrated from armySize
  // armySize: 0 means no army (used in scenarios that need army-absent visibility testing).
  const seededArmies: import('@war/engine').Army[] = nationInits.map((n, i) => ({
    id: 8000 + i + 1,
    nationId: n.id,
    territoryId: n.startingTerritoryIds[0] ?? '',
    size: n.armySize ?? 50,
    status: 'stationed' as import('@war/engine').ArmyStatus,
    destinationTerritoryId: null,
    movedThisTick: false,
    transitPath: [],
    transitTicksRemaining: 0,
  })).filter((a) => a.territoryId !== '' && a.size > 0);
  world = { ...world, armies: seededArmies };

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

  // Side map for abandonment: tick when each nation entered Abandoned state.
  const abandonedAtTickByNation = new Map<string, number>();

  // Assertion errors collected across all ticks.
  const assertionErrors: AssertionError[] = [];

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
        // Set inactivityTier + activityTier; apply degradation (Dormant) or upgrade (active) logic.
        const p = action.payload;
        const nationId = p['nationId'] as string;
        const tier = p['tier'] as string;

        const newNations = { ...world.nations };
        const nation = newNations[nationId];
        if (!nation) { console.warn(`[harness] set_nation_tier: nation ${nationId} not found`); continue; }
        newNations[nationId] = { ...nation, inactivityTier: tier, activityTier: tier };
        // Track abandonedAt tick for fragmentation computation.
        if (tier === 'abandoned') abandonedAtTickByNation.set(nationId, world.tick);

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

      } else if (action.type === 'set_fort_level') {
        // Directly set fortificationLevel on a territory.
        const tid = p['territoryId'] as string;
        const level = p['level'] as number;
        const t = world.territories[tid];
        if (t) {
          world = {
            ...world,
            territories: { ...world.territories, [tid]: { ...t, state: { ...t.state, fortificationLevel: level } } },
          };
        }

      } else if (action.type === 'declare_war') {
        // Inject a War directly into world.wars (harness equivalent of server declareWar).
        // payload: { warId, attackerId, defenderId, hasCasusBelli?, type? }
        const war: War = {
          id: p['warId'] as number,
          attackerId: p['attackerId'] as string,
          defenderId: p['defenderId'] as string,
          type: (p['type'] as 'conquest' | 'raid') ?? 'conquest',
          hasCasusBelli: (p['hasCasusBelli'] as boolean) !== false,
          status: 'active',
          startTick: world.tick,
          declaredTick: world.tick,
          endTick: null,
          occupiedTerritories: [],
          pendingPeaceDeal: null,
          exhaustionByNation: {},
        };

        // Apply no-CB Trust penalty if hasCasusBelli is false.
        const newNationsForWar = { ...world.nations };
        if (!war.hasCasusBelli) {
          const attacker = newNationsForWar[war.attackerId];
          if (attacker) {
            newNationsForWar[war.attackerId] = { ...attacker, trust: Math.max(0, attacker.trust - 10) };
          }
        }

        world = { ...world, nations: newNationsForWar, wars: [...world.wars, war] };

        // Emit event log entry.
        const attackerName = world.nations[war.attackerId]?.name ?? war.attackerId;
        const defenderName = world.nations[war.defenderId]?.name ?? war.defenderId;
        const cbNote = war.hasCasusBelli ? '' : ' without justification';
        world = { ...world, eventLog: [...world.eventLog, { tick: world.tick + 1, message: `${attackerName} declared war on ${defenderName}${cbNote}.` }] };

      } else if (action.type === 'propose_peace') {
        // Set pendingPeaceDeal on a war and transition to peace_negotiation.
        // payload: { warId, proposingNationId, terms: { warType, territoryCessions, tributeWealth, tributeTicks } }
        const warId = p['warId'] as number;
        const proposingNationId = p['proposingNationId'] as string;
        const terms = p['terms'] as { warType: PeaceDealType; territoryCessions: Territorycessation[]; tributeWealth: number; tributeTicks: number };
        const deal: PeaceDeal = {
          proposingNationId,
          proposedAtTick: world.tick,
          warType: terms.warType,
          territoryCessions: terms.territoryCessions ?? [],
          tributeWealth: terms.tributeWealth ?? 0,
          tributeTicks: terms.tributeTicks ?? 0,
        };
        const warIdx = world.wars.findIndex((w) => w.id === warId);
        if (warIdx !== -1) {
          const updatedWars = [...world.wars];
          updatedWars[warIdx] = { ...world.wars[warIdx]!, status: 'peace_negotiation', pendingPeaceDeal: deal };
          world = { ...world, wars: updatedWars };
        }

      } else if (action.type === 'attack_territory') {
        // Engine pass-through with explicit nationId (attacker may not own the target territory).
        const nationId = p['nationId'] as string | undefined;
        if (!nationId) { console.warn('[harness] attack_territory requires explicit nationId in payload'); continue; }
        engineActions.push({ nationId, type: 'attack_territory', payload: p });

      } else if (action.type === 'accept_peace') {
        // Engine pass-through with explicit nationId.
        const nationId = p['nationId'] as string | undefined;
        if (!nationId) { console.warn('[harness] accept_peace requires explicit nationId in payload'); continue; }
        engineActions.push({ nationId, type: 'accept_peace', payload: p });

      } else if (action.type === 'set_army_size') {
        // Set the nation's first army size (creates one if missing). Direct test setup.
        // payload: { nationId, size }
        const nationId = p['nationId'] as string;
        const size = p['size'] as number;
        const nation = world.nations[nationId];
        if (!nation) { console.warn(`[harness] set_army_size: nation ${nationId} not found`); continue; }
        const existingIdx = world.armies.findIndex((a) => a.nationId === nationId);
        if (existingIdx !== -1) {
          const updatedArmies = [...world.armies];
          updatedArmies[existingIdx] = { ...world.armies[existingIdx]!, size };
          world = { ...world, armies: updatedArmies };
        } else {
          const capitalId = nation.capitalTerritoryId ?? Object.entries(world.territories).find(([, t]) => t.state.ownerId === nationId)?.[0] ?? '';
          const newArmy = {
            id: 9000 + world.armies.length + 1,
            nationId,
            territoryId: capitalId,
            size,
            status: 'stationed' as import('@war/engine').ArmyStatus,
            destinationTerritoryId: null,
            movedThisTick: false,
            transitPath: [] as string[],
            transitTicksRemaining: 0,
          };
          world = { ...world, armies: [...world.armies, newArmy] };
        }
        // Also update nation.armySize for backward compat. // migrated from armySize
        world = { ...world, nations: { ...world.nations, [nationId]: { ...nation, armySize: size } } };

      } else if (action.type === 'move_army') {
        // Engine pass-through: move the nation's first army.
        const nationId = p['nationId'] as string | undefined;
        if (!nationId) { console.warn('[harness] move_army requires explicit nationId'); continue; }
        const toTerritoryId = p['toTerritoryId'] as string | undefined;
        if (!toTerritoryId) { console.warn('[harness] move_army requires toTerritoryId'); continue; }
        // Find the army and get its id.
        const army = world.armies.find((a) => a.nationId === nationId);
        if (!army) { console.warn(`[harness] move_army: no army found for ${nationId}`); continue; }
        engineActions.push({ nationId, type: 'move_army', payload: { armyId: army.id, toTerritoryId } });

      } else if (action.type === 'claim_territory') {
        // Engine pass-through: claim an adjacent unclaimed territory.
        const nationId = p['nationId'] as string | undefined;
        if (!nationId) { console.warn('[harness] claim_territory requires explicit nationId'); continue; }
        engineActions.push({ nationId, type: 'claim_territory', payload: p });

      } else if (action.type === 'assert_visibility') {
        // Visibility assertion: deferred until after this tick resolves.
        // Collected here and processed below after resolveTick.
        // No world mutation — assertions are read-only checks.
        continue; // handled in post-tick assertion pass

      } else if (action.type === 'set_ai_doctrine') {
        // Assign a doctrineBlend to a nation (for testing specific doctrine behaviors).
        // payload: { nationId, doctrine: { expansionist, merchant, industrialist, militarist, isolationist } }
        const nationId = p['nationId'] as string;
        const doctrine = p['doctrine'] as DoctrineBlend;
        const nation = world.nations[nationId];
        if (!nation) { console.warn(`[harness] set_ai_doctrine: nation ${nationId} not found`); continue; }
        world = {
          ...world,
          nations: {
            ...world.nations,
            [nationId]: { ...nation, isAI: true, doctrineBlend: doctrine },
          },
        };

      } else if (action.type === 'set_trade_route') {
        // Harness: inject a TradeRoute directly into world.tradeRoutes.
        // Required for tradeStability equilibrium component tests (server populates routes from DB;
        // harness must inject them explicitly).
        // payload: { id, treatyClauseId, sourceTerritoryId, destinationNationId, path }
        const routeId = p['id'] as number ?? (9000 + world.tradeRoutes.length + 1);
        const route: TradeRoute = {
          id: routeId,
          treatyClauseId: p['treatyClauseId'] as number ?? 0,
          sourceTerritoryId: p['sourceTerritoryId'] as string,
          destinationNationId: p['destinationNationId'] as string,
          path: p['path'] as string[] ?? [],
          pathComputedAtTick: world.tick,
          pathStale: false,
          capacity: null,
          friction: null,
          isSeaRoute: (p['isSeaRoute'] as boolean) ?? false,
        };
        world = { ...world, tradeRoutes: [...world.tradeRoutes, route] };

      } else if (action.type === 'establish_trade_route') {
        // Harness: inject a TradeRouteAgreement directly into world.tradeRouteAgreements.
        // payload: { ownerNationId, sourceTerritoryId, destinationTerritoryId, type?, baseCapacity?, currentCapacity? }
        const ownerNationId = p['ownerNationId'] as string;
        const sourceTerritoryId = p['sourceTerritoryId'] as string;
        const destinationTerritoryId = p['destinationTerritoryId'] as string;
        if (!ownerNationId || !sourceTerritoryId || !destinationTerritoryId) {
          console.warn('[harness] establish_trade_route requires ownerNationId, sourceTerritoryId, destinationTerritoryId');
          continue;
        }
        const routeType = (p['type'] as string) ?? 'domestic';
        const baseCapacity = (p['baseCapacity'] as number) ?? 5;
        const currentCapacity = (p['currentCapacity'] as number) ?? baseCapacity;
        const growthCap = baseCapacity * 1.5;
        const routeId = 9100 + (world.tradeRouteAgreements ?? []).length + 1;
        world = {
          ...world,
          tradeRouteAgreements: [
            ...(world.tradeRouteAgreements ?? []),
            {
              id: routeId,
              treatyClauseId: null,
              ownerNationId,
              partnerNationId: (p['partnerNationId'] as string | undefined) ?? null,
              type: routeType as import('@war/engine').TradeRouteType,
              sourceTerritoryId,
              destinationTerritoryId,
              path: [sourceTerritoryId, destinationTerritoryId],
              pathComputedAtTick: world.tick,
              portLevel: (p['portLevel'] as number) ?? 1,
              baseCapacity,
              currentCapacity,
              growthCap,
              cyclesCompleted: (p['cyclesCompleted'] as number) ?? 0,
              profitMultiplier: (p['profitMultiplier'] as number) ?? 1.0,
              upkeepRate: (p['upkeepRate'] as number) ?? 0.1,
              status: 'active' as const,
              startedAtTick: world.tick,
              shipments: [{
                id: -(routeId * 100 + 1),
                routeId,
                path: [destinationTerritoryId],
                transitTicksRemaining: 1,
                cargoAmount: currentCapacity,
                cargoResource: 'wealth' as import('@war/engine').TradeResource,
                direction: 'forward' as const,
                departedAtTick: world.tick,
              }],
            },
          ],
        };

      } else if (action.type === 'renew_trade_route') {
        // Harness: simulate treaty renewal for a trade_route. Finds the active route by
        // sourceTerritoryId+destinationTerritoryId, marks it ended, and injects a new route
        // with currentCapacity and cyclesCompleted carried forward.
        // payload: { ownerNationId, sourceTerritoryId, destinationTerritoryId, type?, baseCapacity? }
        const ownerNationId = p['ownerNationId'] as string;
        const sourceTerritoryId = p['sourceTerritoryId'] as string;
        const destinationTerritoryId = p['destinationTerritoryId'] as string;
        if (!ownerNationId || !sourceTerritoryId || !destinationTerritoryId) {
          console.warn('[harness] renew_trade_route requires ownerNationId, sourceTerritoryId, destinationTerritoryId');
          continue;
        }
        const existing = (world.tradeRouteAgreements ?? []).find(
          (r) => r.sourceTerritoryId === sourceTerritoryId && r.destinationTerritoryId === destinationTerritoryId && r.status === 'active',
        );
        if (!existing) {
          console.warn(`[harness] renew_trade_route: no active route from ${sourceTerritoryId} to ${destinationTerritoryId}`);
          continue;
        }
        // End old route without loss event.
        const updatedRoutes = (world.tradeRouteAgreements ?? []).map((r) =>
          r.id === existing.id ? { ...r, status: 'ended' as const } : r,
        );
        const newRouteId = 9100 + updatedRoutes.length + 1;
        const routeType = (p['type'] as string ?? existing.type) as import('@war/engine').TradeRouteType;
        const baseCapacity = (p['baseCapacity'] as number | undefined) ?? existing.baseCapacity;
        const growthCap = baseCapacity * 1.5;
        const newRoute: import('@war/engine').TradeRouteAgreement = {
          id: newRouteId,
          treatyClauseId: null,
          ownerNationId,
          partnerNationId: existing.partnerNationId,
          type: routeType,
          sourceTerritoryId,
          destinationTerritoryId,
          path: existing.path,
          pathComputedAtTick: world.tick,
          portLevel: existing.portLevel,
          baseCapacity,
          currentCapacity: existing.currentCapacity,  // carry forward
          growthCap,
          cyclesCompleted: existing.cyclesCompleted,  // carry forward
          profitMultiplier: existing.profitMultiplier,
          upkeepRate: existing.upkeepRate,
          status: 'active',
          startedAtTick: world.tick,
          shipments: [{
            id: -(newRouteId * 100 + 1),
            routeId: newRouteId,
            path: [destinationTerritoryId],
            transitTicksRemaining: 1,
            cargoAmount: existing.currentCapacity,
            cargoResource: 'wealth' as import('@war/engine').TradeResource,
            direction: 'forward' as const,
            departedAtTick: world.tick,
          }],
        };
        world = { ...world, tradeRouteAgreements: [...updatedRoutes, newRoute] };

      } else if (action.type === 'set_territory_infra') {
        // Harness: set hasPort/hasMarket/portLevel on a territory.
        // payload: { territoryId, hasPort?, hasMarket?, portLevel? }
        const tid = p['territoryId'] as string;
        const t = world.territories[tid];
        if (!t) { console.warn(`[harness] set_territory_infra: territory ${tid} not found`); continue; }
        world = {
          ...world,
          territories: {
            ...world.territories,
            [tid]: {
              ...t,
              state: {
                ...t.state,
                hasPort: (p['hasPort'] as boolean | undefined) ?? t.state.hasPort,
                hasMarket: (p['hasMarket'] as boolean | undefined) ?? t.state.hasMarket,
                portLevel: (p['portLevel'] as number | undefined) ?? (t.state as any).portLevel ?? 1,
              },
            },
          },
        };

      } else if (action.type === 'propose_embassy') {
        // Harness: directly insert a proposed embassy into world.embassies.
        // payload: { ownerNationId, hostTerritoryId }
        const ownerNationId = p['ownerNationId'] as string;
        const hostTerritoryId = p['hostTerritoryId'] as string;
        if (!ownerNationId || !hostTerritoryId) { console.warn('[harness] propose_embassy requires ownerNationId and hostTerritoryId'); continue; }
        const embassyId = 9000 + world.embassies.length + 1;
        world = {
          ...world,
          embassies: [...world.embassies, {
            id: embassyId,
            ownerNationId,
            hostTerritoryId,
            status: 'proposed' as EmbassyStatus,
            constructionTicksLeft: 0,
            startedAtTick: world.tick,
          }],
        };

      } else if (action.type === 'build_embassy') {
        // Engine pass-through: advance embassy from proposed → under_construction.
        // payload: { nationId, embassyId }
        const nationId = p['nationId'] as string | undefined;
        if (!nationId) { console.warn('[harness] build_embassy requires explicit nationId in payload'); continue; }
        const embassyId = p['embassyId'] as number | undefined;
        if (embassyId === undefined) { console.warn('[harness] build_embassy requires embassyId in payload'); continue; }
        engineActions.push({ nationId, type: 'build_embassy', payload: { embassyId } });

      } else if (action.type === 'expel_embassy') {
        // Engine pass-through: expel an active embassy (host nation only).
        // payload: { nationId, embassyId }
        const nationId = p['nationId'] as string | undefined;
        if (!nationId) { console.warn('[harness] expel_embassy requires explicit nationId in payload'); continue; }
        const embassyId = p['embassyId'] as number | undefined;
        if (embassyId === undefined) { console.warn('[harness] expel_embassy requires embassyId in payload'); continue; }
        engineActions.push({ nationId, type: 'expel_embassy', payload: { embassyId } });

      } else {
        // Pass-through to engine: derive nationId from territory owner.
        const tid = p['territoryId'] as string | undefined;
        const nationId = tid ? (world.territories[tid]?.state.ownerId ?? null) : null;
        if (!nationId) continue;

        let payload: Record<string, unknown> = { ...p, nationId };
        if (action.type === 'build_fort' && !payload['targetLevel']) {
          const fortLevel = (world.territories[tid!]?.state.fortificationLevel ?? 0) + 1;
          payload = { ...payload, targetLevel: fortLevel };
        }

        engineActions.push({ nationId, type: action.type, payload });
      }
    }

    // autoAcceptTreaties: convert any pending proposals to active treaties.
    if (scenario.world.autoAcceptTreaties) {
      for (const proposal of world.proposals) {
        if (proposal.status !== 'pending') continue;
        const totalCollateral = proposal.clauses.reduce((s, c) => s + c.collateral, 0);
        const collateralByParty: Record<string, number> = {
          [proposal.proposerId]: proposal.proposerCollateral,
          [proposal.targetId]:   proposal.targetCollateral,
        };
        const treaty: Treaty = {
          id: world.treaties.length + 1000 + world.tick,
          proposalId: proposal.id,
          partyIds: [proposal.proposerId, proposal.targetId],
          clauses: proposal.clauses,
          status: 'active',
          termTicks: proposal.termTicks,
          tickStarted: world.tick,
          tickEnds: world.tick + proposal.termTicks,
          totalCollateral,
          breakerNationId: null,
          collateralByParty,
          refundRemainingByParty: { [proposal.proposerId]: 0, [proposal.targetId]: 0 },
          refundStartTickByParty: { [proposal.proposerId]: null, [proposal.targetId]: null },
          escrowAmountByParty: { [proposal.proposerId]: 0, [proposal.targetId]: 0 },
          escrowStartTickByParty: { [proposal.proposerId]: null, [proposal.targetId]: null },
        };
        // Deduct collateral from proposer and target.
        const newNations = { ...world.nations };
        for (const [nid, amt] of Object.entries(collateralByParty)) {
          const n = newNations[nid];
          if (n) newNations[nid] = { ...n, stockpiles: { ...n.stockpiles, wealth: n.stockpiles.wealth - amt } };
        }
        // Mark proposal accepted.
        const newProposals = world.proposals.map((pr) =>
          pr.id === proposal.id ? { ...pr, status: 'accepted' as const } : pr,
        );
        world = {
          ...world,
          nations: newNations,
          proposals: newProposals,
          treaties: [...world.treaties, treaty],
        };
      }
    }

    const result = resolveTick(world, engineActions);
    world = result.world;

    // Harness caretaker pass: for Dormant/Autopilot human nations, apply one caretaker action.
    world = applyHarnessCaretaker(world, defById);

    // Harness fragmentation pass: for Abandoned nations, check tick-based fragmentation risk.
    world = applyHarnessFragmentation(world, defById, abandonedAtTickByNation);

    // Harness AI pass: for AI nations with a doctrineBlend, apply the highest-scored action.
    world = applyHarnessAiActions(world, defs, defById);

    // ── assert_visibility post-tick pass ────────────────────────────────────
    // Process any assert_visibility actions scheduled for this tick.
    // Runs after all world mutations so the assertion sees the final state.
    for (const action of tickActions) {
      if (action.type !== 'assert_visibility') continue;
      const p = action.payload;
      const observerNationId = p['observerNationId'] as string;
      const territoryId = p['territoryId'] as string;
      const expectedTier = p['expectedTier'] as number;

      // Build computeVisibility input from current world state.
      const visTerritories = Object.values(world.territories).map((t) => ({
        id: t.def.id,
        ownerId: t.state.ownerId,
        adjacentIds: t.def.adjacentIds,
      }));
      const visArmies = world.armies.map((a) => ({ nationId: a.nationId, territoryId: a.territoryId }));
      const visTreaties = world.treaties
        .filter((t) => t.status === 'active' || t.status === 'degraded')
        .filter((t) => t.partyIds.includes(observerNationId))
        .map((t) => ({
          partyIds: t.partyIds,
          hasActiveMilitaryAccess: t.clauses.some(
            (c) => c.type === 'military_access' && c.clauseStatus === 'active',
          ),
        }));
      // No federation data in harness (federation tables don't exist in pure engine).
      const visFederations: Array<{ memberNationIds: readonly string[] }> = [];

      const visEmbassies = world.embassies
        .filter((e) => e.status === 'active')
        .map((e) => ({ ownerNationId: e.ownerNationId, hostTerritoryId: e.hostTerritoryId }));

      const visMap = computeVisibility({
        nationId: observerNationId,
        territories: visTerritories,
        armies: visArmies,
        treaties: visTreaties,
        federations: visFederations,
        embassies: visEmbassies,
      });

      const actualTier = visMap.get(territoryId) ?? VisibilityTier.TrueFog;
      if (actualTier !== expectedTier) {
        const tierName = (t: number) => t === 0 ? 'TrueFog' : t === 1 ? 'LightFog' : 'Clear';
        const msg = `[assert_visibility] FAILED at tick ${world.tick}: ${observerNationId} sees ${tierName(actualTier)} for ${territoryId}, expected ${tierName(expectedTier)}`;
        console.error(msg);
        assertionErrors.push({
          tick: world.tick,
          type: 'assert_visibility',
          observerNationId,
          territoryId,
          expectedTier,
          actualTier,
          message: msg,
        });
      }
    }

    // ── assert_equilibrium_component post-tick pass ──────────────────────────
    for (const action of tickActions) {
      if (action.type !== 'assert_equilibrium_component') continue;
      const p = action.payload;
      const territoryId = p['territoryId'] as string;
      const component = p['component'] as string;
      const expectedPresent = p['expectedPresent'] as boolean;

      const causes = world.territories[territoryId]?.state.lastEquilibriumCauses;
      const value = causes ? ((causes as unknown) as Record<string, number>)[component] ?? 0 : 0;
      const actualPresent = value !== 0;

      if (actualPresent !== expectedPresent) {
        const msg = `[assert_equilibrium_component] FAILED at tick ${world.tick}: territory ${territoryId} component "${component}" present=${actualPresent}, expected present=${expectedPresent} (value=${value})`;
        console.error(msg);
        assertionErrors.push({
          tick: world.tick,
          type: 'assert_equilibrium_component',
          territoryId,
          component,
          expectedPresent,
          message: msg,
        });
      }
    }

    // ── assert_route_capacity post-tick pass ────────────────────────────────
    for (const action of tickActions) {
      if (action.type !== 'assert_route_capacity') continue;
      const p = action.payload;
      const routeId = p['routeId'] as number | undefined;
      const sourceTerritoryId = p['sourceTerritoryId'] as string | undefined;
      const destinationTerritoryId = p['destinationTerritoryId'] as string | undefined;
      const expectedMin = p['expectedMin'] as number;
      const expectedMax = p['expectedMax'] as number | undefined;

      const route = (world.tradeRouteAgreements ?? []).find((r) =>
        r.status === 'active' && (
          routeId !== undefined ? r.id === routeId :
          r.sourceTerritoryId === sourceTerritoryId && r.destinationTerritoryId === destinationTerritoryId
        ),
      );

      const actualCapacity = route?.currentCapacity ?? -1;
      const failed = actualCapacity < expectedMin || (expectedMax !== undefined && actualCapacity > expectedMax);
      if (failed) {
        const msg = `[assert_route_capacity] FAILED at tick ${world.tick}: route ${routeId ?? `${sourceTerritoryId}→${destinationTerritoryId}`} currentCapacity=${actualCapacity.toFixed(3)}, expected min=${expectedMin}${expectedMax !== undefined ? ` max=${expectedMax}` : ''}`;
        console.error(msg);
        assertionErrors.push({
          tick: world.tick,
          type: 'assert_route_capacity',
          routeId: routeId ?? route?.id ?? -1,
          sourceTerritoryId: sourceTerritoryId ?? route?.sourceTerritoryId ?? '',
          destinationTerritoryId: destinationTerritoryId ?? route?.destinationTerritoryId ?? '',
          expectedMin,
          actualCapacity,
          message: msg,
        });
      }
    }

    // ── assert_route_cycles post-tick pass ──────────────────────────────────
    for (const action of tickActions) {
      if (action.type !== 'assert_route_cycles') continue;
      const p = action.payload;
      const routeId = p['routeId'] as number | undefined;
      const sourceTerritoryId = p['sourceTerritoryId'] as string | undefined;
      const destinationTerritoryId = p['destinationTerritoryId'] as string | undefined;
      const expectedMin = p['expectedMin'] as number;
      const expectedMax = p['expectedMax'] as number | undefined;

      const route = (world.tradeRouteAgreements ?? []).find((r) =>
        r.status === 'active' && (
          routeId !== undefined ? r.id === routeId :
          r.sourceTerritoryId === sourceTerritoryId && r.destinationTerritoryId === destinationTerritoryId
        ),
      );

      const actualCycles = route?.cyclesCompleted ?? -1;
      const failed = actualCycles < expectedMin || (expectedMax !== undefined && actualCycles > expectedMax);
      if (failed) {
        const msg = `[assert_route_cycles] FAILED at tick ${world.tick}: route ${routeId ?? `${sourceTerritoryId}→${destinationTerritoryId}`} cyclesCompleted=${actualCycles}, expected min=${expectedMin}${expectedMax !== undefined ? ` max=${expectedMax}` : ''}`;
        console.error(msg);
        assertionErrors.push({
          tick: world.tick,
          type: 'assert_route_capacity',
          routeId: routeId ?? route?.id ?? -1,
          sourceTerritoryId: sourceTerritoryId ?? route?.sourceTerritoryId ?? '',
          destinationTerritoryId: destinationTerritoryId ?? route?.destinationTerritoryId ?? '',
          expectedMin,
          actualCapacity: actualCycles,
          message: msg,
        });
      }
    }

    // ── assert_route_upkeep post-tick pass ───────────────────────────────────
    for (const action of tickActions) {
      if (action.type !== 'assert_route_upkeep') continue;
      const p = action.payload;
      const nationId = p['nationId'] as string;
      const expectedDelta = p['expectedDelta'] as number; // negative = wealth decreased
      const tolerance = (p['tolerance'] as number) ?? 0.5;

      // Compare nation wealth to previous snapshot.
      const prevSnap = snapshots[snapshots.length - 1];
      const prevWealth = prevSnap?.diplomacy.nationState[nationId]?.wealthStock ?? 0;
      const currWealth = world.nations[nationId]?.stockpiles.wealth ?? 0;
      const actualDelta = currWealth - prevWealth;

      if (Math.abs(actualDelta - expectedDelta) > tolerance) {
        const msg = `[assert_route_upkeep] FAILED at tick ${world.tick}: nation ${nationId} wealth delta=${actualDelta.toFixed(3)}, expected≈${expectedDelta.toFixed(3)} (±${tolerance})`;
        console.error(msg);
        assertionErrors.push({
          tick: world.tick,
          type: 'assert_route_upkeep',
          nationId,
          expectedDelta,
          actualDelta,
          message: msg,
        });
      }
    }

    snapshots.push(captureSnapshot(world, world.tick, defs, abandonedAtTickByNation));
  }

  return { scenario, snapshots, assertionErrors };
}

// ── Harness caretaker pass ────────────────────────────────────────────────────
// For Dormant/Autopilot nations: queue the top-priority caretaker action.
// "Caretaker" tagged in event log. Mirrors server caretaker priorities.

function applyHarnessCaretaker(
  world: WorldState,
  defById: Map<string, TerritoryDef>,
): WorldState {
  let w = world;

  for (const [nationId, nation] of Object.entries(w.nations)) {
    if (nation.isAI) continue; // AI nations use doctrine, not caretaker
    const tier = nation.activityTier;
    if (tier !== 'dormant' && tier !== 'autopilot') continue;

    const ownedTerrs = Object.entries(w.territories).filter(([, t]) => t.state.ownerId === nationId);
    if (ownedTerrs.length === 0) continue;

    // Priority 1: Roads — highest-unrest unroaded territory.
    const unroaded = ownedTerrs
      .filter(([, t]) => !t.state.hasRoad && t.state.constructionType === null)
      .sort(([, a], [, b]) => b.state.unrest - a.state.unrest);

    if (unroaded.length > 0) {
      const [tid, t] = unroaded[0]!;
      // Apply road immediately (engine would queue it; harness applies directly for simplicity).
      w = {
        ...w,
        territories: { ...w.territories, [tid]: { ...t, state: { ...t.state, hasRoad: true } } },
        eventLog: [...w.eventLog, { tick: w.tick, message: `[Caretaker] ${nation.name} built a road in ${tid}.` }],
      };
      continue; // one action per nation per tick
    }

    // Priority 2 (Autopilot only): Expansion into unclaimed adjacent territory.
    if (tier === 'autopilot') {
      const avgUnrest = ownedTerrs.length > 0
        ? ownedTerrs.reduce((s, [, t]) => s + t.state.unrest, 0) / ownedTerrs.length
        : 1;
      if (avgUnrest < 0.4) {
        const ownedIds = new Set(ownedTerrs.map(([id]) => id));
        for (const [ownedId] of ownedTerrs) {
          const def = defById.get(ownedId);
          if (!def) continue;
          for (const adjId of def.adjacentIds) {
            if (ownedIds.has(adjId)) continue;
            const adjTerr = w.territories[adjId];
            if (adjTerr && adjTerr.state.ownerId === null) {
              w = {
                ...w,
                territories: { ...w.territories, [adjId]: { ...adjTerr, state: { ...adjTerr.state, ownerId: nationId, acquiredTick: w.tick } } },
                eventLog: [...w.eventLog, { tick: w.tick, message: `[Caretaker] ${nation.name} claimed ${adjId}.` }],
              };
              break;
            }
          }
        }
      }
    }
  }

  return w;
}

// ── Harness fragmentation pass ────────────────────────────────────────────────
// Tick-based fragmentation risk. The server uses real-time days; the harness
// uses ticks since abandoned (1 tick ≈ 1 day for scenario purposes).
// Constants mirror caretaker.ts but scaled to ticks.

const HARNESS_ABANDON_UNREST_WEIGHT    = 0.6; // same as server
const HARNESS_ABANDON_TIME_WEIGHT      = 0.4; // same as server
// Harness uses ticks not days. 10-tick scale makes fragmentation reachable within scenario runs.
// Server uses 30 days which is intentionally slow for real-play; harness accelerates for testing.
const HARNESS_ABANDON_TIME_SCALE_TICKS = 10;  // [HARNESS ONLY — server uses 30 days]
const HARNESS_ABANDON_FRAGMENT_THRESHOLD = 0.6; // [HARNESS ONLY — server uses 0.8]

export function harnessFragmentationRisk(unrest: number, ticksAbandoned: number): number {
  return unrest * HARNESS_ABANDON_UNREST_WEIGHT
    + (ticksAbandoned / HARNESS_ABANDON_TIME_SCALE_TICKS) * HARNESS_ABANDON_TIME_WEIGHT;
}

function applyHarnessFragmentation(
  world: WorldState,
  defById: Map<string, TerritoryDef>,
  abandonedAtTickByNation: Map<string, number>,
): WorldState {
  let w = world;
  const dissolved: string[] = [];

  for (const [nationId, nation] of Object.entries(w.nations)) {
    if (nation.activityTier !== 'abandoned') continue;
    const abandonedAtTick = abandonedAtTickByNation.get(nationId) ?? w.tick;
    const ticksAbandoned = w.tick - abandonedAtTick;

    const ownedTerrs = Object.entries(w.territories).filter(([, t]) => t.state.ownerId === nationId);
    if (ownedTerrs.length === 0) { dissolved.push(nationId); continue; }

    for (const [tid, t] of ownedTerrs) {
      const risk = harnessFragmentationRisk(t.state.unrest, ticksAbandoned);
      if (risk < HARNESS_ABANDON_FRAGMENT_THRESHOLD) continue;

      // Territory breaks away — set unclaimed.
      w = {
        ...w,
        territories: {
          ...w.territories,
          [tid]: { ...t, state: { ...t.state, ownerId: null, ownershipShock: 0, acquiredTick: null } },
        },
        eventLog: [...w.eventLog, {
          tick: w.tick,
          message: `${tid} broke away from the abandoned ${nation.name} empire.`,
        }],
      };

      // Spawn a new AI nation for the fragment.
      const newNationId = `nation_independent_${tid}_${w.tick}`;
      const traits = t.state.valueTraits;
      const doctrine = deriveDoctrineBlend(traits);
      const newNation = {
        id: newNationId,
        name: `Independent ${tid}`,
        isAI: true,
        stockpiles: { population: 0, industry: 0, wealth: 0 },
        armySize: 10,
        trust: 50,
        prestige: 0,
        capitalTerritoryId: tid,
        inactivityTier: 'active',
        lastBrokenPromiseTick: null,
        debtBalance: 0,
        activityTier: 'active',
        caretakerPriorities: ['defense', 'roads', 'industry', 'expansion'],
        doctrineBlend: doctrine,
        completedTreatiesKept: 0,
        warsWon: 0,
        foundedAtTick: w.tick,
        isDominant: false,
      };
      w = {
        ...w,
        nations: { ...w.nations, [newNationId]: newNation },
        territories: { ...w.territories, [tid]: { ...w.territories[tid]!, state: { ...w.territories[tid]!.state, ownerId: newNationId } } },
      };
    }

    // Check dissolution after fragmentation.
    const remaining = Object.values(w.territories).filter((t) => t.state.ownerId === nationId).length;
    if (remaining === 0) dissolved.push(nationId);
  }

  for (const nationId of dissolved) {
    const n = w.nations[nationId];
    if (!n) continue;
    w = {
      ...w,
      nations: { ...w.nations, [nationId]: { ...n, activityTier: 'dissolved' } },
      eventLog: [...w.eventLog, { tick: w.tick, message: `The ${n.name} empire has dissolved.` }],
    };
  }

  return w;
}

// ── Harness AI pass ────────────────────────────────────────────────────────────
// Applies the top-scored AI action for each AI nation with a doctrineBlend.
// Supports: expand_claim (directly assigns territory) and propose_treaty (adds to proposals).
// Does NOT run build actions (those require production/mandate state managed by engine).
// This is a harness-only approximation for scenario testing — not used in the live server.

function applyHarnessAiActions(
  world: WorldState,
  defs: TerritoryDef[],
  defById: Map<string, TerritoryDef>,
): WorldState {
  let w = world;

  for (const [nationId, nation] of Object.entries(w.nations)) {
    if (!nation.isAI) continue;
    const doctrine = nation.doctrineBlend ?? BALANCED_DOCTRINE;

    const ownedIds = new Set(
      Object.entries(w.territories)
        .filter(([, t]) => t.state.ownerId === nationId)
        .map(([id]) => id),
    );
    const highestOwnedUnrest = Math.max(0, ...[...ownedIds].map((id) => w.territories[id]?.state.unrest ?? 0));

    // Score candidates.
    type Cand = { score: number; apply: () => WorldState };
    const candidates: Cand[] = [];

    // expand_claim: find adjacent unclaimed territory.
    let unclaimedAdj: string | null = null;
    for (const tid of ownedIds) {
      const def = defById.get(tid);
      if (!def) continue;
      for (const adjId of def.adjacentIds) {
        if (ownedIds.has(adjId)) continue;
        if (w.territories[adjId]?.state.ownerId === null) { unclaimedAdj = adjId; break; }
      }
      if (unclaimedAdj) break;
    }
    if (unclaimedAdj) {
      const adjId = unclaimedAdj;
      candidates.push({
        score: scoreAction({ type: 'expand_claim' }, doctrine),
        apply: () => {
          const t = w.territories[adjId];
          if (!t) return w;
          return {
            ...w,
            territories: {
              ...w.territories,
              [adjId]: { ...t, state: { ...t.state, ownerId: nationId, acquiredTick: w.tick } },
            },
            eventLog: [...w.eventLog, { tick: w.tick, message: `[AI] ${nation.name} claimed ${adjId}.` }],
          };
        },
      });
    }

    // propose_treaty: find a neighbor not yet in a treaty (simplified Trust check: always Trust >= 50).
    let neighborId: string | null = null;
    for (const tid of ownedIds) {
      const def = defById.get(tid);
      if (!def) continue;
      for (const adjId of def.adjacentIds) {
        const adjOwnerId = w.territories[adjId]?.state.ownerId;
        if (!adjOwnerId || adjOwnerId === nationId) continue;
        const alreadyTreaty = w.treaties.some(
          (tr) => tr.partyIds.includes(nationId) && tr.partyIds.includes(adjOwnerId) &&
                  (tr.status === 'active' || tr.status === 'degraded'),
        );
        if (!alreadyTreaty) { neighborId = adjOwnerId; break; }
      }
      if (neighborId) break;
    }
    if (neighborId) {
      const tgtId = neighborId;
      const alreadyProposed = w.proposals.some(
        (pr) => pr.status === 'pending' &&
          ((pr.proposerId === nationId && pr.targetId === tgtId) ||
           (pr.proposerId === tgtId && pr.targetId === nationId)),
      );
      if (!alreadyProposed) {
        const proposeScore = scoreAction({ type: 'propose_trade' }, doctrine);
        const treatyScore  = scoreAction({ type: 'propose_treaty' }, doctrine);
        const bestScore = Math.max(proposeScore, treatyScore);
        const isTradeProposal = proposeScore >= treatyScore;

        candidates.push({
          score: bestScore,
          apply: () => {
            const proposalId = w.proposals.length + 2000 + w.tick;
            const clauseId = 3000 + w.tick;
            const sourceTerr = [...ownedIds][0] ?? '';
            const clauses: Treaty['clauses'] = isTradeProposal
              ? [
                  { id: clauseId, clauseIndex: 0, type: 'non_aggression', collateral: 0, payload: {}, clauseStatus: 'active', missedPayments: 0, objective: null },
                  { id: clauseId + 1, clauseIndex: 1, type: 'trade', collateral: 0, payload: { resource: 'wealth', amount: 3, fromNationId: nationId, toNationId: tgtId, sourceTerritoryId: sourceTerr }, clauseStatus: 'active', missedPayments: 0, objective: null },
                ]
              : [
                  { id: clauseId, clauseIndex: 0, type: 'non_aggression', collateral: 0, payload: {}, clauseStatus: 'active', missedPayments: 0, objective: null },
                ];
            const proposal = {
              id: proposalId,
              proposerId: nationId,
              targetId: tgtId,
              status: 'pending' as const,
              termTicks: 10,
              clauses,
              proposerCollateral: 0,
              targetCollateral: 0,
              tickProposed: w.tick,
              expiresAtTick: w.tick + 5,
              parentProposalId: null,
            };
            return {
              ...w,
              proposals: [...w.proposals, proposal],
              eventLog: [...w.eventLog, {
                tick: w.tick,
                message: `[AI] ${nation.name} proposed ${isTradeProposal ? 'a trade treaty' : 'non-aggression'} with ${tgtId}.`,
              }],
            };
          },
        });
      }
    }

    if (candidates.length === 0) continue;
    candidates.sort((a, b) => b.score - a.score);
    w = candidates[0]!.apply();
  }

  return w;
}
