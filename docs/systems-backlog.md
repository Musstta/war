# Persistent World — Systems Backlog & Design Decisions

**Purpose:** Living backlog of locked decisions, vision items, and 
phase assignments. Hand this document to every Claude Code session 
alongside `persistent-world-design.md` and 
`persistent-world-tech-stack.md`.

**Status:** Updated through Phase 6 completion. Phase 6.5 (systems 
deepening) is next.

---

## 1. Locked Decisions — Ready to Build

These are fully decided. Claude Code can implement without asking.

### 1.1 Army lending clause
- Loaned troops fight under receiving nation's orders for the loan 
  duration
- Immediate revoke if lending and receiving nations declare war on 
  each other — troops return to lending nation's nearest owned 
  territory (travel time applies)
- Return penalty if fewer units returned than lent:
  `penalty = collateral × (missingUnits / originalUnits)²`
  Quadratic — small losses are cheap, large losses are very expensive
- Units can also be permanently sold (one-time Wealth payment, no 
  return obligation — goes through instant_trade machinery, not treaty)
- Movement delay applies to delivery: distance in territories ÷ 
  movement speed (roads and geography modifiers apply)

### 1.2 Population transfer clause
- Tradeable resource like any other in a treaty
- Unrest hit on both sender and receiver:
  `unrestHit = (1 - compatibilityScore) × 
   POPULATION_TRANSFER_UNREST_SCALE [PLACEHOLDER]`
- Cultural drift accelerates in receiving territory toward the 
  transferred population's cultural family
- Large transfers risk triggering cultural rebellion if compatibility 
  is very low

### 1.3 Army movement model
- Base: 1 tick per territory crossed
- Geography modifiers on the territory being crossed:
  - Mountainous / forest: ×1.5 (50% slower)
  - Desert: ×1.33 (33% slower)
  - Plain / coastal: ×1.0 (no modifier)
- Road present in crossing territory: ×0.5 applied after geography
  (road through mountains = ×0.75 net; road through plain = ×0.5)
- Movement is a multi-tick planned action — army is in transit state,
  visible to fog-of-war-cleared nations along the path
- Interception: possible if intercepting nation has an army in a 
  territory on the transit path AND is at war with the moving nation
  (stub for now, lock model confirmed)

### 1.4 Border skirmish mechanics
- Fires when both armies queue attack actions against each other 
  in transit on the same tick (pre-tick mutual attack decision)
- Resolves as a small battle — neither nation automatically enters 
  war
- Each nation must separately decide to declare war in response
- Casus belli generated:
  - Default: soft CB (reduces Trust/unrest penalty for declaring)
  - Full CB if additional friction exists: competing territorial 
    claims on the same territory, prior skirmishes within last 
    [PLACEHOLDER: 10] ticks, cultural hostility above 
    [PLACEHOLDER: 0.7] incompatibility
- Non-declaration cultural reactions (per-axis, all named unrest 
  components):
  - Militaristic territories: unrest from showing weakness if nation
    does not declare (the skirmish was an opportunity)
  - Peaceful territories: stability bonus if nation does not escalate
  - Expansionist: mild unrest if nation does not capitalize on the CB
  - Isolationist: unrest spike regardless of outcome (unwanted contact)
  - Traditional: unrest from unpredictability of the incident
  - Collectivist: unrest if national response feels weak or 
    uncoordinated
  - Individualist: minimal reaction (self-reliant, low state 
    expectation)
- Barricades: a nation can deploy a barricade on a territory they own
  (costs [PLACEHOLDER: 1] Mandate) — applies a movement debuff 
  (×1.5) and a territory defense bonus ([PLACEHOLDER: +15%]) to 
  passing armies for [PLACEHOLDER: 5] ticks. Temporary structure,
  not permanent infrastructure.

### 1.5 Territory cession prerequisites
- Receiving nation must have an active embassy in the territory 
  being ceded for the transfer to complete
- Exception: unclaimed territories and independent single-territory 
  nations do not require an embassy (see subjugation, §1.7)
