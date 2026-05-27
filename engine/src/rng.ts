export type RNG = () => number;

/**
 * Mulberry32 — fast, seeded, deterministic PRNG. Returns values in [0, 1).
 * Used for all random factors (combat rolls, trait drift) so ticks are replayable.
 * See design doc §17 (determinism + seed).
 */
export function makeRng(seed: number): RNG {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive a per-tick RNG from the world seed and tick number.
 * Same world seed + same tick number always produces the same RNG sequence,
 * making individual ticks independently replayable for debugging.
 */
export function tickRng(worldSeed: number, tick: number): RNG {
  return makeRng(((worldSeed * 1000) + tick) >>> 0);
}
