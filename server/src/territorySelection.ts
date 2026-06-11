/**
 * Territory selection module (v0.37)
 *
 * Phase flow: lobby → territory_selection → active
 *
 * When the host starts a game, status transitions to territory_selection and
 * each human player calls /territory/roll to receive 3 candidates drawn from
 * the shared pool. Players may use one reroll. Once all players have confirmed
 * (or the AFK deadline fires), the game transitions to active.
 *
 * Inverse-weight draw:
 *   weight(tier) = 1 / (tier + EPSILON)
 *   This makes tier-1 territories ~3× more likely to appear than tier-3,
 *   preventing every game from clustering around the 16 highest-value starts.
 *
 * MID_HIGH_THRESHOLD = 2 (qualityTier ≥ 2).
 *   At least one of the 3 candidates per player must meet this threshold so
 *   no player is handed an all-tier-1 draw. With 34/36 territories ≥ tier 2,
 *   a natural draw almost always satisfies this; the guarantee is a safety net
 *   against the 2-territory tier-1 cluster (brazil_amazonia, peru_selva).
 */

import type { GameMembership } from '@prisma/client';
import type { TerritoryDef } from '@war/engine';
import { prisma } from './db';
import { ensureGameWorldInitialized } from './world';
import { scheduleGameTick } from './scheduler';

// ── Constants ────────────────────────────────────────────────────────────────

const EPSILON = 0.1;
const CANDIDATES_PER_ROLL = 3;
// qualityTier ≥ this value = "mid-high" — at least one candidate per player must qualify
const MID_HIGH_THRESHOLD = 2;

// ── Types ────────────────────────────────────────────────────────────────────

export interface CandidateView {
  slotIndex: number;
  territoryId: string;
  name: string;
  qualityTier: number;
  isCoastal: boolean;
  confirmed: boolean;
}

// ── Weighted random draw ──────────────────────────────────────────────────────

function inverseWeight(tier: number): number {
  return 1 / (tier + EPSILON);
}

/**
 * Draw `count` items from `pool` without replacement using inverse-weight
 * sampling (lower qualityTier = higher probability of being drawn).
 */
function weightedDraw(
  pool: TerritoryDef[],
  count: number,
  rng: () => number = Math.random,
): TerritoryDef[] {
  const remaining = [...pool];
  const drawn: TerritoryDef[] = [];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    const weights = remaining.map((t) => inverseWeight(t.qualityTier ?? 1));
    const total = weights.reduce((s, w) => s + w, 0);
    let r = rng() * total;
    let idx = 0;
    for (let j = 0; j < weights.length; j++) {
      r -= weights[j]!;
      if (r <= 0) { idx = j; break; }
    }
    drawn.push(remaining[idx]!);
    remaining.splice(idx, 1);
  }
  return drawn;
}

// ── Roll candidates ───────────────────────────────────────────────────────────

/**
 * Draw 3 territory candidates for a player, persisting them to DB.
 * - Excludes territories already confirmed by another player in this game.
 * - Guarantees at least one candidate with qualityTier >= MID_HIGH_THRESHOLD.
 * - Deletes any prior (unconfirmed) candidates for this player before inserting.
 *
 * Returns the 3 candidate rows.
 */
export async function rollCandidates(
  gameId: string,
  userId: number,
  defs: TerritoryDef[],
): Promise<CandidateView[]> {
  // Find territories already confirmed by other players in this game.
  const confirmed = await prisma.territoryCandidate.findMany({
    where: { gameId, confirmed: true, userId: { not: userId } },
    select: { territoryId: true },
  });
  const takenIds = new Set(confirmed.map((c) => c.territoryId));

  const pool = defs.filter((d) => !takenIds.has(d.id));

  // Draw 3 candidates, ensuring at least one meets MID_HIGH_THRESHOLD.
  let drawn = weightedDraw(pool, CANDIDATES_PER_ROLL);

  const hasMidHigh = drawn.some((d) => (d.qualityTier ?? 1) >= MID_HIGH_THRESHOLD);
  if (!hasMidHigh) {
    // Replace the last drawn territory with one that meets the threshold.
    const eligible = pool.filter(
      (d) => (d.qualityTier ?? 1) >= MID_HIGH_THRESHOLD && !drawn.some((x) => x.id === d.id),
    );
    if (eligible.length > 0) {
      const replacement = weightedDraw(eligible, 1)[0]!;
      drawn[CANDIDATES_PER_ROLL - 1] = replacement;
    }
  }

  // Delete prior unconfirmed candidates for this player, then insert fresh ones.
  await prisma.territoryCandidate.deleteMany({
    where: { gameId, userId, confirmed: false },
  });

  await prisma.territoryCandidate.createMany({
    data: drawn.map((d, i) => ({
      gameId,
      userId,
      slotIndex: i,
      territoryId: d.id,
      confirmed: false,
    })),
  });

  return buildCandidateViews(drawn.map((d, i) => ({ slotIndex: i, territoryId: d.id, confirmed: false })), defs);
}