- If no embassy exists at the tick the cession should fire: transfer
  delays up to [PLACEHOLDER: 3] ticks waiting for embassy 
  construction. If still no embassy after delay: treaty breaches, 
  collateral transfers, Trust hit on the party that failed to 
  establish the embassy (the receiver)

### 1.6 Embassy system ✓ COMPLETE (v0.29)
- **Implemented:** `propose_embassy` (1 Mandate), `build_embassy` (1 Mandate),
  `expel_embassy` (1 Mandate) action handlers in engine + server
- `EMBASSY_BUILD_TICKS = 3` construction ticks (proposed → under_construction 
  → active)
- Lifecycle: `proposed | under_construction | active | expelled | destroyed`
  (destroyed auto-fires on host territory ownership change)
- **Active effects implemented:**
  - Clear visibility for embassy-owning nation on host territory
    (Rule 4c in `computeVisibility`, `VisEmbassyInput`)
  - `EMBASSY_TRUST_RECOVERY_PER_TICK = 0.5` bonus passive recovery
    while active [PLACEHOLDER — needs tuning]
  - `EMBASSY_COMPAT_BONUS = −0.01` equilibrium reduction on host 
    territory [PLACEHOLDER — probably needs 2–3×]
  - `EMBASSY_EXPEL_TRUST_PENALTY = −10` Trust hit to host on expel
- Territory cession `|| true` stub **removed**: cession now requires 
  live embassy within `CESSION_EMBASSY_GRACE_TICKS` window
- Harness `propose_embassy`/`build_embassy`/`expel_embassy` actions + 
  `embassy-lifecycle.json` scenario validate full lifecycle
- **Deferred / not yet implemented:**
  - One-per-bilateral-pair enforcement not yet validated
  - Mandate cost reduction for diplomacy between embassy nations not yet wired
  - Compatibility score buffer (separate from equilibrium bonus) not wired
- Subjugation exception: single-territory independent nations can 
  be subjugated without an embassy (see §1.7)

### 1.7 Subjugation of single-territory nations
- An alternative to full war for absorbing independent single-
  territory states
- Requires: army presence in or adjacent to target territory + 
  diplomatic offer queued
- Target can accept (becomes client state / integrated territory 
  at reduced conquest shock) or refuse (triggers a small-scale 
  conflict, not a full declared war — uses skirmish mechanics)
- Client state integration: lower conquest shock than conquest, 
  higher than voluntary cession — scaled by compatibility
- Not available against multi-territory nations (must use war + 
  peace deal)

### 1.8 Diplomatic value engine
Two distinct signals shown in the proposal UI:

**Wealth value** — raw resource equivalent used for collateral 
calculation. Computed per clause from game state:
- `non_aggression`: f(relative army sizes, shared border length, 
  Trust)
- `military_access`: f(strategic importance of corridor, army sizes)
- `defense_pact`: f(relative Prestige, army sizes, active wars nearby)
- `outpost/sentry`: f(territories revealed, strategic contest level)
- `territory_cession`: f(territory production + population + 
  infrastructure + strategic position)
- `tribute`: face value in Wealth/tick
- `trade`: net resource differential value
- `embassy`: f(compatibility gap between nations, diplomatic 
  action savings)
- `army_lending`: f(army size × ticks × distance from conflict)
- `population_transfer`: f(population size × compatibility penalty)

All formulas [PLACEHOLDER]. The output is a reference point, not a 
price.

**Diplomatic value** — strategic/reputational weight tied to Trust 
effects. A non-aggression with your most dangerous neighbor is worth 
more diplomatically than one with a distant peaceful nation. Shown 
as a separate gauge. Not a spendable resource — it informs Trust 
implications and feeds into the minimum collateral calculation.

**Minimum collateral:**
`minCollateral = netWealthValueDifferential × 
 COLLATERAL_FLOOR_RATE [PLACEHOLDER: 0.20]`
Player can set collateral above minimum. Cannot go below.

**UI display:** proposal builder shows for each clause:
- "Estimated Wealth value to you: X"
- "Estimated Wealth value to them: Y"  
- "Diplomatic weight: [low/medium/high/critical]"
- Minimum collateral auto-populated, editable upward

