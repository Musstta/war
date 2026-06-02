import type { ActionHandler } from './types';
import { buildRoadHandler } from './buildRoad';
import { buildPortHandler } from './buildPort';
import { buildFortHandler } from './buildFort';
import { cancelPendingConstructionHandler } from './cancelPendingConstruction';
import { proposeTreatyHandler } from './proposeTreaty';
import { acceptTreatyHandler } from './acceptTreaty';
import { declineTreatyHandler } from './declineTreaty';
import { breakTreatyHandler } from './breakTreaty';
import { proposeRenewalHandler } from './proposeRenewal';
import { instantTradeHandler } from './instantTrade';
import { acceptInstantTradeHandler } from './acceptInstantTrade';
import { declineInstantTradeHandler } from './declineInstantTrade';

/**
 * Registry of action handlers keyed by action type string.
 * Add one entry here for each new action type. The /api/action route looks up the
 * handler, calls validate(), then (on success) calls queue().
 */
export const actionRegistry: Record<string, ActionHandler> = {
  build_road:                    buildRoadHandler,
  build_port:                    buildPortHandler,
  build_fort:                    buildFortHandler,
  cancel_pending_construction:   cancelPendingConstructionHandler,
  propose_treaty:                proposeTreatyHandler,
  accept_treaty:                 acceptTreatyHandler,
  decline_treaty:                declineTreatyHandler,
  break_treaty:                  breakTreatyHandler,
  propose_renewal:               proposeRenewalHandler,
  instant_trade:                 instantTradeHandler,
  accept_instant_trade:          acceptInstantTradeHandler,
  decline_instant_trade:         declineInstantTradeHandler,
};

export type { ActionHandler, ActionContext, ValidateResult } from './types';
