# Simulation Harness

Headless scenario runner for the WAR engine. No DB, no HTTP — pure TypeScript engine only. Used for qualitative validation, regression testing, and tuning-parameter exploration.

> **Do not use for balance tuning yet.** All engine constants are placeholders. The harness is a correctness and contrast tool, not a calibration tool. Systematic tuning deferred until all game systems exist.

---

## Quick start

```bash
# Run a scenario
npm run scenario scenarios/belize-neglect.json

# Run with charts disabled (no Python required)
npm run scenario scenarios/belize-integrate.json --no-charts

# Parameter sweep
npm run sweep scenarios/belize-neglect.json CONQUEST_SHOCK_MIN 0.10 0.20 0.30 0.40
```

Requires `matplotlib` for chart generation:
```bash
pip3 install matplotlib
```

---

## Scenario format

Scenario files are JSON in `scenarios/`. All fields:

```jsonc
{
  "name": "my-scenario",           // used for output directory name
  "description": "...",            // shown in report header
  "ticks": 50,                     // how many ticks to simulate
  "rngSeed": 42,                   // optional; default 42
  "world": {
    "nations": [
      {
        "id": "nation_costa_rica", // must match a known nation ID
        "name": "Costa Rica",
        "territories": ["costa_rica"],   // starting territory IDs
        "armySize": 50,            // optional; default 50
        "capitalTerritoryId": "costa_rica"  // optional; default = first territory
      }
    ],
    "territoryOverrides": {        // optional per-territory attribute overrides
      "belize": {
        "individualist": 0.5,
        "progressive": -0.3,
        "culturalFamily": "latin", // override def family
        "unrest": 0.1              // set initial unrest
      }
    }
  },
  "actions": [
    // Harness-level actions (run before the tick that processes them):
    { "tick": 1, "type": "assign_territory",
      "payload": { "territoryId": "belize", "ownerId": "nation_costa_rica" } },
    { "tick": 2, "type": "set_unrest",
      "payload": { "territoryId": "belize", "value": 0.9 } },

    // Engine pass-through actions (same types as the live game):
    { "tick": 2, "type": "build_road",
      "payload": { "territoryId": "belize" } },
    { "tick": 5, "type": "build_port",
      "payload": { "territoryId": "belize" } },
    { "tick": 3, "type": "build_fort",
      "payload": { "territoryId": "belize" } }
    // build_fort auto-computes targetLevel from current fort level
  ],
  "metrics": [
    "unrest_per_territory_per_tick",
    "compat_per_territory_per_tick",
    "equilibrium_components_per_territory_per_tick",
    "nation_culture_per_tick",
    "revolt_events",
    "stockpiles_per_nation_per_tick"
  ]
}
```

### Action types

| Type | Where executed | Payload |
|---|---|---|
| `assign_territory` | Harness (before tick) | `{ territoryId, ownerId: string\|null }` |
| `set_unrest` | Harness (before tick) | `{ territoryId, value: 0.0–1.0 }` |
| `set_fort_level` | Harness (before tick) | `{ territoryId, level: 0–3 }` |
| `create_treaty` | Harness (before tick) | `{ id, partyIds: [nA, nB], clauses: [{type, collateral?, payload?}], termTicks, collateralByParty: {nA: x, nB: y} }` |
| `break_treaty` | Harness (before tick) | `{ treatyId, breakerNationId }` |
| `set_nation_tier` | Harness (before tick) | `{ nationId, tier: 'active'\|'dormant'\|'autopilot'\|'abandoned' }` |
| `declare_war` | Harness (before tick) | `{ warId, attackerId, defenderId, hasCasusBelli?, type? }` |
| `propose_peace` | Harness (before tick) | `{ warId, proposingNationId, terms: { warType, territoryCessions, tributeWealth, tributeTicks } }` |
| `attack_territory` | Engine (via resolveTick) | `{ nationId, targetTerritoryId }` — **nationId required** |
| `accept_peace` | Engine (via resolveTick) | `{ nationId, warId }` — **nationId required** |
| `build_road` | Engine (via resolveTick) | `{ territoryId }` |
| `build_port` | Engine (via resolveTick) | `{ territoryId }` |
| `build_fort` | Engine (via resolveTick) | `{ territoryId }` — targetLevel auto-derived |
| `propose_embassy` | Harness (before tick) | `{ ownerNationId, hostTerritoryId }` — injects embassy with status `proposed` and auto-assigned id 9000+N |
| `build_embassy` | Engine (via resolveTick) | `{ nationId, embassyId }` — advances embassy to `under_construction` |
| `expel_embassy` | Engine (via resolveTick) | `{ nationId, embassyId }` — host nation expels; sets status `expelled` |
| `set_trade_route` | Harness (before tick) | `{ id?, treatyClauseId?, sourceTerritoryId, destinationNationId, path: string[], isSeaRoute? }` — injects a TradeRoute into world.tradeRoutes |
| `assert_visibility` | Harness (post-tick assertion) | `{ observerNationId, territoryId, expectedTier: 0\|1\|2 }` |
| `assert_equilibrium_component` | Harness (post-tick assertion) | `{ territoryId, component: string, expectedPresent: boolean }` |

