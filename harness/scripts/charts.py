#!/usr/bin/env python3
"""
charts.py — generate PNG charts from harness output CSVs.
Usage: python3 charts.py <output-dir>
Requires: matplotlib (pip install matplotlib)
"""

import sys
import os
import csv
from collections import defaultdict

try:
    import matplotlib
    matplotlib.use('Agg')  # headless — no display needed
    import matplotlib.pyplot as plt
    import matplotlib.cm as cm
    import numpy as np
except ImportError:
    print("  ✗ matplotlib not found — skipping charts. Install with: pip install matplotlib")
    sys.exit(0)

def load_csv(path):
    if not os.path.exists(path):
        return []
    with open(path, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))

def setup():
    plt.rcParams.update({
        'figure.facecolor': '#0d0d1a',
        'axes.facecolor':   '#0d0d1a',
        'axes.edgecolor':   '#333355',
        'axes.labelcolor':  '#aaa',
        'xtick.color':      '#666',
        'ytick.color':      '#666',
        'text.color':       '#ccc',
        'grid.color':       '#1a1a2e',
        'legend.facecolor': '#0d0d1a',
        'legend.edgecolor': '#333355',
    })

# ── Chart 1: Unrest over time, all territories ───────────────────────────────

def chart_unrest_over_time(terr_rows, output_dir):
    by_terr = defaultdict(list)
    for row in terr_rows:
        if row['owner_id']:
            by_terr[row['territory_id']].append((int(row['tick']), float(row['unrest'])))

    if not by_terr:
        return

    fig, ax = plt.subplots(figsize=(10, 5))
    colors = cm.tab10(np.linspace(0, 1, max(len(by_terr), 1)))

    for (tid, points), color in zip(sorted(by_terr.items()), colors):
        pts = sorted(points)
        ticks = [p[0] for p in pts]
        vals  = [p[1] for p in pts]
        ax.plot(ticks, vals, label=tid, color=color, linewidth=1.8)

    ax.axhline(0.80, color='#ff4444', linestyle='--', linewidth=1, alpha=0.7, label='Revolt (0.80)')
    ax.set_xlabel('Tick')
    ax.set_ylabel('Unrest')
    ax.set_title('Unrest Over Time — All Owned Territories')
    ax.set_ylim(0, 1.0)
    ax.legend(fontsize=8, loc='upper right')
    ax.grid(True, alpha=0.4)

    plt.tight_layout()
    path = os.path.join(output_dir, 'charts', 'unrest-over-time.png')
    plt.savefig(path, dpi=100, bbox_inches='tight')
    plt.close()
    print(f"  ✓ {path}")

# ── Chart 2: Equilibrium component stacked area for an interesting territory ──

COMP_LABELS = ['Conquest shock', 'Compat clash', 'Distance', 'Empire size', 'Rapid expansion', 'Base']
COMP_COLS   = ['conquest_shock', 'compat_pressure', 'distance_pressure', 'overexpansion', 'rapid_expansion', 'base']
COMP_COLORS = ['#e74c3c', '#e67e22', '#3498db', '#9b59b6', '#f39c12', '#555555']
INFRA_COL   = 'infra_bonus'

def chart_equilibrium_components(terr_rows, territory_id, output_dir):
    rows = [r for r in terr_rows if r['territory_id'] == territory_id and r['owner_id'] and r[COMP_COLS[0]]]
    if not rows:
        return

    rows.sort(key=lambda r: int(r['tick']))
    ticks = [int(r['tick']) for r in rows]

    fig, ax = plt.subplots(figsize=(10, 5))

    bottom = np.zeros(len(ticks))
    for label, col, color in zip(COMP_LABELS, COMP_COLS, COMP_COLORS):
        vals = np.array([max(0.0, float(r[col])) for r in rows])
        if vals.max() > 0.001:
            ax.fill_between(ticks, bottom, bottom + vals, alpha=0.75, label=label, color=color)
            bottom += vals

    # Infra bonus is negative — draw as a downward bar from the total
    infra_vals = np.array([abs(min(0.0, float(r[INFRA_COL]))) if r[INFRA_COL] else 0 for r in rows])
    if infra_vals.max() > 0.001:
        ax.fill_between(ticks, bottom - infra_vals, bottom, alpha=0.65, label='Infra bonus (−)', color='#2ecc71')

    equilibria = [float(r['equilibrium']) for r in rows]
    unrests    = [float(r['unrest'])      for r in rows]
    ax.plot(ticks, equilibria, 'w--', linewidth=1.5, label='Equilibrium', alpha=0.8)
    ax.plot(ticks, unrests,    'w-',  linewidth=2.0, label='Actual unrest')
    ax.axhline(0.80, color='#ff4444', linestyle=':', linewidth=1, alpha=0.7, label='Revolt (0.80)')

    ax.set_xlabel('Tick')
    ax.set_ylabel('Unrest / Equilibrium')
    ax.set_title(f'Equilibrium Components — {territory_id}')
    ax.set_ylim(0, 1.0)
    ax.legend(fontsize=7, loc='upper right')
    ax.grid(True, alpha=0.3)

    plt.tight_layout()
    path = os.path.join(output_dir, 'charts', f'equilibrium-{territory_id}.png')
    plt.savefig(path, dpi=100, bbox_inches='tight')
    plt.close()
    print(f"  ✓ {path}")

