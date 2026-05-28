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

## Mandate budget (resolved in code, noted for harness tuning)

**Observed (T55 smoke test):** Mandate pool read 0/52 for Costa Rica because the old formula
(`3 + floor(wealth / 5)`) let the pool grow with accumulated wealth stockpile.

**Fix applied:** Formula changed to `3 + max(0, territoryCount − 1)` — scales with territory
control, not stockpile. With 1 territory: 3 mandates. Each additional territory adds 1.

**Still needs tuning:** The base (3) and per-territory increment (1) are placeholders.
Target design intent: a single territory needs at most 5 mandates (road 1 + port 2 + fort L1 2)
so a solo nation can't do everything in one tick. Multi-territory nations gain flexibility
but must still prioritize.