`assign_territory` computes compat-scaled conquest shock automatically (same formula as the live server). A low-compat conquest starts with higher shock than a compatible one.

`create_treaty` directly places an active treaty into world state, deducting collateral from both parties' Wealth at the time the action fires. Use `wealthStock` on the nation definition to give nations enough starting Wealth to cover collateral.

`break_treaty` marks the treaty broken, transfers the breaker's collateral to the wronged party (plus returns the wronged party's own collateral), and applies the Trust penalty (`TRUST_BREAK_PENALTY`). Trust recovery is suppressed for `TRUST_RECOVERY_COOLDOWN` ticks after the break.

`declare_war` injects a `War` object directly into `world.wars` (harness equivalent of the server `declareWarHandler`). Applies the −10 Trust no-CB penalty immediately if `hasCasusBelli: false`. War status starts `active`. Use this before queuing `attack_territory` actions — the engine validates `war.status` on the war resolution pass.

`propose_peace` is a harness-side mutation that sets `war.pendingPeaceDeal` and transitions `war.status` to `peace_negotiation` before the tick fires. Pair it with `accept_peace` at the same tick to execute the deal in that tick's peace resolution block.

`attack_territory` and `accept_peace` are engine pass-throughs. Unlike `build_road`, they require an explicit `nationId` in the payload because the engine cannot derive the acting nation from the target territory.

`propose_embassy` uses the harness "direct state injection" pattern — it inserts an embassy row directly into `world.embassies` (status `proposed`, `constructionTicksLeft=0`) without going through the engine action queue. Auto-assigns id `9000 + embassies.length + 1` so harness-created embassies never collide with server-assigned ids.

`set_trade_route` injects a `TradeRoute` directly into `world.tradeRoutes`. The harness normally has `tradeRoutes = []` (the server populates these from the DB at treaty signing); this action is the only way to test `tradeStability` equilibrium components in a scenario. `treatyClauseId` is optional and defaults to 0. `id` defaults to `9000 + tradeRoutes.length + 1`.

`assert_visibility` and `assert_equilibrium_component` are post-tick assertions that run after each tick completes. Failures are collected in `RunResult.assertionErrors` and cause a non-zero exit code.

- `assert_visibility`: calls `computeVisibility` with the full post-tick world state (including active embassies) for the given observer nation, then compares `actualTier` against `expectedTier`. Tier values: `0` = TrueFog, `1` = LightFog, `2` = Clear.
- `assert_equilibrium_component`: reads `territory.state.lastEquilibriumCauses` (written by the engine each tick) and checks whether the named component is non-zero. Use `expectedPresent: true` to assert the component is active, `false` to assert it is absent. Component names match `UnrestCauses` fields (e.g. `tradeStability`, `isolationistEntanglement`, `expansionistStagnation`).

