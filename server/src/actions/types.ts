import type { PrismaClient } from '@prisma/client';
import type { TerritoryDef } from '@war/engine';

/**
 * Context passed to every action handler. Pre-populated by the /api/action route
 * so handlers don't re-fetch what the route already loaded.
 */
export interface ActionContext {
  nationId: string;
  payload: unknown;
  prisma: PrismaClient;
  defById: Map<string, TerritoryDef>;
  /** All territory defs — needed for pathfinding at treaty signing. */
  allDefs: TerritoryDef[];
  nation: {
    id: string;
    mandateUsed: number;
    indStock: number;
    popStock: number;
    wealthStock: number;
  };
  myBudget: number;
  currentTick: number;
  currentPhase: 'main' | 'prep';
}

/**
 * validate() return variants:
 *
 *  queued    — the deferred-construction path: validate already wrote the DB transaction
 *              (mandate + pending slot). Route returns {ok:true} immediately.
 *
 *  ready     — normal path: no DB writes yet. Route does the mandate check, then calls
 *              queue(). cost/finalPayload carry the resolved values (build_fort overrides both).
 *
 *  error     — validation failed. Route returns the error to the client.
 */
export type ValidateQueued = { ok: 'queued' };
export type ValidateReady  = { ok: 'ready'; cost: number; finalPayload: object };
export type ValidateError  = { ok: 'error'; status: 400 | 403 | 404; reason: string };
export type ValidateResult = ValidateQueued | ValidateReady | ValidateError;

/**
 * Uniform interface every action handler must export.
 *
 * validate — all checks against current DB state plus already-queued actions.
 *            On the deferred-construction path: also commits the deferred write and
 *            returns ValidateQueued. Must not write on the normal path.
 *
 * queue    — called only when validate returns 'ready' AND the mandate check passes.
 *            Writes the QueuedAction row plus any side-effect writes in one transaction.
 */
export interface ActionHandler {
  validate(ctx: ActionContext): Promise<ValidateResult>;
  queue(ctx: ActionContext, cost: number, finalPayload: object): Promise<void>;
}
