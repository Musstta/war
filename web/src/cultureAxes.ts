/** Canonical display metadata for the four culture value axes.
 *  Each axis runs from −1 (negative pole) to +1 (positive pole).
 *  Use `label` for compact display, `pos`/`neg` for descriptive text.
 */
export const CULTURE_AXES = [
  {
    key: 'individualist' as const,
    pos: 'Individualist',
    neg: 'Collectivist',
    label: 'Indv / Coll',
    short: 'Indv',
  },
  {
    key: 'progressive' as const,
    pos: 'Progressive',
    neg: 'Traditionalist',
    label: 'Prog / Trad',
    short: 'Prog',
  },
  {
    key: 'militaristic' as const,
    pos: 'Militaristic',
    neg: 'Peaceful',
    label: 'Mltc / Pcfl',
    short: 'Mltc',
  },
  {
    key: 'expansionist' as const,
    pos: 'Expansionist',
    neg: 'Isolationist',
    label: 'Expn / Isol',
    short: 'Expn',
  },
] as const;

export type CultureAxisKey = typeof CULTURE_AXES[number]['key'];

/** Returns the pole name for a given value: positive pole if v > 0, negative if v < 0, "Neutral" if near 0. */
export function poleName(axis: typeof CULTURE_AXES[number], v: number): string {
  if (v > 0.05) return axis.pos;
  if (v < -0.05) return axis.neg;
  return 'Neutral';
}