`set_nation_tier` to `'dormant'` triggers treaty degradation: inactive party's collateral moves to escrow, active partner's collateral begins a 3-tick refund. Setting back to `'active'` upgrades degraded treaties and applies the escrow skim (`ESCROW_SKIM_RATE = 5%`). No Trust change in either direction.

### Nation starting stockpiles

The `wealthStock`, `industryStock`, and `populationStock` fields on a scenario nation override the default (0) starting stockpiles. Use these when a scenario needs nations to have Wealth available for collateral before production builds up:

```jsonc
{ "id": "nation_costa_rica", "territories": ["costa_rica"], "wealthStock": 30 }
```

---

## Output files

All outputs go to `scenarios/<scenario-name>/`.

### `report.md`

Primary human-readable output. Contains:
- Scenario header and parameters
- **Nation summary table** — territories owned, avg/max unrest, revolt count at final tick
- **Territory unrest table** — unrest, equilibrium, shock, compat, infra bonus, distance at T0/1/2/5/10/15/20/25/30/40/50
- **Event timeline** — all engine events with tick numbers

Read this first. It tells you in 30 seconds whether the scenario behaved as expected.

### `territory-metrics.csv`

One row per territory per tick. Columns:

```
tick, territory_id, owner_id, unrest, equilibrium, conquest_shock,
base, compat_pressure, distance_pressure, infra_bonus,
overexpansion, rapid_expansion, is_in_revolt, compat_total
```

Pull into Excel, pandas, or anything else for custom analysis.

### `nation-metrics.csv`

One row per nation per tick. Columns:

```
tick, nation_id, pop_stock, ind_stock, wealth_stock, army_size,
culture_individualist, culture_progressive, culture_militaristic,
culture_expansionist, culture_family
```

### `events.csv`

All engine events with tick number and message string.

### `treaty-metrics.csv` *(only when treaties exist)*

One row per treaty per tick. Columns:

```
tick, treaty_id, status, party_a, party_b, clauses, term_ticks, tick_ends,
total_collateral, collateral_a, collateral_b, escrow_a, escrow_b, refund_a, refund_b
```

### `nation-diplomacy.csv`

One row per nation per tick. Columns: `tick, nation_id, trust, inactivity_tier, wealth_stock, debt_balance`. Always written. `wealth_stock` may be negative when insolvency is active. `debt_balance` tracks cumulative debt accrued while insolvent; non-zero during recovery phase.

### `trade-flows.csv` *(only when trade clauses exist)*

One row per trade clause per tick. Columns:

```
tick, treaty_id, clause_index, resource, amount, from_nation, to_nation,
flow_status, missed_payments, clause_status
```

`flow_status` is inferred from consecutive `missed_payments` values: `paid` (payment transferred), `missed` (insufficient stockpile, counter incremented), `breached` (clause status = breached), `degraded` (source territory lost), `pending` (T0 pre-treaty).

### `war-state.csv` *(only when wars exist)*

One row per active/peace_negotiation war per tick. Columns: `tick, war_id, attacker_id, defender_id, type, has_casus_belli, status, start_tick, occupied_count`. `occupied_count` is the number of territories currently in `occupiedTerritories` for that war.

### `army-sizes.csv` *(only when wars exist)*

One row per nation per tick. Columns: `tick, nation_id, army_size`. Emitted alongside `war-state.csv` when any war exists in the scenario.

### `objective-metrics.csv` *(only when objective clauses exist)*

One row per objective clause per tick. Columns: `tick, treaty_id, clause_index, objective_type, responsible_party, status, deadline_ticks`. Used by the objective-status panel in `treaty-status-over-time.png`.

### `fragmentation-risk.csv` *(only when abandoned nations exist)*

One row per territory per tick for territories owned by Abandoned nations. Columns: `tick, territory_id, owner_id, unrest, fragmentation_risk`. `fragmentation_risk` uses the harness tick-based formula: `unrest × 0.6 + (ticksAbandoned / 10) × 0.4`. Threshold is 0.6 in the harness (vs. 0.8 in the live server which uses real-time days). Used by `fragmentation-risk-over-time.png`.

### `charts/` directory

