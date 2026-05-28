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
| `build_road` | Engine (via resolveTick) | `{ territoryId }` |
| `build_port` | Engine (via resolveTick) | `{ territoryId }` |
| `build_fort` | Engine (via resolveTick) | `{ territoryId }` — targetLevel auto-derived |

`assign_territory` computes compat-scaled conquest shock automatically (same formula as the live server). A low-compat conquest starts with higher shock than a compatible one.

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

### `charts/` directory

| File | What it shows |
|---|---|
| `unrest-over-time.png` | All owned territories' unrest as lines over time. Red dashed line = revolt threshold (0.80). |
| `equilibrium-<territory>.png` | Stacked area chart of equilibrium components for territories that changed ownership or moved meaningfully. Solid white line = actual unrest; dashed = equilibrium target. |
| `nation-culture-drift.png` | Four subplots (one per axis) showing each nation's culture value over time. |

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

| Scenario | Description | Key question |
|---|---|---|
| `belize-neglect.json` | Conquer Belize, no investment, 50 ticks | Does shock persist without integration? |
| `belize-integrate.json` | Same conquest, road at T2 + port at T5 | Does investment visibly speed shock recovery? |
| `overexpansion.json` | Conquer 3 territories in 3 ticks, no investment | Does rapid-expansion pressure smear across all owned territories? |