// ── Confirm candidate ─────────────────────────────────────────────────────────

/**
 * Confirm a candidate by slotIndex for a player.
 *
 * Snipe detection: if the chosen territory was confirmed by another player
 * between the roll and this confirm call, auto-reroll the affected slot and
 * return the new candidates with `sniped: true`.
 *
 * On success: sets confirmed=true on the candidate row, sets
 * GameMembership.confirmedTerritoryId, and checks if all players are done.
 * If all confirmed → calls transitionToActive.
 *
 * Returns { ok, sniped, candidates, transitioned }.
 */
export async function confirmCandidate(
  gameId: string,
  userId: number,
  slotIndex: number,
  defs: TerritoryDef[],
): Promise<{ ok: boolean; sniped: boolean; candidates: CandidateView[]; transitioned: boolean }> {
  const candidate = await prisma.territoryCandidate.findFirst({
    where: { gameId, userId, slotIndex },
  });
  if (!candidate) throw new Error('Candidate not found for slotIndex ' + slotIndex);

  // Snipe check: was this territory confirmed by someone else since our roll?
  const snipedBy = await prisma.territoryCandidate.findFirst({
    where: { gameId, territoryId: candidate.territoryId, confirmed: true, userId: { not: userId } },
  });

  if (snipedBy) {
    // Auto-reroll the sniped slot and return fresh candidates.
    const fresh = await rollCandidates(gameId, userId, defs);
    return { ok: false, sniped: true, candidates: fresh, transitioned: false };
  }

  // Mark confirmed.
  await prisma.territoryCandidate.updateMany({
    where: { gameId, userId, slotIndex },
    data: { confirmed: true },
  });
  await prisma.gameMembership.updateMany({
    where: { gameId, userId },
    data: { confirmedTerritoryId: candidate.territoryId },
  });

  // Check if all human players have confirmed.
  const game = await prisma.game.findUniqueOrThrow({
    where: { id: gameId },
    include: { memberships: true },
  });
  const aiSlots = new Set<number>((game.aiSlots as number[]) ?? []);
  const humanMemberships = game.memberships.filter((m) => !aiSlots.has(m.slotIndex));
  const allConfirmed = humanMemberships.every((m) => m.confirmedTerritoryId != null || m.userId === userId);

  // Re-check after our update (the query was before the update).
  const refreshedMemberships = await prisma.gameMembership.findMany({ where: { gameId } });
  const humanRefreshed = refreshedMemberships.filter((m) => !aiSlots.has(m.slotIndex));
  const allDone = humanRefreshed.every((m) => m.confirmedTerritoryId != null);

  let transitioned = false;
  if (allDone) {
    await transitionToActive(gameId, defs, refreshedMemberships);
    transitioned = true;
  }

  const remaining = await prisma.territoryCandidate.findMany({ where: { gameId, userId } });
  return {
    ok: true,
    sniped: false,
    candidates: buildCandidateViews(
      remaining.map((c) => ({ slotIndex: c.slotIndex, territoryId: c.territoryId, confirmed: c.confirmed })),
      defs,
    ),
    transitioned,
  };
}

// ── Auto-assign unconfirmed ───────────────────────────────────────────────────

/**
 * For each human player who hasn't confirmed, pick the highest-qualityTier
 * candidate from their 3 (ties broken randomly), confirm it (with snipe
 * retry up to 2 attempts), then transition to active.
 *
 * Called at AFK deadline or by host force-resolve.
 */
