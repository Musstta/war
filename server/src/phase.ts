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

/**
 * [PLACEHOLDER] Mandate budget based on infrastructure investment, not raw territory count.
 * Base: 3 (always).
 * +1 per territory with road + (port OR market) + fort L1+ ("developed").
 * +1 per territory with road + (port OR market) + fort L3 ("fully fortified") — cumulative with above.
 * Tune values via harness once combat/economy are in place.
 */
export function mandateBudget(developedCount: number, fullyFortifiedCount: number): number {
  return 3 + developedCount + fullyFortifiedCount;
}

// Mandate cost per action type. build_fort cost is variable — see FORT_MANDATE_COSTS.
export const ACTION_COSTS: Record<string, number> = {
  build_road:           1,
  build_port:           2,
  build_market:         2, // [PLACEHOLDER] same cost as build_port
  build_fort:           0, // sentinel — real cost from FORT_MANDATE_COSTS
  propose_treaty:       1, // [PLACEHOLDER] per design doc §8.3
  accept_treaty:        1, // [PLACEHOLDER] 0.5 rounded to 1 for now
  decline_treaty:       0, // free
  break_treaty:         0, // mandate is free; cost is collateral + Trust
  propose_renewal:      1, // same as propose_treaty
  instant_trade:        1, // [PLACEHOLDER]
  accept_instant_trade: 0, // free
  decline_instant_trade: 0, // free
  declare_war:          3, // [PLACEHOLDER] expensive action per design doc §9.1
  attack_territory:     2, // [PLACEHOLDER] per attack intent per tick
  retreat_army:         0, // free — retreat costs no Mandate
  propose_peace:        2, // [PLACEHOLDER]
  accept_peace:         0, // free
  decline_peace:        0, // free
  move_army:            1, // [PLACEHOLDER]
  claim_territory:      1, // [PLACEHOLDER]
  build_barricade:      1, // [PLACEHOLDER]
  propose_embassy:      1, // [PLACEHOLDER] §1.6
  build_embassy:        1, // [PLACEHOLDER] §1.6
  expel_embassy:        0, // [PLACEHOLDER] §1.6 — free for host nation
  establish_trade_route: 2, // [PLACEHOLDER] §11 — ESTABLISH_DOMESTIC_ROUTE_MANDATE
};

// Which phase each action type is restricted to.
export const ACTION_PHASE: Record<string, Phase> = {
  build_road:           'main',
  build_port:           'main',
  build_market:         'main',
  build_fort:           'main',
  propose_treaty:       'main',
  accept_treaty:        'main',
  decline_treaty:       'main',
  break_treaty:         'main',
  propose_renewal:      'main',
  instant_trade:        'main',
  accept_instant_trade: 'main',
  decline_instant_trade: 'main',
  declare_war:          'main',
  attack_territory:     'main',
  retreat_army:         'main',
  propose_peace:        'main',
  accept_peace:         'main',
  decline_peace:        'main',
  move_army:            'main',
  claim_territory:      'main',
  build_barricade:      'main',
  propose_embassy:      'main',
  build_embassy:        'main',
  expel_embassy:        'main',
  establish_trade_route: 'main',
};

/** Mandate cost to build each fort level. [PLACEHOLDER] */
export const FORT_MANDATE_COSTS: Record<1 | 2 | 3, number> = {
  1: 2,
  2: 3,
  3: 4,
};
