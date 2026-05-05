#!/usr/bin/env node
// Pattern: production binding for the canonical-metric-list-per-repo
//   substrate — composes `SUCCESS_METRICS` (rule #2 — one source of
//   truth) + the daily `.minsky/metric-snapshots/<date>.json`
//   (#186, `metric-snapshot-store.mjs`) + the pure builder
//   (`generate-metrics-md.mjs`) into a written `METRICS.md`.
//   Mirror of `changelog-today.mjs`'s shape: pure orchestrator above
//   injected I/O seams + a thin CLI binding at the bottom.
// Source: task `canonical-metric-list-per-repo` Acceptance (3) "daemon
//   refreshes daily" — that wire-in is the next slice; this slice ships
//   the operator-runnable CLI it dispatches into. Until snapshots carry
//   `SUCCESS_METRICS`-aligned ids, the rendered output is byte-equivalent
//   to the genesis (all stubs) — that IS the load-bearing assertion: the
//   pipeline is correct end-to-end before observations land.
// Anchor: rule #2 (data-not-code — `SUCCESS_METRICS` is canonical, this
//   binding projects); rule #9 (Munafò 2017 — every metric carries
//   `freshnessBudgetMs` *before* observation, the lint defines stale
//   ahead of time); rule #10 (deterministic — same input, same output);
//   Helland 2007 (visible-not-silent — missing observation renders as
//   explicit `(stub)`, never silent zero); Card & Mackinlay 1999
//   (10-metric glanceable display).
// Conformance: full — pure transforms (`mapSnapshotToObservations`,
//   `runMetricsRender`) take no I/O; the CLI is the only fs surface.
// Pivot (rule #9): if the snapshot/metric-id namespace stays misaligned
//   long enough that operators stop trusting `METRICS.md` as a live
//   surface, tighten by adding an alias map in `SUCCESS_METRICS` rather
//   than retiring the per-day cadence. The pipeline contract
//   (snapshot → SUCCESS_METRICS-keyed observations → rendered markdown)
//   is what acceptance (3) depends on.

import { readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildMetricsMd } from "./generate-metrics-md.mjs";
import { loadSnapshot } from "./metric-snapshot-store.mjs";

/**
 * @typedef {import("./generate-metrics-md.mjs").SuccessMetricLike} SuccessMetricLike
 * @typedef {import("./generate-metrics-md.mjs").Observation} Observation
 * @typedef {import("./metric-snapshot-store.mjs").MetricSnapshot} MetricSnapshot
 */

/**
 * Project a `MetricSnapshot` into the `Observation` map the pure builder
 * accepts. Only `metricIds` present as keys in `snapshot` produce
 * observations; the rest are left undefined so the builder renders them
 * as explicit `(stub)`s (visible-not-silent — Helland 2007).
 *
 * The on-disk snapshot shape (`{value, higherIsBetter?}`) does not carry
 * a per-entry timestamp — the snapshot file IS the per-day record, and
 * the caller-supplied `timestampMs` is the moment the snapshot was
 * captured (the file's UTC date midnight in the production binding).
 *
 * @param {{
 *   snapshot: MetricSnapshot | undefined,
 *   metricIds: ReadonlyArray<string>,
 *   timestampMs: number,
 *   source?: string,
 * }} args
 * @returns {Record<string, Observation>}
 */
export function mapSnapshotToObservations({ snapshot, metricIds, timestampMs, source }) {
  /** @type {Record<string, Observation>} */
  const observations = {};
  if (snapshot === undefined) return observations;
  for (const id of metricIds) {
    const entry = snapshot[id];
    if (entry === undefined) continue;
    /** @type {Observation} */
    const obs = source
      ? { value: entry.value, timestampMs, source }
      : { value: entry.value, timestampMs };
    observations[id] = obs;
  }
  return observations;
}

/**
 * Pure orchestrator: project the snapshot into observations, then build
 * the markdown. Same input → same output (rule #10).
 *
 * @param {{
 *   metrics: ReadonlyArray<SuccessMetricLike>,
 *   snapshot: MetricSnapshot | undefined,
 *   snapshotTimestampMs: number,
 *   snapshotSource?: string,
 *   nowMs: number,
 *   stubFollowUp?: string,
 * }} args
 * @returns {string}
 */
export function runMetricsRender({
  metrics,
  snapshot,
  snapshotTimestampMs,
  snapshotSource,
  nowMs,
  stubFollowUp,
}) {
  const metricIds = metrics.map((m) => m.id);
  const observations =
    snapshotSource === undefined
      ? mapSnapshotToObservations({ snapshot, metricIds, timestampMs: snapshotTimestampMs })
      : mapSnapshotToObservations({
          snapshot,
          metricIds,
          timestampMs: snapshotTimestampMs,
          source: snapshotSource,
        });
  return stubFollowUp === undefined
    ? buildMetricsMd({ metrics, observations, nowMs })
    : buildMetricsMd({ metrics, observations, nowMs, stubFollowUp });
}

/**
 * Validate a YYYY-MM-DD UTC date string and return its midnight epoch ms.
 * Rejects non-real dates (e.g. 2026-13-01) — the snapshot file's name
 * IS the observation timestamp, so a malformed name has to fail loud.
 *
 * @param {string} date
 * @returns {number}
 */
export function dateToMidnightUtcMs(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`invalid date "${date}" — expected YYYY-MM-DD`);
  }
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) {
    throw new Error(`invalid date "${date}" — not a real calendar date`);
  }
  const back = new Date(ms).toISOString().slice(0, 10);
  if (back !== date) {
    throw new Error(`invalid date "${date}" — not a real calendar date`);
  }
  return ms;
}

// ---- CLI thin wrapper -------------------------------------------------
//
// Reads SUCCESS_METRICS from the compiled `@minsky/dashboard-web` (the
// one source of truth — rule #2), loads today's snapshot via the file
// store (graceful-degrades to `undefined` on ENOENT — rule #7 — so a
// fresh repo pre-instrumentation still renders all-stubs), runs the
// pure orchestrator, and writes `METRICS.md` to the repo root.

/** @returns {string} */
function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ date: string | null, output: string | null }} */
  const args = { date: null, output: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date") args.date = argv[++i] ?? null;
    else if (a === "--output") args.output = argv[++i] ?? null;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = args.date ?? todayUtc();
  const rootDir = process.cwd();
  const outputPath = args.output ?? resolvePath(rootDir, "METRICS.md");

  // Re-resolve the SUCCESS_METRICS source from this script's location so
  // the CLI works regardless of `cwd`. The dist file is the workspace
  // package's compiled output; tests cover the pure orchestrator above.
  const scriptDir = fileURLToPath(new URL(".", import.meta.url));
  const metricsModuleUrl = new URL(
    `file://${resolvePath(scriptDir, "../novel/dashboard-web/dist/metrics.js")}`,
  );
  const { SUCCESS_METRICS } = await import(metricsModuleUrl.href);

  const snapshot = await loadSnapshot({
    rootDir,
    date,
    readFile: (path) => fsReadFile(path, "utf8"),
  });

  const markdown = runMetricsRender({
    metrics: SUCCESS_METRICS,
    snapshot,
    snapshotTimestampMs: dateToMidnightUtcMs(date),
    snapshotSource: `.minsky/metric-snapshots/${date}.json`,
    nowMs: Date.now(),
  });

  await fsWriteFile(outputPath, markdown);
  process.stdout.write(`${outputPath}\n`);
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("metrics-render.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