### 1.9 Maintain_peace polish
- Minimum collateral floor derived from diplomatic value engine 
  (§1.8) — trivial maintain_peace treaties between non-threatening 
  nations have near-zero Wealth value, making the collateral floor 
  near-zero but the Trust farming gain proportionally small
- Trust bonus on completion scales with diplomatic value: a 
  maintain_peace between nations that were genuinely at risk of war 
  yields full bonus; between distant peaceful nations yields 
  [PLACEHOLDER: 25%] of normal bonus
- Minimum term: 3 ticks (already enforced)
- Consecutive signing limit: a nation cannot sign more than 
  [PLACEHOLDER: 2] maintain_peace treaties with the same partner 
  within [PLACEHOLDER: 20] ticks — prevents farming via rapid 
  re-signing

### 1.10 Resource auto-assignment
- Default behavior for all outgoing resource flows (trade clauses, 
  tribute, army lending delivery): distribute proportionally across 
  all owned territories weighted by their relevant production rate
- Manual territory pinning remains available as an override for 
  players who want strategic specificity
- If a territory is lost mid-treaty: flow redistributes 
  automatically across remaining territories (no clause degradation 
  unless total nation output cannot cover the obligation)
- Shown in UI: "sourced from all territories proportionally" with 
  a breakdown available on expand

### 1.11 Outpost / sentry clause
- A clause in a treaty granting the receiving nation a visibility 
  tier upgrade on specified territories for the treaty duration
- Types:
  - `sentry`: grants LightFog on specified territory (you know who 
    owns it and approximate military presence)
  - `outpost`: grants Clear visibility on specified territory (full 
    detail, army positions visible)
- Wealth value computed by diplomatic value engine (§1.8)
- Physical representation: the granting nation builds a small 
  outpost structure in the territory (same construction pipeline as 
  roads/ports, [PLACEHOLDER: 2] ticks, costs [PLACEHOLDER: 1] 
  Industry)
- Destroyed if territory changes ownership
- Can be revoked early (treaty breach consequences apply)

---

## 2. Systems Integration — Open Loops to Close

Existing systems that should be connected but aren't yet. All are 
wiring tasks, not new features. Build before Phase 7.

### 2.1 Trade → unrest and integration (design doc §14A.4) ✓ v0.25
- `trade_stability` named unrest component wired: −TRADE_STABILITY_BONUS [0.02] per active trade clause on the receiving nation's route territories
- `TRADE_DRIFT_MULTIPLIER` [1.3] applied to cultural drift for territories on active route paths
- Both are first-pass — see tuning-notes.md for "trade_stability and drift acceleration" note

### 2.2 Eight cultural constraint axes ✓ v0.25 (all 8 now implemented)

| Trait pole | Unrest trigger | Notes |
|---|---|---|
| Militaristic | Long peace (no war in N ticks) | ✓ Implemented (pre-v0.25) |
| Peaceful | Prolonged war | ✓ Implemented (pre-v0.25) |
| Isolationist | Treaty count > ISOLATIONIST_TREATY_THRESHOLD [3] | ✓ `isolationist_entanglement` v0.25 |
| Expansionist | No territory acquired in last EXPANSIONIST_GROWTH_WINDOW [10] ticks | ✓ `expansionist_stagnation` v0.25 |
| Collectivist | No tribute/solidarity receiver obligations | ✓ `collectivist_isolation` v0.25 |
| Individualist | Active tribute payer obligations | ✓ `individualist_obligation` v0.25 |
| Traditional | Cultural drift rate exceeds TRADITIONAL_EROSION_THRESHOLD [0.05] | ✓ `traditional_erosion` v0.25 |
| Progressive | Cultural drift rate below PROGRESSIVE_STAGNATION_THRESHOLD [0.01] | ✓ `progressive_stagnation` v0.25 |

All weights [PLACEHOLDER]. Note: traditional_erosion threshold currently unreachable — see tuning-notes.md.

### 2.3 Geography → trade capacity and friction ✓ v0.25
- `computeTradeCapacity` and `computeTradeFriction` pure functions in `engine/src/trade.ts`
- `acceptTreaty.ts` now populates capacity and friction on TradeRoute at signing
- Friction enforcement (applying friction to actual flow amounts) is deferred — values stored only
- All constants [PLACEHOLDER] — see tuning-notes.md

