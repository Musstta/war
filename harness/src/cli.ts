#!/usr/bin/env node
/**
 * npm run scenario <path-to-scenario.json> [--no-charts]
 *
 * Loads a scenario, runs it through the pure engine, writes output to
 * scenarios/<name>/ (report.md, CSVs, charts).
 */
import { readFileSync, mkdirSync } from 'fs';
import { resolve, dirname, join, basename } from 'path';
import { execSync, execFileSync } from 'child_process';
import type { Scenario } from './types';
import { run } from './runner';
import { generateReport, generateCSVs } from './report';

const args = process.argv.slice(2);
const noCharts = args.includes('--no-charts');
const scenarioPath = args.find((a) => !a.startsWith('--'));

if (!scenarioPath) {
  console.error('Usage: npm run scenario <path-to-scenario.json> [--no-charts]');
  process.exit(1);
}

const absolutePath = resolve(process.cwd(), scenarioPath);
let scenario: Scenario;
try {
  scenario = JSON.parse(readFileSync(absolutePath, 'utf-8')) as Scenario;
} catch (e) {
  console.error(`Failed to load scenario: ${absolutePath}\n${e}`);
  process.exit(1);
}

// Output directory: scenarios/<scenario-name>/
const scenariosDir = resolve(__dirname, '../../scenarios');
const outputDir = join(scenariosDir, scenario.name);
mkdirSync(join(outputDir, 'charts'), { recursive: true });

console.log(`\n▶  ${scenario.name}`);
if (scenario.description) console.log(`   ${scenario.description}`);
console.log(`   ${scenario.ticks} ticks · ${scenario.world.nations.length} nations · ${(scenario.actions ?? []).length} scripted actions\n`);

console.log('Running scenario...');
const t0 = Date.now();
const result = run(scenario);
const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

const assertionErrors = result.assertionErrors ?? [];
if (assertionErrors.length > 0) {
  console.log(`  ✗ ${scenario.ticks} ticks in ${elapsed}s — ${assertionErrors.length} assertion failure(s)\n`);
  for (const err of assertionErrors) {
    console.error(`  ${err.message}`);
  }
} else {
  console.log(`  ✓ ${scenario.ticks} ticks in ${elapsed}s\n`);
}

console.log('Writing outputs...');
generateReport(result, outputDir);
generateCSVs(result, outputDir);

if (!noCharts) {
  const chartsScript = resolve(__dirname, '../scripts/charts.py');
  try {
    execFileSync('python3', [chartsScript, outputDir], { stdio: ['ignore', 'inherit', 'inherit'] });
  } catch {
    try {
      execFileSync('python', [chartsScript, outputDir], { stdio: ['ignore', 'inherit', 'inherit'] });
    } catch {
      console.log('  ✗ Could not run python3/python — skipping charts. Install matplotlib to enable.');
    }
  }
}

console.log(`\n✓ Output written to: ${outputDir}/`);
console.log(`  report.md  territory-metrics.csv  nation-metrics.csv  events.csv`);
if (!noCharts) console.log(`  charts/`);

// Exit non-zero if any assertions failed so the test runner reports correctly.
if (assertionErrors.length > 0) {
  process.exit(1);
}