| File | What it shows |
|---|---|
| `unrest-over-time.png` | All owned territories' unrest as lines over time. Red dashed line = revolt threshold (0.80). |
| `equilibrium-<territory>.png` | Stacked area chart of equilibrium components for territories that changed ownership or moved meaningfully. Solid white line = actual unrest; dashed = equilibrium target. |
| `nation-culture-drift.png` | Four subplots (one per axis) showing each nation's culture value over time. |
| `treaty-status-over-time.png` | Three or four-panel chart: treaty status timeline (colour-coded bars), [objective clause status timeline when present,] Trust over time per nation, Wealth over time per nation. Only generated when `treaty-metrics.csv` is non-empty. |
| `trade-flow-over-time.png` | Two-panel chart: trade clause flow status per tick (paid/missed/breached/degraded as colour-coded bars), Wealth over time per nation. Only generated when `trade-flows.csv` is non-empty. |
| `war-state-over-time.png` | Three-panel chart: army sizes per belligerent, occupied territory count per war, average unrest per belligerent. Only generated when `war-state.csv` is non-empty. |
| `activity-tier-over-time.png` | Step chart showing activity tier transitions per human nation over time. Only generated when any nation left the 'active' tier. |
| `fragmentation-risk-over-time.png` | Line chart showing fragmentation risk per abandoned territory, with dashed threshold line. Only generated when `fragmentation-risk.csv` is non-empty. |

Only "interesting" territories get equilibrium charts — those whose unrest moved more than 2% over the run.

---

## Parameter sweep

```bash
npm run sweep <scenario.json> <PARAM_NAME> <val1> <val2> ...
```

Example — vary initial conquest shock minimum:
```bash
npm run sweep scenarios/belize-neglect.json CONQUEST_SHOCK_MIN 0.10 0.20 0.30 0.50
```

Outputs go to `scenarios/sweep-<scenario-name>-<param>/`:
- One subdirectory per value with full report + CSV + charts
- `sweep-summary.md` — comparison table (avg/max final unrest, revolt count per value)

### Sweepable parameters

These are harness-computed values that the runner can override without recompiling:

| Parameter | Default | Effect |
|---|---|---|
| `CONQUEST_SHOCK_MIN` | 0.20 | Minimum shock on compatible conquest |
| `CONQUEST_SHOCK_MAX` | 0.70 | Maximum shock on incompatible conquest |

Parameters deep inside the engine tick loop (e.g. `CONQUEST_SHOCK_BASE_DECAY`, `RECENT_ACQUISITION_WINDOW`) cannot currently be swept without a code change and Docker rebuild, because they're compiled into the engine binary. This limitation is noted in `tuning-notes.md`.

---

## Writing a new scenario

1. Copy an existing scenario file and rename it.
2. Change `name` — this becomes the output directory.
3. Set `ticks` and add your nations/actions.
4. Run it and check `report.md` first.

To test a specific mechanism in isolation, use `territoryOverrides` to set a territory's culture to known values rather than relying on seed data. Use `set_unrest` to force initial conditions.

---

## Seed scenarios

### Culture & unrest (regression baseline)

| Scenario | Description | Key question |
|---|---|---|
| `belize-neglect.json` | Conquer Belize, no investment, 50 ticks | Does shock persist without integration? |
| `belize-integrate.json` | Same conquest, road at T2 + port at T5 | Does investment visibly speed shock recovery? |
| `overexpansion.json` | Conquer 3 territories in 3 ticks, no investment | Does rapid-expansion pressure smear across all owned territories? |

### Treaty system (diplomacy validation)

| Scenario | Description | Key question |
|---|---|---|
| `treaty-honor.json` | CR + Guatemala sign 10-tick non_aggression + tribute at T1; run 15 ticks | Collateral deposited, tribute flows each tick, expiry grants Trust bonus `min(10×0.5, 15)=5`? |
| `treaty-break.json` | Same setup; Guatemala breaks at T5 | Breaker Trust −20, collateral to wronged party, wronged Trust unchanged, recovery suppressed for 10 ticks? |
| `treaty-degradation.json` | CR + Guatemala sign 20-tick defense_pact at T1; CR goes Dormant at T5, returns at T15 | Treaty degrades at T5, refund over 3 ticks, escrow held, upgrade at T15 with 5% skim, no Trust change, expires at T21 with bonus? |

