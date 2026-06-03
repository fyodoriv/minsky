#!/usr/bin/env node
// @ts-check
// obs-live-competitive-self-column: compute Minsky's OWN run metrics from
// `run-summary.json` and place them head-to-head against the competitor corpus
// (`@minsky/competitive-benchmark`). Emits `.minsky/competitive-scorecard.json`
// — the load-bearing artifact the dashboard (PR F) renders as the "minsky"
// column with direction-aware deltas vs each competitor.
//
// Re-implements the reducer deleted in the 2026-05-28 Path-A cut, but reads the
// already-built competitor corpus instead of re-deriving it, and writes the
// JSON artifact rather than rewriting the curated `competitors/scorecard.md`
// (the static snapshot stays stable; the live comparison is the JSON + board).
//
// Small-n guard (the task's Pivot): count-sensitive readings (latency, cost)
// are suppressed to null until the run has merged >= MIN_N PRs — an honest
// "(n too small)" instead of a misleading point estimate (rule #4).
//
// Anchor: Basili, Caldiera, Rombach, "The Goal-Question-Metric Approach", 1994 —
// compare against a baseline on the same operationalized metric.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Import the built corpus directly from dist (the package isn't linked into the
// root node_modules, and adding a root dep would mean a pnpm-install + lockfile
// churn). dist is produced by `tsc -b` before tests/CI run, so it's present.
import {
  COMPETITORS,
  computeDelta,
  metricById,
  publishedValue,
} from "../novel/competitive-benchmark/dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const RUNS = join(REPO, ".minsky", "runs");
const SCORECARD = join(REPO, ".minsky", "competitive-scorecard.json");
const MIN_N = 5;

const round2 = (/** @type {number} */ x) => Number(x.toFixed(2));
const round3 = (/** @type {number} */ x) => Number(x.toFixed(3));
const numOrNull = (/** @type {unknown} */ x) =>
  typeof x === "number" && Number.isFinite(x) ? x : null;

/**
 * Map an enriched run summary onto the 5 ledger-derivable competitive metrics.
 * @param {Record<string, unknown>} s
 * @returns {Record<string, number | null>}
 */
export function minskyReadings(s) {
  const merged = Number(s?.["tasksMerged"] ?? 0);
  const uptime = numOrNull(s?.["totalUptimeSec"]);
  const longest = numOrNull(s?.["longestUninterruptedSec"]);
  const attempts = numOrNull(s?.["tasksAttempted"]);
  const enoughN = merged >= MIN_N;
  return {
    "deploy-frequency":
      uptime && uptime > 0 && merged > 0 ? round2(merged / (uptime / 86400)) : null,
    "daemon-stability-pct":
      uptime && uptime > 0 && longest !== null ? round3(longest / uptime) : null,
    "autonomous-merge-rate": attempts && attempts > 0 ? round3(merged / attempts) : null,
    "mean-autonomous-merge-latency": enoughN ? numOrNull(s?.["meanMergeLatencySec"]) : null,
    "cost-per-merged-pr": enoughN ? numOrNull(s?.["meanCostPerMergedPr"]) : null,
  };
}

/**
 * Per-competitor deltas: one entry per metric this competitor publishes.
 * @param {any} c @param {string[]} metricIds @param {Record<string, number | null>} readings
 * @returns {Array<{ metricId: string, minsky: number | null, competitor: number, delta: number | null }>}
 */
function competitorDeltas(c, metricIds, readings) {
  const deltas = [];
  for (const mid of metricIds) {
    const cv = publishedValue(c, mid);
    if (cv === undefined) continue;
    const mv = readings[mid];
    const metric = metricById(mid);
    const delta = typeof mv === "number" && metric ? round3(computeDelta(metric, mv, cv)) : null;
    deltas.push({ metricId: mid, minsky: mv ?? null, competitor: cv, delta });
  }
  return deltas;
}

/**
 * Build the competitive scorecard: Minsky's readings + a direction-aware delta
 * vs every competitor that publishes the same metric.
 * @param {Record<string, number | null>} readings
 * @param {{ competitors?: readonly any[] }} [opts]
 */
export function buildScorecard(readings, { competitors = COMPETITORS } = {}) {
  const metricIds = Object.keys(readings);
  const competitorsOut = [];
  for (const c of competitors) {
    const deltas = competitorDeltas(c, metricIds, readings);
    if (deltas.length) competitorsOut.push({ id: c.id, label: c.label, deltas });
  }
  const nonNullMetrics = metricIds.filter((m) => typeof readings[m] === "number").length;
  return { minsky: { values: readings, nonNullMetrics }, competitors: competitorsOut };
}

/** @returns {string | null} newest run-id by dir mtime */
function latestRunDir() {
  if (!existsSync(RUNS)) return null;
  const dirs = readdirSync(RUNS)
    .map((n) => ({ n, p: join(RUNS, n) }))
    .filter((e) => {
      try {
        return statSync(e.p).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => statSync(b.p).mtimeMs - statSync(a.p).mtimeMs);
  const top = dirs[0];
  return top ? top.n : null;
}

/** @param {string} runId @returns {Record<string, unknown> | null} */
function readRunSummary(runId) {
  const f = join(RUNS, runId, "run-summary.json");
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--run");
  const arg = i >= 0 ? args[i + 1] : "latest";
  const runId = !arg || arg === "latest" ? latestRunDir() : arg;
  const summary = runId ? readRunSummary(runId) : null;
  const readings = summary ? minskyReadings(summary) : minskyReadings({});
  const scorecard = { runId: runId ?? null, ...buildScorecard(readings) };

  try {
    mkdirSync(dirname(SCORECARD), { recursive: true });
    writeFileSync(SCORECARD, `${JSON.stringify(scorecard, null, 2)}\n`);
  } catch {
    /* best-effort; printing still works */
  }
  process.stdout.write(`${JSON.stringify(scorecard)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
