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

## Fast-forward vote (deferred feature)

when all active players check "ready for next tick," the tick fires immediately instead of waiting for midnight. Preserves the persistent-world design as default but lets a synchronously-online group compress time. Build post-Phase 4, post-harness. Needs to handle: who counts as "active" for the vote, what happens to queued actions for absent-but-not-Dormant players, whether the vote requires unanimous or majority. Need to differentiate between if this is possible in prep or only main phase and what the difference is. Differences in phases at the moment are still unrealized, so defer until the full action set and phase structure are specced.