/**
 * War council helpers — Phase 9.
 *
 * Creates WarCouncil rows for a new war and mirrors military actions
 * into CouncilQueuedAction for real-time coordination visibility.
 */
import { Prisma } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

/**
 * Create attacker and defender WarCouncil rows for a newly declared war.
 * Each side gets exactly one council. Additional nations can join via
 * addNationToCouncil when defense pacts fire.
 *
 * Returns { attackerCouncilId, defenderCouncilId }.
 */
export async function createWarCouncils(
  tx: TxClient,
  warId: number,
  attackerNationId: string,
  defenderNationId: string,
): Promise<{ attackerCouncilId: number; defenderCouncilId: number }> {
  const [attackerCouncil, defenderCouncil] = await Promise.all([
    tx.warCouncil.create({
      data: {
        warId,
        side: 'attacker',
        memberNationIds: [attackerNationId] as unknown as Prisma.InputJsonValue,
      },
    }),
    tx.warCouncil.create({
      data: {
        warId,
        side: 'defender',
        memberNationIds: [defenderNationId] as unknown as Prisma.InputJsonValue,
      },
    }),
  ]);
  return { attackerCouncilId: attackerCouncil.id, defenderCouncilId: defenderCouncil.id };
}

/**
 * Add a nation to the defender-side council for a war.
 * Used when a defense pact ally auto-declares — they join the defender side.
 *
 * No-ops if the nation is already a member.
 */
export async function addNationToDefenderCouncil(
  tx: TxClient,
  warId: number,
  nationId: string,
): Promise<void> {
  const council = await tx.warCouncil.findFirst({
    where: { warId, side: 'defender' },
  });
  if (!council) return;

  const existing = (council.memberNationIds as string[]) ?? [];
  if (existing.includes(nationId)) return;

  await tx.warCouncil.update({
    where: { id: council.id },
    data: {
      memberNationIds: [...existing, nationId] as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * Mirror a military action into the appropriate council's CouncilQueuedAction table.
 * Called at queue time from attackTerritory, moveArmy, and retreatArmy handlers.
 *
 * Finds the council for this nation (either side of any war that nation is in),
 * then writes the mirror row. No-ops if no council is found (nation not in a war).
 *
 * targetTerritoryId semantics:
 *   attack_territory: the territory being attacked
 *   move_army:        the destination territory
 *   retreat_army:     the territory being retreated from
 */
export async function mirrorMilitaryAction(
  tx: TxClient,
  nationId: string,
  actionType: 'attack_territory' | 'move_army' | 'retreat_army',
  targetTerritoryId: string | null,
  tick: number,
): Promise<void> {
  // Find all active wars involving this nation.
  const activeWars = await tx.war.findMany({
    where: {
      status: { in: ['active', 'peace_negotiation'] },
      OR: [{ attackerId: nationId }, { defenderId: nationId }],
    },
    select: { id: true },
  });
  if (activeWars.length === 0) return;

  const warIds = activeWars.map((w) => w.id);

  // Find councils for these wars where this nation is a member.
  const councils = await tx.warCouncil.findMany({
    where: { warId: { in: warIds } },
  });

  for (const council of councils) {
    const members = (council.memberNationIds as string[]) ?? [];
    if (!members.includes(nationId)) continue;

    await tx.councilQueuedAction.create({
      data: {
        councilId: council.id,
        nationId,
        actionType,
        targetTerritoryId: targetTerritoryId ?? null,
        tick,
      },
    });
  }
}
