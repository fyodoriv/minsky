#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved 2026-05-22 M1.10 — slice (c) of `self-metrics-competitive-benchmark`. CLI shim that reads `.minsky/orchestrate.jsonl`, calls `buildScorecard()` from `@minsky/competitive-benchmark`, writes `competitive-scorecard.json`, and exits 0 / non-zero per acceptance. -->
//
// Usage:
//   node scripts/benchmark-run.mjs [--host PATH] [--write-to PATH] [--json] [--help]
//
// Default behaviour:
//   1. Read `.minsky/orchestrate.jsonl` from --host (or $MINSKY_HOME, or
//      cwd if cwd is a git repo, else the repo root).
//   2. Compute Minsky's readings via @minsky/competitive-benchmark.
//   3. Build the scorecard with the live corpus.
//   4. Write to <host>/.minsky/competitive-scorecard.json (or --write-to).
//   5. Print a human summary to stdout (or --json for raw scorecard JSON).
//   6. Exit 0 when the M1.10 shape gate is met (≥4 competitors × ≥5
//      shared metrics in the published corpus); exit 1 when the corpus
//      is too thin. `liveDeltaCount` is surfaced in the summary as a
//      cold-start health indicator but does NOT gate the exit code —
//      Minsky measurements accumulate over time, not block the milestone.
//
// Pattern: thin CLI shim over the pure builder. Matches
//   `scripts/minsky-benchmark.mjs` (the iteration-throughput benchmark)
//   in argv parsing + exit-code shape.
// Source: docs/plans/self-metrics-competitive-benchmark.md slice (c).
// Anchor: rule #1 (don't reinvent — uses @minsky/competitive-benchmark
//   pure builder); rule #4 (visible — exits non-zero when acceptance
//   fails so `pnpm m1:metrics` and CI surface the gap immediately);
//   rule #17 (proactive healing — the gap rationale is in the human
//   summary, not buried in the JSON).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  computeFreshness,
  extractCorpusEntries,
} from "./check-corpus-freshness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * @typedef {{ host: string | null, writeTo: string | null, json: boolean, help: boolean }} CliOpts
 */

/**
 * Apply one argv token to the running CliOpts. Returns the new index
 * (the caller advances by 1 by default, this returns +1 when the flag
 * consumed a value too).
 *
 * @param {string} flag
 * @param {string[]} args
 * @param {number} i
 * @param {CliOpts} out
 * @returns {number} new index in args
 */
function applyArg(flag, args, i, out) {
  if (flag === "--json") {
    out.json = true;
    return i;
  }
  if (flag === "--host") {
    out.host = args[i + 1] ?? null;
    return i + 1;
  }
  if (flag === "--write-to") {
    out.writeTo = args[i + 1] ?? null;
    return i + 1;
  }
  if (flag === "--help" || flag === "-h") {
    out.help = true;
    return i;
  }
  process.stderr.write(`benchmark-run: unknown argument: ${flag}\n`);
  process.exit(64);
}

/**
 * Parse argv. Same shape as scripts/minsky-benchmark.mjs.
 *
 * @param {string[]} argv
 * @returns {CliOpts}
 */
function parseArgs(argv) {
  /** @type {CliOpts} */
  const out = { host: null, writeTo: null, json: false, help: false };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a) continue;
    i = applyArg(a, args, i, out);
  }
  return out;
}

function printUsage() {
  process.stdout.write(
    [
      "Usage: node scripts/benchmark-run.mjs [options]",
      "",
      "Build the M1.10 competitive scorecard. Reads .minsky/orchestrate.jsonl,",
      "computes Minsky's metrics, compares to the published competitor corpus,",
      "writes competitive-scorecard.json.",
      "",
      "Options:",
      "  --host PATH       Host repo (default: $MINSKY_HOME or cwd if cwd is a git repo)",
      "  --write-to PATH   Override the output path (default: <host>/.minsky/competitive-scorecard.json)",
      "  --json            Print scorecard JSON to stdout (otherwise prints a human summary)",
      "  --help, -h        Print this message",
      "",
      "Exit code:",
      "  0  M1.10 shape gate met (≥4 competitors × ≥5 shared metrics in the corpus)",
      "  1  shape gap — corpus too thin (scorecard still written; check the `gap` field)",
      "  2  reading/writing error (missing builder dist, write permission, etc.)",
      "",
      "Live deltas (Minsky measured against ≥1 corpus-covered metric) are",
      "surfaced in the summary as a cold-start health indicator — they do not",
      "gate the exit code. A fresh host has 0 deltas; weekly iterations grow it.",
      "",
    ].join("\n"),
  );
}

