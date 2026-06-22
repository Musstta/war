# Systems Coherence Audit — v0.39

*Pre-Phase 9 audit. Documentation only. No code changes. All source citations use file:line format.*

---

## 1. Mechanic Inventory

### 1.1 Armies

**What it does**: Armies are mobile force-projection units owned by a nation. They move between territories, fight battles, besiege fortified territories, and occupy conquered ones.

**Key states** (`engine/src/types.ts`):
- `stationed` — idle, in a territory (costs upkeep but no special effect)
- `moving` — in transit along a computed path; path re-computed at dispatch
- `besieging` — attacking a fortified territory; battle fires each tick until siege ends
- `occupying` — territory taken, army holds it pending formal conquest action

**Inputs**:
- `move_army` action → calls `computeArmyPath` (`engine/src/war.ts`) BFS
- `dispatchArmy` logic respects `TERRAIN_DIFFICULTY` and `GEOGRAPHY_MOVEMENT_MODIFIER` for transit time
- `attack_territory` / `start_siege` / `assault_fort` (Phase 5 war actions)

**Outputs per tick** (`engine/src/tick.ts:2552–2560`):
- Upkeep deducted: `effectiveArmySize × UPKEEP_PER_SOLDIER` (0.05 [PLACEHOLDER]) from nation Wealth
- `totalArmySize` sums across `draft.armies` (or falls back to `nation.armySize` if armies array empty)

**Battle resolution** (`engine/src/war.ts`, called from tick.ts during war processing):
- `computeBattleStrengths(attackingSize, defendingSize, fortLevel, ...)` — fort level adds defense bonus
- Loser loses `BATTLE_LOSER_LOSS_RATE` of army; winner loses `BATTLE_WINNER_LOSS_RATE`
- Attacker wins → territory transfers; defender wins → attacker retreats

**Transit** (`engine/src/tick.ts`, army transit advancement block):
- Per-tick: `transitTicksRemaining -= 1`; moves along path array
- Geography modifier: `GEOGRAPHY_MOVEMENT_MODIFIER_INLINE` scales ticks (defined in `engine/src/war.ts`)

**Upkeep constant source**: `engine/src/tick.ts:123` — `UPKEEP_PER_SOLDIER = 0.05` [PLACEHOLDER]

**Notable gap**: No garrison mechanic. An army with status `stationed` in a fortified territory provides no upkeep discount, no additional fort defense bonus, and no siege-extension effect beyond the fort's own `fortificationLevel`. The `stationed` status is purely positional.

---

### 1.2 Ports

**What it does**: Enables sea-path trade routes (port-tier `TradeRouteAgreement`) and contributes to unrest integration.

**Infrastructure state**: `TerritoryState.hasPort Boolean @default(false)` + `portLevel Int @default(1)` (added v0.33)

**Build** (`engine/src/tick.ts:134–149`):
- `BUILD_TICKS.port = 3` [PLACEHOLDER]; `BUILD_INDUSTRY.port = 5` [PLACEHOLDER]
- No level progression for ports (unlike forts) — portLevel is fixed at 1 on build

**Unrest contribution**: Port reduces unrest equilibrium via `computeUnrestEquilibrium` — `hasPort` is a parameter alongside `hasRoad` and `fortificationLevel` (`engine/src/culture.ts`, `computeUnrestEquilibrium` signature)

**Trade contribution**: Endpoint for `TradeRouteAgreement` port-tier routes. `profitMultiplier = 1 + hopDistance × PORT_DISTANCE_PROFIT_BONUS`. Capacity scales by `PORT_ROUTE_BASE_CAPACITY[portLevel]` — L1=8, L2=12, L3=18 [PLACEHOLDER] (`engine/src/tradeRoutes.ts`).

**Shock decay contribution**: `hasPort` counted in integration-progress score for `computeShockDecayRate` (`engine/src/culture.ts`) — having a port speeds up conquest shock recovery.

---

### 1.3 Forts

**What it does**: Three-level fortification providing defense bonus in battles, siege time extension, unrest equilibrium reduction, and shock decay acceleration.

**Infrastructure state**: `TerritoryState.fortificationLevel: 0 | 1 | 2 | 3`

**Build** (`engine/src/tick.ts:134–149`):
| Level | BUILD_TICKS | BUILD_INDUSTRY |
|---|---|---|
| fort_l1 | 3 | 3 |
| fort_l2 | 7 | 6 |
| fort_l3 | 14 | 10 |

All [PLACEHOLDER]. Build is sequential — must be at level N-1 to build N. Validated in `build_fort` action case in tick.ts.

**Defense bonus**: `computeBattleStrengths(attackingArmySize, defendingArmySize, targetTerr.state.fortificationLevel, ...)` — `fortificationLevel` is passed directly as a scalar bonus.

**Siege extension**: `siegeTicksRequired(fortLevel)` from `engine/src/war.ts` — higher level = more ticks before siege resolves.

**Unrest reduction**: `FORT_INFRA_CONTRIBUTION_PER_LEVEL` (defined in `engine/src/culture.ts`, passed as parameter to `computeUnrestEquilibrium`) — each fortification level reduces equilibrium.