# ── Chart 3: Nation culture drift ─────────────────────────────────────────────

AXIS_COLS   = ['culture_individualist', 'culture_progressive', 'culture_militaristic', 'culture_expansionist']
AXIS_LABELS = ['Indiv ↔ Coll', 'Prog ↔ Trad', 'Mltc ↔ Pcfl', 'Expn ↔ Isol']

def chart_nation_culture_drift(nation_rows, output_dir):
    by_nation = defaultdict(list)
    for row in nation_rows:
        if row.get('culture_individualist'):
            by_nation[row['nation_id']].append(row)

    if not by_nation:
        return

    n_nations = len(by_nation)
    nation_colors = cm.tab10(np.linspace(0, 1, max(n_nations, 1)))

    fig, axes = plt.subplots(2, 2, figsize=(12, 7))
    fig.suptitle('Nation Culture Axis Drift Over Time', y=1.01)
    axes = axes.flatten()

    for ax_i, (col, label) in enumerate(zip(AXIS_COLS, AXIS_LABELS)):
        ax = axes[ax_i]
        for (nid, rows), color in zip(sorted(by_nation.items()), nation_colors):
            rows.sort(key=lambda r: int(r['tick']))
            ticks = [int(r['tick']) for r in rows]
            vals  = [float(r[col]) for r in rows]
            ax.plot(ticks, vals, label=nid.replace('nation_', ''), color=color, linewidth=1.5)
        ax.axhline(0, color='#444', linestyle=':', linewidth=0.8)
        ax.set_title(label, fontsize=9)
        ax.set_ylim(-1, 1)
        ax.grid(True, alpha=0.3)
        if ax_i == 0:
            ax.legend(fontsize=7, loc='upper right')

    plt.tight_layout()
    path = os.path.join(output_dir, 'charts', 'nation-culture-drift.png')
    plt.savefig(path, dpi=100, bbox_inches='tight')
    plt.close()
    print(f"  ✓ {path}")

# ── Chart 4: Treaty status over time + Trust + Wealth [+ objective status] ────

STATUS_COLORS = {
    'active':   '#5bbcff',
    'degraded': '#ffaa33',
    'broken':   '#ff4444',
    'expired':  '#555555',
}

OBJ_STATUS_COLORS = {
    'pending': '#fa6',
    'met':     '#5b5',
    'failed':  '#e55',
    'waived':  '#555',
}

