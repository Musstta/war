# Tuning Notes

Running log of placeholder-value observations discovered during smoke testing.
Do not touch constants in source until the harness can validate the change end-to-end.

**Harness status:** The simulation harness exists (`npm run scenario`, `npm run sweep`, docs in `docs/harness.md`). It is a qualitative-validation and regression-testing tool — not a calibration tool. Systematic numerical tuning is deferred until all game systems (diplomacy, trade, military, combat) exist and the harness can model the full action set. Use it now to verify that model changes produce the expected directional behavior (shock persists when neglected, fades when integrated, etc.), not to dial in exact numbers.

---

## Revolt suppression too fast

**Observed:** A territory forced to unrest 0.9 (above REVOLT_THRESHOLD 0.80) self-corrected
within ~3 ticks because its unrest equilibrium was ~0.1 — far below the threshold.
The drift rate pulled unrest down faster than any realistic in-game pressure could sustain it.

**Root cause:** All current unrest pressures (compatibility, distance, overexpansion) are
small [PLACEHOLDER] values. With a single home territory, perfect compatibility, and no
distance penalty, equilibrium is essentially just the base floor (0.02). Revolt can only
persist if equilibrium is also above the exit threshold (REVOLT_THRESHOLD − REVOLT_HYSTERESIS = 0.75).

**Expected:** Revolt self-suppression is the correct mechanical behavior once inputs are tuned.
The observation just means the current placeholder constants don't produce conditions where
revolt is naturally sustained.

**Action:** No code change needed now. Revisit when combat, occupation, and cultural clash
mechanics exist — those will push equilibrium high enough for revolt to matter.

---

## Mandate budget v2 (resolved; needs further tuning)

**History:** First formula `3 + floor(wealth/5)` inflated unboundedly with stockpile accumulation (fixed). Second formula `3 + (territories−1)` scaled with raw count, ignoring development (also fixed).

**Current formula:** `3 + developedCount + fullyFortifiedCount` where "developed" = road+port+fort L1+, "fully fortified" = road+port+fort L3. Cumulative.

**Known structural gap:** Inland territories can never earn Mandate bonuses because they can't build ports. This is intentional for now (ports = economic integration = more administrative capacity), but may produce dead inland territories with no development incentive. Revisit if this shows up in play.

**Still needs tuning:** The base (3) and per-tier increments (1 each) are placeholders. Opening base of 3 may be too generous once the full action set (diplomacy, trade, military orders) exists — revisit when those actions are specced and the total demand on Mandate is clearer.

---

## Culture round (Phase 4b) — model gaps addressed

**What was changed:** ownership shock (CONQUEST_SHOCK_INITIAL=0.50, CONQUEST_SHOCK_DECAY_RATE=0.15), rapid-expansion pressure (RECENT_ACQUISITION_TICKS=5, RECENT_CONQUEST_PRESSURE_PER_TERRITORY=0.06), infrastructure investment model (road 0.08, port 0.04, fort/level 0.02), family-clash weight (COMPAT_FAMILY_WEIGHT 0.25→0.60), capital culture multiplier (CAPITAL_CULTURE_WEIGHT_MULTIPLIER=2.0).

**What still needs tuning:** All constants above are first-pass placeholders. The conquest shock initial value (0.50) and decay rate (0.15) are untested — expect to adjust once conquest exists in the engine. The rapid-expansion window (5 ticks) is a guess; real expansion pace depends on game flow. Infrastructure bonuses should be validated against revolt threshold after first full multi-territory game.

---

## Family-clash equilibrium gap (pre-fix observation)

**Observed:** A European-family territory under a Latin nation settled at equilibrium ~0.288 — not alarming enough to feel like a real governance problem. Family was supposed to be the dominant lever but COMPAT_FAMILY_WEIGHT was only 0.25 (axis weight 0.75).

**Fix applied:** Weights flipped to COMPAT_FAMILY_WEIGHT=0.60, COMPAT_AXIS_WEIGHT=0.40. A full family mismatch (no closeness, e.g. latin vs east_asian) now drives much more compatibility pressure. Verify in next Belize transfer test.

---

## Capital mechanics — deferred items

