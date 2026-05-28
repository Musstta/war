# Tuning Notes

Running log of placeholder-value observations discovered during smoke testing.
Address during harness tuning once more game systems exist.
Do not touch constants in source until the harness can validate the change end-to-end.

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

## Linear Mandate curve at empire scale

**Note:** The current `3 + developedCount + fullyFortifiedCount` formula is sublinear at large empire scale (adding one more developed territory always gives exactly +1). A sublinear curve or hard cap may be appropriate once nations can hold 10+ territories, to avoid the action space becoming overwhelming. Flag for harness tuning when territory counts grow past ~6.