def chart_treaty_status_over_time(treaty_rows, dipl_rows, output_dir, obj_rows=None):
    if not treaty_rows:
        return

    has_objectives = bool(obj_rows)

    # Group treaty rows by treaty_id.
    by_treaty = defaultdict(list)
    for row in treaty_rows:
        by_treaty[row['treaty_id']].append(row)

    # Group nation-diplomacy rows by nation_id.
    by_nation = defaultdict(list)
    for row in dipl_rows:
        by_nation[row['nation_id']].append(row)

    n_treaties = len(by_treaty)
    n_nations  = len(by_nation)

    # Subplots: status, [objective status,] Trust, Wealth.
    n_panels = 4 if has_objectives else 3
    fig, axes = plt.subplots(n_panels, 1, figsize=(10, 3 * n_panels))
    fig.suptitle('Treaty System — Status, Trust & Wealth Over Time', y=1.01)

    ax_idx = 0

    # ── Treaty status panel ───────────────────────────────────────────────────
    ax0 = axes[ax_idx]; ax_idx += 1
    status_order = ['active', 'degraded', 'broken', 'expired']
    status_y     = {s: i for i, s in enumerate(status_order)}
    sorted_treaty_ids = sorted(by_treaty.keys())

    treaty_colors = cm.tab10(np.linspace(0, 1, max(n_treaties, 1)))
    for (tid, rows), color in zip([(k, by_treaty[k]) for k in sorted_treaty_ids], treaty_colors):
        rows_sorted = sorted(rows, key=lambda r: int(r['tick']))
        tid_idx = sorted_treaty_ids.index(tid)
        prev_status, seg_start = None, None
        for row in rows_sorted:
            tick   = int(row['tick'])
            status = row['status']
            if status != prev_status:
                if prev_status is not None and seg_start is not None:
                    y = status_y.get(prev_status, 0) + tid_idx * 0.12
                    ax0.barh(y, tick - seg_start, left=seg_start, height=0.10,
                             color=STATUS_COLORS.get(prev_status, '#888'), alpha=0.85)
                seg_start = tick
                prev_status = status
        if prev_status is not None and seg_start is not None and rows_sorted:
            last_tick = int(rows_sorted[-1]['tick'])
            y = status_y.get(prev_status, 0) + tid_idx * 0.12
            ax0.barh(y, last_tick - seg_start + 1, left=seg_start, height=0.10,
                     color=STATUS_COLORS.get(prev_status, '#888'), alpha=0.85,
                     label=f'Treaty #{tid}')

    ax0.set_yticks(list(range(len(status_order))))
    ax0.set_yticklabels(status_order, fontsize=8)
    ax0.set_xlabel('Tick')
    ax0.set_title('Treaty Status Timeline', fontsize=9)
    ax0.legend(fontsize=7, loc='upper right')
    ax0.grid(True, alpha=0.3, axis='x')

    # ── Objective status panel (only when objectives exist) ───────────────────
    if has_objectives:
        ax_obj = axes[ax_idx]; ax_idx += 1
        # obj_rows: list of dicts with tick, treaty_id, clause_index, objective_type,
        #           responsible_party, status, deadline_ticks
        by_obj = defaultdict(list)
        for row in obj_rows:
            key = f"T#{row['treaty_id']} {row['objective_type']} (c{row['clause_index']})"
            by_obj[key].append(row)

        obj_status_order = ['pending', 'met', 'failed', 'waived']
        obj_status_y = {s: i for i, s in enumerate(obj_status_order)}
        obj_keys = sorted(by_obj.keys())
        obj_colors = cm.tab10(np.linspace(0, 1, max(len(obj_keys), 1)))

        for (okey, rows), color in zip([(k, by_obj[k]) for k in obj_keys], obj_colors):
            rows_sorted = sorted(rows, key=lambda r: int(r['tick']))
            k_idx = obj_keys.index(okey)
            prev_status, seg_start = None, None
            for row in rows_sorted:
                tick   = int(row['tick'])
                status = row['status']
                if status != prev_status:
                    if prev_status is not None and seg_start is not None:
                        y = obj_status_y.get(prev_status, 0) + k_idx * 0.12
                        ax_obj.barh(y, tick - seg_start, left=seg_start, height=0.10,
                                    color=OBJ_STATUS_COLORS.get(prev_status, '#888'), alpha=0.85)
                    seg_start = tick
                    prev_status = status
            if prev_status is not None and seg_start is not None and rows_sorted:
                last_tick = int(rows_sorted[-1]['tick'])
                y = obj_status_y.get(prev_status, 0) + k_idx * 0.12
                ax_obj.barh(y, last_tick - seg_start + 1, left=seg_start, height=0.10,
                            color=OBJ_STATUS_COLORS.get(prev_status, '#888'), alpha=0.85,
                            label=okey)

        ax_obj.set_yticks(list(range(len(obj_status_order))))
        ax_obj.set_yticklabels(obj_status_order, fontsize=8)
        ax_obj.set_xlabel('Tick')
        ax_obj.set_title('Objective Clause Status Over Time', fontsize=9)
        ax_obj.legend(fontsize=7, loc='upper right')
        ax_obj.grid(True, alpha=0.3, axis='x')

    # ── Trust panel ───────────────────────────────────────────────────────────
    ax1 = axes[ax_idx]; ax_idx += 1
    nation_colors = cm.tab10(np.linspace(0, 1, max(n_nations, 1)))
    for (nid, rows), color in zip(sorted(by_nation.items()), nation_colors):
        rows_sorted = sorted(rows, key=lambda r: int(r['tick']))
        ticks  = [int(r['tick']) for r in rows_sorted]
        trusts = [float(r['trust']) for r in rows_sorted]
        label  = nid.replace('nation_', '')
        ax1.plot(ticks, trusts, label=label, color=color, linewidth=1.8)
    ax1.axhline(50, color='#aaa', linestyle='--', linewidth=0.8, alpha=0.5, label='Baseline (50)')
    ax1.set_ylabel('Trust')
    ax1.set_title('Trust Over Time', fontsize=9)
    ax1.set_ylim(0, 100)
    ax1.legend(fontsize=7, loc='lower right')
    ax1.grid(True, alpha=0.3)

    # ── Wealth panel ──────────────────────────────────────────────────────────
    ax2 = axes[ax_idx]; ax_idx += 1
    for (nid, rows), color in zip(sorted(by_nation.items()), nation_colors):
        rows_sorted = sorted(rows, key=lambda r: int(r['tick']))
        ticks  = [int(r['tick']) for r in rows_sorted]
        wealth = [float(r['wealth_stock']) for r in rows_sorted]
        label  = nid.replace('nation_', '')
        ax2.plot(ticks, wealth, label=label, color=color, linewidth=1.8)
    ax2.set_xlabel('Tick')
    ax2.set_ylabel('Wealth stockpile')
    ax2.set_title('Wealth Over Time (collateral deductions + tribute + fines)', fontsize=9)
    ax2.legend(fontsize=7, loc='upper right')
    ax2.grid(True, alpha=0.3)

    plt.tight_layout()
    path = os.path.join(output_dir, 'charts', 'treaty-status-over-time.png')
    plt.savefig(path, dpi=100, bbox_inches='tight')
    plt.close()
    print(f"  ✓ {path}")