**Shock decay**: `fortificationLevel` counted in integration-progress score for `computeShockDecayRate`.

**Prestige**: `PRESTIGE_PER_INFRA_POINT = 0.5` applied to sum of `hasRoad + hasPort + fortLevel` across all territories (`engine/src/prestige.ts:36`).

**Gap — no garrison mechanic**: An army `stationed` in a fort confers zero mechanical benefit beyond the fort's passive bonuses. See Section 4 for garrison design proposal.

---

### 1.4 Markets

**What it does**: Enables land-tier domestic and international `TradeRouteAgreement` routes; contributes infrastructure score.

**Infrastructure state**: `TerritoryState.hasMarket Boolean @default(false)` (added v0.32)

**Build** (`engine/src/tick.ts:134–149`):
- `BUILD_TICKS.market = 3` [PLACEHOLDER]; `BUILD_INDUSTRY.market = 5` [PLACEHOLDER]

**Trade contribution**: Required on at least one endpoint for domestic `establish_trade_route`. Required on both border-crossing endpoints for international market-tier routes (`trade_route` clause). `LAND_MARKET_CAPACITY_MULTIPLIER` scales capacity for market-tier routes.

**Unrest contribution**: Market currently does NOT appear in `computeUnrestEquilibrium` parameters — only `hasRoad`, `hasPort`, and `fortificationLevel` are passed. Market's unrest effect is indirect (through trade route stability bonuses on territories it enables).

---

### 1.5 Trade Routes (v0.33 `TradeRouteAgreement`)

**What it does**: Moving shipments that grow in capacity over cycles, charge upkeep, and apply cultural pressure.

**Types**: `domestic` (same nation, no treaty) / `international_market` (land, treaty clause) / `international_port` (sea, treaty clause)

**Constants** (`engine/src/tradeRoutes.ts`):
| Constant | Value | Status |
|---|---|---|
| `MARKET_ROUTE_BASE_CAPACITY` | 5 | [PLACEHOLDER] |
| `PORT_ROUTE_BASE_CAPACITY` | L1=8, L2=12, L3=18 | [PLACEHOLDER] |
| `ROUTE_GROWTH_CAP_MULTIPLIER` | 1.5 | [PLACEHOLDER] |
| `ROUTE_GROWTH_RATE` | 0.05 | [PLACEHOLDER] |
| `ROUTE_UPKEEP_RATE` | 0.1 | [PLACEHOLDER] |
| `ROUTE_INTERNATIONAL_UPKEEP_SPLIT` | 0.5 | [PLACEHOLDER] |
| `ROUTE_LOSS_UNREST_SCALE` | 0.1 | [PLACEHOLDER] |
| `ROUTE_LOSS_UNREST_TICKS` | 5 | [PLACEHOLDER] |
| `ROUTE_MERCHANT_PRESSURE_WEIGHT` | 0.5 | [PLACEHOLDER] |
| `ROUTE_ISOLATIONIST_THRESHOLD` | 3 | [PLACEHOLDER] |
| `ROUTE_ISOLATIONIST_COUNT_WEIGHT` | (from tradeRoutes.ts) | [PLACEHOLDER] |
| `PRESTIGE_PER_TRADE_CAPACITY` | (from tradeRoutes.ts) | [PLACEHOLDER] |

**Growth cycle** (`engine/src/tick.ts`, shipment arrival block):
- On shipment arrival: `currentCapacity = min(growthCap, currentCapacity + baseCapacity × ROUTE_GROWTH_RATE)`
- `cyclesCompleted += 1`
- New shipment departs immediately if route still active

**Upkeep** (`engine/src/tick.ts:2562–2579`):
- Per tick: `upkeep = currentCapacity × ROUTE_UPKEEP_RATE`
- Domestic: 100% from `ownerNationId`
- International: split 50/50 via `ROUTE_INTERNATIONAL_UPKEEP_SPLIT`

**Loss event** (`applyRouteLossEvent` helper in tick.ts):
- Triggered by: territory ownership change, treaty non-renewal, infra destroyed, breach
- `lostValue = currentCapacity - baseCapacity`; if ≤ 0 no spike (route never grew)
- Applies `TerritoryModifier` to endpoint territories with `unrestEquilibriumAdj = (lostValue / growthCap) × ROUTE_LOSS_UNREST_SCALE`, duration `ROUTE_LOSS_UNREST_TICKS`
- Event log: "The trade route between X and Y (grown N% over M cycles) has been severed."

**Trade stability unrest** (`engine/src/tick.ts:2296–2305`):
- `tradeRouteCount = tradeRouteTerritoryBonus[t.def.id]`
- If territory is on receiver path: `tradeStability = -(tradeRouteCount × TRADE_STABILITY_BONUS)` — reduces equilibrium

**Note on old `trade` clause**: The original flat per-tick `trade` clause (Phase 6.5, `engine/src/trade.ts`) is still active and unchanged. It applies `TRADE_STABILITY_BONUS` via the same `tradeRouteTerritoryBonus` pre-computation path. The `TradeRouteAgreement` system and the old `trade` clause co-exist; they share the `TRADE_STABILITY_BONUS` constant but use separate route infrastructure.

---