### Trade system (trade clause + objective clause validation)

| Scenario | Description | Key question |
|---|---|---|
| `trade-flow.json` | CR + Guatemala sign 10-tick treaty with 5 Wealth/tick trade clause; 14 ticks | 5 Wealth/tick flows from Guatemala to CR each tick T1–T10, stops at expiry? Trust bonus fires at T11? |
| `trade-missed-payment.json` | Same trade clause but flow (6/tick) exceeds Guatemala's production (5/tick); Guatemala collateral-drained to 0 at treaty sign | Missed-payment events at T1+T2, clause breaches at T2 (2 consecutive misses), Guatemala Trust −20, collateral to CR? |
| `trade-source-lost.json` | Same trade clause; at T5 harness reassigns `guatemala` territory to Honduras | Clause degrades at T5 (source territory no longer owned by sender), flows stop, no Trust hit, treaty continues? |
| `objective-port.json` | CR + Guatemala 10-tick treaty with build_port objective on `costa_rica`, deadline 8 ticks, responsible CR; CR never builds | Objective fails at T9 (deadline tick 8 passes), CR Trust −20, collateral forfeited to Guatemala? |
| `objective-port-met.json` | Same treaty; CR queues build_port at T3 | Port completes at T5 (3-tick construction), objective met at T5, Trust bonus fires, treaty auto-completes early? |
| `objective-port-failed.json` | Same as objective-port.json but with 5-tick deadline; CR never builds | Objective fails at T6, CR Trust −20, collateral transferred? |(shorter deadline variant for fast regression)|

### War system (Phase 5 validation)

| Scenario | Description | Key question |
|---|---|---|
| `war-conquest.json` | CR declares war on Nicaragua (CB) at T1; attacks each tick; L0 fort; peace deal at T8 with nicaragua ceded | Siege completes in ≤2 ticks (L0 = 1 tick needed); territory captured with ownershipShock=0.50; peace deal executes — ownership transfers, Trust +5 both parties, war ends? |
| `war-fortified.json` | Same war but nicaragua has fortificationLevel=2 (requires 3 consecutive wins) | siegeProgress increments 1/3 → 2/3 → 3/3 across consecutive winning ticks; territory not captured prematurely; army losses accumulate on both sides? |
| `war-no-cb.json` | CR declares war on Nicaragua **without** CB; costa_rica territory has militaristic=−0.6, expansionist=−0.5 | CR Trust −10 at declaration; Peaceful+Isolationist territories show elevated equilibrium (+0.05) for 5 ticks (NO_CB_UNREST_SPIKE window)? |
| `war-exhaustion.json` | CR declares war on Nicaragua; Nicaragua owes 8 Wealth/tick tribute to Honduras (5/tick production, 2.5/tick upkeep) | Nicaragua enters insolvency at T1 (wealth < 0); `WAR_INSOLVENCY_UNREST_PER_TICK` (+0.03) and `INSOLVENCY_GENERAL_UNREST_PER_TICK` (+0.02) both fire each tick; `insolvencyPressure` visible as named component; equilibrium climbs over 15 ticks. `debt_balance` column in `nation-diplomacy.csv` tracks cumulative debt. |
| `war-defense-pact.json` | CR + Honduras sign defense_pact at T1; Guatemala declares war on CR at T2 | War inserted into world.wars at T2; event log "Guatemala declared war on Costa Rica." emitted. Note: Honduras auto-defense is a server-side effect (fires in `runTick` post-engine) — not observable in the pure-engine harness. Validates: engine-side war state, event log, treaty survives alongside war. |

### Caretaker AI + abandonment (Phase 6 validation)