# ── Chart 5: Trade flow over time ─────────────────────────────────────────────

FLOW_STATUS_COLORS = {
    'paid':     '#5bbcff',
    'missed':   '#ffaa33',
    'breached': '#ff4444',
    'degraded': '#888888',
    'pending':  '#333355',
    'inactive': '#222233',
}

def chart_trade_flow_over_time(flow_rows, dipl_rows, output_dir):
    if not flow_rows:
        return

    # Group by clause key: "treaty_id:clause_index (from→to resource amount)"
    by_clause = defaultdict(list)
    for row in flow_rows:
        key = f"T#{row['treaty_id']} c{row['clause_index']} {row['from_nation'].replace('nation_','')[:6]}→{row['to_nation'].replace('nation_','')[:6]} {row['resource']}"
        by_clause[key].append(row)

    # Group nation wealth by nation_id.
    by_nation = defaultdict(list)
    for row in dipl_rows:
        by_nation[row['nation_id']].append(row)

    n_clauses = len(by_clause)
    n_nations = len(by_nation)
    if n_clauses == 0:
        return

    fig, axes = plt.subplots(2, 1, figsize=(10, 7))
    fig.suptitle('Trade Flows Over Time', y=1.01)

    # ── Flow status bar chart ─────────────────────────────────────────────────
    ax0 = axes[0]
    clause_keys = sorted(by_clause.keys())
    clause_colors = cm.tab10(np.linspace(0, 1, max(n_clauses, 1)))

    for y_idx, (ckey, rows) in enumerate([(k, by_clause[k]) for k in clause_keys]):
        rows_sorted = sorted(rows, key=lambda r: int(r['tick']))
        for row in rows_sorted:
            tick = int(row['tick'])
            status = row['flow_status']
            if status in ('pending', 'inactive'):
                continue
            color = FLOW_STATUS_COLORS.get(status, '#444')
            ax0.barh(y_idx, 1, left=tick - 0.5, height=0.6, color=color, alpha=0.85)

    ax0.set_yticks(list(range(len(clause_keys))))
    ax0.set_yticklabels([k for k in clause_keys], fontsize=7)
    ax0.set_xlabel('Tick')
    ax0.set_title('Trade Clause Flow Status per Tick', fontsize=9)

    # Legend
    from matplotlib.patches import Patch
    legend_elements = [Patch(facecolor=c, label=s) for s, c in FLOW_STATUS_COLORS.items()
                       if s not in ('pending', 'inactive')]
    ax0.legend(handles=legend_elements, fontsize=7, loc='upper right')
    ax0.grid(True, alpha=0.3, axis='x')

    # ── Wealth over time ──────────────────────────────────────────────────────
    ax1 = axes[1]
    nation_colors = cm.tab10(np.linspace(0, 1, max(n_nations, 1)))
    for (nid, rows), color in zip(sorted(by_nation.items()), nation_colors):
        rows_sorted = sorted(rows, key=lambda r: int(r['tick']))
        ticks  = [int(r['tick'])  for r in rows_sorted]
        wealth = [float(r['wealth_stock']) for r in rows_sorted]
        label  = nid.replace('nation_', '')
        ax1.plot(ticks, wealth, label=label, color=color, linewidth=1.8)
    ax1.set_xlabel('Tick')
    ax1.set_ylabel('Wealth stockpile')
    ax1.set_title('Nation Wealth (trade flows visible as divergence)', fontsize=9)
    ax1.legend(fontsize=7, loc='upper right')
    ax1.grid(True, alpha=0.3)

    plt.tight_layout()
    path = os.path.join(output_dir, 'charts', 'trade-flow-over-time.png')
    plt.savefig(path, dpi=100, bbox_inches='tight')
    plt.close()
    print(f"  ✓ {path}")

