/** Canonical display metadata for the four culture value axes.
 *  Each axis runs from −1 (negative pole) to +1 (positive pole).
 */
export const CULTURE_AXES = [
  {
    key: 'individualist' as const,
    pos: 'Individualist',   neg: 'Collectivist',
    posShort: 'Indiv',      negShort: 'Coll',
    label: 'Indiv ↔ Coll',
  },
  {
    key: 'progressive' as const,
    pos: 'Progressive',     neg: 'Traditionalist',
    posShort: 'Prog',       negShort: 'Trad',
    label: 'Prog ↔ Trad',
  },
  {
    key: 'militaristic' as const,
    pos: 'Militaristic',    neg: 'Peaceful',
    posShort: 'Mltc',       negShort: 'Pcfl',
    label: 'Mltc ↔ Pcfl',
  },
  {
    key: 'expansionist' as const,
    pos: 'Expansionist',    neg: 'Isolationist',
    posShort: 'Expn',       negShort: 'Isol',
    label: 'Expn ↔ Isol',
  },
] as const;

export type CultureAxisKey = typeof CULTURE_AXES[number]['key'];

/** Returns the full pole name for a value. */
export function poleName(axis: typeof CULTURE_AXES[number], v: number): string {
  if (v > 0.05) return axis.pos;
  if (v < -0.05) return axis.neg;
  return 'Neutral';
}

/** Returns the short pole label for compact table cells. */
export function poleShort(axis: typeof CULTURE_AXES[number], v: number): string {
  if (v > 0.05) return axis.posShort;
  if (v < -0.05) return axis.negShort;
  return 'Neut';
}