/**
 * Resolve which host directory to read orchestrate.jsonl from.
 *
 * @param {string | null} explicit
 * @returns {string}
 */
function resolveHost(explicit) {
  if (explicit) return resolve(explicit);
  const env = process.env["MINSKY_HOME"];
  if (env) return resolve(env);
  const cwd = process.cwd();
  if (existsSync(join(cwd, ".git"))) return cwd;
  return REPO_ROOT;
}

/**
 * Read .minsky/orchestrate.jsonl into an iteration-record array. Tolerates
 * a missing file (returns []) and malformed lines (skipped).
 *
 * @param {string} host
 * @returns {object[]}
 */
function readLedger(host) {
  const path = join(host, ".minsky", "orchestrate.jsonl");
  if (!existsSync(path)) return [];
  const body = readFileSync(path, "utf8");
  /** @type {object[]} */
  const records = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      // Parse error → record skipped. The scorecard's `samples`
      // sub-object will reflect the smaller denominator.
    }
  }
  return records;
}

/** @typedef {{ competitorId: string, delta: number | undefined, competitorValue: number | undefined, minskyValue: number }} CellRow */

/**
 * Build the one-line M1.10 acceptance summary from a scorecard's
 * `acceptance` object.
 *
 * @param {import("../novel/competitive-benchmark/dist/scorecard.js").Scorecard["acceptance"]} a
 * @returns {string}
 */
function formatAcceptanceLine(a) {
  // The M1.10 milestone gate is the corpus SHAPE: ≥4 competitors × ≥5
  // shared metrics. `liveDeltaCount` is an informational health number
  // surfaced beside the verdict — a cold-start host has 0 deltas and
  // that's expected behavior, not a gate failure.
  const overall = a.meetsM110 ? "✅ MET" : "❌ GAP";
  const detail = a.meetsM110
    ? a.liveDeltaCount > 0
      ? `${a.liveDeltaCount} live delta(s)`
      : "0 live deltas — cold-start host; run ≥1 iteration on a shared metric to baseline"
    : a.gap;
  return `M1.10 acceptance: ${overall} — ${detail}`;
}

/**
 * Group cells by metric, dropping rows where both Minsky and the
 * competitor have no value (pure no-data rows). The summary stays
 * scan-able by only showing rows that carry information.
 *
 * @param {readonly import("../novel/competitive-benchmark/dist/scorecard.js").ScorecardCell[]} cells
 * @returns {Map<string, CellRow[]>}
 */
function groupCellsByMetric(cells) {
  /** @type {Map<string, CellRow[]>} */
  const byMetric = new Map();
  for (const cell of cells) {
    if (cell.competitorValue === undefined && !Number.isFinite(cell.minskyValue)) {
      continue;
    }
    if (!byMetric.has(cell.metricId)) byMetric.set(cell.metricId, []);
    byMetric.get(cell.metricId)?.push({
      competitorId: cell.competitorId,
      delta: cell.delta,
      competitorValue: cell.competitorValue,
      minskyValue: cell.minskyValue,
    });
  }
  return byMetric;
}

/**
 * Format one row in the per-metric block of the summary.
 *
 * @param {CellRow} row
 * @returns {string}
 */
function formatCellRow(row) {
  const indicator = row.delta === undefined ? "·" : row.delta > 0 ? "✓" : row.delta < 0 ? "✗" : "=";
  const minSki = Number.isFinite(row.minskyValue) ? row.minskyValue.toFixed(4) : "no data";
  const comp = row.competitorValue === undefined ? "no data" : row.competitorValue.toFixed(4);
  const delta = row.delta === undefined ? "" : ` (Δ ${row.delta.toFixed(4)})`;
  return `    ${indicator} vs ${row.competitorId}: minsky=${minSki} competitor=${comp}${delta}`;
}

/**
 * Build the one-line freshness summary, e.g.
 *   "Freshness: mean 330d (2 stale, 3 very-stale) — file refresh tasks via scripts/auto-file-corpus-refresh-tasks.mjs"
 * or
 *   "Freshness: mean 45d (all fresh)"
 *
 * @param {ReturnType<typeof computeFreshness>} f
 * @returns {string}
 */
