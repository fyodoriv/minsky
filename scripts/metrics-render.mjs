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
 * Parse a previously-rendered `METRICS.md` document and return the raw
 * `**Value:** …` line text (with the leading marker stripped) for every
 * metric section. Stub sections are included verbatim — the consumer
 * (`buildMetricsMd`) filters them via `isCarryForwardCandidate`.
 *
 * The parser mirrors `check-milestone-alignment.mjs:parseMetricsMd` so
 * the carry-forward render and the alignment gate agree on what counts
 * as a "value line" for a given metric id. Pure — same input, same
 * output (rule #10). The on-disk read happens in the CLI binding below.
 *
 * @param {string} content
 * @returns {Record<string, string>}
 */
export function extractPriorRawValues(content) {
  /** @type {Record<string, string>} */
  const values = {};
  if (typeof content !== "string" || content.length === 0) return values;
  // First chunk is the preamble — every subsequent chunk starts with the
  // section heading body (the leading `## ` was the split delimiter).
  const sections = content.split(/^## /m).slice(1);
  for (const section of sections) {
    const firstLine = section.split("\n", 1)[0] ?? "";
    const idMatch = firstLine.match(/^([a-z0-9-]+)\b/);
    if (!idMatch?.[1]) continue;
    const id = idMatch[1];
    const valueMatch = section.match(/\*\*Value:\*\*\s*(.+?)(?:\n|$)/);
    const rawValue = valueMatch?.[1]?.trim();
    if (rawValue === undefined || rawValue.length === 0) continue;
    values[id] = rawValue;
  }
  return values;
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
 *   proposedMetrics?: ReadonlyArray<{
 *     id: string, label: string, rationale: string,
 *     milestone: string, blockedBy?: string, formula: string,
 *   }>,
 *   priorRawValues?: Readonly<Record<string, string>>,
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
  proposedMetrics,
  priorRawValues,
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
  /** @type {Parameters<typeof buildMetricsMd>[0]} */
  const input = { metrics, observations, nowMs };
  if (stubFollowUp !== undefined) input.stubFollowUp = stubFollowUp;
  if (proposedMetrics !== undefined) input.proposedMetrics = proposedMetrics;
  if (priorRawValues !== undefined) input.priorRawValues = priorRawValues;
  return buildMetricsMd(input);
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
// pure orchestrator, and writes the rendered markdown to
// `DEFAULT_OUTPUT_RELATIVE` (`docs/METRICS.md`) below — the canonical
// location read by the alignment gate and documented in
// `docs/metrics-discipline.md`. `--output <path>` overrides.

/** @returns {string} */
function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Canonical location of the rendered metrics document, relative to the
 * repo root. Exported so tests can pin the value — see
 * `scripts/metrics-render.test.mjs` — and so the daemon-side mtime
 * probe (`novel/tick-loop/bin/tick-loop.mjs:1259`) and the alignment
 * gate (`scripts/check-milestone-alignment.mjs:605`) can be cross-
 * checked against one source of truth (rule #2 — data-not-code).
 *
 * Prior value was bare `METRICS.md` (repo root), which neither the
 * alignment gate nor any documented surface looked at — the daemon's
 * daily render was silently going to the wrong file, leaving the
 * canonical `docs/METRICS.md` stale and every M1.X metric-tagged
 * criterion stuck in `(stub)` state. Pinning to `docs/METRICS.md`
 * matches `vision.md`, `docs/metrics-discipline.md`, and the alignment
 * check reader. Operators can still pass `--output <path>` to override.
 */
export const DEFAULT_OUTPUT_RELATIVE = "docs/METRICS.md";

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
  const outputPath = args.output ?? resolvePath(rootDir, DEFAULT_OUTPUT_RELATIVE);

  // Re-resolve the SUCCESS_METRICS source from this script's location so
  // the CLI works regardless of `cwd`. The dist file is the workspace
  // package's compiled output; tests cover the pure orchestrator above.
  const scriptDir = fileURLToPath(new URL(".", import.meta.url));
  const metricsModuleUrl = new URL(
    `file://${resolvePath(scriptDir, "../novel/dashboard-web/dist/metrics.js")}`,
  );
  const { SUCCESS_METRICS, PROPOSED_METRICS } = await import(metricsModuleUrl.href);

  const snapshot = await loadSnapshot({
    rootDir,
    date,
    readFile: (path) => fsReadFile(path, "utf8"),
  });

  // Read the existing METRICS.md so a regen that produces only stubs for
  // SUCCESS_METRICS ids (e.g. the daemon's daily snapshot uses a
  // non-`SUCCESS_METRICS`-aligned id namespace) doesn't overwrite real
  // committed values — that downgrade flips the pre-push milestone-
  // alignment gate red and wedges every push. Graceful-degrade on
  // ENOENT (genesis case: no prior file → no carry-forward).
  /** @type {Record<string, string>} */
  let priorRawValues = {};
  try {
    const priorContent = await fsReadFile(outputPath, "utf8");
    priorRawValues = extractPriorRawValues(priorContent);
  } catch (err) {
    if (!isEnoent(err)) throw err;
  }

  const markdown = runMetricsRender({
    metrics: SUCCESS_METRICS,
    snapshot,
    snapshotTimestampMs: dateToMidnightUtcMs(date),
    snapshotSource: `.minsky/metric-snapshots/${date}.json`,
    nowMs: Date.now(),
    proposedMetrics: PROPOSED_METRICS,
    priorRawValues,
  });

  await fsWriteFile(outputPath, markdown);
  process.stdout.write(`${outputPath}\n`);
  return 0;
}

/**
 * Discriminate ENOENT from other read errors. The CLI's prior-file load
 * graceful-degrades on missing-file (genesis), but any other error
 * (EACCES, EISDIR, …) propagates so the operator notices.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
function isEnoent(err) {
  if (!(err instanceof Error)) return false;
  const code = /** @type {NodeJS.ErrnoException} */ (err).code;
  return typeof code === "string" && code === "ENOENT";
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("metrics-render.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