# ── Chart 6: War state over time ─────────────────────────────────────────────

def chart_war_state_over_time(war_rows, army_rows, terr_rows, dipl_rows, output_dir):
    if not war_rows:
        return

    # Group war rows by war_id.
    by_war = defaultdict(list)
    for row in war_rows:
        by_war[row['war_id']].append(row)

    # Group army rows by nation_id.
    by_nation_army = defaultdict(list)
    for row in army_rows:
        by_nation_army[row['nation_id']].append(row)

    # Occupied count per war per tick.
    # Avg unrest per belligerent per tick (from territory-metrics).
    by_nation_terr = defaultdict(list)
    for row in terr_rows:
        if row['owner_id'] and row['unrest']:
            by_nation_terr[row['owner_id']].append(row)

    # Collect all belligerents.
    belligerents = set()
    for rows in by_war.values():
        for row in rows:
            belligerents.add(row['attacker_id'])
            belligerents.add(row['defender_id'])

    fig, axes = plt.subplots(3, 1, figsize=(10, 9))
    fig.suptitle('War State Over Time', y=1.01)
    nation_colors = cm.tab10(np.linspace(0, 1, max(len(belligerents), 1)))
    color_map = {nid: color for nid, color in zip(sorted(belligerents), nation_colors)}

    # ── Army sizes ────────────────────────────────────────────────────────────
    ax0 = axes[0]
    for nid in sorted(belligerents):
        rows_sorted = sorted([r for r in by_nation_army.get(nid, [])], key=lambda r: int(r['tick']))
        if not rows_sorted:
            continue
        ticks = [int(r['tick']) for r in rows_sorted]
        sizes = [int(r['army_size']) for r in rows_sorted]
        label = nid.replace('nation_', '')
        ax0.plot(ticks, sizes, label=label, color=color_map.get(nid, '#888'), linewidth=2)
    ax0.set_ylabel('Army size')
    ax0.set_title('Army Sizes Over Time', fontsize=9)
    ax0.legend(fontsize=8, loc='upper right')
    ax0.grid(True, alpha=0.3)

    # ── Occupied territory count ──────────────────────────────────────────────
    ax1 = axes[1]
    war_colors = cm.tab10(np.linspace(0.3, 0.9, max(len(by_war), 1)))
    for (wid, rows), color in zip(sorted(by_war.items()), war_colors):
        rows_sorted = sorted(rows, key=lambda r: int(r['tick']))
        ticks = [int(r['tick']) for r in rows_sorted]
        occ   = [int(r['occupied_count']) for r in rows_sorted]
        attacker = rows_sorted[0]['attacker_id'].replace('nation_', '') if rows_sorted else wid
        defender = rows_sorted[0]['defender_id'].replace('nation_', '') if rows_sorted else ''
        ax1.plot(ticks, occ, label=f'War #{wid} ({attacker}→{defender})', color=color, linewidth=2, marker='o', markersize=4)
    ax1.set_ylabel('Occupied territories')
    ax1.set_title('Occupied Territory Count', fontsize=9)
    ax1.yaxis.set_major_locator(plt.MaxNLocator(integer=True))
    ax1.legend(fontsize=8, loc='upper right')
    ax1.grid(True, alpha=0.3)

    # ── Average unrest per belligerent ────────────────────────────────────────
    ax2 = axes[2]
    for nid in sorted(belligerents):
        rows = by_nation_terr.get(nid, [])
        if not rows:
            continue
        by_tick = defaultdict(list)
        for r in rows:
            by_tick[int(r['tick'])].append(float(r['unrest']))
        tick_list = sorted(by_tick.keys())
        avg_unrest = [sum(by_tick[t]) / len(by_tick[t]) for t in tick_list]
        label = nid.replace('nation_', '')
        ax2.plot(tick_list, avg_unrest, label=label, color=color_map.get(nid, '#888'), linewidth=2)
    ax2.axhline(0.80, color='#ff4444', linestyle='--', linewidth=1, alpha=0.7, label='Revolt (0.80)')
    ax2.set_xlabel('Tick')
    ax2.set_ylabel('Avg unrest')
    ax2.set_title('Average Unrest — Belligerents', fontsize=9)
    ax2.set_ylim(0, 1.0)
    ax2.legend(fontsize=8, loc='upper right')
    ax2.grid(True, alpha=0.3)

    plt.tight_layout()
    path = os.path.join(output_dir, 'charts', 'war-state-over-time.png')
    plt.savefig(path, dpi=100, bbox_inches='tight')
    plt.close()
    print(f"  ✓ {path}")