**Capital relocation:** Not implemented. The capital is locked to the starting territory (set in world init). Intended future design: relocation requires a fully developed source territory and conditions-to-be-defined (political stability, probably). Spec this when war exists and the consequence of losing a capital is clear.

**Losing a capital in war:** Currently has no special consequence beyond ownership change (conquest shock applies like any other territory). A lost capital should eventually trigger nation-wide instability, legitimacy loss, or similar — defer until war sub-phase is specced.

---

## Production economy opacity

**Observed:** Players have no clear visibility into per-tick production rates or per-territory contributions. Stockpiles update each tick but there's no breakdown of "this territory produced X industry this tick." This makes economic decision-making opaque.

**Action:** No code change now. Revisit when economic systems (trade, resource dependencies) mature enough to make per-territory production a meaningful player decision. At that point, surface it in the InfoPanel.

---

## Conquest shock and rapid-expansion coupling (design intent)

Conquest shock now decays only through active integration — infrastructure investment (road/port/fort) is the primary lever, with structural stability and cultural alignment as secondary signals. Neglected territories stay shocked for a very long time; actively integrated ones recover in ~10 ticks at full investment. This is intentional: investment is causal to integration, neglect compounds. All decay weights are [PLACEHOLDER] — tune once real conquest data exists.

Rapid-expansion pressure now uses a linear-decay window (RECENT_ACQUISITION_WINDOW = 12 ticks) instead of a hard 5-tick cliff. Weight decays smoothly from 1.0 at acquisition to 0.0 at tick 12, so a nation that swallowed three territories doesn't suddenly feel organized at an arbitrary cutoff. Window length is [PLACEHOLDER].

---

## Harness findings (post Culture-v3)

Observations from running the three seed scenarios (belize-neglect, belize-integrate, overexpansion) after the conditional shock-decay fix.

**Overexpansion doesn't produce revolts in 30 ticks** — UNREST_DRIFT_RATE (0.10) is too slow relative to RECENT_ACQUISITION_WINDOW (12). The drift cannot reach the elevated equilibrium before the window expires and pressure begins to ease. The system is mechanically correct; the constants just don't produce the crisis pace intended for rapid expansion. Target for the post-Phase-4 tuning sweep: extend the window to 15–20 ticks rather than speed up drift (slow drift is intentional for legibility). Verify by sweep when the full system is in.

**Unrest lags equilibrium on the way down** (e.g. overexpansion scenario, T20: unrest 52% vs equilibrium 50%). This is intentional — drift-based dynamics produce sticky unrest by design. A territory that was high-unrest doesn't instantly calm when equilibrium drops; it drifts down over several ticks. Not a bug.

**Stability-score zero-clipping during high-pressure periods** correctly prevents shock decay when a territory is structurally troubled — the compat/stability components are suppressed until infra AND lower structural equilibrium bring the stability factor above zero. The eventual un-clip when pressure subsides is the system working. Noted for clarity, not change.

---

## Trait flip at midpoint — potential bias

**Current behavior:** When cultural drift would move a trait value across zero (e.g. from -0.01 toward positive), the flip is decided 50/50 by seeded RNG — equal chance of allowing the cross or bouncing back.

**Potential improvement:** Bias the flip toward whichever direction drift was already moving. If a territory has been drifting toward positive for several ticks and finally reaches the midpoint, a 50% chance of reversal feels arbitrary — the drift signal is already giving a direction. A bias like 70/30 in favor of continuing would make flips feel like earned cultural change rather than a coin flip.

**Defer:** Requires harness data to see how often flips actually fire and whether the 50/50 behavior produces visible artifacts. Address in post-Phase-4 tuning pass.

---

## Linear Mandate curve at empire scale

**Note:** The current `3 + developedCount + fullyFortifiedCount` formula is sublinear at large empire scale (adding one more developed territory always gives exactly +1). A sublinear curve or hard cap may be appropriate once nations can hold 10+ territories, to avoid the action space becoming overwhelming. Flag for harness tuning when territory counts grow past ~6.

---

## Diplomacy constants (Phase 4 Diplomacy — all [PLACEHOLDER])

**Minimum treaty term:** `MIN_TREATY_TERM = 3` ticks. Prevents 1-tick Trust farming. May need raising once real play reveals how fast proposals cycle; 5–7 ticks might feel more meaningful. Revisit after first multi-player diplomacy session.

