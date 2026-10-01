#!/usr/bin/env node
// @ts-check
// audit-pass-empty-queue-coverage — the "comes up with tasks between ticks"
// pillar made falsifiable.
//
// Rule #17 (proactive heal) makes agents author tasks INSIDE iterations. But
// when the queue empties the daemon used to idle, waiting for the operator —
// the BETWEEN-tick half of the "comes up with tasks" vision pillar was missing.
// `novel/tick-loop/src/audit-pass-trigger.ts` closes the loop: on a
// `pickHostTask → null` tick the daemon runs an audit pass and seeds the next
// ticks, appending one `AuditPassTickEvent` to
// `.minsky/experiment-store/audit-pass/*.jsonl` per tick. This script reads
// those events and computes the Measurement the task block pre-registered:
//
//   { "empty_queue_ticks": N, "audit_pass_invocations": N,
//     "new_tasks_produced": M, "idle_to_next_task_p50_minutes": X }
//
// with the pre-registered Success thresholds: empty_queue_ticks ==
// audit_pass_invocations (the daemon invokes an audit on EVERY empty-queue
// tick) and idle_to_next_task_p50_minutes < 5 (the daemon never idles for long
// on a non-trivially-empty repo).
//
// Usage:
//   node scripts/audit-pass-empty-queue-coverage.mjs [--window=10ticks]
//        [--store PATH] [--json] [--strict] [--help]
//
// Defaults: --window=all (every event in the store), store
// `.minsky/experiment-store/audit-pass`, human-readable summary on stdout.
// `--window=Nticks` keeps only the most-recent N events. `--json` emits the
// Measurement object. `--strict` exits 1 when the Success thresholds are not
// met (for CI / a future ratchet); without it the script exits 0 and reports.
//
// Pattern: pure aggregator + thin CLI wrapper (matches
// scripts/throughput-benchmark.mjs / scripts/lib/iteration-ship-rate.mjs).
// Conformance: full — `parseTickEvents`, `selectWindow`, `computeCoverage`,
// `percentile`, `formatCoverageSummary`, `parseArgs`, `parseWindow` are all
// exported and unit-tested in scripts/audit-pass-empty-queue-coverage.test.mjs.
// Source: TASKS.md `autonomous-task-authoring-between-ticks`; the operator's
//   "comes up with tasks" vision directive; user-stories/021-autonomous-task-
//   authoring.md; vision.md rule #12 (scope discipline) + rule #17 (proactive
//   heal); MAPE-K (Kephart & Chess 2003 — Plan synthesises actions); Ries 2011
//   (falsifiable pre-registered metric, not a vanity count); Munafò et al. 2017
//   (pre-registration).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");

/** Default JSONL store the daemon appends `AuditPassTickEvent`s to. */
export const DEFAULT_STORE_DIR = ".minsky/experiment-store/audit-pass";

/**
 * Pre-registered Success threshold (task block): the idle→next-task p50 must be
 * under this many minutes once the audit pass is feeding the queue. Below this
 * the daemon "never idles for >1h on a non-trivially-empty repo".
 */
export const IDLE_TO_NEXT_TASK_P50_THRESHOLD_MINUTES = 5;

/**
 * @typedef {Object} TickEvent
 * @property {string} ts
 * @property {boolean} emptyQueue
 * @property {boolean} auditPassInvoked
 * @property {number} newTasksProduced
 * @property {number | null} idleToNextTaskMinutes
 */

/**
 * @typedef {Object} CoverageReport
 * @property {number} empty_queue_ticks
 * @property {number} audit_pass_invocations
 * @property {number} new_tasks_produced
 * @property {number | null} idle_to_next_task_p50_minutes
 * @property {boolean} success
 */

/**
 * Parse JSONL text into tick events, skipping blank / unparseable / shape-
 * invalid lines. Pure. A corrupt line is dropped (graceful-degrade, rule #6) —
 * one bad append must not poison the whole coverage read.
 *
 * @param {string} text raw JSONL file contents
 * @returns {TickEvent[]}
 */
export function parseTickEvents(text) {
  /** @type {TickEvent[]} */
  const out = [];
  for (const line of text.split("\n")) {
    const event = parseTickLine(line);
    if (event !== null) out.push(event);
  }
  return out;
}

/**
 * Parse a single JSONL line into a tick event, or `null` if it's blank,
 * unparseable, or shape-invalid (graceful-degrade, rule #6 — never throw).
 *
 * @param {string} line
 * @returns {TickEvent | null}
 */
