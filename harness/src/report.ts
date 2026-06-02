/**
 * Generates report.md, territory-metrics.csv, nation-metrics.csv, and events.csv
 * from a completed RunResult.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { RunResult, TickSnapshot } from './types';

// Tick markers included in the summary tables.
const REPORT_TICKS = [0, 1, 2, 5, 10, 15, 20, 25, 30, 40, 50];

function pct(n: number): string { return (n * 100).toFixed(1) + '%'; }
function f3(n: number): string { return n.toFixed(3); }
function pad(s: string, w: number): string { return s.padEnd(w); }

// ── report.md ────────────────────────────────────────────────────────────────

export function generateReport(result: RunResult, outputDir: string): void {
  const { scenario, snapshots } = result;
  const finalSnap = snapshots[snapshots.length - 1]!;
  const ticks = scenario.ticks;

  // Which territories changed ownership at some point?
  const changed = new Set<string>();
  const t0 = snapshots[0]!.territories;
  for (const [id, snap] of Object.entries(finalSnap.territories)) {
    if (snap.ownerId !== t0[id]?.ownerId) changed.add(id);
  }
  // Also include territories that had any revolt or high unrest.
  for (const snap of snapshots) {
    for (const [id, t] of Object.entries(snap.territories)) {
      if (t.isInRevolt || t.unrest > 0.3) changed.add(id);
    }
  }

  const lines: string[] = [];

  lines.push(`# Scenario: ${scenario.name}`);
  if (scenario.description) lines.push(`\n> ${scenario.description}`);
  lines.push(`\n**Ticks run:** ${ticks}`);
  lines.push(`**Nations:** ${scenario.world.nations.length}`);
  lines.push(`**Scripted actions:** ${(scenario.actions ?? []).length}`);

  // ── Final state per nation ──────────────────────────────────────────────────
  lines.push('\n---\n\n## Nation Summary — Final State\n');
  lines.push('| Nation | Territories | Avg Unrest | Max Unrest | Revolts at Final |');
  lines.push('|---|---|---|---|---|');
  for (const n of scenario.world.nations) {
    const ownedIds = Object.entries(finalSnap.territories)
      .filter(([, t]) => t.ownerId === n.id)
      .map(([id]) => id);
    const unrests = ownedIds.map((id) => finalSnap.territories[id]!.unrest);
    const avg = unrests.length ? unrests.reduce((a, b) => a + b, 0) / unrests.length : 0;
    const max = unrests.length ? Math.max(...unrests) : 0;
    const revolting = ownedIds.filter((id) => finalSnap.territories[id]!.isInRevolt).length;
    lines.push(`| ${n.name} | ${ownedIds.join(', ') || '—'} | ${pct(avg)} | ${pct(max)} | ${revolting} |`);
  }

  // ── Per-territory unrest history ────────────────────────────────────────────
  const interestingTerrs = [...changed].filter((id) =>
    snapshots.some((s) => s.territories[id]?.ownerId !== null),
  );

  lines.push('\n---\n\n## Unrest & Equilibrium — Key Territories\n');
  const snapTicks = REPORT_TICKS.filter((t) => t <= ticks);

  for (const tid of interestingTerrs) {
    lines.push(`### ${tid}\n`);
    lines.push('| Tick | Owner | Unrest | Eq. | Shock | Compat | Infra | Distance |');
    lines.push('|------|-------|--------|-----|-------|--------|-------|----------|');
    for (const t of snapTicks) {
      const snap = snapshots[t];
      if (!snap) continue;
      const ts = snap.territories[tid];
      if (!ts) continue;
      const c = ts.causes;
      lines.push(
        `| T${t} | ${ts.ownerId ?? '—'} | ${pct(ts.unrest)} | ${pct(ts.equilibrium)} |` +
        ` ${f3(ts.ownershipShock)} | ${ts.compatTotal !== null ? f3(ts.compatTotal) : '—'} |` +
        ` ${c ? f3(c.infrastructureBonus) : '—'} | ${c ? f3(c.distancePressure) : '—'} |`,
      );
    }
    lines.push('');
  }

  // ── Revolt events ──────────────────────────────────────────────────────────
  const allEvents = snapshots.flatMap((s) => s.events);
  if (allEvents.length > 0) {
    lines.push('---\n\n## Event Timeline\n');
    lines.push('| Tick | Event |');
    lines.push('|------|-------|');
    for (const e of allEvents) {
      lines.push(`| T${e.tick} | ${e.message} |`);
    }
  }

  // ── Diplomacy summary ──────────────────────────────────────────────────────
  const hasDipl = snapshots.some((s) => s.diplomacy.treaties.length > 0);
  if (hasDipl) {
    lines.push('\n---\n\n## Diplomacy Summary\n');

    // Trust per nation across key ticks.
    const snapTicks2 = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20].filter((t) => t <= ticks);
    lines.push('### Trust Over Time\n');
    const nationIds = scenario.world.nations.map((n) => n.id);
    lines.push('| Tick | ' + scenario.world.nations.map((n) => n.name).join(' | ') + ' |');
    lines.push('|---' + scenario.world.nations.map(() => '|---').join('') + '|');
    for (const t of snapTicks2) {
      const snap = snapshots[t];
      if (!snap) continue;
      const vals = nationIds.map((id) => {
        const ns = snap.diplomacy.nationState[id];
        return ns ? ns.trust.toFixed(1) : '—';
      });
      lines.push(`| T${t} | ${vals.join(' | ')} |`);
    }

    // Wealth per nation (shows collateral deductions and tribute flows).
    lines.push('\n### Wealth Over Time (shows collateral + tribute effects)\n');
    lines.push('| Tick | ' + scenario.world.nations.map((n) => n.name).join(' | ') + ' |');
    lines.push('|---' + scenario.world.nations.map(() => '|---').join('') + '|');
    for (const t of snapTicks2) {
      const snap = snapshots[t];
      if (!snap) continue;
      const vals = nationIds.map((id) => {
        const ns = snap.diplomacy.nationState[id];
        return ns ? ns.wealthStock.toFixed(1) : '—';
      });
      lines.push(`| T${t} | ${vals.join(' | ')} |`);
    }

    // Treaty status timeline.
    lines.push('\n### Treaty Status Timeline\n');
    // Collect all treaty IDs seen across the run.
    const allTreatyIds = new Set<number>();
    for (const snap of snapshots) for (const t of snap.diplomacy.treaties) allTreatyIds.add(t.id);
    for (const tid of allTreatyIds) {
      const firstSeen = snapshots.find((s) => s.diplomacy.treaties.some((t) => t.id === tid));
      if (!firstSeen) continue;
      const tDef = firstSeen.diplomacy.treaties.find((t) => t.id === tid)!;
      lines.push(`**Treaty #${tid}** (${tDef.clauses.join(' + ')}, ${tDef.termTicks}-tick term, collateral ${tDef.totalCollateral})\n`);
      lines.push('| Tick | Status | Escrow A | Escrow B | Refund A | Refund B |');
      lines.push('|------|--------|----------|----------|----------|----------|');
      const [partyA, partyB] = tDef.partyIds;
      for (const t of snapTicks2) {
        const snap = snapshots[t];
        if (!snap) continue;
        const st = snap.diplomacy.treaties.find((tx) => tx.id === tid);
        if (!st) { lines.push(`| T${t} | — | — | — | — | — |`); continue; }
        lines.push(`| T${t} | ${st.status} | ${(st.escrowAmountByParty[partyA!] ?? 0).toFixed(1)} | ${(st.escrowAmountByParty[partyB!] ?? 0).toFixed(1)} | ${(st.refundRemainingByParty[partyA!] ?? 0).toFixed(1)} | ${(st.refundRemainingByParty[partyB!] ?? 0).toFixed(1)} |`);
      }
      lines.push('');

      // Objective clause status timeline (if any).
      if (tDef.objectives && tDef.objectives.length > 0) {
        lines.push('**Objective Clauses:**\n');
        for (const obj of tDef.objectives) {
          lines.push(`_Clause ${obj.clauseIndex}: ${obj.objectiveType} · responsible: ${obj.responsibleParty} · deadline +${obj.deadlineTicks}t_\n`);
          lines.push('| Tick | Status |');
          lines.push('|------|--------|');
          for (const t of snapTicks2) {
            const snap = snapshots[t];
            if (!snap) continue;
            const st = snap.diplomacy.treaties.find((tx) => tx.id === tid);
            const objSnap = st?.objectives?.find((o) => o.clauseIndex === obj.clauseIndex);
            lines.push(`| T${t} | ${objSnap?.status ?? '—'} |`);
          }
          lines.push('');
        }
      }
    }
  }

  // ── Chart list ─────────────────────────────────────────────────────────────
  const hasTradeFlowsForChart = snapshots.some((s) =>
    s.diplomacy.treaties.some((t) => t.tradeClauses && t.tradeClauses.length > 0),
  );
  const hasObjectiveClausesForChart = snapshots.some((s) =>
    s.diplomacy.treaties.some((t) => t.objectives && t.objectives.length > 0),
  );

  const hasWarsForChart = snapshots.some((s) => s.wars && s.wars.length > 0);

  lines.push('\n---\n\n## Charts\n');
  lines.push('- `charts/unrest-over-time.png` — Unrest per territory over all ticks');
  for (const tid of interestingTerrs) {
    lines.push(`- \`charts/equilibrium-${tid}.png\` — Equilibrium component breakdown for ${tid}`);
  }
  lines.push('- `charts/nation-culture-drift.png` — Nation culture axis drift over time');
  if (hasDipl) {
    lines.push('- `charts/treaty-status-over-time.png` — Treaty status transitions + Trust + Wealth' +
      (hasObjectiveClausesForChart ? ' + Objective status' : ''));
  }
  if (hasTradeFlowsForChart) {
    lines.push('- `charts/trade-flow-over-time.png` — Per-tick trade flows (paid/missed/degraded) alongside nation Wealth stockpiles');
  }
  if (hasWarsForChart) {
    lines.push('- `charts/war-state-over-time.png` — Army sizes, occupied territory count, and belligerent unrest over the war timeline');
  }
  const hasActivityTierData = snapshots.some((s) =>
    Object.values(s.diplomacy.nationState).some((ns) => ns.activityTier && ns.activityTier !== 'active'),
  );
  if (hasActivityTierData) {
    lines.push('- `charts/activity-tier-over-time.png` — Activity tier transitions per human nation over time');
  }
  const hasFragDataForChart = snapshots.some((s) => s.fragmentationData && s.fragmentationData.length > 0);
  if (hasFragDataForChart) {
    lines.push('- `charts/fragmentation-risk-over-time.png` — Fragmentation risk per abandoned territory, with threshold line');
  }
  lines.push('\n*Generated by the WAR simulation harness.*');

  writeFileSync(join(outputDir, 'report.md'), lines.join('\n') + '\n');
  console.log('  ✓ report.md');
}

// ── CSVs ─────────────────────────────────────────────────────────────────────

export function generateCSVs(result: RunResult, outputDir: string): void {
  const { snapshots } = result;

  // territory-metrics.csv
  const terrHeader = [
    'tick', 'territory_id', 'owner_id', 'unrest', 'equilibrium',
    'conquest_shock', 'base', 'compat_pressure', 'distance_pressure',
    'infra_bonus', 'overexpansion', 'rapid_expansion', 'is_in_revolt', 'compat_total',
  ].join(',');

  const terrRows: string[] = [terrHeader];
  for (const snap of snapshots) {
    for (const [tid, ts] of Object.entries(snap.territories)) {
      const c = ts.causes;
      terrRows.push([
        snap.tick, tid, ts.ownerId ?? '',
        ts.unrest.toFixed(6), ts.equilibrium.toFixed(6),
        ts.ownershipShock.toFixed(6),
        c ? c.base.toFixed(6) : '',
        c ? c.compatibilityPressure.toFixed(6) : '',
        c ? c.distancePressure.toFixed(6) : '',
        c ? c.infrastructureBonus.toFixed(6) : '',
        c ? c.overexpansionPressure.toFixed(6) : '',
        c ? c.recentConquestPressure.toFixed(6) : '',
        ts.isInRevolt ? '1' : '0',
        ts.compatTotal !== null ? ts.compatTotal.toFixed(6) : '',
      ].join(','));
    }
  }
  writeFileSync(join(outputDir, 'territory-metrics.csv'), terrRows.join('\n') + '\n');

  // nation-metrics.csv
  const natHeader = [
    'tick', 'nation_id', 'pop_stock', 'ind_stock', 'wealth_stock', 'army_size',
    'culture_individualist', 'culture_progressive', 'culture_militaristic', 'culture_expansionist', 'culture_family',
  ].join(',');

  const natRows: string[] = [natHeader];
  for (const snap of snapshots) {
    for (const [nid, ns] of Object.entries(snap.nations)) {
      const cu = ns.culture;
      natRows.push([
        snap.tick, nid,
        ns.stockpiles.population.toFixed(2), ns.stockpiles.industry.toFixed(2), ns.stockpiles.wealth.toFixed(2),
        '',  // armySize not in snapshot — acceptable gap for now
        cu ? cu.individualist.toFixed(6) : '',
        cu ? cu.progressive.toFixed(6) : '',
        cu ? cu.militaristic.toFixed(6) : '',
        cu ? cu.expansionist.toFixed(6) : '',
        cu ? (cu.primaryFamily ?? '') : '',
      ].join(','));
    }
  }
  writeFileSync(join(outputDir, 'nation-metrics.csv'), natRows.join('\n') + '\n');

  // events.csv
  const evtRows = ['tick,message'];
  for (const snap of snapshots) {
    for (const e of snap.events) {
      evtRows.push(`${e.tick},"${e.message.replace(/"/g, '""')}"`);
    }
  }
  writeFileSync(join(outputDir, 'events.csv'), evtRows.join('\n') + '\n');

  // treaty-metrics.csv — one row per treaty per tick
  const hasTreaties = snapshots.some((s) => s.diplomacy.treaties.length > 0);
  if (hasTreaties) {
    const tmHeader = 'tick,treaty_id,status,party_a,party_b,clauses,term_ticks,tick_ends,total_collateral,collateral_a,collateral_b,escrow_a,escrow_b,refund_a,refund_b';
    const tmRows: string[] = [tmHeader];
    for (const snap of snapshots) {
      for (const t of snap.diplomacy.treaties) {
        const [pA, pB] = t.partyIds;
        tmRows.push([
          snap.tick, t.id, t.status,
          pA!, pB!,
          `"${t.clauses.join('|')}"`,
          t.termTicks, t.tickEnds, t.totalCollateral.toFixed(2),
          (t.collateralByParty[pA!] ?? 0).toFixed(2),
          (t.collateralByParty[pB!] ?? 0).toFixed(2),
          (t.escrowAmountByParty[pA!] ?? 0).toFixed(2),
          (t.escrowAmountByParty[pB!] ?? 0).toFixed(2),
          (t.refundRemainingByParty[pA!] ?? 0).toFixed(2),
          (t.refundRemainingByParty[pB!] ?? 0).toFixed(2),
        ].join(','));
      }
      // Per-nation diplomacy state
    }
    writeFileSync(join(outputDir, 'treaty-metrics.csv'), tmRows.join('\n') + '\n');
  }

  // nation-diplomacy.csv — trust + wealth + debt + activity tier per nation per tick
  const ndHeader = 'tick,nation_id,trust,inactivity_tier,activity_tier,wealth_stock,debt_balance';
  const ndRows: string[] = [ndHeader];
  for (const snap of snapshots) {
    for (const [nid, ns] of Object.entries(snap.diplomacy.nationState)) {
      ndRows.push([snap.tick, nid, ns.trust.toFixed(3), ns.inactivityTier, ns.activityTier ?? ns.inactivityTier, ns.wealthStock.toFixed(2), ns.debtBalance.toFixed(2)].join(','));
    }
  }
  writeFileSync(join(outputDir, 'nation-diplomacy.csv'), ndRows.join('\n') + '\n');

  // fragmentation-risk.csv — per-territory fragmentation risk per tick (abandoned nations only).
  const hasFragData = snapshots.some((s) => s.fragmentationData && s.fragmentationData.length > 0);
  if (hasFragData) {
    const frHeader = 'tick,territory_id,owner_id,unrest,fragmentation_risk';
    const frRows: string[] = [frHeader];
    for (const snap of snapshots) {
      for (const fd of (snap.fragmentationData ?? [])) {
        frRows.push([snap.tick, fd.territoryId, fd.ownerId ?? '', fd.unrest.toFixed(6), fd.fragmentationRisk.toFixed(6)].join(','));
      }
    }
    writeFileSync(join(outputDir, 'fragmentation-risk.csv'), frRows.join('\n') + '\n');
  }

  // trade-flows.csv — per-tick per-clause flow status (only when trade clauses exist).
  // Flow status per tick is inferred from consecutive missedPayments values:
  //   missedPayments increased vs prev tick → missed this tick
  //   missedPayments == 0 and was active → paid this tick
  //   clauseStatus == 'degraded' or 'breached' → stopped
  const hasTradeFlows = snapshots.some((s) =>
    s.diplomacy.treaties.some((t) => t.tradeClauses && t.tradeClauses.length > 0),
  );
  if (hasTradeFlows) {
    const tfHeader = 'tick,treaty_id,clause_index,resource,amount,from_nation,to_nation,flow_status,missed_payments,clause_status';
    const tfRows: string[] = [tfHeader];
    // Build prev-tick missedPayments map: "treatyId:clauseIndex" → missedPayments
    const prevMissed = new Map<string, number>();

    for (const snap of snapshots) {
      for (const t of snap.diplomacy.treaties) {
        for (const tc of (t.tradeClauses ?? [])) {
          const key = `${t.id}:${tc.clauseIndex}`;
          const prev = prevMissed.get(key) ?? 0;
          let flowStatus: string;
          if (tc.clauseStatus === 'degraded') {
            flowStatus = 'degraded';
          } else if (tc.clauseStatus === 'breached') {
            flowStatus = 'breached';
          } else if (snap.tick === 0) {
            flowStatus = 'pending'; // T0 = pre-treaty
          } else if (tc.missedPayments > prev) {
            flowStatus = 'missed';
          } else if (tc.clauseStatus === 'active') {
            flowStatus = snap.tick > 0 ? 'paid' : 'pending';
          } else {
            flowStatus = 'inactive';
          }
          prevMissed.set(key, tc.missedPayments);
          tfRows.push([
            snap.tick, t.id, tc.clauseIndex,
            tc.resource, tc.amount.toFixed(2),
            tc.fromNationId, tc.toNationId,
            flowStatus, tc.missedPayments, tc.clauseStatus,
          ].join(','));
        }
      }
    }
    writeFileSync(join(outputDir, 'trade-flows.csv'), tfRows.join('\n') + '\n');
  }

  // objective-metrics.csv — per-tick per-objective-clause status (for objective-status chart).
  const hasObjectiveClauses = snapshots.some((s) =>
    s.diplomacy.treaties.some((t) => t.objectives && t.objectives.length > 0),
  );
  if (hasObjectiveClauses) {
    const omHeader = 'tick,treaty_id,clause_index,objective_type,responsible_party,status,deadline_ticks';
    const omRows: string[] = [omHeader];
    for (const snap of snapshots) {
      for (const t of snap.diplomacy.treaties) {
        for (const obj of (t.objectives ?? [])) {
          omRows.push([
            snap.tick, t.id, obj.clauseIndex,
            obj.objectiveType, obj.responsibleParty,
            obj.status, obj.deadlineTicks,
          ].join(','));
        }
      }
    }
    writeFileSync(join(outputDir, 'objective-metrics.csv'), omRows.join('\n') + '\n');
  }

  // war-state.csv — army sizes, occupied territory counts, and war status per tick.
  const hasWars = snapshots.some((s) => s.wars && s.wars.length > 0);
  if (hasWars) {
    const wsHeader = 'tick,war_id,attacker_id,defender_id,type,has_casus_belli,status,start_tick,occupied_count';
    const wsRows: string[] = [wsHeader];
    // Also emit army sizes alongside war state for charting.
    for (const snap of snapshots) {
      for (const w of (snap.wars ?? [])) {
        wsRows.push([
          snap.tick, w.id, w.attackerId, w.defenderId, w.type,
          w.hasCasusBelli ? '1' : '0', w.status,
          w.startTick, w.occupiedCount,
        ].join(','));
      }
    }
    writeFileSync(join(outputDir, 'war-state.csv'), wsRows.join('\n') + '\n');

    // army-sizes.csv — per-nation army size per tick (for war chart).
    const asHeader = 'tick,nation_id,army_size';
    const asRows: string[] = [asHeader];
    for (const snap of snapshots) {
      for (const [nid, ns] of Object.entries(snap.nations)) {
        asRows.push([snap.tick, nid, ns.armySize].join(','));
      }
    }
    writeFileSync(join(outputDir, 'army-sizes.csv'), asRows.join('\n') + '\n');
  }

  const extraCsvs = [
    hasTreaties ? 'treaty-metrics.csv' : null,
    'nation-diplomacy.csv',
    hasTradeFlows ? 'trade-flows.csv' : null,
    hasObjectiveClauses ? 'objective-metrics.csv' : null,
    hasWars ? 'war-state.csv  army-sizes.csv' : null,
    hasFragData ? 'fragmentation-risk.csv' : null,
  ].filter(Boolean).join('  ');
  console.log(`  ✓ territory-metrics.csv  nation-metrics.csv  events.csv  ${extraCsvs}`);
}