### 2.4 Roads → cultural drift rate ✓ v0.25
- `ROAD_DRIFT_MULTIPLIER` [1.25] applied to drift rate in territory loop
- Applied to both unrest drift rate and cultural drift (`applyDrift` multiplier parameter)

### 2.5 Geography → conquest shock magnitude ✓ v0.25
- `GEOGRAPHY_SHOCK_MULTIPLIER` map in `engine/src/war.ts`
- Applied at all three conquest shock callsites in `tick.ts`
- All multipliers [PLACEHOLDER]

### 2.6 Population → production scaling ✓ v0.25
- `POPULATION_PRODUCTION_BASE = 50` — production multiplier = `population / 50`
- Applied to all three resource streams (pop, ind, wealth) per territory per tick
- Linear — see tuning-notes.md for sublinear curve note and POPULATION_PRODUCTION_BASE calibration concern

---

## 3. Initialization Pipeline ✓ v0.26

`deriveTerritoryTraits(family, geography, seed)` built in `engine/src/initialization.ts`. Wired into `ensureWorldInitialized`. `GET /api/admin/territory/:id/derived-traits` endpoint for authoring inspection. All table values [PLACEHOLDER] — see tuning-notes.md §3.1–3.4 notes.

### 3.1 Cultural family → starting trait values
Derived from Hofstede cultural dimensions as a reference baseline. 
All values [PLACEHOLDER] — principled starting points, not final 
tuning.

| Family | Collectivist | Traditional | Militaristic | Expansionist |
|---|---|---|---|---|
| Latin | +0.3 | +0.1 | −0.1 | +0.1 |
| European | −0.2 | −0.1 | +0.1 | +0.2 |
| East Asian | +0.5 | +0.4 | +0.1 | −0.1 |
| South Asian | +0.4 | +0.3 | 0.0 | 0.0 |
| Arab | +0.2 | +0.5 | +0.1 | 0.0 |
| Slavic | +0.1 | +0.2 | +0.2 | +0.1 |
| African | +0.3 | +0.2 | 0.0 | 0.0 |
| Indigenous | +0.2 | +0.4 | −0.2 | −0.3 |
| Nordic | −0.3 | −0.2 | −0.1 | 0.0 |
| Frontier | −0.4 | −0.3 | +0.2 | +0.5 |

Values are axis offsets from 0. Final trait = family offset + 
geography modifier + seeded RNG variance [PLACEHOLDER: ±0.15].

### 3.2 Geography → trait modifiers
Applied on top of family baseline:

| Geography | Militaristic | Expansionist | Isolationist | Traditional |
|---|---|---|---|---|
| Mountainous | +0.1 | −0.2 | +0.3 | +0.2 |
| Coastal | −0.1 | +0.2 | −0.2 | −0.1 |
| Island | 0.0 | −0.1 | +0.4 | +0.1 |
| Plain | 0.0 | +0.1 | −0.1 | 0.0 |
| Forest | +0.1 | −0.1 | +0.2 | +0.1 |
| Desert | +0.2 | 0.0 | +0.2 | +0.3 |

All [PLACEHOLDER].

### 3.3 Geography + family → starting population density
Base population by geography [PLACEHOLDER]:
- Coastal plain: 80
- Inland plain: 60
- Forest: 40
- Mountainous: 30
- Desert: 15
- Island: 50

Family multiplier [PLACEHOLDER]:
- East Asian: ×1.8
- South Asian: ×1.6
- Latin: ×1.0
- European: ×1.1
- Arab: ×0.9
- African: ×0.8
- Indigenous: ×0.6
- Frontier: ×0.5

### 3.4 Cultural family → base economic productivity
Starting Wealth/Industry/Population production rates modified by 
family [PLACEHOLDER]:

