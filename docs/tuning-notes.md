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

## Phase 5 + 6 harness baseline note (v0.19)

All Phase 5 constants (tier thresholds: 3/7/14 days; fragmentation weights: 0.6/0.4; time scale: 30 days; fragment threshold: 0.8; AI scoring weights; AI efficiency penalty 0.7) are first-pass placeholders. The caretaker, abandonment, and AI scenarios added in v0.19 are the first data on these systems — treat initial harness results as **directional only**.

The harness fragmentation constants intentionally differ from the server: `HARNESS_ABANDON_TIME_SCALE_TICKS = 10` (vs. server's 30 days) and `HARNESS_ABANDON_FRAGMENT_THRESHOLD = 0.6` (vs. server's 0.8). This makes fragmentation observable in 10–25 tick scenarios without changing the server behavior. Reconcile these values before playtest once the server's real-time fragmentation is observed in practice.

---

## AI doctrine constants (Phase 6 v0.18 — all [PLACEHOLDER])

All in `engine/src/doctrine.ts` and `server/src/ai.ts`.

**Doctrine derivation weights** (from cultural traits → doctrine component):
- `TRAIT_HIGH_THRESHOLD = 0.3` — trait value above this is "high". Governs when a trait drives doctrine weight. Lowering to 0.2 makes doctrine more sensitive to modest cultural leanings; raising to 0.5 only responds to extreme cultures.
- `DOCTRINE_MIN_WEIGHT = 0.05` — minimum weight per doctrine component before normalization. Prevents any doctrine from going to zero — every AI can do anything, just less likely. The 0.05 floor means even a pure militarist AI has a 5% merchant tendency.
- High `expansionist` culture → +0.5 expansionist, +0.2 militarist (conquerors tend to need armies). [PLACEHOLDER — ratio]
- High `individualist` → +0.5 merchant, +0.4 industrialist (entrepreneurs build things). [PLACEHOLDER]
- High `progressive` → +0.2 merchant, +0.3 industrialist. [PLACEHOLDER]
- High `militaristic` → +0.6 militarist, +0.2 expansionist. [PLACEHOLDER]
- Low `expansionist` (< −0.3, isolationist pole) → +0.6 isolationist. [PLACEHOLDER]
- Low `militaristic` (< −0.3, peaceful pole) → +0.3 isolationist. [PLACEHOLDER]

**Action scoring weights** (base + doctrine_component × weight):
- `build_road`:  `0.3 + industrialist×0.4 + (highUnrest ? 0.3 : 0)` [PLACEHOLDER] — roads score higher when territories are unruly (integration value is obvious)
- `build_port`:  `0.2 + merchant×0.5 + industrialist×0.2` [PLACEHOLDER]
- `build_fort`:  `0.2 + militarist×0.4 + isolationist×0.3` [PLACEHOLDER] — isolationists build forts defensively
- `expand_claim`: `0.3 + expansionist×0.6` [PLACEHOLDER] — pure expansionists score 0.3+0.6×0.55 = 0.63 → high priority
- `propose_treaty (non_aggr)`: `0.2 + isolationist×0.3 + merchant×0.2` [PLACEHOLDER] — non-aggression secures borders
- `propose_trade`: `0.1 + merchant×0.6` [PLACEHOLDER] — pure merchant scores 0.1+0.6×0.60 = 0.46 → beats non-aggression

**`AI_EFFICIENCY_PENALTY = 0.7`**
Multiplier on effective army/production for AI nations. Not yet applied to production (deferred — production is territory-based and equal for all). Currently documented for army size computation in future combat AI. [PLACEHOLDER]

**Offensive war threshold: `OFFENSIVE_WAR_THRESHOLD = 0.6`** [PLACEHOLDER — STUB GATED]
Score formula: `militarist×0.5 + expansionist×0.3`. A pure militarist (0.6) + pure expansionist (0.3) doctrine scores 0.6×0.5 + 0.3×0.3 = 0.39 — still below threshold. Only a nation with both high militarist AND high expansionist (e.g. mil=0.6, exp=0.4 → 0.6×0.5+0.4×0.3=0.42) approaches the threshold. This is intentional — offensive war should be rare among AI. Do not remove the stub gate until harness scenarios confirm war initiation doesn't destabilize the game.

**Doctrine is fixed at creation** — does not drift with culture changes. This is intentional: doctrine is the AI's "personality" built from initial cultural state. If cultural drift changes the territory, the AI's behavior doesn't flip mid-game. Revisit if post-playtest data suggests AIs feel "wrong" relative to their evolved culture.

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

## Debt recovery skim rate — gross production fix (v0.24)

**Previous behavior (v0.16–v0.23):** skim applied to `incomingWealthByNation` (net after trade draws and upkeep). At `DEBT_RECOVERY_SKIM_RATE = 0.20` and 5 Wealth/tick net income, skim = floor(5 × 0.20) = 1/tick. With 87.5 debt, recovery takes ~87 ticks — nearly 3 months at daily tick pace. Flagged as game-breaking in v0.16 tuning notes but not fixed until v0.24.

**Fix (v0.24):** skim now applied to `grossWealthByNation` — sum of `t.def.baseWealth` for non-revolting owned territories before any deductions. Rate raised to 0.30. A nation with 5 gross Wealth/tick territory output: skim = floor(5 × 0.30) = 1/tick. **Still too slow.** 87.5 debt at 1/tick = 87 ticks. This is unchanged from before.

**Why the rate change alone isn't enough:** the skim is `floor(gross × rate)`. For small gross values (1–10 Wealth/tick), the floor function absorbs much of the rate increase:
- gross=5, rate=0.30 → floor(1.5) = 1/tick (same as rate=0.20 → floor(1.0) = 1/tick)
- gross=5, rate=0.40 → floor(2.0) = 2/tick → 87.5 / 2 ≈ 44 ticks
- gross=5, rate=0.70 → floor(3.5) = 3/tick → 87.5 / 3 ≈ 29 ticks
- gross=5, rate=1.00 → floor(5.0) = 5/tick → 87.5 / 5 = 17.5 ticks (target range)

**Recommendation before first playtest:** switch from `Math.floor(gross × rate)` to `Math.max(1, Math.floor(gross × rate))` — minimum skim of 1/tick regardless of rate. Add a minimum skim floor. OR raise rate to 0.60–0.70. The benefit of gross (vs net) is that tribute can no longer stall recovery — the amount is now predictable.

**Target:** 10–20 ticks to clear a moderately deep hole (~30–90 Wealth debt). This requires skim ≥ 2–4/tick at typical production. Validate with a dedicated harness sweep once first playtest provides real debt accumulation data.

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

## Prestige formula constants (v0.22 — all [PLACEHOLDER])

All in `engine/src/prestige.ts`. Every constant here is first-pass and untested.

**`PRESTIGE_PER_TERRITORY = 10`**
10 points per owned territory. Dominant driver of early-game prestige. At 5 territories: 50 points base. May need to drop to 6–8 once other components fill in, otherwise territory count dominates to the exclusion of everything else.

**`PRESTIGE_PER_TREATY = 5`**
Per standing treaty. Rewards diplomacy without being farm-able past the natural limit (you can only have as many treaties as you have neighbors + tolerance for Mandate spend). At 4 treaties: +20.

**`PRESTIGE_PER_KEPT_TREATY = 8`**
Per treaty that ran to natural expiry without being broken. Cumulative — this is the "long-term reputation" component. A nation that has kept 10 treaties earns +80. Should be meaningfully higher than PRESTIGE_PER_TREATY to reward sustained diplomacy over treaty churn.

**`PRESTIGE_PER_WAR_WIN = 15`**
Per war win (territory gained or tribute extracted). At 2 wins: +30. The 15-point value is the same as the old stub — left as-is since there's no playtest data on war frequency yet. May need to be lower (10) if wars happen constantly, or higher (20–25) if wars are rare.

**`PRESTIGE_STABILITY_THRESHOLD = 0.3`**
Average unrest below this earns the stability bonus. 0.3 is already reachable for a well-developed 1-territory nation; should probably be 0.20 or lower once typical multi-territory unrest is measured from real play.