### 1.6 Treaties (11 Clause Types)

**What it does**: Formal agreements between nations containing one or more clauses. Each clause type creates a different mechanical effect evaluated each tick. Treaties have trust, terms, expiry, and renewal mechanics.

**Active clause types** (`engine/src/types.ts`, `ClauseType` union):

| Clause | Mechanism | Status |
|---|---|---|
| `tribute` | Per-tick wealth transfer from payer to receiver; missed payment → breach | Implemented |
| `trade` | Per-tick resource flow; `computeTradeCapacity`, `computeTradeFriction`; `TRADE_STABILITY_BONUS` on path territories | Implemented |
| `trade_route` | `TradeRouteAgreement` created on accept; shipment transit, growth, cultural feedback | Implemented (v0.33) |
| `territory_cession` | Territory transfers on treaty acceptance; compat-scaled shock | Implemented |
| `population_transfer` | Ownership shock applied; compat scaling computed but discarded (bug — see §3) | Partial |
| `army_lending` | Army transfers between nations; tracked by clause | Implemented |
| `outpost` | Allows the lending nation an army presence in the borrowing nation's territory | Implemented |
| `peace` | Enforces no-attack; breach via `breachMaintainPeaceObjectives` | Implemented |
| `objective` | Conditional milestone; met or failed triggers prestige/trust outcomes | Implemented |
| `defense_pact` | **Stub** — logs `[DEFENSE_PACT_UNHONORED]` event, no forced war entry | Stub only |
| `non_aggression` | Standard non-attack clause | Implemented |

**Defense pact stub detail** (`engine/src/tick.ts:957–973`): When a defense pact signatory is attacked, the engine emits an event log entry but does NOT force the pact partner into war. This means defense pacts provide zero mechanical deterrence.

**Trust mechanics** (`engine/src/diplomacy.ts`):
- Baseline: `TRUST_BASELINE` per treaty pair
- Breach: `-TRUST_BREAK_PENALTY`; recovery cooldown `TRUST_RECOVERY_COOLDOWN`
- Low trust fine: `LOW_TRUST_FINE_PER_TREATY` per active treaty when trust is degraded
- Embassy recovery: `EMBASSY_TRUST_RECOVERY_PER_TICK` while an active embassy exists in the partner's territory

**Cultural clash pressure** (`computeTreatyCulturalClash` in `engine/src/diplomacy.ts`):
- Evaluates `clauseSummary.clauseTypes` against territory's `valueTraits`
- Returns a positive unrest equilibrium adjustment — treaties misaligned with territory culture cause unrest

---

### 1.7 Cultural System