| Family | Wealth | Industry | Population growth |
|---|---|---|---|
| Latin | ×1.0 | ×0.9 | ×1.1 |
| European | ×1.1 | ×1.2 | ×1.0 |
| East Asian | ×1.1 | ×1.3 | ×1.2 |
| Arab | ×1.2 | ×0.8 | ×1.0 |
| Frontier | ×0.7 | ×0.8 | ×0.9 |

All [PLACEHOLDER].

---

## 4. Culture Objectives and Edicts

Vision item — document now, build in Phase 8.

### 4.1 Culture objectives
Territory-level expectations generated by dominant trait values. 
If unmet → named unrest component. If met → small stability bonus.

Examples:
- Militaristic (> 0.5): expects army recruitment within last N ticks.
  Unmet: `military_restlessness` unrest component
- Expansionist (> 0.5): expects territorial growth within last N 
  ticks. Unmet: `expansion_stagnation` unrest
- Merchant/Individualist (> 0.5): expects active trade routes. 
  Unmet: `trade_hunger` unrest
- Isolationist (> 0.5): expects treaty count below threshold. 
  Exceeded: `entanglement_anxiety` unrest
- Traditional (> 0.5): expects cultural drift rate below threshold. 
  Exceeded: `identity_erosion` unrest
- Progressive (> 0.5): expects cultural exchange above threshold. 
  Unmet: `cultural_stagnation` unrest
- Collectivist (> 0.5): expects tribute/solidarity obligations 
  present. Unmet: `isolation_guilt` unrest
- Peaceful (> 0.5): expects no active wars. Violated: 
  `war_weariness` unrest ✓ (partially implemented)

All thresholds and weights [PLACEHOLDER].

### 4.2 Edicts
Nation-level policy declarations that temporarily suppress natural 
cultural penalty for acting against your culture. Cost: Mandate/tick 
for duration. Effect: reduced unrest hit + production bonus relevant 
to the edict type. Side effect: accelerates cultural drift in edict 
direction.

Edict lifecycle:
1. Player pays Mandate to declare edict (duration in ticks)
2. While active: suppressed unrest, production bonus, drift 
   accelerates toward edict culture
3. If edict used repeatedly / long enough: trait flips toward edict 
   direction (uses existing trait flip mechanic, biased RNG)
4. Once trait flips: edict is no longer needed — territory now 
   expects this behavior
5. New culture objective fires for the flipped trait
6. No going back without another sustained edict in opposite 
   direction (another period of cultural pain)

Example edict types:
- `martial_law`: suppresses Peaceful unrest during war, boosts 
  army recruitment, accelerates Militaristic drift
- `open_borders`: suppresses Isolationist unrest from treaties, 
  boosts trade route establishment, accelerates Progressive drift
- `austerity`: suppresses Merchant unrest from low trade, boosts 
  Industry production, accelerates Traditional drift
- `cultural_exchange`: suppresses Traditional unrest from drift, 
  boosts compatibility gains, accelerates Progressive drift

All values [PLACEHOLDER]. Edict system is Phase 8.

---

## 5. Events System

Vision item — document now, build in Phase 8.

### 5.1 Territory modifier framework
Before events, build a `TerritoryModifier` composable system. 
Every territory has a set of active modifiers:
- Movement speed multiplier (affects armies crossing)
- Production multiplier (Pop/Ind/Wealth output)
- Unrest equilibrium additive (named component)
- Cultural drift rate multiplier

Sources of modifiers (all feed into same system):
- Geography (permanent)
- Infrastructure (permanent while built)
- Events (temporary, N ticks)
- War-torn status (temporary)
- Occupation (conquest shock — already implemented, migrate into 
  this framework)
- Treaty cultural clash (already implemented, migrate)
- Edict effects (temporary)
- Barricade (temporary, §1.4)

### 5.2 Natural disasters
Fired from seeded RNG weighted by territory state. Neglected 
high-unrest territories more likely to get negative events.

| Event | Effect | Duration |
|---|---|---|
| Flood | Road destroyed + movement ×1.5 | [PLACEHOLDER] ticks |
| Earthquake | Infrastructure damage + unrest spike | [PLACEHOLDER] |
| Drought | Wealth + Population production ×0.5 | [PLACEHOLDER] |
| Disease | Population loss + unrest spike | [PLACEHOLDER] |
| Storm (coastal) | Port damaged + trade route disrupted | [PLACEHOLDER] |