| Scenario | Description | Key question |
|---|---|---|
| `caretaker-roads.json` | CR set to Autopilot at T1; `costa_rica` has unrest 0.65 and no road | Caretaker queues build_road on high-unrest territory at T1 (`[Caretaker]` in event log), road applied, unrest trends down toward lower equilibrium? |
| `abandonment-fragmentation.json` | CR owns two territories (unrest 0.80 and 0.30), set to Abandoned at T1; run 25 ticks | High-unrest territory fragments ~T11 (risk = 0.723×0.6 + 1×0.4/10 = 0.473 → approaches 0.6 as time grows), low-unrest at ~T13; both emit "broke away" events; independent AI nations spawn; empire dissolves? |
| `fragment-becomes-ai.json` | CR owns `costa_rica` (unrest 0.82, expansionist traits), set to Abandoned at T1 | Fragment fires at ~T11; spawned AI nation derives doctrine from territory traits; `[AI]` events follow immediately (proposing non-aggression with neighbors)? |

### AI nation behavior (Phase 6 validation)

| Scenario | Description | Key question |
|---|---|---|
| `ai-expansionist.json` | AI nation owns `mexico_yucatan`, doctrine `{ expansionist: 0.55, ... }`, two unclaimed neighbors (`belize`); 15 ticks | AI claims `belize` at T1 (expand_claim scores 0.63); subsequent ticks show non-aggression proposals to human neighbors? Army upkeep deducted each tick? |
| `ai-merchant.json` | AI nation owns `panama` (adjacent to Costa Rica), doctrine `{ merchant: 0.60, ... }`; `autoAcceptTreaties: true`; 15 ticks | AI proposes trade treaty with Costa Rica at T1 (`propose_trade` scores 0.46); auto-accepted at T2; trade flows (3 Wealth/tick) visible in `trade-flows.csv` T2–T11? Treaty expires naturally at T11? |

### Embassy, trade stability, visibility & cultural constraints (Phase 6.5 validation)

| Scenario | Description | Key question |
|---|---|---|
| `trade-integration.json` | Costa Rica + Guatemala sign 20-tick trade treaty at T1. `set_trade_route` seeds a route `[guatemala→honduras→nicaragua→costa_rica]`. 12 ticks. | `tradeStability` component appears as non-zero on `costa_rica` (receiver path) at T5 and T12? |
| `cultural-constraints.json` | Nicaragua (expansionist=−0.7) signs 4 non-aggression treaties at T1 (above `ISOLATIONIST_TREATY_THRESHOLD=3`). Guatemala (expansionist=0.7) holds no territory gains. 13 ticks. | `isolationistEntanglement` present on `nicaragua` at T8? `expansionistStagnation` present on `guatemala` at T12 (stagnation fires when `world.tick > EXPANSIONIST_GROWTH_WINDOW=10`, i.e. pre-tick value 11 inside tick iteration 12)? |
| `movement-travel.json` | Nation A (el_salvador) moves army toward mexico_yucatan. 2-hop path: el_salvador→guatemala (mountainous, 1.5 ticks per-leg→ceil=2) + guatemala→mexico_yucatan (coastal, 1 tick). 6 ticks. | `mexico_yucatan` = TrueFog at T2 (army still at el_salvador, non-adjacent)? Clear at T4 (army arrived at mexico_yucatan after first leg completes at T3, second at T4)? |
| `embassy-lifecycle.json` | Costa Rica proposes embassy in nicaragua at T1 (status=proposed). Builds at T2 (under_construction, 3 ticks left). Active at T5. Nicaragua expels at T7 (status=expelled). 10 ticks. | `nicaragua` = Clear for Costa Rica observer at T5 (active embassy → embassy grant)? = LightFog at T8 (expelled, no army, adjacent territory)? |
| `territory-cession.json` | Treaty 1: Costa Rica receives panama via cession (transferAtTick=3); CR has active embassy at T5 → cession succeeds. Treaty 2: Guatemala receives honduras via cession (transferAtTick=3); no embassy → grace period expires after 3 ticks → clause breaches. 12 ticks. | Cession with embassy executes cleanly (ownership transferred, no breach event)? Cession without embassy produces a breach event after `CESSION_EMBASSY_GRACE_TICKS=3`? |