**Trust scale and recovery:** Scale 0–100, baseline 50, passive recovery `TRUST_RECOVERY_PER_TICK = 0.5/tick` toward 50, suppressed for `TRUST_RECOVERY_COOLDOWN = 10` ticks after a break. Break penalty `TRUST_BREAK_PENALTY = 20`. Completion bonus `min(term×0.5, 15)`. These are guesses — the right numbers depend on how fast diplomacy turns over and how punishing break events feel in real play. The completion-bonus curve may need flattening (log rather than linear) so short treaties don't feel worthless.

**Proposal expiry window:** `PROPOSAL_EXPIRY_TICKS = 5`. With daily ticks this is 5 real days — long enough for the recipient to log in. Shorten if proposals get ignored; lengthen if 5 days feels too urgent for the group's play pace.

**Low-Trust fines:** `LOW_TRUST_FINE_PER_TREATY = 1 Wealth/tick` per active treaty when Trust < 50. At 1 Wealth/tick with placeholder stockpile rates, this is nearly invisible — probably needs to be 2–5 Wealth to bite. Tune once Wealth economy is better understood.

**Escrow skim:** `ESCROW_SKIM_RATE = 5%` of escrowed amount on inactive player's return. Flat percentage ignores time-in-escrow; the design doc says "scaled with time." Keep flat for now; add time scaling once real absence data exists (e.g. 5% base + 1% per 3 ticks in escrow, capped at 25%).

**Degradation refund duration:** `DEGRADATION_REFUND_TICKS = 3`. Active partner gets their collateral back over 3 ticks. Fast enough to not sting; slow enough to be noticeable. Adjust if it feels abrupt.

**Cultural-clash unrest weights:** `non_aggression = 0.04, defense_pact = 0.03, trade/military_access = 0.03`. All are tiny relative to compatibility pressure (max 0.55) and conquest shock (up to 0.70). Intention: visible in the breakdown, not dominant. May need 2–3× multiplier to be felt. Add harness scenarios once multi-treaty play exists.

**Multi-party treaties: deferred (unchanged).** v1 is strictly bilateral (two-nation only). Multi-party treaties (e.g. three-nation trade packs, coalition defense pacts) are a meaningful design addition but require rethinking the `partyIds: [string, string]` type and the collateral pooling model. Spec when Diplomacy has a real play history.

---

## Trade constants (Phase 4 Trade — all [PLACEHOLDER])

**Consecutive-missed-payment breach threshold:** `TRADE_MISSED_PAYMENT_BREACH_THRESHOLD = 2`. Two consecutive ticks of insufficient resources triggers breach (Trust penalty + collateral). One missed tick is a warning; two is a consequence. Tune once real trade data exists — 2 may be too forgiving for large flows or too harsh for variance-prone small nations. Could become non-consecutive with a cooldown window.

**Per-clause collateral proration on partial degradation:** When a single trade clause degrades (source territory changes owner) but other clauses stay active, current code marks only that clause's `clauseStatus = 'degraded'` and does not move collateral. The escrow/refund split for partial degradation is [OPEN]: prorate `treaty.totalCollateral` by clause count, move the degraded clause's share to escrow for the sender, start refund for receiver. Deferred until first real partial-degradation case — will need targeted changes to `saveWorldState` and the engine diplomacy section.

**Sea-route capacity vs land-route:** `SEA_ROUTE_CAPACITY = null`, `LAND_ROUTE_CAPACITY = null`. Sea routes (port-to-port) should have materially higher capacity than land — rough starting point: sea = 2× base land. Validate against actual play. Pathfinder already distinguishes sea vs land and sets `isSeaRoute`; add capacity values to `acceptTreaty.ts` when formula is specified.

**Capacity formula:** `null` on all TradeRoute objects (tagged `[PLACEHOLDER]` in schema). To be defined: `capacity = f(endpoint infrastructure + path length)`. Likely: `baseCapacity × (1 + portBonus) / (1 + distancePenalty)`. Store as `TradeRoute.capacity` in DB. Add computation to `acceptTreaty.ts` and re-pathfind when staleness flag fires.