function formatFreshnessLine(f) {
  const allFresh = f.staleCount === 0;
  if (allFresh) return `Freshness: mean ${f.meanAgeDays}d (all fresh, ≤90d)`;
  const buckets = [];
  const staleOnly = f.staleCount - f.verySaleCount;
  if (staleOnly > 0) buckets.push(`${staleOnly} stale`);
  if (f.verySaleCount > 0) buckets.push(`${f.verySaleCount} very-stale`);
  const tail =
    f.verySaleCount > 0
      ? " — `node scripts/auto-file-corpus-refresh-tasks.mjs` to file refresh tasks"
      : "";
  return `Freshness: mean ${f.meanAgeDays}d (${buckets.join(", ")})${tail}`;
}

/**
 * Read competitors.ts and compute the freshness summary. Returns
 * `null` if the file isn't readable (so the surrounding scorecard
 * still renders — freshness is a visibility add-on, not a gate).
 *
 * @returns {ReturnType<typeof computeFreshness> | null}
 */
function tryComputeFreshness() {
  const competitorsPath = join(
    REPO_ROOT,
    "novel/competitive-benchmark/src/competitors.ts",
  );
  if (!existsSync(competitorsPath)) return null;
  try {
    const body = readFileSync(competitorsPath, "utf8");
    const entries = extractCorpusEntries(body);
    if (entries.length === 0) return null;
    return computeFreshness({
      competitors: entries,
      now: new Date().toISOString().slice(0, 10),
    });
  } catch {
    return null;
  }
}

/**
 * Render a human-readable summary table.
 *
 * @param {import("../novel/competitive-benchmark/dist/scorecard.js").Scorecard} sc
 * @param {ReturnType<typeof computeFreshness> | null} freshness
 * @returns {string}
 */
function renderSummary(sc, freshness) {
  const lines = [];
  lines.push("");
  lines.push("══ Minsky Competitive Scorecard ══");
  lines.push(`Generated: ${sc.generatedAt}`);
  lines.push(
    `Grid: ${sc.cellCount} cells (${sc.metrics.length} metrics × ${sc.competitors.length} competitors)`,
  );
  lines.push(`Live comparisons: ${sc.comparisonCount} cell(s) with a delta`);
  lines.push(formatAcceptanceLine(sc.acceptance));
  if (freshness !== null) lines.push(formatFreshnessLine(freshness));
  lines.push("");

  for (const [metricId, rows] of groupCellsByMetric(sc.cells)) {
    lines.push(`  ${metricId}`);
    for (const row of rows) {
      lines.push(formatCellRow(row));
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printUsage();
    return 0;
  }
  const host = resolveHost(opts.host);
  const distRoot = join(REPO_ROOT, "novel/competitive-benchmark/dist");
  if (!existsSync(distRoot)) {
    process.stderr.write(
      "benchmark-run: @minsky/competitive-benchmark not built. Run `pnpm install` (or `pnpm --filter @minsky/competitive-benchmark build`) first.\n",
    );
    return 2;
  }
  // Lazy-load the workspace package (compiled dist).
  const { computeMinskyReadings, readingsToMetricValues } = await import(
    join(distRoot, "ledger.js")
  );
  const { buildScorecard } = await import(join(distRoot, "scorecard.js"));

  const records = readLedger(host);
  const readings = computeMinskyReadings(records);
  const scorecard = buildScorecard({
    minskyValues: readingsToMetricValues(readings),
    now: new Date().toISOString(),
  });

  // Compute corpus freshness as a visibility add-on (rule #4). The
  // returned FreshnessSummary is attached to the scorecard JSON under
  // `corpusFreshness` so downstream consumers (the dashboard, the
  // weekly autofile runner) can read it without re-extracting from
  // competitors.ts. `null` here means competitors.ts wasn't readable;
  // the scorecard still renders — freshness is informational, not a gate.
  const freshness = tryComputeFreshness();
  const scorecardWithFreshness = {
    ...scorecard,
    ...(freshness ? { corpusFreshness: freshness } : {}),
  };

  const outPath = opts.writeTo ?? join(host, ".minsky", "competitive-scorecard.json");
  try {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(scorecardWithFreshness, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(
      `benchmark-run: failed to write ${outPath}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(scorecardWithFreshness, null, 2)}\n`);
  } else {
    process.stdout.write(renderSummary(scorecard, freshness));
    process.stdout.write(`\nWrote ${outPath}\n`);
  }

  // M1.10 milestone gate: corpus SHAPE — ≥4 competitors × ≥5 shared
  // metrics with published values. Exit 0 when the shape gate is met;
  // exit 1 when the corpus is too thin. `liveDeltaCount` is surfaced
  // in the summary but does NOT gate the exit code — a cold-start host
  // (0 live deltas) is expected to accumulate Minsky measurements over
  // time, not block the milestone.
  return scorecard.acceptance.meetsM110 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await main();
  process.exit(code);
}
