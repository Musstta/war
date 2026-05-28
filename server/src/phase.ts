export type Phase = 'main' | 'prep';

// [DEV-ONLY] In-memory phase override. null = derive from real clock.
// Lives for the lifetime of the server process; resets on restart.
// [DEFERRED SECURITY] Remove this entire block (and the /admin/set-phase endpoint)
// before any production deployment. See docs/persistent-world-tech-stack.md §11.
let _phaseOverride: Phase | null = null;

export function setPhaseOverride(phase: Phase | null): void {
  _phaseOverride = phase;
}

export function getPhaseOverride(): Phase | null {
  return _phaseOverride;
}

// Main Phase: 00:00–18:59 CR time. Prep Phase: 19:00–23:59 CR time.
export function currentPhase(): Phase {
  if (_phaseOverride !== null) return _phaseOverride;
  const crHour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Costa_Rica',
      hour: 'numeric',
      hour12: false,
    }).format(new Date()),
    10,
  );
  return crHour >= 19 ? 'prep' : 'main';
}

// Mandate budget scales with a nation's wealth stockpile.
// Placeholder formula — tune via harness once more systems exist.
export function mandateBudget(wealthStock: number): number {
  return Math.max(1, 3 + Math.floor(wealthStock / 5));
}

// Mandate cost per action type. build_fort cost is variable — see FORT_MANDATE_COSTS.
export const ACTION_COSTS: Record<string, number> = {
  build_road: 1,
  build_port: 2,
  build_fort: 0, // sentinel — real cost computed per fort level from FORT_MANDATE_COSTS
};

// Which phase each action type is restricted to.
export const ACTION_PHASE: Record<string, Phase> = {
  build_road: 'main',
  build_port: 'main',
  build_fort: 'main',
};

/** Mandate cost to build each fort level. [PLACEHOLDER] */
export const FORT_MANDATE_COSTS: Record<1 | 2 | 3, number> = {
  1: 2,
  2: 3,
  3: 4,
};
