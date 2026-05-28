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

## Fast-forward vote (deferred feature)

when all active players check "ready for next tick," the tick fires immediately instead of waiting for midnight. Preserves the persistent-world design as default but lets a synchronously-online group compress time. Build post-Phase 4, post-harness. Needs to handle: who counts as "active" for the vote, what happens to queued actions for absent-but-not-Dormant players, whether the vote requires unanimous or majority. Need to differentiate between if this is possible in prep or only main phase and what the difference is. Differences in phases at the moment are still unrealized, so defer until the full action set and phase structure are specced.