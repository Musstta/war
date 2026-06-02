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
| `create_treaty` | Harness (before tick) | `{ id, partyIds: [nA, nB], clauses: [{type, collateral?, payload?}], termTicks, collateralByParty: {nA: x, nB: y} }` |
| `break_treaty` | Harness (before tick) | `{ treatyId, breakerNationId }` |
| `set_nation_tier` | Harness (before tick) | `{ nationId, tier: 'active'\|'dormant'\|'autopilot'\|'abandoned' }` |
| `build_road` | Engine (via resolveTick) | `{ territoryId }` |
| `build_port` | Engine (via resolveTick) | `{ territoryId }` |
| `build_fort` | Engine (via resolveTick) | `{ territoryId }` — targetLevel auto-derived |

`assign_territory` computes compat-scaled conquest shock automatically (same formula as the live server). A low-compat conquest starts with higher shock than a compatible one.

`create_treaty` directly places an active treaty into world state, deducting collateral from both parties' Wealth at the time the action fires. Use `wealthStock` on the nation definition to give nations enough starting Wealth to cover collateral.

`break_treaty` marks the treaty broken, transfers the breaker's collateral to the wronged party (plus returns the wronged party's own collateral), and applies the Trust penalty (`TRUST_BREAK_PENALTY`). Trust recovery is suppressed for `TRUST_RECOVERY_COOLDOWN` ticks after the break.

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

One row per nation per tick. Columns: `tick, nation_id, trust, inactivity_tier, wealth_stock`. Always written, even when there are no treaties — useful for verifying Trust stays at baseline in culture-only scenarios.

### `trade-flows.csv` *(only when trade clauses exist)*

One row per trade clause per tick. Columns:

```
tick, treaty_id, clause_index, resource, amount, from_nation, to_nation,
flow_status, missed_payments, clause_status
```

`flow_status` is inferred from consecutive `missed_payments` values: `paid` (payment transferred), `missed` (insufficient stockpile, counter incremented), `breached` (clause status = breached), `degraded` (source territory lost), `pending` (T0 pre-treaty).

### `objective-metrics.csv` *(only when objective clauses exist)*

One row per objective clause per tick. Columns: `tick, treaty_id, clause_index, objective_type, responsible_party, status, deadline_ticks`. Used by the objective-status panel in `treaty-status-over-time.png`.

### `charts/` directory

| File | What it shows |
|---|---|
| `unrest-over-time.png` | All owned territories' unrest as lines over time. Red dashed line = revolt threshold (0.80). |
| `equilibrium-<territory>.png` | Stacked area chart of equilibrium components for territories that changed ownership or moved meaningfully. Solid white line = actual unrest; dashed = equilibrium target. |
| `nation-culture-drift.png` | Four subplots (one per axis) showing each nation's culture value over time. |
| `treaty-status-over-time.png` | Three or four-panel chart: treaty status timeline (colour-coded bars), [objective clause status timeline when present,] Trust over time per nation, Wealth over time per nation. Only generated when `treaty-metrics.csv` is non-empty. |
| `trade-flow-over-time.png` | Two-panel chart: trade clause flow status per tick (paid/missed/breached/degraded as colour-coded bars), Wealth over time per nation. Only generated when `trade-flows.csv` is non-empty. |

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