function parseTickLine(line) {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let obj;
  try {
    obj = JSON.parse(trimmed);
    // graceful-degrade: a malformed line is dropped, never thrown.
  } catch {
    return null;
  }
  if (!isTickEventShape(obj)) return null;
  const idle = obj.idleToNextTaskMinutes;
  return {
    ts: obj.ts,
    emptyQueue: Boolean(obj.emptyQueue),
    auditPassInvoked: Boolean(obj.auditPassInvoked),
    newTasksProduced: Number(obj.newTasksProduced) || 0,
    idleToNextTaskMinutes: idle === null || idle === undefined ? null : Number(idle),
  };
}

/**
 * @param {unknown} obj
 * @returns {obj is { ts: string, emptyQueue?: unknown, auditPassInvoked?: unknown, newTasksProduced?: unknown, idleToNextTaskMinutes?: unknown }}
 */
function isTickEventShape(obj) {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof (/** @type {Record<string, unknown>} */ (obj)["ts"]) === "string"
  );
}

/**
 * Keep only the most-recent `n` events (the `--window=Nticks` tail). `n <= 0`
 * or non-finite means "all events". Pure.
 *
 * @param {readonly TickEvent[]} events
 * @param {number} n
 * @returns {TickEvent[]}
 */
export function selectWindow(events, n) {
  if (!Number.isFinite(n) || n <= 0) return [...events];
  return events.slice(Math.max(0, events.length - Math.floor(n)));
}

/**
 * Linear-interpolation percentile over a numeric sample. Returns `null` for an
 * empty sample (never `NaN`/`Infinity` — rule #6). `p` is in [0, 1]. Pure.
 *
 * @param {readonly number[]} values
 * @param {number} p
 * @returns {number | null}
 */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const loV = sorted[lo] ?? 0;
  const hiV = sorted[hi] ?? loV;
  if (lo === hi) return loV;
  const frac = rank - lo;
  return loV + (hiV - loV) * frac;
}

/**
 * Compute the pre-registered Measurement object from a window of tick events.
 * Pure — no I/O, deterministic. `success` is the AND of the two pre-registered
 * Success thresholds: (a) every empty-queue tick invoked an audit pass
 * (empty_queue_ticks == audit_pass_invocations) AND (b) the idle→next-task p50
 * is under the threshold (or there is not yet an idle measurement, in which
 * case (b) is vacuously satisfied — INSUFFICIENT-DATA never fails the gate).
 *
 * @param {readonly TickEvent[]} events
 * @returns {CoverageReport}
 */
export function computeCoverage(events) {
  const emptyTicks = events.filter((e) => e.emptyQueue);
  const empty_queue_ticks = emptyTicks.length;
  const audit_pass_invocations = emptyTicks.filter((e) => e.auditPassInvoked).length;
  const new_tasks_produced = emptyTicks.reduce((sum, e) => sum + e.newTasksProduced, 0);
  const idleSamples = emptyTicks
    .map((e) => e.idleToNextTaskMinutes)
    .filter((m) => /** @type {number | null} */ (m) !== null)
    .map((m) => /** @type {number} */ (m));
  const idle_to_next_task_p50_minutes = percentile(idleSamples, 0.5);

  const everyEmptyTickAudited =
    empty_queue_ticks > 0 && empty_queue_ticks === audit_pass_invocations;
  const idleUnderThreshold =
    idle_to_next_task_p50_minutes === null ||
    idle_to_next_task_p50_minutes < IDLE_TO_NEXT_TASK_P50_THRESHOLD_MINUTES;
  const success = everyEmptyTickAudited && idleUnderThreshold;

  return {
    empty_queue_ticks,
    audit_pass_invocations,
    new_tasks_produced,
    idle_to_next_task_p50_minutes,
    success,
  };
}

/**
 * Render the coverage report as the operator-facing summary.
 *
 * @param {CoverageReport} report
 * @returns {string}
 */
