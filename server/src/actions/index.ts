import type { ActionHandler } from './types';
import { buildRoadHandler } from './buildRoad';
import { buildPortHandler } from './buildPort';
import { buildMarketHandler } from './buildMarket';
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
import { declareWarHandler } from './declareWar';
import { attackTerritoryHandler } from './attackTerritory';
import { retreatArmyHandler } from './retreatArmy';
import { proposePeaceHandler } from './proposePeace';
import { acceptPeaceHandler } from './acceptPeace';
import { declinePeaceHandler } from './declinePeace';
import { moveArmyHandler } from './moveArmy';
import { claimTerritoryHandler } from './claimTerritory';
import { buildBarricadeHandler } from './buildBarricade';
import { proposeEmbassyHandler } from './proposeEmbassy';
import { buildEmbassyHandler } from './buildEmbassy';
import { expelEmbassyHandler } from './expelEmbassy';
import { establishTradeRouteHandler } from './establishTradeRoute';

/**
 * Registry of action handlers keyed by action type string.
 * Add one entry here for each new action type. The /api/action route looks up the
 * handler, calls validate(), then (on success) calls queue().
 */
export const actionRegistry: Record<string, ActionHandler> = {
  build_road:                    buildRoadHandler,
  build_port:                    buildPortHandler,
  build_market:                  buildMarketHandler,
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
  declare_war:                   declareWarHandler,
  attack_territory:              attackTerritoryHandler,
  retreat_army:                  retreatArmyHandler,
  propose_peace:                 proposePeaceHandler,
  accept_peace:                  acceptPeaceHandler,
  decline_peace:                 declinePeaceHandler,
  move_army:                     moveArmyHandler,
  claim_territory:               claimTerritoryHandler,
  build_barricade:               buildBarricadeHandler,
  propose_embassy:               proposeEmbassyHandler,
  build_embassy:                 buildEmbassyHandler,
  expel_embassy:                 expelEmbassyHandler,
  establish_trade_route:         establishTradeRouteHandler,
};

export type { ActionHandler, ActionContext, ValidateResult } from './types';