**What it does**: Each territory has four cultural trait axes (`ValueTraits`). A nation has a `NationCulture` (the centroid of its territories' traits). Territories drift toward their nation's culture over time. Unrest equilibrium is partly a function of cultural compatibility between territory and owner.

**The four axes** (`engine/src/types.ts`, `ValueTraits`):

| Axis | Negative pole | Positive pole | Threshold for constraint effect |
|---|---|---|---|
| `expansionist` | Isolationist | Expansionist | ±0.3 |
| `individualist` | Collectivist | Individualist / Merchant | ±0.3 |
| `militaristic` | Peaceful | Militaristic | ±0.3 |
| `progressive` | Traditional | Progressive | ±0.3 |

**Compatibility** (`computeCompatibility` in `engine/src/culture.ts`):
- Returns `CompatibilityBreakdown` with `.total` (0–1)
- Computed from axis distance between territory traits and nation culture + `CulturalFamily` bonus
- Drives `COMPAT_UNREST_MAX` contribution: higher compat = lower equilibrium

**Drift** (`applyDrift` in `engine/src/culture.ts`):
- `CULTURE_DRIFT_RATE × (1 − unrest)` — high unrest slows assimilation
- Multiplied by `tradeDriftMult` (1.3 if on trade route path) × `roadDriftMult` × `modDriftMult` (`engine/src/tick.ts:2491–2494`)

**Nation culture** (`computeNationCulture` in `engine/src/culture.ts`):
- Territory-count-weighted average of owned territories' `valueTraits`
- Recomputed each tick before the territory loop

**8 constraint components** (all computed per-territory in the main loop, `engine/src/tick.ts:2307–2384`):

| Component | Trigger condition | Unrest effect | Source |
|---|---|---|---|
| `isolationistEntanglement` | `expansionist < -0.3` AND treaty count > `ISOLATIONIST_TREATY_THRESHOLD` (3) | `(count - threshold) × ISOLATIONIST_ENTANGLEMENT_WEIGHT` | tick.ts:2312 |
| `isolationistEntanglement` (route) | `expansionist < -0.3` AND route count > `ROUTE_ISOLATIONIST_THRESHOLD` (3) | Additive to above | tick.ts:2318 |
| `expansionistStagnation` | `expansionist > 0.3` AND no territory acquired in `EXPANSIONIST_GROWTH_WINDOW` ticks | `EXPANSIONIST_STAGNATION_WEIGHT` flat | tick.ts:2327 |
| `collectivistIsolation` | `individualist < -0.3` AND no tribute receiver obligations | `COLLECTIVIST_ISOLATION_WEIGHT` flat | tick.ts:2338 |
| `individualistObligation` | `individualist > 0.3` AND has tribute payer clauses | `count × INDIVIDUALIST_OBLIGATION_WEIGHT` | tick.ts:2344 |
| `traditionalErosion` | `progressive < -0.3` AND drift magnitude > `TRADITIONAL_EROSION_THRESHOLD` | `TRADITIONAL_EROSION_WEIGHT` flat | tick.ts:2374 |
| `progressiveStagnation` | `progressive > 0.3` AND drift magnitude < `PROGRESSIVE_STAGNATION_THRESHOLD` | `PROGRESSIVE_STAGNATION_WEIGHT` flat | tick.ts:2382 |
| `militaryBonus` | `militaristic > 0.3` AND nation at war | `-WAR_MILITARISTIC_HAPPINESS_BONUS` (reduces equilibrium) | tick.ts:2286 |

All constraint constants are [PLACEHOLDER].

---

### 1.8 Activity Tiers + Caretaker Roads

**What it does**: Activity tiers segment nations into high/medium/low activity. Caretaker mode builds roads in territories that lack them, at no cost, when the player is inactive.

**Activity states** (`engine/src/types.ts`, `NationActivityTier`): `high` / `medium` / `low`

**Caretaker road building** (`engine/src/tick.ts`, caretaker block):
- Fires when nation has `activityTier = 'low'` (or caretaker flag set)
- Selects a territory without a road and adds `hasRoad = true`
- Costs no Mandate or Industry (purely compensatory for inactive players)

**Road effects**:
- `ROAD_DRIFT_MULTIPLIER = (from culture.ts)` — territories with roads drift faster toward national culture
- Accelerates shock decay via `computeShockDecayRate`
- Reduces effective distance pressure (road represents connectivity, not a hop-count reduction — the BFS-based distance is unchanged, but road accelerates the equilibrium-closing rate)

**Gap**: No active road-building action for active players. Roads are currently only buildable via caretaker. There is no `build_road` action for deliberate investment.

*Update: `build_road` action case exists in tick.ts (seen in Explore research). Road construction uses BUILD_TICKS/BUILD_INDUSTRY constants. Caretaker auto-builds in addition.*

---

### 1.9 Prestige

**What it does**: A score reflecting geopolitical standing. Determines `isDominant` status which unlocks mechanical advantages.

**Formula** (`engine/src/prestige.ts`, computed in `server/src/world.ts` `saveWorldState`):

| Component | Value | Source |
|---|---|---|
| Per owned territory | 10 [PLACEHOLDER] | prestige.ts:15 |
| Per active/degraded treaty | 5 [PLACEHOLDER] | prestige.ts:18 |
| Per naturally-expired kept treaty (cumulative) | 8 [PLACEHOLDER] | prestige.ts:21 |
| Per war win (cumulative) | 15 [PLACEHOLDER] | prestige.ts:24 |
| Stability bonus (avg unrest < 0.3) | +20 [PLACEHOLDER] | prestige.ts:27–30 |
| Per tick age | 0.1 [PLACEHOLDER] | prestige.ts:33 |
| Per infra point (road+port+fortLevel sum) | 0.5 [PLACEHOLDER] | prestige.ts:36 |
| Per trust point (0–100 scale) | 0.3 [PLACEHOLDER] | prestige.ts:39 |
| Per unit active trade route capacity | `PRESTIGE_PER_TRADE_CAPACITY` [PLACEHOLDER] | tradeRoutes.ts |

**Dominant qualification** (`engine/src/prestige.ts:41–56`):
- Requires absolute score ≥ `DOMINANT_PRESTIGE_FLOOR` (150) [PLACEHOLDER]
- Requires score ≥ topPrestige × `DOMINANT_COMPARABILITY_BAND` (0.85) [PLACEHOLDER]
- Multiple co-Dominant nations possible

**Dominant mechanical effects** (`engine/src/prestige.ts:60–80`):
- `DOMINANT_TRUST_PENALTY_REDUCTION = 0.75` — 25% reduction in trust loss when Dominant nation breaks a treaty
- `UNDERDOG_PRESTIGE_BONUS = 5` — non-Dominant party who accepts Dominant's treaty proposal gets +5 Prestige
- `UNDERDOG_UNREST_REDUCTION = -0.02` — minor unrest reduction when accepting a Dominant nation's treaty
- `DOMINANT_WAR_ATTACKER_BONUS` — combat advantage for non-Dominant attacking a Dominant nation (giant-killer)
- `DOMINANT_WAR_MILITARISTIC_BONUS` — additional equilibrium reduction for Militaristic territories of giant-killer attacker (`engine/src/tick.ts:2288`)

---

### 1.10 Unrest

**What it does**: Per-territory score (0–1). Above `REVOLT_THRESHOLD` (0.80) territory enters revolt and stops producing. Unrest drifts toward an equilibrium that is a weighted sum of all active components.

**Equilibrium formula** (`computeUnrestEquilibrium` in `engine/src/culture.ts`):
Components summed into a final `equilibrium` value (clamped 0–1):
1. `BASE_UNREST_FLOOR` = 0.02 [PLACEHOLDER]
2. Compatibility mismatch: `(1 - compat.total) × COMPAT_UNREST_MAX` (0.55 [PLACEHOLDER])
3. Distance from capital: `min(hops, MAX_CAPITAL_DISTANCE_HOPS) × DISTANCE_UNREST_PER_HOP` (0.04/hop [PLACEHOLDER])
4. Infrastructure reductions: road, port, fort each reduce equilibrium
5. Overexpansion: `(tcount - OVEREXPANSION_THRESHOLD) × OVEREXPANSION_PER_TERRITORY` when > 3 territories
6. Recent conquest pressure: `recentWeight × RECENT_CONQUEST_PRESSURE_PER_TERRITORY` (0.06 [PLACEHOLDER])
7. Ownership shock: current `ownershipShock` value — decays at rate driven by `computeShockDecayRate`
8. Cultural clash (treaty): `clashPressure` from `computeTreatyCulturalClash`
9. Military happiness bonus: negative when Militaristic territory at war
10. Insolvency pressure: `INSOLVENCY_GENERAL_UNREST_PER_TICK` (0.02 [PLACEHOLDER])
11. Trade stability: `-(tradeRouteCount × TRADE_STABILITY_BONUS)` (0.02 per route [PLACEHOLDER])
12. 8 cultural constraint axes (§1.7 above)
13. Population transfer shock: `POPULATION_TRANSFER_UNREST_SCALE` when `shockTicksLeft > 0`
14. Trade route stability endpoint bonus: `-0.01` if endpoint of grown active route [PLACEHOLDER]

**War additions** (applied after `computeUnrestEquilibrium`, `engine/src/tick.ts:2431–2456`):
- War overextension: distance-scaled pressure from occupied territories
- War insolvency ramp: `WAR_INSOLVENCY_UNREST_PER_TICK` when fighting on credit
- No-CB spike: `NO_CB_UNREST_SPIKE` on Peaceful/Isolationist territories of unjustified declarer
- Exhaustion bump: `PEACE_DECLINE_EXHAUSTION_BUMP` when nation declined a peace proposal

**`TerritoryModifier`** (`engine/src/tick.ts:2354–2358`):
- Timed modifiers with `unrestEquilibriumAdj` and `driftRateMultiplier`
- Sources: trade route loss spike, territory cession grace period, conquest modifiers
- Applied as `effectiveEquilibrium = causes.equilibrium + warEquilibriumAdj + modUnrestAdj`

**Revolt hysteresis** (`engine/src/tick.ts:2471–2483`):
- Enter: `unrest >= REVOLT_THRESHOLD` (0.80)
- Exit: `unrest < REVOLT_THRESHOLD - REVOLT_HYSTERESIS` (0.75)
- While in revolt: territory produces nothing (excluded from production loop)

---

## 2. Cross-System Interaction Matrix

Rows = cultural axis (negative/positive). Columns = mechanic category.

| Cultural axis | Armies / War | Ports / Trade Routes | Forts | Markets | Treaties | Prestige |
|---|---|---|---|---|---|---|
| **Expansionist** (positive) | Stagnation unrest if no territory gain in `EXPANSIONIST_GROWTH_WINDOW` ticks → pressure to go to war | Trade routes reduce stagnation pressure indirectly (economic output) | Forts enable conquest defense without stagnation penalty | Markets provide domestic routes as non-conquest expansion | Treaty territory_cession clause satisfies expansion without war | War wins → Prestige → Dominant status |
| **Isolationist** (negative) | No-CB unrest spike if at war for Peaceful/Isolationist territories | Active routes increase `isolationistEntanglement` unrest (route count threshold) | No direct interaction | No direct interaction | Active treaty count increases `isolationistEntanglement` | Dominant underdog bonus rewards isolationist accepting large-nation treaties |
| **Individualist / Merchant** (positive) | Tribute-as-payer clauses cause `individualistObligation` unrest | Merchant pressure drift bias: endpoint territories nudged toward +individualist over time | No direct interaction | No direct interaction | Tribute payer role conflicts with individualist trait | Trade route capacity → Prestige |
| **Collectivist** (negative) | No direct interaction | No direct interaction | No direct interaction | No direct interaction | No tribute receiver obligations → `collectivistIsolation` unrest | No direct interaction |
| **Militaristic** (positive) | Happiness bonus: equilibrium reduction when at war; giant-killer Dominant bonus | No direct interaction | Fort enables defense without active war | No direct interaction | Peace clause enforces non-aggression; breach creates warstate | War wins → Prestige |
| **Peaceful** (negative) | No-CB spike hits Peaceful territories hard | No direct interaction | No direct interaction | No direct interaction | Defense pact stub (no effect) | No direct interaction |
| **Traditional** (negative) | No direct interaction | `traditionalErosion` — drift on trade path accelerates cultural change past threshold | No direct interaction | No direct interaction | Cultural clash penalty if treaty clause misaligned | No direct interaction |
| **Progressive** (positive) | No direct interaction | `progressiveStagnation` — no drift when territory isolated (no road, no trade path) | No direct interaction | No direct interaction | Cultural clash penalty if treaty clause misaligned | No direct interaction |

**Implemented cross-system links**: ✅ Expansionist↔War, ✅ Isolationist↔Treaties, ✅ Isolationist↔Trade Routes, ✅ Individualist↔Trade merchant pressure, ✅ Militaristic↔War, ✅ Traditional/Progressive↔Drift rate, ✅ Cultural clash↔Treaties

**Designed-but-stub**: ⚠️ Defense pact (Militaristic-ally interaction), ⚠️ Population transfer compat scaling discarded

**Candidate gaps**: ❌ Collectivist↔infrastructure (collective investment should have a bonus), ❌ Militaristic↔Garrison (stationed army in fort should reduce unrest for militaristic territories), ❌ Progressive↔Ports/Markets (progressive territories should drift faster near trade hubs)

---

## 3. Balance and Loop Analysis

### 3.1 One-way mechanics (no negative feedback)

**Prestige accumulation (age component)**:
- `PRESTIGE_PER_TICK_AGE = 0.1` accrues every tick regardless of performance
- Old nations gain structural Prestige advantages with no decay mechanism
- Risk: Early-game leaders are perpetually advantaged. No Prestige sink exists.

**Kept-treaty Prestige (cumulative)**:
- `PRESTIGE_PER_KEPT_TREATY = 8` stacks permanently
- Incentivizes churning short treaties (sign → let expire naturally → repeat)
- No cap, no decay, no retroactive penalty if relationship sours later

**War-win Prestige (cumulative)**:
- `PRESTIGE_PER_WAR_WIN = 15` stacks permanently
- Together with kept-treaty stacking, Prestige is monotonically increasing for active players
- A peaceful high-treaty nation cannot overtake a war-focused early-game nation once the win-Prestige gap opens

**Infrastructure Prestige**:
- `PRESTIGE_PER_INFRA_POINT` rewards every fort level and road
- Infrastructure is never destroyed by normal game flow (only by conquest, which is already punished by shock/unrest)
- Result: build everything, Prestige goes up, nothing brings it back down

### 3.2 Dominant strategy candidates

**Fort-and-hold**:
- Fort L3 + stationed army: maximum passive defense, zero ongoing cost beyond army upkeep
- Forts reduce shock decay rate (easier integration) AND reduce unrest equilibrium AND extend sieges
- No garrison mechanic means no trade-off for keeping a large army stationed vs. forward-deploying it
- **Risk**: Turtling is the dominant defensive posture with no counter-pressure

**International trade route as economic engine**:
- Route capacity grows passively; upkeep scales with capacity but profit (port-tier multiplier) exceeds upkeep at distance
- Loss event creates unrest spike but no wealth loss (only grown capacity above base is lost)
- Defense pact stub means the natural trade partner protection mechanism doesn't exist yet
- **Risk**: Port-to-port long-distance routes become uncounterable economic engines once grown

**Tribute extraction from small nations**:
- Tribute pays wealth each tick; low-Trust fine is modest
- `INDIVIDUALIST_OBLIGATION_WEIGHT` punishes the payer, not the receiver
- No diminishing returns on tribute as a receiver
- Dominant trust penalty reduction means dominant nations pay 25% less for breaking tribute treaties if they want to switch partners
- **Risk**: Tribute chain is the fastest wealth-per-mandate investment with no economic counter

### 3.3 Missing feedback loops

**Loop gap: Wealth → Infrastructure → More Wealth**
- Currently: wealth → build port → trade route → more wealth (positive loop ✅)
- Missing: overbuilt infrastructure doesn't decay, doesn't cost maintenance (only army upkeep exists)
- Result: infrastructure investment is strictly non-negative, no maintenance pressure

**Loop gap: Isolationist with high unrest → can't grow treaties to relieve it**
- `collectivistIsolation` fires when no tribute receiver and `individualist < -0.3`
- The relief condition (get a tribute receiver) requires diplomacy with other nations — blocked for a nation in revolt
- Revolt prevents production → can't build → can't use economy to escape the loop
- **Risk**: A collectivist nation that falls into insolvency + revolt cannot recover without external intervention

**Loop gap: Expansionist stagnation has no diplomatic alternative**
- `expansionistStagnation` fires when no territory gained in `EXPANSIONIST_GROWTH_WINDOW` ticks
- Relief condition: acquire territory (only war or territory_cession clause)
- Trade routes, markets, and ports don't count as "expansion" for this axis
- **Risk**: Expansionist nations are structurally pressured to go to war every N ticks regardless of diplomatic options

**Loop gap: No Prestige sink**
- Prestige only goes up (territory, treaties, wins, age, infra, trade)
- No Prestige loss for sustained unrest, revolts, insolvency, or military defeat
- `isDominant` flags never toggled off mid-tick (recomputed each tick — will correct, but no decay mechanism means the flag oscillates rather than representing sustained standing)

### 3.4 Known bugs

**Population transfer compat scaling discarded** (`engine/src/tick.ts:1739`):
```typescript
void shockMagnitude; // compat-scaled magnitude computed but not used
```
The engine computes a compat-scaled shock magnitude but then applies the fixed `POPULATION_TRANSFER_UNREST_SCALE` constant instead. Result: population transfer shock is always the same magnitude regardless of cultural compatibility, making it functionally identical to conquest shock for unrest purposes.

**Defense pact is a stub** (`engine/src/tick.ts:957–973`):
The event log entry `[DEFENSE_PACT_UNHONORED]` fires but no war entry is created. All defense pact treaties are decorative. Militaristic nations that rely on defense pacts for protection are exposed.

---

## 4. Fort Garrison Design Proposal

### 4.1 Problem statement

Armies stationed in fortified territories currently provide no mechanical benefit beyond the fort's passive values. This means:
1. A player can fully abandon a fort (no army) and get the same defense bonus from the passive fort level
2. There is no trade-off for committing a large army to defense vs. projection
3. Militaristic territories near forts have no identity-reinforcing mechanic

### 4.2 Proposed garrison mechanic

**Garrison status**: An army with status `stationed` in a territory with `fortificationLevel >= 1` is considered a **garrison**. No new status needed — use the existing `stationed` state with a check.

**Effects of garrison**:

| Effect | Formula | Rationale |
|---|---|---|
| Reduced army upkeep | `upkeep = garrisonedSoldiers × UPKEEP_PER_SOLDIER × GARRISON_UPKEEP_REDUCTION` | Settled armies have better logistics |
| Additional fort defense bonus | `GARRISON_DEFENSE_BONUS_PER_SOLDIER_RATIO × (garrisonSize / MAX_GARRISON_SIZE)` added to `fortificationLevel` in `computeBattleStrengths` | Defenders on home turf |
| Siege extension | `siegeTicksRequired(fortLevel) + floor(garrisonSize × GARRISON_SIEGE_TICKS_PER_SOLDIER)` | More soldiers = longer siege |
| Unrest suppression | Reduce equilibrium by `GARRISON_UNREST_SUPPRESSION` on the territory | Soldiers deter revolt |
| Militaristic trait interaction | Double the unrest suppression if `territory.valueTraits.militaristic > 0.3` | Culturally compatible presence |

**Constants (all [PLACEHOLDER])**:
```typescript
// engine/src/war.ts (new exports)
export const GARRISON_UPKEEP_REDUCTION     = 0.75;  // garrison pays 75% of normal upkeep
export const GARRISON_DEFENSE_BONUS_PER_SOLDIER_RATIO = 0.5; // up to +0.5 fort-level-equivalent at full garrison
export const MAX_GARRISON_SIZE             = 10;    // soldiers; beyond this, no additional bonus
export const GARRISON_SIEGE_TICKS_PER_SOLDIER = 0.5; // fractional tick extension per soldier
export const GARRISON_UNREST_SUPPRESSION   = 0.04;  // equilibrium reduction [PLACEHOLDER]
export const GARRISON_MILITARISTIC_MULTIPLIER = 2.0; // doubles suppression for militaristic trait
```

**Integration points** (all future implementation session — no code changes in this document):

1. `engine/src/war.ts` → `computeBattleStrengths`: Accept optional `garrisonSize: number = 0`; add `GARRISON_DEFENSE_BONUS_PER_SOLDIER_RATIO × (garrisonSize / MAX_GARRISON_SIZE)` to the defender's fort bonus

2. `engine/src/war.ts` → `siegeTicksRequired`: Accept optional `garrisonSize: number = 0`; add `floor(garrisonSize × GARRISON_SIEGE_TICKS_PER_SOLDIER)`

3. `engine/src/tick.ts` — Upkeep loop (`tick.ts:2552–2560`): When computing army upkeep, check if army is `stationed` and territory has `fortificationLevel >= 1`; apply `GARRISON_UPKEEP_REDUCTION`

4. `engine/src/culture.ts` → `computeUnrestEquilibrium`: Add `garrisonSize: number` parameter; subtract `GARRISON_UNREST_SUPPRESSION` (doubled for militaristic trait) when `garrisonSize > 0`

5. `harness/src/types.ts`: Add `assert_garrison_defense`, `assert_garrison_suppression` assertion types

6. `engine/src/tick.ts` — War resolution: When looking up the army in the defender's territory, extract `garrisonArmy = armyInTerritory(draft.armies, targetTerrId, defenderId)` and pass `garrisonArmy?.size ?? 0` to both `computeBattleStrengths` and `siegeTicksRequired`

### 4.3 Design trade-offs

**For garrison mechanic**:
- Creates a real commitment decision (station vs. project)
- Gives militaristic cultural identity a mechanical expression beyond war happiness bonus
- Enables a "fortress economy" playstyle distinct from "conquest" and "trade" styles

**Against / risks**:
- Upkeep reduction incentivizes parking large armies permanently (degenerate case: max garrison = effectively free army)
- Unrest suppression stacks with fort passive reduction — combined effect could drop equilibrium near 0 for militaristic territories, making them immune to unrest
- Garrison defense bonus makes defended forts exponentially harder to take (fort bonus + garrison bonus + compat + road all reduce at the same time)

**Recommended mitigation**: Set `GARRISON_UNREST_SUPPRESSION` low (0.04 vs fort's ~0.08/level) and cap the garrison size contribution to avoid additive stacking. Require the garrison army to remain `stationed` continuously — any movement order cancels garrison status until it returns and re-stations. This creates the commitment cost without over-powering the defense.

---

## 5. Open Questions — Prioritized by Phase 9 Relevance

### P0 — Must answer before Phase 9 begins

**Q1: What is Phase 9's primary new mechanic?**
The backlog mentions several candidate systems. The answer determines which open questions below are load-bearing.

**Q2: Is the defense pact stub acceptable for Phase 9, or must it be promoted to a real mechanic?**
Defense pacts appear in several existing scenarios as a stability mechanism. The stub means any treaty containing a `defense_pact` clause provides zero deterrence. If Phase 9 involves multi-polar conflict, this is a critical gap.

**Q3: Should the Prestige sink be added before or after Phase 9 systems are designed?**
If Phase 9 introduces a victory condition based on Prestige thresholds, the absence of a sink means the first player to reach a territory lead is uncatchable. If Phase 9 is not about Prestige, this can wait.

**Q4: Does population transfer work correctly for Phase 9 scenarios?**
The compat scaling bug (`void shockMagnitude`) means population transfer always applies fixed-magnitude shock. If Phase 9 uses population transfer clauses in high-compat diplomatic scenarios, the bug makes them feel incorrect (same shock as hostile transfer). Fix is a one-line change but needs a failing test first.

### P1 — Should answer before Phase 9 design is locked

**Q5: What is the intended role of markets vs. ports in the economy?**
Currently ports have a port-level capacity multiplier and profit multiplier (distance bonus). Markets enable land routes at base capacity. There is no market upgrade path (portLevel has no market analogue). Is the market→port power gap intentional? If not, Phase 9 may need a `marketLevel` path.

**Q6: Should roads be player-buildable (via action) or remain caretaker-only?**
The `build_road` action case appears in tick.ts but it's unclear if it's wired through the server action handlers and harness. Roads are powerful (drift multiplier, shock decay, distance integration) but only auto-built for inactive nations currently.

**Q7: What does "fleet" mean in the context of Phase 9?**
`systems-backlog.md` and tech stack mention naval mechanics as a candidate. If Phase 9 introduces sea combat, port-level becomes highly relevant and the `portLevel` default-1-everywhere assumption breaks down.

**Q8: Is the collectivist isolation / revolt deadlock a Phase 9 problem?**
The feedback gap (§3.3) where a collectivist insolvent nation can't escape revolt is a live game state that can be triggered today. If Phase 9 introduces more economic pressure, this deadlock becomes more likely. A minimum relief mechanism (e.g., foreign tribute-giver breaks the isolation) may be needed.

### P2 — Can defer beyond Phase 9

**Q9: How should the garrison mechanic interact with caretaker mode?**
If a player goes inactive, their garrisoned army should probably maintain garrison status automatically. The current caretaker only handles road-building.

**Q10: Should the `trade` clause (old, flat per-tick flow) be deprecated in favor of `trade_route`?**
Both systems exist. The old `trade` clause has no growth, no shipments, no loss event. If `trade_route` is the intended long-term design, continuing to support both creates confusion. A migration path (convert existing `trade` clauses to `trade_route` clauses on next renewal) would clean this up.

**Q11: Should traditional/progressive trait interact with infrastructure building?**
Currently no interaction: any nation can build ports, markets, and forts regardless of cultural axis. A Traditional territory that builds a market (highly progressive act) could logically generate unrest or slow the build. This would make the trait system feel more coherent but adds complexity.

**Q12: Is the DOMINANT_PRESTIGE_FLOOR of 150 achievable in Phase 9 timescales?**
`PRESTIGE_PER_TICK_AGE = 0.1` means 1500 ticks of pure age gives the floor. Territory (10/territory), kept treaties (8/expiry), and war wins (15/win) accelerate it. This has not been simulated — the floor may be unreachable in any reasonable game length, making the Dominant system inert.

---

## 6. Source File Reference

| System | Primary source files |
|---|---|
| Armies / War | `engine/src/war.ts`, `engine/src/tick.ts` (war processing block) |
| Ports | `engine/src/types.ts` (`TerritoryState.hasPort`, `portLevel`), `engine/src/tradeRoutes.ts` |
| Forts | `engine/src/tick.ts` (`build_fort` case, `computeBattleStrengths` call), `engine/src/war.ts` |
| Markets | `engine/src/types.ts` (`hasMarket`), `engine/src/tick.ts` (`build_market` case) |
| Trade Routes | `engine/src/tradeRoutes.ts`, `engine/src/tick.ts` (shipment transit, upkeep, loss event, cultural feedback) |
| Treaties / Diplomacy | `engine/src/diplomacy.ts`, `engine/src/tick.ts` (clause evaluation loop) |
| Culture / Unrest | `engine/src/culture.ts`, `engine/src/tick.ts` (territory loop 2263–2508) |
| Activity Tiers | `engine/src/tick.ts` (caretaker block), `engine/src/types.ts` (`NationActivityTier`) |
| Prestige | `engine/src/prestige.ts`, `server/src/world.ts` (`saveWorldState`) |
| Unrest equilibrium | `engine/src/culture.ts` (`computeUnrestEquilibrium`), `engine/src/tick.ts:2405–2421` |
