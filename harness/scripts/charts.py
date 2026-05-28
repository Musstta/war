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

# ── Main ──────────────────────────────────────────────────────────────────────

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

    print(f"\nCharts written to {charts_dir}/")

if __name__ == '__main__':
    main()