### 5.3 Positive events
Well-developed stable territories more likely to receive these.

| Event | Effect | Duration |
|---|---|---|
| Carnival / Festival | Unrest −0.05, drift acceleration | [PLACEHOLDER] |
| Trade boom | Wealth production ×1.3 (requires active trade route) | [PLACEHOLDER] |
| Infrastructure milestone | Stability bonus on road/port/fort completion | Permanent |
| Cultural renaissance | Progressive/Traditional drift bonus | [PLACEHOLDER] |

### 5.4 Manmade tragedies
| Event | Trigger | Effect |
|---|---|---|
| War-torn | After occupation ends | Movement ×1.3 + production ×0.7 for N ticks |
| Rebellion aftermath | After revolt suppressed | Unrest spike + infra damage |
| Economic collapse | Wealth stock < −50 for 5+ ticks | Production ×0.5 for N ticks |

Data model: `TerritoryEvent` table: `id`, `territoryId`, `type`, 
`startTick`, `durationTicks`, `modifiers` (JSON). Build table in 
Phase 6.5 migrations even if events don't fire yet — architecture 
ready.

---

## 6. UI Target — Paradox-Style

Vision item — build in Phase 8/9 UI pass. Every UI decision before 
then should not make this harder to reach.

### 6.1 Target layout
- **Top bar:** nation name, Pop/Ind/Wealth with per-tick rates and 
  trend arrows, Mandate used/available, tick counter + phase 
  countdown, Prestige rank
- **Main canvas:** map always visible, fog overlays, floating 
  numbers (production ticks, army movements, unrest changes on map)
- **Right panel:** persistent context panel reacting to selection 
  (territory / nation / army / treaty detail) — not a drawer, 
  always visible
- **Bottom bar:** active wars, active treaties, incoming proposals, 
  urgent notifications
- **Event log:** toggleable history panel, first-class feature
- **Floating numbers:** damage/production/unrest deltas visible on 
  map as transient overlays

### 6.2 Advisor / notification system
Persistent feed surfacing recommended actions. Not blocking — 
informational only. Severity: info / warning / urgent.

Examples:
- "Belize unrest at 0.7 — consider building a road"
- "Non-aggression with Guatemala expires in 3 ticks"
- "Honduras army moving toward your border"
- "Inactive for 2 ticks — Dormant in 1 tick"
- "Militaristic territories restless — no war in 15 ticks"
- "Embassy in Nicaragua enables territory cession if needed"

Dismissable per notification. Build in Phase 8.

### 6.3 Tutorial and documentation
- In-game tutorial as a scripted harness scenario — guided 
  walkthrough teaching the game by playing a simplified version
- Demo scenario: 3 nations, 20 ticks, covers: claiming territory, 
  building infrastructure, proposing a treaty, declaring war, 
  signing peace
- Full documentation site generated from design docs
- Build in Phase 9

---

## 7. Full Simulation Harness Upgrade

Vision item — Phase 9.

Agent-based simulation replacing scripted scenarios:
- Randomized initial world states (different starting positions, 
  culture distributions, geography)
- AI nations using existing doctrine system
- Player-mimicking AIs using game theory heuristics:
  - Attack when strength advantage > threshold AND Trust < threshold
  - Treaty when mutual value > threshold AND Trust > threshold
  - Trade when route value > opportunity cost
  - Edict when cultural pressure > mandate cost
- Outputs: balance data per system, starting-position equity 
  analysis, culture-constraint effectiveness, Prestige formula 
  validation
- Used for systematic tuning of all [PLACEHOLDER] constants

---

## 8. Americas Territory Map — Phase 7 Stage 1

### 8.1 Territory list
**North America (12 territories):**
- `usa_northeast`
- `usa_midwest`
- `usa_south`
- `usa_west`
- `canada_west` (BC, Alberta)
- `canada_central` (Saskatchewan, Manitoba, Ontario, Quebec)
- `canada_east` (Maritimes, Newfoundland)
- `canada_northwest` (Yukon, NWT, Nunavut, Alaska)
- `mexico_norte`
- `mexico_centro`
- `mexico_sur`