**`PRESTIGE_STABILITY_BONUS = 20`**
Flat bonus for sub-threshold stability. At 20 this is worth 2 territories — reasonable for sustained internal investment. If stability turns out to be the dominant path, lower to 10.

**`PRESTIGE_PER_TICK_AGE = 0.1`**
Points per tick of nation age. After 100 ticks: +10. Rewards longevity without being farm-able (it doesn't compound). At 0.1/tick with daily ticks, a 6-month game gives +180 — probably too large at that timescale; lower to 0.02–0.05 if age becomes the dominant Prestige driver.

**`PRESTIGE_PER_INFRA_POINT = 0.5`**
Per point of infrastructure score (hasRoad+hasPort+fortLevel per territory). A fully developed 5-territory nation scores 5×(1+1+3)=25 points → +12.5 Prestige. Reasonable but modest. Raise to 1.0 if you want infrastructure investment to be a visible Prestige lever.

**`PRESTIGE_TRUST_SCALE = 0.3`**
Trust (0–100) multiplied by this. At Trust=80: +24. At Trust=50 (baseline): +15. The spread is small (24 vs 15) — Trust is a modifier, not a primary driver. This feels right; raise to 0.5 if you want high-Trust play to be more strategically distinct.

---

## Dominant qualification constants (v0.22 — COMPLETELY UNTESTED)

**`DOMINANT_PRESTIGE_FLOOR = 150` and `DOMINANT_COMPARABILITY_BAND = 0.85`**

These are completely untested — they need a full multi-session simulation before they mean anything. At the current formula, a 5-territory nation at tick 0 with baseline Trust (50) and no wars/treaties scores: 5×10 + (0.3 floor? maybe) + 0.1×0 + 50×0.3 = 50 + 20 + 0 + 15 = 85. Nobody will be Dominant at tick 0. At tick 50 with 10 territories, 4 treaties, 2 war wins, 3 kept treaties: 100 + 20 + 24 + 30 + 20 + 5 + (infrastructure ~10) + 15 = ~224 → crosses the floor. That's roughly 2 months of active play. Whether that's too fast or too slow is completely unknowable without real game data.

The comparability band (0.85) means a second nation at 190 when the leader is 224 (190/224 = 0.848) does NOT qualify — just barely outside. At 191 they do (191/224 = 0.853). This will feel arbitrary until the spread of actual Prestige scores across sessions is understood. Track the spread in harness sweeps before tuning.

---

## Dominant mechanical effect constants (v0.22 — all [PLACEHOLDER])

**`DOMINANT_TRUST_PENALTY_REDUCTION = 0.75`**
Dominant nation breaks a treaty: Trust penalty is 75% of normal (−15 instead of −20). This is tiny. The intent is just a small grace for the most prominent nation — if it never feels noticeable, raise to 0.5 for a more meaningful reduction.

**`UNDERDOG_PRESTIGE_BONUS = 5`**
Non-Dominant accepts Dominant's treaty: +5 Prestige. Small but visible. At 5 points it's half a territory's worth. If players can't perceive it in the leaderboard it's too small; if it becomes a farm target (spam accept treaties from the Dominant player for Prestige) raise to be non-farmable (e.g. once per Dominant nation per 10 ticks).

**`UNDERDOG_UNREST_REDUCTION = −0.02` and `UNDERDOG_UNREST_DURATION = 3`**
[DEFERRED — column exists in schema but equilibrium wiring not yet connected]. When wired: −0.02 equilibrium on all territories for 3 ticks. At 0.02 this is barely visible; the intent is a small diplomatic-morale effect. Wire in next prestige pass; tune after first observations.

**`DOMINANT_WAR_ATTACKER_BONUS = 1.15`**
Non-Dominant attacking Dominant: ×1.15 attack strength. At armySize=50 this adds ~7.5 effective soldiers. Against a Dominant defender with no army (coastal L0 fort) this is irrelevant; against a well-fortified Dominant force it gives the underdog a fighting chance. Tune relative to BATTLE_RANDOM_SPREAD (0.15) — a 15% bonus barely exceeds the random spread, so upsets aren't guaranteed. May need to raise to 1.25–1.30 to feel impactful.

**`DOMINANT_WAR_MILITARISTIC_BONUS = −0.03`**
Additional equilibrium reduction for Militaristic territories of the attacker (on top of WAR_MILITARISTIC_HAPPINESS_BONUS) while fighting a Dominant nation. −0.03 added to −0.02 = −0.05 total. Only fires for Militaristic > 0.3 territories, same gate as the base bonus. If the base bonus is already invisible at 0.02, the combination at 0.05 may still be too small. Tune both together.

---

## Fog of war — visibility rule placeholder (v0.21)

**`military_access` clause grants Clear visibility [PLACEHOLDER — may be too strong]**

Currently, having an active `military_access` clause with a nation's owner grants **Clear** (full detail) visibility over all their territories. This was chosen as the conservative, intuitive default: if you have military access through a nation's lands, you can see those lands.

**Why it might be too strong:** In practice, a military_access clause means your armies can pass through — not that you have stationed scouts in every territory. A nation could sign military_access treaties purely for the visibility benefit, with no intention of moving armies. If this becomes a loophole (players sign access treaties just to spy), downgrade the grant to LightFog instead.

**How to apply:** When revisiting, change Rule 3 in `engine/src/visibility.ts` from `VisibilityTier.Clear` to `VisibilityTier.LightFog`. Revisit once military access has real enforcement (blocking movement through unauthorized territory) and players have tested the system.

---

## Army positioning constants (v0.20 — all [PLACEHOLDER])

All in `engine/src/war.ts`.

**`PACIFICATION_THRESHOLD = 100`**
Progress required to fully pacify and claim an unclaimed territory. Army contributes `armySize / nativeDifficulty` each tick. At default armySize=50 and coastal terrain (difficulty=1.0), 2 ticks to pacify. Mountainous (difficulty=1.8): 3–4 ticks. This is intentionally fast for v1 — raise to 200–500 once real play reveals whether pacification feels too easy or too hard. Should require at least several days of sustained army presence.

**`PACIFICATION_DECAY_PER_TICK = 10`**
Progress lost per tick when the claiming army is absent. At threshold=100 and decay=10, a fully-progressed territory loses 10% per tick without an army. An army that pacifies halfway (50/100) and then leaves would decay to 0 in 5 ticks. Tune relative to threshold: decay/threshold ratio (0.10) determines the "forgiveness window." If too low, brief retreats are catastrophic; if too high, pacification is too lossless.

**Terrain difficulty values (`TERRAIN_DIFFICULTY`):**
All values are first-pass placeholders. The intent: mountainous and forest terrain is harder to pacify (defenders can hide, resist longer); coastal and plain is easier.
- `coastal: 1.0` — baseline; easy access, established trade routes
- `inland: 1.2` — slightly harder; fewer supply lines
- `mountainous: 1.8` — significantly harder; natural fortifications, guerrilla terrain
- `desert: 1.5` — hard; supply problems, harsh environment
- `forest: 1.4` — hard; difficult movement and visibility

These should diverge once real play data exists. The current mountainous bonus (1.8×) is also coincidentally equal to the GEO_DEFENSE_BONUS multiplier — that's a placeholder coincidence, not a design decision.

**`POP_DIFFICULTY_SCALE = 0.001`**
Per-capita population contribution to pacification difficulty: `population × 0.001` added to terrain difficulty. A territory with basePopulation=100 adds 0.1 to difficulty (10% harder). Intent: dense populations resist pacification longer. At 0.001 scale this is nearly invisible — raise to 0.002–0.005 once typical population values are understood from play.

**`COMPAT_DIFFICULTY_SCALE = 0.5`**
Cultural incompatibility contribution to pacification difficulty. Currently unused in the engine formula (the `(1 - compatScore) × COMPAT_DIFFICULTY_SCALE` term is in the spec but the engine uses 0.5 as a fixed placeholder for compat). Wire up the actual compat score once it's available in the pacification context. At full incompatibility (compatScore=0): +0.5 difficulty; at full compatibility (compatScore=1): +0.0. This is the planned tuning lever for culturally-resistant territories.

---

## Split/merge army stubs (v0.20)

`split_army` and `merge_army` are **not yet implemented**. The data model supports them: a nation may have multiple `Army` rows, each with independent `territoryId` and `size`. Splitting would divide one army into two smaller ones at the same territory; merging would combine two armies at the same territory into one.

**Why stub now:** The primary use case is splitting a large home army into two — one stays to defend, one moves to pacify a new claim. Without split/merge, a nation with one army (the default) must choose between defense and expansion. This creates useful strategic pressure for v1 but will feel constraining once nations grow larger.

**Tag for future prompt:** Implement `split_army` and `merge_army` action handlers. Each creates/modifies Army rows; both cost 0 Mandate (repositioning, not a strategic decision). Validate: split requires army.size >= 2; merge requires both armies in same territory and same nation. The engine already handles multiple armies per nation in all combat/pacification paths.

---

## Siege without army — defense note (v0.20)

When a battle is resolved against a territory where the defending nation has **no army stationed**, the defending army size is 0. Only fort bonus and geography apply. An ungarrisoned L3 fort still provides `fortBonus = 3 × GEO_DEFENSE_BONUS = 0.60` defense, but with defendingArmySize=0 that is `0 × 1.60 = 0` — the fort is worthless without troops.

This is intentional: fortifications slow siege only when combined with army presence. An abandoned fortification falls in 1 tick (still requires siegeProgress >= fortLevel + 1 to capture, but with 0 vs any army the attacker wins every tick). The design intent is that forts buy time for a garrison to arrive, not substitute for one.

**Implication for caretaker:** The caretaker defense priority (move army toward besieged territory) is critical for nations going Dormant/Autopilot — if no army reaches the besieged territory, the siege completes automatically even behind a L3 fort. Tune `TIER_ACTIVE_TO_DORMANT_DAYS` conservatively so forts have time to matter.

---

## Movement model constants (v0.28 — all [PLACEHOLDER])

### §1.3 Multi-tick army transit

**`BASE_MOVEMENT_TICKS = 1`** (war.ts)
Minimum ticks to cross any territory. With no terrain modifier this equals 1.

**`GEOGRAPHY_MOVEMENT_MODIFIER`** (war.ts)
Per-geography travel cost multipliers:
- `mountainous: 1.5` — alpine terrain doubles movement cost (+50%)
- `forest: 1.5` — dense jungle/forest, same cost as mountainous
- `desert: 1.33` — arid terrain, approx 1 extra day per 3 territories
- `plain: 1.0` / `coastal: 1.0` / `island: 1.0` / `inland: 1.0` — baseline
Mountainous and forest are equal at 1.5. Consider whether forest should be slightly cheaper (1.25) — in Central America, mountain passes are more restrictive than jungle paths, but both are punishing. Revisit after first movement playtest.

**`ROAD_MOVEMENT_MODIFIER = 0.5`** (war.ts)
Multiplier applied to terrain cost for road-equipped territories. Halves movement cost. With a road, mountainous costs 0.75 (under 1 tick → rounds to instant). This makes roads very powerful for military logistics — possibly too powerful. Consider 0.6–0.7.

### §1.4 Barricade

**`BARRICADE_DEFENSE_BONUS = 0.15`** (war.ts)
Added to the territory's defense calculation while the barricade TerritoryModifier is active. Stacks with fort bonus. At L0 fort, barricade provides 0.15 raw defense — enough to notice but not game-breaking.

**`BARRICADE_MOVEMENT_MULTIPLIER = 1.5`** (war.ts)
Movement penalty applied to armies crossing a barricaded territory (slows transit, matches mountainous). Encourages going around rather than through.

**`BARRICADE_DURATION_TICKS = 5`** (war.ts)
How long a barricade lasts before it degrades. 5 real days = effectively one week of coverage. May be too long if barricades can chain into indefinite blocking. Revisit if players spam barricade renewals.

### §1.4 Border skirmish thresholds

**`SKIRMISH_FULL_CB_WINDOW = 10`** (war.ts)
Ticks after a border skirmish during which the victim gets full `hasCasusBelli` for a declaration of war. 10 ticks = 10 real days. Generous window; consider 5 if skirmish-farming for CB becomes a degenerate strategy.

**`SKIRMISH_CB_DECLARATION_WINDOW = 5`** (war.ts)
Additional ticks (beyond FULL window) where a CB can still be declared but at reduced legitimacy. Total CB window = 15 ticks from skirmish. Not yet mechanically distinct from FULL_CB — currently both grant CB. Distinction to be wired in future pass.

**`SKIRMISH_HOSTILITY_COMPAT_THRESHOLD = 0.3`** (war.ts)
Minimum compatibility gap between the two nations for a skirmish to generate a CB. Prevents two culturally-similar nations from accidentally generating CB through routine border contact. Tune against actual compatibility distributions once several games have run.

---

## Diplomatic value engine constants (v0.28 — all [PLACEHOLDER])

**`COLLATERAL_FLOOR_RATE = 0.20`** (diplomaticValue.ts)
Fraction of net Wealth value differential between parties used as minimum collateral floor. A treaty where one party benefits 20 Wealth more than the other requires at least 4 Wealth total collateral. Conservative — the point is to establish a non-zero floor, not to make every treaty expensive.

**`MAINTAIN_PEACE_LOW_VALUE_TRUST_FRACTION = 0.25`** (diplomaticValue.ts)
When `maintainPeaceTrustMultiplier` detects a low-value context (no armies, no prior skirmish), the Trust bonus from completing a maintain_peace objective is reduced to 25% of normal. Prevents two pacifist nations from farming Trust via empty peace treaties.

**`MAINTAIN_PEACE_MAX_CONSECUTIVE = 2`** (diplomaticValue.ts)
Maximum number of maintain_peace treaties the same pair of nations can sign within the consecutive window. At 2, a pair can sign once, let it expire, sign again — but a third attempt within the window is blocked. This is the anti-farming gate. If 2 feels too restrictive for genuine peace-building relationships, raise to 3.

**`MAINTAIN_PEACE_CONSECUTIVE_WINDOW = 20`** (diplomaticValue.ts)
Tick window within which the consecutive count is measured. 20 ticks = 20 real days (roughly 3 weeks). Chosen to span a typical treaty term (MIN_TREATY_TERM = 3, typical = 5–10). A treaty signed at T0 and another at T12 would both count within a 20-tick window queried at T15. Reduce to 10 if the window is too punishing for genuine long-term partners.

---

## Embassy system constants (v0.29 — all [PLACEHOLDER])

All in `engine/src/culture.ts` (constants) and `engine/src/tick.ts` (logic).

**`EMBASSY_BUILD_TICKS = 3`** (tick.ts / types.ts)
Construction ticks before an embassy transitions from `under_construction` to `active`. With daily ticks this is 3 real days. Matches `CESSION_MIN_FUTURE_TICKS` and `CESSION_EMBASSY_GRACE_TICKS` — a receiving nation that starts construction immediately on treaty signing has zero margin. Consider raising to 5 if the grace window is also raised.

**`EMBASSY_COMPAT_BONUS = −0.01`** (culture.ts)
Equilibrium reduction on territories of the host nation for each active embassy owned by a foreign nation. Negative — small diplomatic-presence stability effect. At −0.01 this is nearly invisible; may need 2×–3× to be felt. Intended as a soft reward for maintaining embassies rather than a dominant driver.

**`EMBASSY_TRUST_RECOVERY_PER_TICK = 0.5`** (culture.ts)
Additional Trust recovery per tick for the embassy owner toward the host nation while the embassy is active. Stacks with normal passive Trust recovery (`TRUST_RECOVERY_PER_TICK`). At 0.5/tick this doubles the baseline recovery rate — may need to be lower (0.2–0.3) once real diplomatic Trust dynamics are observed. Intended to make "maintain embassy rather than breaking and re-building" the dominant Trust strategy.

**`EMBASSY_EXPEL_TRUST_PENALTY = −10`** (culture.ts)
Trust hit applied to the host nation when it expels an embassy. Magnitude is half the treaty-break penalty (−20). Rationale: expulsion is an aggressive signal but less severe than breaking a signed agreement. Tune relative to `TRUST_BREAK_PENALTY` once embassy-expulsion incidents exist in real play.

**`EmbassyStatus` lifecycle:**
`proposed` → (after `build_embassy` action) `under_construction` → (after `EMBASSY_BUILD_TICKS` ticks) `active` → (after `expel_embassy` action) `expelled`.
A `destroyed` status fires automatically when the host territory changes ownership (engine tick loop).

---

## Treaty system expansion constants (v0.27 — all [PLACEHOLDER])

### §1.5 Territory cession

**`CESSION_EMBASSY_GRACE_TICKS = 3`** (culture.ts)
Ticks after `transferAtTick` during which the engine waits for the receiving nation to establish an embassy before the clause breaches. 3 ticks = 3 real days. With embassy construction time ([PLACEHOLDER: 3 ticks]), a receiving nation that immediately starts construction upon treaty signing has zero margin — they must have started before or they need more grace ticks. Consider raising to 5–7 to be realistic.

**`CESSION_MIN_FUTURE_TICKS = 3`** (culture.ts)
Minimum ticks between treaty signing and `transferAtTick`. Enforced at proposal time. 3 ticks matches the embassy construction time placeholder — a receiver needs at least this window to build one. If embassy construction time changes, update both.

**Embassy stub:** `hasEmbassy` is always false in the current DB schema (new `TerritoryState` column defaults false). The territory cession code currently short-circuits this with `|| true` in the engine to allow testing without embassy construction. When embassy construction ships (Phase 8), remove the `|| true` override and the clause will naturally require an embassy. Tag in `tick.ts`: `[DEFERRED: remove '|| true' when embassy ships]`.

Embassy cession check is stubbed — cessionTerr.state.hasEmbassy || true in the territory cession execution path means the embassy prerequisite is not enforced. The hasEmbassy field needs to be set by the embassy construction pipeline (Phase 6.5 Prompt 5 built embassy construction but the cession check wasn't wired to it). Fix before Phase 7 goes live: replace || true with a real lookup against the Embassy table for an active embassy owned by the receiving nation in the cession territory.

### §1.2 Population transfer

**`POPULATION_TRANSFER_UNREST_SCALE = 0.15`** (culture.ts)
Unrest equilibrium spike applied to all territories of both nations for `POPULATION_TRANSFER_SHOCK_DURATION` ticks. Currently applied as a flat 0.15 (the `populationTransferShock` named component). The compat-scaled formula `(1 − compatScore) × 0.15` is computed in the engine but the per-territory compat score would require additional state storage — the current implementation uses the flat `POPULATION_TRANSFER_UNREST_SCALE` value directly. Wire the compat-scaled version when per-territory shock magnitude storage is available.

**`POPULATION_TRANSFER_SHOCK_DURATION = 5`** (culture.ts)
How many ticks the `populationTransferShock` component persists. 5 real days. Probably correct order-of-magnitude — a sudden population movement should affect stability for about a week. Tune once real transfer data exists.

**`POPULATION_TRANSFER_DRIFT_DURATION = 8`** (culture.ts)
How many ticks cultural drift accelerates toward the transferred population's cultural family. Currently stored as a constant but the drift acceleration effect is not yet wired into `applyDrift` — it's defined here for the Phase 8 implementation when cultural drift toward specific families (not just nation culture) is built. Tag: **[DEFERRED — acceleration toward transferred family not yet wired]**.

### §1.10 Auto-assign resource sourcing

Auto-assign tribute: deducts from territory local Wealth stockpiles proportionally (weight = `territory.def.baseWealth`). Overflow (when local stockpiles are insufficient) falls back to the nation's general stockpile, then allows insolvency as before. The distribution is by **base production rate**, not by current local stockpile level — this means a territory with high base wealth takes a larger share even if its local stockpile happens to be depleted (e.g. by earlier trade draws). Whether weighting by current stockpile level (more fair) or base rate (more predictable) is better depends on play experience.

Auto-assign trade: same proportional logic, with missed-payment detection checking total available (local + general) against the required amount. The "consecutive" missed-payment rule still applies.

**Known gap:** trade clause `sourceTerritoryId = null` enables auto-assign. Existing treaties stored in the DB from v0.9–v0.26 have `sourceTerritoryId` set (manual pin path). New treaties signed after v0.27 default to auto-assign if `sourceTerritoryId` is omitted from the payload. Backward-compatible.

---

## Initialization pipeline constants (v0.26 — all [PLACEHOLDER])

All in `engine/src/initialization.ts`. These are principled starting points derived from Hofstede cultural dimensions (§3.1) and geographic intuition (§3.2–3.3). None have been validated against actual play data — treat as directional guesses.

### §3.1 Cultural family → trait offsets

Each family shifts all four axis values from a baseline of 0. The table entries are Hofstede-inspired but do not map 1:1 to any specific Hofstede dimension.

**Current values and first-pass notes:**
- `latin`: individualist −0.3 (collectivist lean), progressive −0.1 (slightly traditional), militaristic −0.1, expansionist +0.1. Broadly matches Central American cultural profile in the current test map.
- `european`: individualist −0.2 (less collectivist), progressive −0.1, militaristic +0.1, expansionist +0.2. European expansion history encoded. May be too expansionist.
- `arab`: individualist −0.2, progressive −0.5 (strong traditional lean), militaristic +0.1, expansionist 0. Traditional pole is the strongest signal here.
- `slavic`: individualist −0.1, progressive −0.2, militaristic +0.2, expansionist +0.1. Slightly more militaristic than european.
- `east_asian`: individualist −0.5 (strongly collectivist), progressive −0.4 (strongly traditional), militaristic +0.1, expansionist −0.1. Hofstede high power-distance + collectivism.
- `african`: individualist −0.3, progressive −0.2, militaristic 0, expansionist 0. Moderate collectivist baseline.
- `south_asian`: individualist −0.4, progressive −0.3, militaristic 0, expansionist 0. Similar to east_asian but less extreme.
- `indigenous`: individualist −0.2, progressive −0.4 (traditional), militaristic −0.2 (peaceful lean), expansionist −0.3 (isolationist lean). Encodes historical defensive/isolated posture.

**To validate:** run a full-world sweep across all families at Phase 7 and check whether the resulting nation culture distributions produce interesting diplomatic variation rather than convergent behavior.

### §3.2 Geography → trait modifiers

Applied on top of family offsets. Captures how terrain shapes culture over generations.

- `mountainous`: progressive −0.2 (isolation preserves tradition), militaristic +0.1 (defensive necessity), expansionist −0.2 (hard to expand from mountains). Mountain kingdoms historically conservative and non-expansionist.
- `coastal`: progressive +0.2 (trade exposure drives change), militaristic −0.1, expansionist +0.2 (sea access enables expansion). This is the strongest positive progressive signal in the table.
- `inland`: all 0 (neutral baseline — no special terrain effect).
- `desert`: progressive −0.3 (extreme isolation preserves tradition), militaristic +0.2 (survival demands toughness), expansionist 0.
- `forest`: progressive −0.1, militaristic +0.1, expansionist −0.1. Moderate defensive lean.
- `island`: not yet in the Geography type — will be needed for Phase 7 Caribbean territories. Add when the type is extended.

**Known gap:** the current Geography type (`coastal | inland | mountainous | desert | forest`) lacks `island`. When Phase 7 adds island territories, extend both the Geography type and the GEOGRAPHY_TRAIT_MODIFIERS table.

### §3.3 Starting population

Formula: `round(GEOGRAPHY_BASE_POPULATION[geography] × FAMILY_POPULATION_MULTIPLIER[family])`.

**Geography bases (GEOGRAPHY_BASE_POPULATION):**
- coastal: 80, inland: 60, forest: 40, mountainous: 30, desert: 15
- These are abstract units, not real-world population counts. The important thing is relative density. At Phase 7 scale (37 territories), the range 15–80 produces meaningful spread. May need to scale down or up once POPULATION_PRODUCTION_BASE is calibrated.

**Family multipliers (FAMILY_POPULATION_MULTIPLIER):**
- east_asian: 1.8, south_asian: 1.6, european: 1.1, latin: 1.0, arab: 0.9, african: 0.8, slavic: 0.7, indigenous: 0.6
- These reflect broad historical density patterns. The 1.8× east_asian multiplier is the most aggressive — an east_asian coastal territory gets population 80 × 1.8 = 144. At POPULATION_PRODUCTION_BASE=50, that's a 2.88× production multiplier, which may be too strong. Revisit when the full world is authored.

**Current test map all 8 territories:**
- coastal latin (coast 80 × latin 1.0 = 80): costa_rica, honduras, el_salvador, nicaragua, panama, mexico_yucatan, belize(european → 88)
- mountainous latin (30 × 1.0 = 30): guatemala
- These are computed starting populations for the DB at init — they replace the hand-authored `basePopulation` values in the def file only at server initialization. The harness still uses the def file values directly.

### §3.4 Cultural family → production multipliers

The `ProductionModifiers` struct has three fields: wealthMultiplier, industryMultiplier, populationMultiplier. These multiply the territory's `baseWealth`, `baseIndustry`, and `basePopulation` at production time.

**Current values and rationale:**
- `latin`: wealth 1.0, industry 0.9, pop 1.1. Standard trader/agrarian profile.
- `european`: wealth 1.1, industry 1.2, pop 1.0. Industrial and mercantile.
- `east_asian`: wealth 1.1, industry 1.3, pop 1.2. Highest industry multiplier — encodes East Asian manufacturing tradition.
- `arab`: wealth 1.2, industry 0.8, pop 1.0. Mercantile wealth without industrial strength (trade routes > manufacturing).
- `slavic`: wealth 0.9, industry 1.1, pop 1.0. Modest industrial lean.
- `african`: wealth 0.9, industry 0.8, pop 1.0. Slight underperformance — intentional placeholder; revisit when African territories are authored, as this generalizes an enormous diverse region unfairly.
- `south_asian`: wealth 1.0, industry 0.9, pop 1.1. Agricultural/service lean.
- `indigenous`: wealth 0.7, industry 0.8, pop 0.9. Lowest multipliers — encodes subsistence economy. Will produce very weak nations if used for major territories; tuning priority before Phase 7 indigenous territory authoring.

**Known issue:** these multipliers are stored in the initialization pipeline but are NOT currently applied to territory base rates at server init (the `ensureWorldInitialized` function derives traits and population but does not yet update `baseWealth`/`baseIndustry` in the DB — those columns exist only in the def file JSON, not in `TerritoryState`). The production modifiers are returned by the API for inspection but need a DB column or a separate application step before they affect actual production. Tag: **[DEFERRED — productionModifiers need DB application]**.

### `TRAIT_RNG_VARIANCE = 0.15`

±0.15 seeded variance per axis at initialization. At a family offset of −0.3 and geography of 0, the range is [−0.45, −0.15] for that axis. This produces meaningful territorial variation within the same family × geography bucket. If 0.15 feels too wide (territories of the same type feel chaotic), lower to 0.10. If it feels too narrow (all latin coastal territories feel identical), raise to 0.20. Validate by inspecting `derived-traits` across a batch of same-family same-geography territories after Phase 7 authoring.

---

## Systems integration constants (v0.25 — all [PLACEHOLDER])

### Trade → unrest and drift (2.1)

**`TRADE_STABILITY_BONUS = 0.02`** (culture.ts)
Equilibrium reduction per active trade clause flowing through a territory on the receiving nation's side. Negative — reduces unrest. Applies to all territories owned by the receiving nation that appear on the trade route's `computedPath`. The "first-pass" note: currently applies to all territories on the computedPath, which may be too broad — the path includes both source and destination endpoints, so even the source nation's capital could appear if it's on the path. Validate once real trade route data exists.

**`TRADE_DRIFT_MULTIPLIER = 1.3`** (culture.ts)
Drift rate multiplier applied to cultural drift (`applyDrift`) for territories on an active trade route's computedPath this tick. Stacks multiplicatively with `ROAD_DRIFT_MULTIPLIER`. A territory on 2 trade routes still only gets 1.3× (not 1.6×) — the multiplier is per-territory, not per-route-count. If multi-route drift acceleration is desired, change to `tradeRouteCount × 0.1 + 1.0` style formula.

**trade_stability and drift acceleration are first-pass — need real trade route data to validate. Currently applies to all territories on the computedPath which may be too broad.**

### Eight cultural constraint axes (2.2)

All in `engine/src/culture.ts`. All weights first-pass — need harness scenarios with specific cultural conditions to validate.

**`ISOLATIONIST_TREATY_THRESHOLD = 3`** — Nation active treaty count above which isolationist (expansionist < −0.3) territories experience entanglement pressure. 3 is a guess; with 5 players and typical diplomatic activity, 3 active treaties is achievable quickly. May need to be 4–5.

**`ISOLATIONIST_ENTANGLEMENT_WEIGHT = 0.015`** — Unrest per treaty above threshold. At 4 treaties (1 above threshold): +0.015. At 6 treaties: +0.045. Probably needs 2×–3× to be felt.

**`EXPANSIONIST_GROWTH_WINDOW = 10`** — Ticks without territorial acquisition before expansionist stagnation fires. 10 ticks = 10 real days. May be too short early-game (not everyone expands immediately) or too long late-game (expansion slows). Tune relative to actual game pace.

**`EXPANSIONIST_STAGNATION_WEIGHT = 0.02`** — Flat unrest for expansionist territories stagnating. Small — probably needs 2×–3× to be meaningfully felt.

**`COLLECTIVIST_ISOLATION_WEIGHT = 0.015`** — Unrest for collectivist territories with no tribute receiver obligations. Currently only checks tribute clauses (where nation is toNationId). Does not check "solidarity" obligations because those don't exist yet as a clause type. Wire to solidarity clauses when they ship.

**`INDIVIDUALIST_OBLIGATION_WEIGHT = 0.02`** — Unrest per tribute clause where the nation is the payer. At 1 obligation: +0.02. At 3 obligations: +0.06. Probably needs 2×–3× to sting enough.

**`TRADITIONAL_EROSION_THRESHOLD = 0.05`** — Cultural drift magnitude threshold. This compares against `CULTURE_DRIFT_RATE (0.02) × (1 − unrest) × roadMult`. At unrest=0 and no road: drift = 0.02 < 0.05 → threshold never fires! At unrest=0 with road: drift = 0.02 × 1.25 = 0.025 < 0.05 → still never fires. This means the threshold is too high — the maximum possible drift magnitude is ~0.025 (road + low unrest). Lower to 0.015 or reframe as "any drift above 0" to make it responsive.

**`TRADITIONAL_EROSION_WEIGHT = 0.025`** — Unrest when drift exceeds threshold. Since threshold is currently unreachable, this never fires. Fix threshold first.

**`PROGRESSIVE_STAGNATION_THRESHOLD = 0.01`** — Drift magnitude below which progressive territories feel stagnant. At drift=0.02 (baseline): 0.02 > 0.01, so progressive_stagnation doesn't fire at baseline unless unrest is high. At unrest=0.5: drift = 0.02 × 0.5 = 0.01 → right at threshold. Feels reasonable — progressive stagnation fires when territory is half-stressed. May want to lower to 0.005 if it fires too rarely.

**`PROGRESSIVE_STAGNATION_WEIGHT = 0.015`** — Unrest when drift is stagnant. Small, may need 2×.

### Geography → trade capacity and friction (2.3)

All in `engine/src/trade.ts`. First-pass values — need real trade route data to validate.

**`CAPACITY_BASE = 10`** — Base capacity before infrastructure multipliers. Units are flow/tick in the relevant resource. At typical trade amounts (3–8 Wealth/tick), a capacity of 10 is not binding. May need to be lower (5) once trade volumes are calibrated.

**`SEA_CAPACITY_MULTIPLIER = 2.0`** — Sea routes (port+port) get 2× base capacity. Rationale: ports are expensive infrastructure. This creates a meaningful incentive to build ports.

**`LAND_ROAD_CAPACITY_MULTIPLIER = 1.5`** — Land routes with roads on both ends get 1.5× base. Road investment pays off in trade.

**`NO_INFRA_CAPACITY_MULTIPLIER = 0.7`** — No infrastructure: 70% of base. Landlocked/unroaded nation trades at a penalty. May need to be lower (0.5) to make infrastructure more meaningful.

**`FRICTION_BASE = 0.05`** — Base friction per territory on the path. A 3-territory path has 0.15 base friction = 15% flow lost. At typical path lengths (2–5 territories), total friction 0.10–0.25. May need calibration against actual route lengths.

**`FRICTION_MOUNTAIN = 0.08`** — Extra friction for mountainous path territory. Combined with base: 0.13/territory. Mountain nations are genuinely hard to trade through.

**`FRICTION_DESERT = 0.06`** — Extra friction for desert path territory. Combined with base: 0.11/territory.

**`FRICTION_HOSTILE_CROSSING = 0.10`** — Extra friction for crossing a territory not owned by source or destination nation. Hostile crossings penalize trade through third-party territory — incentivizes direct borders or military access.

**`FRICTION_ROAD_REDUCTION = 0.03`** — Friction reduction for a road on the crossing territory. Roads mitigate friction but don't eliminate it. At base+mountain: 0.13 − 0.03 = 0.10 net. May need to be 0.05 to be more meaningful.

**Note: capacity and friction are stored but not yet applied to actual flow amounts in resolveTick. The friction value is computed at signing time and stored on the TradeRoute row — it should be applied to the resource transfer (receiver gets amount × (1 − friction)) when the friction enforcement pass is built. Currently stored only.**

### Roads → cultural drift rate (2.4)

**`ROAD_DRIFT_MULTIPLIER = 1.25`** (culture.ts)
Drift rate multiplier for roaded territories. Applied to `CULTURE_DRIFT_RATE` before computing cultural drift this tick. At base CULTURE_DRIFT_RATE=0.02 and unrest=0: drift = 0.025/tick (vs 0.020 without road). At typical unrest=0.3: drift = 0.017 (vs 0.014). The difference is subtle at [PLACEHOLDER] values; may need 1.5× to be noticeable over multi-tick periods. Also applied to UNREST_DRIFT_RATE to slightly speed up unrest convergence on roaded territories.

### Geography → conquest shock magnitude (2.5)

**`GEOGRAPHY_SHOCK_MULTIPLIER`** (war.ts) — Per-geography multipliers applied to base conquest shock (0.50). All [PLACEHOLDER]:
- `mountainous: 1.3` → shock 0.65 (capped at 1.0). Mountain territories resist hard.
- `forest: 1.15` → shock 0.575. Forest terrain gives modest extra resistance.
- `desert: 1.2` → shock 0.60. Harsh terrain, supply difficulty.
- `island: 1.25` → shock 0.625. Geographic isolation fosters strong identity.
- `coastal: 0.9` → shock 0.45. Trade exposure reduces cultural resistance (intentional — ports and trade connectivity make coastal territories slightly easier to integrate).
- `plain: 1.0` → shock 0.50. Baseline.

The base shock (0.50) is the `[PLACEHOLDER]` from war sub-phase. These multipliers stack on top of it. The full compat-scaled shock (`computeConquestShock`) is only used in the harness assign_territory path; the engine uses the fixed base shock × geography multiplier. These two paths should be unified eventually.

### Population → production scaling (2.6)

**`POPULATION_PRODUCTION_BASE = 50`** (tick.ts)
Population level at which production multiplier is exactly 1.0. Formula: `popScale = territory.basePopulation / POPULATION_PRODUCTION_BASE`. A territory with population 100 produces 2× base; population 25 produces 0.5× base; population 50 produces 1.0× base.

**population production scaling is linear — may need a sublinear curve at high population to prevent runaway production in dense territories.** At the current test map's population values (3–20 for Central American territories), all territories produce well below their nominal rates. For example, belize (population 3): `3/50 = 0.06×` base production — only 6% of stated base rates. This makes the `basePopulation`, `baseIndustry`, and `baseWealth` values in the territory seed file much less intuitive. Recommendation before first playtest: either raise POPULATION_PRODUCTION_BASE to match actual territory population range (e.g., 10 for the current Central America set), or reframe population values to represent "effective workforce units" at a consistent scale.

---

## Phase 7 territory trait overrides (v0.31)

Two territories in `engine/src/data/americas.json` required `traitOverrides` after the derived-traits inspection. The `european` cultural family baseline starts at `individualist: -0.2` (Hofstede collective bias for European nations generally), which is geographically plausible for Western Europe but incorrect for settler-colonial Americas contexts.

**`usa_northeast`** (`european` / `coastal`)
- Derived without override: `individualist=-0.28, progressive=-0.03` — reads as mildly collectivist and near-neutral progressive.
- Expected: lean individualist (Anglo-Protestant settler culture, early capitalist institutions) and progressive (historically reform-oriented region).
- Override applied: `{ "individualist": 0.3, "progressive": 0.3 }`
- Final traits: `individualist=+0.30, progressive=+0.30, militaristic=+0.02, expansionist=+0.41`

**`argentina_patagonia`** (`european` / `inland`)
- Derived without override: `individualist=-0.23, expansionist=+0.13` — collectivist lean, weak expansion.
- Expected: frontier/ranching culture strongly individualist and expansionist (low population density, isolated self-reliance, historical land-expansion drives).
- Override applied: `{ "individualist": 0.25, "expansionist": 0.35 }`
- Final traits: `individualist=+0.25, progressive=-0.12, militaristic=-0.01, expansionist=+0.35`

**When to review:** After the first playtest provides real data on nation cultural drift. If `european` family gets retuned with higher individualist baseline (e.g., +0.1), these overrides should be revisited — the offset may no longer be needed.

---

## North America macro-territory derived traits (v0.35)

All 8 North American macro-territories (`usa_northeast`, `usa_midwest`, `usa_south`, `usa_west`, `canada_west`, `canada_central`, `canada_east`, `canada_northwest`) are in `engine/src/data/americas.json` and go through the same `deriveTerritoryTraits` initialization pipeline as all other territories. Their base values and derived traits are first-pass [PLACEHOLDER] exactly like the rest of the Americas dataset.

**Cultural family assignment:** all 8 are `frontier` in `americas-territories.json`, which maps to `european` in the current initialization pipeline (see v0.26 notes). This is a placeholder decision — the US and Canada have genuinely different cultural sub-profiles (Midwestern isolationism vs. Northeastern cosmopolitanism vs. Southern conservative-expansionist vs. Western frontier-individualist). These differences are currently represented only through `traitOverrides` (only `usa_northeast` has one: `individualist: 0.3, progressive: 0.3`). The other 7 North American territories derive traits from the generic `european/coastal|plain|mountainous` buckets.

**Quality tier summary (v0.34 formula, all [PLACEHOLDER]):**
- `usa_northeast`: score 9.25 → tier 3 (coastal, high base values)
- `usa_midwest`: score 6.2 → tier 2 (inland plain, moderate base values)
- `usa_south`: score 9.25 → tier 3 (coastal)
- `usa_west`: score 7.25 → tier 2 (coastal but mountainous geography lowers base values slightly)
- `canada_west`: score 7.25 → tier 2 (coastal mountainous)
- `canada_central`: score 7.7 → tier 2 (coastal — shares a sea adjacency, scoring coastal bonus)
- `canada_east`: score 9.25 → tier 3 (coastal)
- `canada_northwest`: score 7.7 → tier 2 (coastal — Alaska coast)

**Known gap — cultural family nuance:** the `frontier → european` mapping groups all NA territories into the European cultural family, which drives Hofstede-style collectivist offsets. This will produce incorrect baseline traits for regions with strong Indigenous cultural presence (`canada_northwest`) and over-individual-or-collectivist results for others. The correct fix is either a new `frontier` cultural family with its own FAMILY_TRAIT_OFFSETS, or territory-level `traitOverrides` on each of the 8 territories after the first playtest reveals the derived traits. Defer until Phase 7 content pass with real player data.

**Geography assignments:**
- `usa_northeast`: `coastal` — trade-oriented, moderate population, progressive modifier (+0.2)
- `usa_midwest`: `plain` (rendered as `inland`) — agrarian, neutral modifiers
- `usa_south`: `coastal` — largest state count, most disconnected sub-polygons; trait profile similar to northeast but distinct in history
- `usa_west`: `mountainous` — traditional lean (−0.2 progressive, −0.2 expansionist), militaristic (+0.1)
- `canada_west`: `mountainous` — same modifiers as usa_west
- `canada_central`: `plain` (rendered as `inland`) — neutral modifiers, agrarian
- `canada_east`: `coastal` — similar to northeast
- `canada_northwest`: `plain` (rendered as `inland`, indigenous family in americas-territories.json but mapped to `european`) — correct family assignment would give peaceful (−0.2 militaristic) and isolationist (−0.3 expansionist) leans

**Map geometry note:** `canada_northwest` has 98 sub-polygons after dissolve (was 105). This is correct — Nunavut comprises ~1,800 islands, none contiguous with the mainland. The dissolve correctly merges the mainland portion (Yukon, NWT mainland) into a smaller polygon count while preserving the genuinely disconnected island chain geometry.

---

## Market construction placeholders (v0.32)

Markets are the inland equivalent of ports — single-territory construction, same slot, mutually exclusive with port.

**Current placeholder values:**
- Construction cost: `BUILD_INDUSTRY['market'] = 5` (same as port)
- Construction time: `BUILD_TICKS['market'] = 3` (same as port)
- Mandate cost: `ACTION_COSTS['build_market'] = 2` (same as build_port)
- Land trade capacity with road+market: `LAND_MARKET_CAPACITY_MULTIPLIER = 1.5` (stacks multiplicatively on `LAND_ROAD_CAPACITY_MULTIPLIER = 1.5` → net 2.25× base)

---

## Trade route placeholders (v0.33)

All values in `engine/src/tradeRoutes.ts`. Every value is [PLACEHOLDER] — these were set to produce a recognizable growth curve in harness scenarios, not from real tuning data.

**Capacity:**
- `MARKET_ROUTE_BASE_CAPACITY = 5` — starting capacity for market-tier (domestic or international) routes
- `PORT_ROUTE_BASE_CAPACITY = { 1: 8, 2: 12, 3: 18 }` — starting capacity indexed by portLevel (L2/L3 are future-proofed; only L1 is reachable in v0.33)
- `ROUTE_GROWTH_CAP_MULTIPLIER = 1.5` — max capacity = baseCapacity × 1.5 (market-tier cap: 7.5, port L1 cap: 12)

**Growth:**
- `ROUTE_GROWTH_RATE = 0.05` — capacity added per cycle = baseCapacity × 0.05
  - Market-tier: +0.25 per cycle. Takes 10 cycles to reach cap from base.
  - Port L1: +0.40 per cycle. Takes 10 cycles to reach cap from base.
  - Deliberately slow — represents deepening commercial relations, not immediate windfall.

**Upkeep:**
- `ROUTE_UPKEEP_RATE = 0.1` — per tick cost = currentCapacity × 0.1
  - Market-tier at base: 0.5/tick. At cap: 0.75/tick. Not punitive.
  - Observation: upkeep at cap < growth benefit for most routes. Routes are net-positive long-term — that's intentional.

**Port distance bonus:**
- `PORT_DISTANCE_PROFIT_BONUS = 0.1` — profitMultiplier += 0.1 per hop
  - 1-hop sea route: 1.1× cargo deposited
  - 3-hop sea route: 1.3× cargo deposited
  - Rationale: reward maritime trade networks; differentiate port-tier from market-tier beyond just capacity

**Loss event:**
- `ROUTE_LOSS_UNREST_SCALE = 0.1` — unrestSpike = (lostValue / growthCap) × 0.1
  - Route at cap (lostValue = growthCap × 0.333): spike = 0.033 equilibrium adjustment
  - Modest but visible; stacks with existing unrest causes
- `ROUTE_LOSS_UNREST_TICKS = 5` — duration of the TerritoryModifier spike

**Cultural pressure:**
- `ROUTE_MERCHANT_PRESSURE_WEIGHT = 0.5` — scales how much merchant drift pressure a route exerts relative to its share of national output
  - A route at baseCapacity = 5 in a nation with 100 total output → drift bias = 0.025 toward individualist per tick
- `ROUTE_ISOLATIONIST_THRESHOLD = 3` — routes beyond this count add routeCountPressure (separate counter from ISOLATIONIST_TREATY_THRESHOLD)
- `ROUTE_ISOLATIONIST_COUNT_WEIGHT = 0.02` — per-route-above-threshold isolationist entanglement penalty
  - Intentionally same magnitude as `ISOLATIONIST_ENTANGLEMENT_WEIGHT = 0.015` but separate component

**Prestige:**
- `PRESTIGE_PER_TRADE_CAPACITY = 0.3` — prestige contribution = Σ currentCapacity × 0.3
  - 10 market routes at cap (7.5 each) → 22.5 prestige. Meaningful but not dominant.

**Mandate costs:**
- `ESTABLISH_DOMESTIC_ROUTE_MANDATE = 2` — same as `build_market` / `build_port`
- `INTERNATIONAL_ROUTE_MANDATE = 1` — reduced (treaty negotiation is the real cost for international routes)

**When to tune:**
- After first playtest pass with trade routes active. Key questions: Are routes growing too fast? Does upkeep feel meaningful at scale? Does the loss event feel punishing enough to deter offensive action near trade endpoints?

**Stacking decision:** The market bonus is multiplicative with the road bonus (not additive). Rationale: markets only help if goods can flow; a market without roads still gets only the no-infra multiplier. Additive stacking would let a market partially compensate for missing roads, which isn't the intended design.

**When to review:** After first playtest or harness data on AI build behavior. Key questions:
- Is market construction too cheap relative to ports (inland AIs spamming markets vs. building roads first)?
- Does 22.5 effective capacity (road+market on both ends) meaningfully differentiate high-investment inland trade routes?
- Should market construction time differ from port (markets are logistical hubs, not infrastructure — may be faster)?

---

## Open items from v0.33 (trade routes)

**hopDistance is hardcoded to 1 in `server/src/actions/acceptTreaty.ts`** (marked `TODO(v0.34+)`). Real hop distance for international port-tier routes requires BFS over `seaAdjacentIds` from source to destination port. Until this is implemented, all port-tier routes get `profitMultiplier = 1 + 1×0.1 = 1.1` regardless of actual geography. Fix when port-tier international routes are first used in play; the formula is correct, only the distance input is stubbed.

**Prestige contribution from trade routes is server-only and not harness-verifiable.** `PRESTIGE_PER_TRADE_CAPACITY × Σ currentCapacity` is computed in `server/src/world.ts` `saveWorldState()`, not in `resolveTick`. The harness runs the engine only and cannot observe prestige. When Phase 9's simulation harness is extended with a prestige-visibility mode (needed for tuning the Dominant qualification floor), add a `assert_prestige` assertion type that reads the prestige formula output directly from the engine rather than the DB.

---

## Quality tier formula (v0.34 — thresholds [PLACEHOLDER])

Territory quality tiers are read-only metadata computed at data-authoring time and stored as `qualityTier` in `engine/src/data/americas.json`. No simulation effect. Exposed via `GET /api/admin/territory/:id/quality-tier`.

**Formula:**
```
score = basePopulation × 0.4 + baseIndustry × 0.35 + baseWealth × 0.25 + (isCoastal ? 1.5 : 0)
tier 3 = score ≥ 8.0
tier 2 = score ≥ 5.0
tier 1 = score < 5.0
```

**Current Americas distribution (36 territories):**
- Tier 3 (18): all coastal territories score 9.25 (basePopulation=10, baseIndustry=8, baseWealth=5, isCoastal=true → 4.0+2.8+1.25+1.5=9.55; exact scores vary by def values but all coastal reach ≥ 8.0)
- Tier 2 (16): inland and mountain territories scoring 5.0–7.99
- Tier 1 (2): `brazil_amazonia` (score 4.05), `peru_selva` (score 4.05) — landlocked forest with low base values

**Why coastal territories are all tier 3:** the `isCoastal ? 1.5 : 0` bonus was chosen so that any reasonably-developed coastal territory crosses the tier-3 threshold. This reflects the design doc's positioning of coastal access as a significant economic advantage. If the first playtest reveals coastal territories are too dominant relative to inland ones, lower the coastal bonus to 1.0 (shifting many coastal territories to tier 2) or adjust the tier-3 threshold from 8.0 to 9.0.

**Component weights are [PLACEHOLDER].** The 0.4/0.35/0.25 split (population-heavy) was chosen to reflect that labor supply is the primary driver of territory value before infrastructure is built. This may need adjustment once the full production formula is calibrated — if wealth production dominates at later game stages, the wealth weight should rise. Adjust at data-authoring time by recomputing scores and re-tagging `qualityTier` in `americas.json`; the formula is purely in `server/src/index.ts` and not part of the simulation.

**Thresholds (8.0/5.0) are [PLACEHOLDER].** Setting them requires knowing the score distribution — with the current Americas dataset, scores range from ~4.0 (forest inland) to ~9.5 (well-developed coastal). The current thresholds put 50% of territories at tier 3, 44% at tier 2, 6% at tier 1. A tighter distribution (e.g., tier 3 ≥ 9.0, tier 2 ≥ 6.0) would reduce tier-3 coverage to ~18 territories with explicit coastal+development gating. Tune once quality tier is used for any simulation-visible mechanic.

---

## Territory selection constants (v0.37)

### Draw algorithm

| Constant | Value | Location | Notes |
|---|---|---|---|
| `EPSILON` | 0.1 | `server/src/territorySelection.ts` | Inverse-weight denominator floor: `weight = 1/(tier + EPSILON)`. Prevents divide-by-zero for tier-0 hypotheticals. |
| `CANDIDATES_PER_ROLL` | 3 | same | Candidates shown to each player per roll. |
| `MID_HIGH_THRESHOLD` | 2 | same | `qualityTier ≥ 2` = at least one candidate per player must qualify. 34/36 territories qualify; the 2 non-qualifying are `brazil_amazonia` and `peru_selva` (both tier 1, inland). |

### qualityTier distribution (Americas, 36 territories)

| Tier | isCoastal | Count | Territories |
|---|---|---|---|
| 3 | true | 16 | usa_northeast, usa_south, canada_east, belize, el_salvador, nicaragua, costa_rica, panama, caribbean_west, caribbean_east, venezuela, guianas, brazil_nordeste, brazil_sul, chile, uruguay |
| 2 | true | 14 | usa_west, canada_west, canada_central, canada_northwest, mexico_norte, mexico_centro, mexico_sur, guatemala, honduras, colombia_andes, ecuador, peru_costa_sierra, argentina_pampa_norte, argentina_patagonia |
| 2 | false | 4 | usa_midwest, colombia_orinoquia, bolivia, paraguay |
| 1 | false | 2 | brazil_amazonia, peru_selva |

### Inverse-weight probabilities (relative draw probability per territory)

`weight = 1/(qualityTier + 0.1)`: tier 1 → 0.909, tier 2 → 0.333, tier 3 → 0.244. In a 36-territory pool: tier-1 territories are drawn ~3.7× more likely than tier-3 per slot. This causes inverse distribution — lower-value territories appear more often in rolls, forcing players to decide whether to reroll for better options or accept a strategic low-tier start.

### Reroll policy

One reroll per player per game session. Replaces all 3 candidates (not individual slot). `rerollUsed Boolean @default(false)` on `GameMembership`. Cannot reroll after confirming.

### Snipe detection

Checked at confirm-time, not roll-time. If the chosen territory was confirmed by another player between the roll and the confirm call, `confirmCandidate` returns `{sniped: true, candidates: [...fresh]}` — the server auto-rerolls the affected player's candidates. No reroll token consumed (snipe-triggered rerolls are free). In `autoAssignUnconfirmed`, snipe retry capped at 2 attempts.

### AFK deadline

`lastTickAt` (set to now when host calls `POST /api/games/:id/start`) + `tickIntervalSeconds * 1000` = AFK deadline for territory selection. Same `tickIntervalSeconds` as the game tick interval — short intervals (e.g. 60s) give short selection windows, suitable for testing. `scheduleSelectionDeadline` uses the same `gameTimers` map as `scheduleGameTick`, so `deregisterGame` cancels both.

## Lobby and scheduler constants (v0.36)

### Tick interval

| Constant | Default | Where set | Notes |
|---|---|---|---|
| `tickIntervalSeconds` | 86400 (24h) | `POST /api/games` body; `Game.tickIntervalSeconds` in DB | Minimum enforced in endpoint: 10s (for testing). Legacy-world uses `TICK_SCHEDULE` cron. |
| Min for test | 10s | endpoint validation | Lower bound prevents runaway self-scheduling. |

**Testing guidance:** create a new game with `tickIntervalSeconds: 60` to observe a full tick cycle in 1 minute. Fast-forward votes can further compress this to ~instant.

### Fast-forward vote

| Concept | Implementation |
|---|---|
| Denominator | Human player slots only — `GameMembership` rows where slot is not in `game.aiSlots` and not in `game.removedSlots` |
| Threshold | **Unanimous** (all human players) |
| Vote lifetime | Per-tick; upserted on each vote, entire `FastForwardVote` table for the game cleared after the triggered tick completes |
| Re-arm | After a fast-forward tick fires, scheduler re-arms normally with the full `tickIntervalSeconds` interval |

The unanimous threshold is appropriate for the ~5-player context. For larger games, consider a majority threshold (Session C decision). AI slots and removed slots do not vote — they should not block human players from fast-forwarding.

### Empty slot policy

When host calls `POST /api/games/:id/start`:

| `emptySlotPolicy` | Effect on unfilled slots |
|---|---|
| `'ai'` (default) | Slot is occupied by an AI nation (`isAI = true`, auto-doctrinated) |
| `'removed'` | Slot is skipped entirely — no nation created for that slot |
| `'open'` | Slot remains open (no nation); same as removed for initialization purposes [Session C will allow late-join to an open slot] |

Per-slot overrides in `slotResolutions: { [slotIndex]: 'ai' | 'removed' }` take precedence over `emptySlotPolicy`.

### Win condition

| Constant | Value | Source |
|---|---|---|
| `DOMINANT_PRESTIGE_FLOOR` | 150 [PLACEHOLDER] | `engine/src/prestige.ts` |
| `DOMINANT_COMPARABILITY_BAND` | 0.85 [PLACEHOLDER] | `engine/src/prestige.ts` |

A game ends automatically when `computeDominantNations()` returns a non-empty set after any tick. The check runs outside the tick transaction (read-only). Multiple co-dominant nations are allowed — if two nations both qualify, the game ends with both as winners.

### Game ID format

New games get `id = "game_{timestamp}_{randomSuffix}"`. Legacy world keeps `id = "legacy-world"`. The scheduler skips `legacy-world` on resume and on win-condition checks.

---

## Fast-forward vote (deferred feature — shipped v0.36)

Implemented in v0.36. See lobby and scheduler constants section above for the current design. The original deferred note is preserved here for reference: when all active players check "ready for next tick," the tick fires immediately instead of waiting for midnight. Preserves the persistent-world design as default but lets a synchronously-online group compress time.