export async function autoAssignUnconfirmed(
  gameId: string,
  defs: TerritoryDef[],
): Promise<void> {
  const game = await prisma.game.findUniqueOrThrow({
    where: { id: gameId },
    include: { memberships: true },
  });

  if (game.status !== 'territory_selection') return;

  const aiSlots = new Set<number>((game.aiSlots as number[]) ?? []);
  const unconfirmedMembers = game.memberships.filter(
    (m) => !aiSlots.has(m.slotIndex) && m.confirmedTerritoryId == null,
  );

  for (const member of unconfirmedMembers) {
    await autoAssignOne(gameId, member.userId, defs, 2);
  }

  const refreshed = await prisma.gameMembership.findMany({ where: { gameId } });
  await transitionToActive(gameId, defs, refreshed);
}

async function autoAssignOne(
  gameId: string,
  userId: number,
  defs: TerritoryDef[],
  retriesLeft: number,
): Promise<void> {
  const candidates = await prisma.territoryCandidate.findMany({
    where: { gameId, userId, confirmed: false },
    orderBy: { slotIndex: 'asc' },
  });

  // If no candidates yet, roll first.
  let pool = candidates;
  if (pool.length === 0) {
    await rollCandidates(gameId, userId, defs);
    pool = await prisma.territoryCandidate.findMany({
      where: { gameId, userId, confirmed: false },
    });
  }

  // Pick highest-tier candidate; break ties randomly.
  const defsById = new Map(defs.map((d) => [d.id, d]));
  const sorted = [...pool].sort((a, b) => {
    const ta = defsById.get(a.territoryId)?.qualityTier ?? 1;
    const tb = defsById.get(b.territoryId)?.qualityTier ?? 1;
    if (tb !== ta) return tb - ta;
    return Math.random() - 0.5;
  });

  for (const candidate of sorted) {
    // Snipe check.
    const taken = await prisma.territoryCandidate.findFirst({
      where: { gameId, territoryId: candidate.territoryId, confirmed: true, userId: { not: userId } },
    });
    if (taken) continue;

    await prisma.territoryCandidate.updateMany({
      where: { gameId, userId, slotIndex: candidate.slotIndex },
      data: { confirmed: true },
    });
    await prisma.gameMembership.updateMany({
      where: { gameId, userId },
      data: { confirmedTerritoryId: candidate.territoryId },
    });
    return;
  }

  // All candidates sniped — reroll and retry.
  if (retriesLeft > 0) {
    await rollCandidates(gameId, userId, defs);
    await autoAssignOne(gameId, userId, defs, retriesLeft - 1);
  }
}

// ── Transition to active ──────────────────────────────────────────────────────

/**
 * Reads confirmed territory IDs from memberships, initialises the world
 * with those as capitals, then arms the tick scheduler.
 */
export async function transitionToActive(
  gameId: string,
  defs: TerritoryDef[],
  memberships?: GameMembership[],
): Promise<void> {
  const rows = memberships ?? (await prisma.gameMembership.findMany({ where: { gameId } }));

  const capitalsBySlot: Record<number, string> = {};
  for (const m of rows) {
    if (m.confirmedTerritoryId) {
      capitalsBySlot[m.slotIndex] = m.confirmedTerritoryId;
    }
  }

  // Initialise world with confirmed capitals.
  await ensureGameWorldInitialized(gameId, defs, capitalsBySlot);

  const game = await prisma.game.update({
    where: { id: gameId },
    data: { status: 'active', lastTickAt: new Date() },
  });

  scheduleGameTick(gameId, defs, game.tickIntervalSeconds * 1000);
  console.log(`[territorySelection] Game ${gameId} transitioned to active`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildCandidateViews(
  rows: Array<{ slotIndex: number; territoryId: string; confirmed: boolean }>,
  defs: TerritoryDef[],
): CandidateView[] {
  const defsById = new Map(defs.map((d) => [d.id, d]));
  return rows.map((r) => {
    const def = defsById.get(r.territoryId);
    return {
      slotIndex: r.slotIndex,
      territoryId: r.territoryId,
      name: def?.name ?? r.territoryId,
      qualityTier: def?.qualityTier ?? 1,
      isCoastal: def?.isCoastal ?? false,
      confirmed: r.confirmed,
    };
  });
}

export async function getCandidateViews(
  gameId: string,
  userId: number,
  defs: TerritoryDef[],
): Promise<CandidateView[]> {
  const rows = await prisma.territoryCandidate.findMany({
    where: { gameId, userId },
    orderBy: { slotIndex: 'asc' },
  });
  return buildCandidateViews(
    rows.map((r) => ({ slotIndex: r.slotIndex, territoryId: r.territoryId, confirmed: r.confirmed })),
    defs,
  );
}