**Friction formula:** `null` on all TradeRoute objects (tagged `[PLACEHOLDER]` in schema). To be defined: fraction of flow lost in transit. Likely: `friction = distanceFactor × (1 - roadMitigation)`. Hostile/unintegrated intermediate territory raises friction. When implemented: receiver gets `amount × (1 - friction)`, sender pays full `amount`. Add to trade clause resolution loop in `resolveTick` when ready.

## Missed-payment threshold and per-clause collateral proration

**Missed-payment consecutive threshold (`TRADE_MISSED_PAYMENT_BREACH_THRESHOLD = 2`):** Two consecutive ticks of insufficient Wealth triggers breach. The `trade-missed-payment` harness scenario confirms this fires correctly (miss at T1, miss at T2, breach at T2). The threshold of 2 is the first value to revisit once real multi-session play data exists — it may be too forgiving for large flows or too harsh for nations with volatile production. The "consecutive" requirement (resets on success) means a single bad tick followed by a good tick is a warning, not a breach. Consider a non-consecutive window (e.g. 2 misses in any 5-tick window) once production variance is understood from actual play.

**Per-clause collateral proration on partial degradation:** When a single trade clause degrades (source territory lost) but the treaty has other active clauses, the current code marks only that clause's `clauseStatus = 'degraded'` without moving collateral. The `trade-source-lost` scenario confirms this: no Trust hit, no collateral change, just a status flag. The escrow/refund split for partial degradation is [OPEN] — prorate `treaty.totalCollateral` by clause count, move the degraded clause's share to escrow for the sender, start refund for receiver. Deferred until first real partial-degradation case in actual play. Per-clause collateral proration is the second value to revisit with real play data.

---

## Objective clause stubs — joint_invasion and attack_player

`joint_invasion` and `attack_player` objective clause types are **data-model present but engine-inert** (no per-tick evaluation fires). The `ObjectiveClause` row is created correctly at treaty acceptance and persists through the world load/save cycle, but the evaluation branch in `resolveTick` does nothing and the status stays `pending` until the deadline passes (at which point it fails the same as any other missed deadline).

**Activate when War sub-phase ships:**
- `joint_invasion`: both parties queue attack actions against `targetTerritoryId` in the same tick — check the action queue before resolving combat.
- `attack_player`: responsible party must have an active declared war against `targetNationId` by the deadline — check `War` table (or equivalent) each tick.
- `breachMaintainPeaceObjectives()` in `diplomacy.ts` is the pre-wired call site for the War sub-phase to invoke when an attack resolves.

---

## War sub-phase constants (Phase 5 War — all [PLACEHOLDER])