export function formatCoverageSummary(report) {
  const p50 =
    report.idle_to_next_task_p50_minutes === null
      ? "(insufficient data)"
      : `${report.idle_to_next_task_p50_minutes.toFixed(2)} min`;
  const lines = [
    "─── audit-pass empty-queue coverage ───",
    `empty-queue ticks:        ${report.empty_queue_ticks}`,
    `audit-pass invocations:   ${report.audit_pass_invocations}`,
    `new tasks produced:       ${report.new_tasks_produced}`,
    `idle→next-task p50:       ${p50}`,
    `verdict:                  ${report.success ? "PASS" : "BELOW"}`,
    "───────────────────────────────────────",
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Parse a `--window` spec: `Nticks` → N, `all` (or absent) → 0 (= all events).
 *
 * @param {string | undefined} raw
 * @returns {number}
 */
export function parseWindow(raw) {
  if (raw === undefined || raw === "all") return 0;
  const m = /^(\d+)ticks$/.exec(raw);
  if (m) return Number.parseInt(m[1] ?? "0", 10);
  const bare = Number.parseInt(raw, 10);
  return Number.isFinite(bare) && bare > 0 ? bare : 0;
}

/**
 * @typedef {Object} CliOptions
 * @property {string} windowRaw
 * @property {string | undefined} store
 * @property {boolean} json
 * @property {boolean} strict
 * @property {boolean} help
 */

/**
 * Apply one bare boolean flag to the accumulator. Returns true if `a` was a
 * recognised boolean flag (so the caller skips the value-flag branches).
 *
 * @param {string} a
 * @param {CliOptions} acc
 * @returns {boolean}
 */
function applyBooleanFlag(a, acc) {
  if (a === "--help" || a === "-h") acc.help = true;
  else if (a === "--json") acc.json = true;
  else if (a === "--strict") acc.strict = true;
  else return false;
  return true;
}

/**
 * Apply one value flag (`--window=…`, `--store=…`, `--store <v>`) to the
 * accumulator. Returns the index of the LAST arg consumed (advances past a
 * separate-token value).
 *
 * @param {readonly string[]} args
 * @param {number} i
 * @param {CliOptions} acc
 * @returns {number}
 */
function applyValueFlag(args, i, acc) {
  const a = args[i] ?? "";
  if (a.startsWith("--window=")) acc.windowRaw = a.slice("--window=".length);
  else if (a.startsWith("--store=")) acc.store = a.slice("--store=".length);
  else if (a === "--store") {
    acc.store = args[i + 1] ?? undefined;
    return i + 1;
  }
  return i;
}

/**
 * @param {readonly string[]} argv
 * @returns {CliOptions}
 */
export function parseArgs(argv) {
  const args = argv.slice(2);
  /** @type {CliOptions} */
  const acc = { windowRaw: "all", store: undefined, json: false, strict: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (applyBooleanFlag(a, acc)) continue;
    i = applyValueFlag(args, i, acc);
  }
  return acc;
}

/**
 * Read every `*.jsonl` file under the store dir and concatenate their parsed
 * events in lexical filename order (timestamped filenames sort chronologically).
 *
 * @param {string} storeDir
 * @returns {TickEvent[]}
 */
function readStore(storeDir) {
  if (!existsSync(storeDir)) return [];
  const files = readdirSync(storeDir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();
  /** @type {TickEvent[]} */
  const events = [];
  for (const f of files) {
    events.push(...parseTickEvents(readFileSync(join(storeDir, f), "utf8")));
  }
  return events;
}

/**
 * @param {string} p
 * @param {string} root
 * @returns {string}
 */
function resolveUnderRoot(p, root) {
  return isAbsolute(p) ? p : resolve(root, p);
}

function printUsage() {
  process.stdout.write(
    [
      "Usage: node scripts/audit-pass-empty-queue-coverage.mjs [options]",
      "",
      "  --window=Nticks   keep only the most-recent N tick events (default: all)",
      "  --store PATH      JSONL store dir (default: .minsky/experiment-store/audit-pass)",
      "  --json            emit the Measurement object as JSON",
      "  --strict          exit 1 when the Success thresholds are not met",
      "  --help            show this message",
      "",
    ].join("\n"),
  );
}

/**
 * @param {readonly string[]} argv
 * @returns {number} process exit code
 */
function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printUsage();
    return 0;
  }
  const storeDir = resolveUnderRoot(opts.store ?? DEFAULT_STORE_DIR, REPO_ROOT);
  const window = parseWindow(opts.windowRaw);
  const events = selectWindow(readStore(storeDir), window);
  const report = computeCoverage(events);
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatCoverageSummary(report));
    process.stdout.write(`  store:                  ${storeDir}\n`);
  }
  if (opts.strict && !report.success) return 1;
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv));
}