**Central America (7 territories — keep individual):**
- `costa_rica`, `guatemala`, `honduras`, `nicaragua`, `panama`, 
  `el_salvador`, `belize`

**Caribbean (2 territories):**
- `caribbean_west` (Cuba, Jamaica, Haiti, small western islands)
- `caribbean_east` (Puerto Rico, Dominican Republic, smaller 
  eastern islands)

**South America (16 territories):**
- `colombia_andes`
- `colombia_orinoquía`
- `venezuela`
- `brazil_amazonia`
- `brazil_nordeste`
- `brazil_sul`
- `peru_costa_sierra` (coast + highland combined)
- `peru_selva` (Amazon basin interior)
- `argentina_pampa_norte` (Buenos Aires + agricultural core + norte)
- `argentina_patagonia`
- `chile`
- `bolivia`
- `ecuador`
- `paraguay`
- `uruguay`
- `guianas` (French Guiana, Suriname, Guyana)

**Total: 37 territories**

### 8.2 Cultural family assignments (Americas)
- `usa_*`, `canada_*`: Frontier / European mix
- `mexico_*`, `colombia_*`, `venezuela`, `ecuador`, `peru_*`, 
  `bolivia`, `paraguay`: Latin
- `brazil_*`: Latin (Nordeste has stronger African influence)
- `argentina_*`, `uruguay`, `chile`: Latin / European mix
- `caribbean_*`: Latin / African mix
- `central_america_*`: Latin / Indigenous mix
- `guianas`: African / European mix
- `canada_northwest`: Indigenous / Frontier

### 8.3 Adjacency notes (edge cases for auto-generation review)
- `caribbean_west` and `caribbean_east`: not land-adjacent to 
  each other or mainland — sea routes only (requires port on both 
  ends)
- `canada_northwest` and `usa_west`: adjacent (Alaska border)
- `colombia_andes` and `colombia_orinoquía`: adjacent to each other 
  and to Venezuela
- `peru_costa_sierra` and `peru_selva`: adjacent
- `brazil_amazonia` borders: Venezuela, Colombia Orinoquía, Peru 
  Selva, Bolivia, Brazil Nordeste, Brazil Sul
- `guianas`: adjacent to Venezuela and Brazil Amazonia only — 
  sea route to Caribbean

---

## 9. Phase Assignment Summary

| Phase | Focus | Status |
|---|---|---|
| 0–3 | Skeleton, persistence, map, auth, basic play | ✓ Complete |
| 4 | Infrastructure, Culture, Diplomacy, Trade, War | ✓ Complete |
| 5 | AI nations, activity tiers, fragmentation | ✓ Complete |
| 6 | Fog of war, Prestige, War council, hardening | ✓ Complete |
| 6.5 | Systems integration, initialization pipeline, treaty expansion, movement model, diplomatic value engine | In progress (Prompt 1 of N complete — 2.1–2.6 wired) |
| 7 | Americas map expansion (37 territories) | After 6.5 |
| 8 | Culture objectives, edicts, events system, advisor/notification UI, embassy construction, Paradox UI pass | After 7 |
| 9 | Tutorial, documentation, full simulation harness | After 8 |
| 10 | Europe + Asia map expansion | After 9 |

---

## 10. Known Placeholder Constants Requiring Post-Phase-7 Tuning

This is a non-exhaustive reminder. ALL constants in the codebase 
are [PLACEHOLDER]. The following are highest priority for the 
first tuning sweep after Phase 7 real-play data:

- Activity tier thresholds (3/7/14 ticks)
- Conquest shock initial value and decay rate
- Rapid expansion window (12 ticks)
- Debt recovery skim rate (currently 0.30, known too slow)
- All battle formula weights
- Prestige formula weights and Dominant floor/band
- All 8 cultural constraint axis thresholds and weights
- Pacification threshold and difficulty formula
- Army movement speed modifiers
- Diplomatic value formulas (all null/placeholder)
- Trust recovery rate and fine rates
- Fragmentation risk formula weights
- All AI doctrine scoring weights