**Battle formula weights:**
- `GEO_DEFENSE_BONUS = 0.20` (+20% effective defense for mountainous/forest geography). Applies per terrain type; coastal and plain/inland are neutral. Same rate also used per fort level — `fortBonus = fortLevel × GEO_DEFENSE_BONUS`. These two being equal is a placeholder coincidence; they should diverge once real battle data exists.
- `ROAD_ATTACK_BONUS = 0.10` (+10% effective attack if attacker has a road in any adjacent owned territory). Roads as logistics feel plausible at this magnitude; may need to be 2× to be felt at small army sizes.
- `BATTLE_RANDOM_SPREAD = 0.15` (±15% of attack strength). Wide enough to produce occasional upsets; narrow enough that larger armies reliably win. Validate against first war playtest.
- `BATTLE_LOSER_LOSS_RATE = 0.10` (−10% of loser's army on each lost battle). At default armySize=50 this is 5 soldiers/battle. Currently using `Math.max(1, floor(armySize × rate))` so a win always costs the loser at least 1. May need to be higher to make wars feel costly.
- `BATTLE_WINNER_LOSS_RATE = 0.05` (−5% of winner's army per battle). Wars of attrition require this to bite; at armySize=50 and 0.05 rate the winner loses 2–3 soldiers per battle. Raise if wars feel consequence-free.

**Siege duration:**
- `SIEGE_TICKS_BASE = 1`. Full capture = `siegeProgress >= fortLevel + 1`. Unfortified territory captured in 1 tick; L1 fort needs 2 ticks; L2 needs 3; L3 needs 4. These are game-days — with daily ticks, a maximum-fortification siege lasts 4 real days. May need to be longer to make fortification investment feel meaningful.

**War unrest rates:**
- `WAR_OVEREXTENSION_PRESSURE_PER_DIST = 0.02` per occupied territory per distance unit from capital. Applied to the occupying nation — each territory you hold far from home costs you. At distance 5 and 3 occupied territories that's +0.30 equilibrium total, which is significant. Verify against revolt threshold.
- `WAR_INSOLVENCY_UNREST_PER_TICK = 0.03` added to all territories per tick a nation stays insolvent (wealthStock < 0) while at war. Compounding — after 10 ticks insolvent the total ramp is +0.30. This is the core "fighting on credit collapses empires" mechanic. Tune relative to typical Wealth production.
- `WAR_MILITARISTIC_HAPPINESS_BONUS = −0.02` (reduces equilibrium for militaristic > 0.3 territories while nation is at war). This activates the `militaryBonus` stub. At −0.02 it's barely visible; likely needs 2–3× to produce a meaningful difference.

**No-CB penalty magnitudes:**
- `NO_CB_UNREST_SPIKE = 0.05` equilibrium pressure added to Peaceful (militaristic < −0.3) and Isolationist (expansionist < −0.3) territories of the declaring nation.
- `NO_CB_SPIKE_DURATION = 5` ticks. With daily ticks this means the spike lasts 5 real days after declaration. Matches the soft-CB design (§9.1). Raise if no-CB wars feel consequence-free.
- No-CB Trust penalty is `−10` (applied immediately in `declareWar` server handler). Combined with normal war Trust effects this should be felt. Validate once real war data exists.

**Army size and upkeep:**
- `armySize` default is 50 for all 5 nations. `UPKEEP_PER_SOLDIER = 0.05 Wealth/tick` (already live since Phase 4). At armySize=50 and baseWealth=5/tick per territory, upkeep is 2.5/tick — exactly half of a single territory's production. Raising army sizes (recruitment not yet implemented) will stress the economy. Revisit army size distribution when recruit/disband actions are added.

---

## Road network vs. local segment

**Current implementation:** `hasRoad` is a per-territory boolean — roads help locally for unrest and integration with no network connectivity requirement. The `build_road_connection` objective clause uses BFS reachability across the road graph, treating roads as a network for that specific mechanic.

This inconsistency is intentional for now — the design doc §13 question ("network or local?") is answered differently by different subsystems pending a formal decision. Revisit when the War phase introduces army movement, which will force a definitive answer: movement speed bonuses either require a connected network or they don't.

---

## Prestige formula (Phase 5 Prompt 3 — all [PLACEHOLDER])

Prestige is a first-pass stub. Computed at end of each tick in `server/src/world.ts` (`saveWorldState`):

```
prestige = (territoryCount × 10)
         + (standingTreatyCount × 5)
         + (averageUnrest < 0.3 ? 20 : 0)
         + (completedWarsWon × 15)
```

All weights need validation once the full action set (war wins, treaty completions, infrastructure) exists across a real playthrough. Current issues: `completedWarsWon` counts the attacker of any ended war regardless of whether they gained territory — a surrendered attacker still gets credited. Fix when war outcome tracking (won/lost flag or cession delta) is richer. The stability bonus (flat +20 for avgUnrest < 0.3) is a cliff function — may want a smooth decay. Dominant qualification (absolute floor + comparability band) deferred to Phase 6.

---

## Activity tier constants (Phase 6 v0.17 — all [PLACEHOLDER])

All in `server/src/caretaker.ts`.

**Tier thresholds** (days of inactivity before advancing):
- `TIER_ACTIVE_TO_DORMANT_DAYS = 3` — After 3 real days without login or action, nation enters Dormant. Short enough that players notice but long enough to survive a weekend. Revisit once first playtest shows actual session gaps.
- `TIER_DORMANT_TO_AUTOPILOT_DAYS = 7` — One week without engagement. Caretaker starts acting at this point. The 7→14 window is the "soft return" window — player can log in and immediately reclaim without any conversion.
- `TIER_AUTOPILOT_TO_ABANDONED_DAYS = 14` — Two weeks. Past this point the caretaker cannot stabilize without player input; fragmentation risk is real. Consider shortening to 10 days if nations fragment too slowly.

**Caretaker thresholds**:
- `CARETAKER_INFRA_WEALTH_FLOOR = 20` — Only queues infrastructure upgrades when wealth ≥ 20. Prevents caretaker from spending wealth needed for upkeep. If typical starting wealth is 10–30 this may be too conservative — revise once typical game-state wealth is known.
- `CARETAKER_EXPANSION_UNREST_CAP = 0.4` — Only expands when average unrest < 0.4. At 0.4 average unrest a nation is stressed but not in revolt. This prevents caretaker from expanding into a death spiral. Could lower to 0.3 for more conservative behavior.

**Fragmentation constants**:
- `ABANDON_UNREST_WEIGHT = 0.6`, `ABANDON_TIME_WEIGHT = 0.4` — Unrest drives fragmentation more than time. A high-unrest territory can break away in days; a low-unrest territory survives weeks of abandonment. Revisit ratio if territories break away too quickly/slowly.
- `ABANDON_TIME_SCALE_DAYS = 30` — Time component reaches full weight after 30 days abandoned. At 14-day abandonment threshold, time component = (14/30) × 0.4 = 0.187. Even a 0 unrest territory would reach risk 0.187 at abandonment day 14 — below the 0.8 threshold. A 0.5-unrest territory reaches risk = 0.5×0.6 + 0.187 = 0.487 on day 14 — still below threshold. This means fragmentation won't happen instantly on Abandoned entry, which is correct behavior.
- `ABANDON_FRAGMENT_THRESHOLD = 0.8` — Territory breaks away when risk ≥ 0.8. With the above weights, risk ≥ 0.8 requires either very high unrest or extended abandonment. Example: unrest=0.9 → time component needed = 0.8 − 0.54 = 0.26 → (days/30)×0.4 = 0.26 → days ≥ 19.5. So a high-unrest territory needs ~20 days of abandonment before breaking away. That feels right — fragmentation should be a slow pressure, not instant collapse.

---

## Insolvency constants (Phase 5 v0.16 — all [PLACEHOLDER])

All in `engine/src/war.ts` and `engine/src/culture.ts`.

**`DEBT_RECOVERY_SKIM_RATE = 0.20`** (war.ts) — **FLAGGED: too slow before first playtest**
Fraction of incoming wealth each tick applied toward debt repayment during recovery (wealthStock ≥ 0 but debtBalance > 0).

**Observed in war-exhaustion walkthrough:** After 7 ticks of insolvency at −7.5 Wealth/tick net drain, debtBalance reaches 87.5. At 5 Wealth/tick gross production, skim = floor(5 × 0.20) = 1/tick. Recovery takes ~87 ticks — nearly 3 months at one tick/day. That is game-breaking, not punishing.

**Target:** 10–20 ticks to clear a moderately deep hole. With 5 Wealth/tick income and a target of 15-tick recovery from −30 debt: need skim = 2/tick → rate = 2/5 = **0.40**. From −80 debt: 80/2 = 40 ticks — still long but survivable.

**Two fix paths (decide before Phase 5 goes live):**
1. Raise rate to 0.40–0.50. Simple. Predictable when income is stable. Problem: if net incoming is near zero (another tribute obligation during recovery), skim is also near zero and recovery stalls.
2. Compute skim on **gross production** (territory output, before tribute/upkeep) rather than net incoming wealth. More predictable because gross production is the player's actual economic capacity, not their cash-flow after obligations. Gross for a 1-territory nation is ~5 Wealth/tick regardless of what they owe. Implementation: sum `t.def.baseWealth` for non-revolting owned territories instead of using `incomingWealthByNation` (which is the post-trade-draw local stock flush).

**Recommendation before playtest:** Switch to gross-production skim at 0.30. At 5 Wealth/tick gross and 0.30 rate: skim = 1.5/tick → 20 ticks to clear −30 debt, 53 ticks for −80. Acceptable. Isolates recovery speed from tribute entanglements. Do not change the constant in source until the harness has a recovery scenario to validate against.

**`INSOLVENCY_GENERAL_UNREST_PER_TICK = 0.02`** (culture.ts)
Applied to all territories when wealthStock < 0, regardless of war status. Separates "broke" (general) from "broke while at war" (adds WAR_INSOLVENCY_UNREST_PER_TICK = 0.03 on top). Total insolvency + war pressure = 0.05/tick. At UNREST_DRIFT_RATE = 0.10, effective equilibrium rise = 0.05 → drift adds 0.005/tick. From base equilibrium ~0.02, revolt threshold is 0.80 — at 0.05 added, the territory would need ~156 ticks to reach 0.80 by drift alone (from 0). This is intentionally slow — insolvency is a pressure signal, not an instant revolt trigger. War overextension compounds.

**Mandate surcharge threshold** (`cost >= 2` in `/api/action` route)
The +1 Mandate surcharge on actions costing 2+ while insolvent (wealthStock < 0 or debtBalance > 0) is a first-pass guess. Revisit if this makes diplomacy during war too punishing — `propose_treaty` (1 Mandate) is exempt, so basic diplomacy is unaffected. `attack_territory` (2 → 3 Mandate), `declare_war` (3 → 4), `build_port` (2 → 3) are all surcharge-eligible. The threshold could be raised to cost >= 3 to exempt `attack_territory` and `build_port` if war-fighting proves too expensive.

---

## War insolvency ramp — resolved (v0.16)

Previously documented as unreachable because tribute and upkeep were clamped at 0. Fixed in v0.16 by removing all `Math.max(0, ...)` floors on wealth deductions. Wealth now goes genuinely negative; the `wealthStock < 0` insolvency check fires correctly. `debtBalance` tracks cumulative debt. Recovery skim reduces debtBalance over subsequent ticks. See `DEBT_RECOVERY_SKIM_RATE` entry above — skim rate is flagged as too slow and needs to be fixed before first playtest.

---

## Peace negotiation constants (Phase 5 Peace — all [PLACEHOLDER])

All values in `engine/src/war.ts` under the "Peace negotiation constants" block.

**`PEACE_PROPOSAL_LAPSE_TICKS = 3`**
Ticks a proposal stays open before it silently expires with no exhaustion penalty. 3 ticks = 3 real days at one tick/day pacing. Too long and wars drag on indefinitely via stalling; too short and players can't coordinate a response before the window closes. 3 is a starting guess — revisit when we have data on typical response latency in live play.

**`PEACE_DECLINE_EXHAUSTION_BUMP = 0.04`**
Equilibrium bump applied to ALL territories of the party that said no. +0.04 is small enough to not instantly spiral into revolt (typical equilibrium baseline ~0.10–0.20) but large enough to feel punishing on already-stressed territories. Scale with war duration once the full war system is calibrated.

**`PEACE_DECLINE_EXHAUSTION_TICKS = 3`**
Duration of the exhaustion bump. 3 ticks mirrors the lapse window — feels symmetric. Both values should be tuned together.

**`PEACE_TRUST_BONUS = 5`**
Both parties gain +5 Trust for signing a peace deal. Small relative to the break penalty (−20) — intentionally asymmetric: the system incentivizes peace but doesn't force it. Compare to the objective-meet bonus when tuning.

**Tribute-via-treaty mechanic:**
When a peace deal includes tribute (`tributeWealth > 0, tributeTicks > 0`), the engine emits a `[TRIBUTE_TREATY]` event log entry that the server save hook parses to create a real Treaty row. This uses the same tribute-clause machinery as voluntary tribute treaties — the attacker pays the defender per tick. No collateral, no renewal: treaty expires at `tickStarted + tributeTicks`. The tribute amount is fixed at signing (not inflation-adjusted). Whether the loser can afford it depends on their wealth stock — if they go insolvent, the insolvency unrest ramp fires. Full enforcement identical to any other tribute clause: missed payments → Trust penalty → breach.

---

## Fast-forward vote (deferred feature)

when all active players check "ready for next tick," the tick fires immediately instead of waiting for midnight. Preserves the persistent-world design as default but lets a synchronously-online group compress time. Build post-Phase 4, post-harness. Needs to handle: who counts as "active" for the vote, what happens to queued actions for absent-but-not-Dormant players, whether the vote requires unanimous or majority. Need to differentiate between if this is possible in prep or only main phase and what the difference is. Differences in phases at the moment are still unrealized, so defer until the full action set and phase structure are specced.