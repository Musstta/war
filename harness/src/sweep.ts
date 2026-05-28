#!/usr/bin/env node
/**
 * npm run sweep <scenario.json> <param-name> <val1> <val2> ...
 *
 * Runs the same scenario N times, varying one numeric constant that the harness
 * controls (e.g. CONQUEST_SHOCK_MIN). Outputs one run per value plus a combined
 * sweep-summary.md and overlaid chart.
 *
 * Sweepable params (set via scenario constantOverrides):
 *   CONQUEST_SHOCK_MIN  CONQUEST_SHOCK_MAX  RECENT_ACQUISITION_WINDOW
 *   CONQUEST_SHOCK_BASE_DECAY  SHOCK_DECAY_INFRA_WEIGHT
 */
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { execFileSync } from 'child_process';
import type { Scenario } from './types';
import { run } from './runner';
import { generateReport, generateCSVs } from './report';

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('Usage: npm run sweep <scenario.json> <param-name> <val1> [val2 ...]');
  process.exit(1);
}

const [scenarioArg, paramName, ...rawValues] = args;
const values = rawValues.map((v) => parseFloat(v)).filter((v) => !isNaN(v));
if (values.length === 0) { console.error('No valid numeric values provided'); process.exit(1); }

const absolutePath = resolve(process.cwd(), scenarioArg!);
const baseScenario = JSON.parse(readFileSync(absolutePath, 'utf-8')) as Scenario;

const sweepsRoot = resolve(__dirname, '../../scenarios', `sweep-${baseScenario.name}-${paramName}`);
mkdirSync(sweepsRoot, { recursive: true });

type HeadlineMetric = { avgFinalUnrest: number; maxFinalUnrest: number; revoltCount: number };
const summaryRows: Array<{ value: number; metrics: HeadlineMetric }> = [];

for (const value of values) {
  console.log(`\n▶  ${paramName} = ${value}`);
  const scenario: Scenario = {
    ...baseScenario,
    name: `${baseScenario.name}_${paramName}_${value}`,
    constantOverrides: { ...((baseScenario as any).constantOverrides ?? {}), [paramName!]: value },
  } as Scenario & { constantOverrides: Record<string, number> };

  const runDir = join(sweepsRoot, String(value));
  mkdirSync(join(runDir, 'charts'), { recursive: true });

  const result = run(scenario);
  generateReport(result, runDir);
  generateCSVs(result, runDir);

  try {
    const chartsScript = resolve(__dirname, '../scripts/charts.py');
    execFileSync('python3', [chartsScript, runDir], { stdio: ['ignore', 'inherit', 'inherit'] });
  } catch { /* skip charts if python unavailable */ }

  // Compute headline metrics for summary.
  const finalSnap = result.snapshots[result.snapshots.length - 1]!;
  const ownedTerrs = Object.values(finalSnap.territories).filter((t) => t.ownerId !== null);
  const unrests = ownedTerrs.map((t) => t.unrest);
  const revoltCount = result.snapshots
    .flatMap((s) => s.events)
    .filter((e) => e.message.toLowerCase().includes('revolt')).length;

  summaryRows.push({
    value,
    metrics: {
      avgFinalUnrest: unrests.length ? unrests.reduce((a, b) => a + b, 0) / unrests.length : 0,
      maxFinalUnrest: unrests.length ? Math.max(...unrests) : 0,
      revoltCount,
    },
  });
}

// ── sweep-summary.md ──────────────────────────────────────────────────────────

const lines: string[] = [
  `# Sweep: ${baseScenario.name} — varying ${paramName}`,
  '',
  `**Scenario:** ${baseScenario.description ?? baseScenario.name}`,
  `**Ticks:** ${baseScenario.ticks}`,
  `**Values swept:** ${values.join(', ')}`,
  '',
  '---',
  '',
  `## Results`,
  '',
  `| ${paramName} | Avg Final Unrest | Max Final Unrest | Revolt Events |`,
  '|---|---|---|---|',
];

for (const { value, metrics } of summaryRows) {
  lines.push(
    `| ${value} | ${(metrics.avgFinalUnrest * 100).toFixed(1)}% |` +
    ` ${(metrics.maxFinalUnrest * 100).toFixed(1)}% | ${metrics.revoltCount} |`,
  );
}

lines.push('', '---', '', '## Per-run outputs', '');
for (const value of values) {
  lines.push(`- [\`${value}/\`](./${value}/report.md)`);
}

writeFileSync(join(sweepsRoot, 'sweep-summary.md'), lines.join('\n') + '\n');
console.log(`\n✓ Sweep complete. Summary: ${join(sweepsRoot, 'sweep-summary.md')}`);