# ── Main ──────────────────────────────────────────────────────────────────────

def load_objective_rows(treaty_rows, output_dir):
    """
    Build objective-clause rows from treaty-metrics.csv by reading the report.md
    objective status timeline. Since objectives are stored in the report but not
    in a separate CSV, we derive them from the treaty-metrics.csv by scanning
    the events.csv for objective events, and reconstruct status transitions.
    Simpler: just read from a dedicated objective-metrics.csv if it exists,
    otherwise return empty.
    """
    path = os.path.join(output_dir, 'objective-metrics.csv')
    if os.path.exists(path):
        return load_csv(path)
    return []


def main():
    if len(sys.argv) < 2:
        print("Usage: charts.py <output-dir>")
        sys.exit(1)

    output_dir = sys.argv[1]
    charts_dir = os.path.join(output_dir, 'charts')
    os.makedirs(charts_dir, exist_ok=True)

    setup()

    terr_rows   = load_csv(os.path.join(output_dir, 'territory-metrics.csv'))
    nation_rows = load_csv(os.path.join(output_dir, 'nation-metrics.csv'))
    treaty_rows = load_csv(os.path.join(output_dir, 'treaty-metrics.csv'))
    dipl_rows   = load_csv(os.path.join(output_dir, 'nation-diplomacy.csv'))
    flow_rows   = load_csv(os.path.join(output_dir, 'trade-flows.csv'))
    war_rows    = load_csv(os.path.join(output_dir, 'war-state.csv'))
    army_rows   = load_csv(os.path.join(output_dir, 'army-sizes.csv'))
    obj_rows    = load_objective_rows(treaty_rows, output_dir)

    # Determine "interesting" territories: owned + unrest moved more than 2%.
    unrest_by_terr = defaultdict(list)
    for row in terr_rows:
        if row['owner_id'] and row['unrest']:
            unrest_by_terr[row['territory_id']].append(float(row['unrest']))

    interesting = [
        tid for tid, vals in unrest_by_terr.items()
        if vals and (max(vals) - min(vals)) > 0.02
    ]

    chart_unrest_over_time(terr_rows, output_dir)
    for tid in interesting:
        chart_equilibrium_components(terr_rows, tid, output_dir)
    chart_nation_culture_drift(nation_rows, output_dir)
    if treaty_rows:
        chart_treaty_status_over_time(treaty_rows, dipl_rows, output_dir, obj_rows or None)
    if flow_rows:
        chart_trade_flow_over_time(flow_rows, dipl_rows, output_dir)
    if war_rows:
        chart_war_state_over_time(war_rows, army_rows, terr_rows, dipl_rows, output_dir)

    print(f"\nCharts written to {charts_dir}/")

if __name__ == '__main__':
    main()
