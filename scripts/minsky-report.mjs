#!/usr/bin/env node
// minsky-report — read .minsky/metric-snapshots/*.json and print
// the baseline (latest), the delta (latest vs prev), or a human-readable
// summary.
//
// Usage:
//   node scripts/minsky-report.mjs --baseline [--repo <path>]
//   node scripts/minsky-report.mjs --delta    [--repo <path>]
//   node scripts/minsky-report.mjs            [--repo <path>]
//
// Repo defaults to the current working directory. Snapshots live at
// `<repo>/.minsky/metric-snapshots/<YYYY-MM-DD>.json`. The "latest" is
// the file with the highest sortable filename.
//
// Source: M1 milestone exit criterion §7 (`minsky report --baseline /
// --delta`). Pattern: pure functions for the diff logic + thin CLI
// wrapper, matches the project's "I/O at the edge" idiom.
//
// Conformance: full — pure helpers `readSnapshots`,
// `pickLatestTwo`, `formatDelta`, `formatSummary` are exported for
// the unit tests in `scripts/minsky-report.test.mjs`. The CLI wrapper
// only does argv parsing + stdout writes.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @typedef {Object} MetricValue
 * @property {unknown} value
 * @property {boolean} [higherIsBetter]
 */

/**
 * @typedef {Object} Snapshot
 * @property {string} date
 * @property {Record<string, MetricValue>} data
 */

/**
 * Read all dated snapshots from the metric-snapshots dir.
 * Returns sorted oldest-first. Each entry is `{ date, data }`.
 * @param {string} repoRoot
 * @returns {Snapshot[]}
 */
export function readSnapshots(repoRoot) {
  const dir = join(repoRoot, ".minsky", "metric-snapshots");
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  return files.map((f) => ({
    date: f.replace(/\.json$/, ""),
    data: JSON.parse(readFileSync(join(dir, f), "utf8")),
  }));
}

/** Pick latest + previous from a sorted (oldest-first) snapshot list.
 *  Returns `{ latest, previous }` — `previous` may be undefined.
 *  @param {Snapshot[]} snapshots
 *  @returns {{ latest: Snapshot | undefined; previous: Snapshot | undefined }}
 */
export function pickLatestTwo(snapshots) {
  if (snapshots.length === 0) return { latest: undefined, previous: undefined };
  if (snapshots.length === 1) return { latest: snapshots[0], previous: undefined };
  return { latest: snapshots[snapshots.length - 1], previous: snapshots[snapshots.length - 2] };
}

/** Format one delta row for a single metric key — extracted from
 *  formatDelta to keep cognitive complexity ≤10. Callers guarantee
 *  at least one of `prev`/`cur` is defined (the row exists because
 *  the metric key appears in one of the two snapshots).
 *  @param {string} key
 *  @param {MetricValue | undefined} prev
 *  @param {MetricValue | undefined} cur
 *  @returns {string}
 */
function formatDeltaRow(key, prev, cur) {
  if (!prev && cur) return `  + ${key}: ${formatValue(cur.value)} (new)\n`;
  if (!cur && prev) return `  - ${key}: ${formatValue(prev.value)} (removed)\n`;
  if (!prev || !cur) return ""; // impossible per caller contract — defensive no-op
  if (sameValue(prev.value, cur.value)) {
    return `  → ${key}: ${formatValue(cur.value)} (same)\n`;
  }
  const arrow = directionArrow(prev.value, cur.value, cur.higherIsBetter);
  return `  ${arrow} ${key}: ${formatValue(prev.value)} → ${formatValue(cur.value)}\n`;
}

/** Format the delta between two snapshots as a human-readable list.
 *  Shows arrow direction per metric: ↑ (better) / ↓ (worse) / → (same)
 *  / + (new metric) / - (removed metric). Direction is interpreted
 *  using each metric's `higherIsBetter` field — falls back to "→" if
 *  values aren't numeric or differ in shape.
 *  @param {Snapshot | undefined} latest
 *  @param {Snapshot | undefined} previous
 *  @returns {string}
 */
export function formatDelta(latest, previous) {
  if (!latest) return "no snapshots available\n";
  if (!previous) {
    let out = `baseline-only (no previous snapshot to diff against): ${latest.date}\n`;
    for (const [k, v] of Object.entries(latest.data)) {
      out += `  + ${k}: ${formatValue(v.value)}\n`;
    }
    return out;
  }
  let out = `delta: ${previous.date} → ${latest.date}\n`;
  const allKeys = new Set([...Object.keys(latest.data), ...Object.keys(previous.data)]);
  for (const key of [...allKeys].sort()) {
    out += formatDeltaRow(key, previous.data[key], latest.data[key]);
  }
  return out;
}

/** Format a snapshot as a human-readable summary.
 *  @param {Snapshot | undefined} latest
 *  @returns {string}
 */
export function formatSummary(latest) {
  if (!latest) return "no snapshots available — run `pnpm metrics:collect` first\n";
  let out = `metrics snapshot — ${latest.date}\n`;
  out += `${"─".repeat(50)}\n`;
  for (const [k, v] of Object.entries(latest.data)) {
    const arrow = v.higherIsBetter ? "(higher better)" : "(lower better)";
    out += `  ${k.padEnd(28)} ${formatValue(v.value)} ${arrow}\n`;
  }
  return out;
}

/** Format any value for display — numbers stay numeric, strings pass
 *  through, undefined → "—".
 *  @param {unknown} v
 *  @returns {string}
 */
export function formatValue(v) {
  if (v === undefined || v === null) return "—";
  if (typeof v === "number") return String(v);
  return String(v);
}

/** Return the direction arrow for a metric change. Uses
 *  `higherIsBetter` to map up/down to ↑/↓. If either value isn't a
 *  number AND they differ as strings, returns "→" (changed but
 *  direction undefined).
 *  @param {unknown} prev
 *  @param {unknown} cur
 *  @param {boolean | undefined} higherIsBetter
 *  @returns {string}
 */
export function directionArrow(prev, cur, higherIsBetter) {
  // Try to extract numeric prefix for "string-with-units" cases like
  // "43.3% active days" or "16.6 commits/day".
  const prevN = extractNumber(prev);
  const curN = extractNumber(cur);
  if (prevN === undefined || curN === undefined || prevN === curN) return "→";
  const wentUp = curN > prevN;
  // XOR: arrow is up when the change matches the desired direction.
  return wentUp === higherIsBetter ? "↑" : "↓";
}

/** Extract the leading number from a value (handles strings like
 *  "43.3% active days"). Returns undefined when no number found.
 *  @param {unknown} v
 *  @returns {number | undefined}
 */
export function extractNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return undefined;
  const m = v.match(/-?\d+(\.\d+)?/);
  return m ? Number.parseFloat(m[0]) : undefined;
}

/** Same-value check with type tolerance — strings compared exact,
 *  numbers compared exact, deep-objects compared via JSON.
 *  @param {unknown} a
 *  @param {unknown} b
 *  @returns {boolean}
 */
export function sameValue(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

// ── CLI wrapper ───────────────────────────────────────────────

/**
 * @typedef {{ mode: "baseline" | "delta" | "summary"; repoRoot: string; help: boolean }} ReportCliOptions
 */

/** Apply one CLI flag at index `i` of `args` to the accumulator `acc`.
 *  Returns the new index (advanced past any value the flag consumes).
 *  Extracted from `parseArgs` to keep cognitive complexity ≤10
 *  (matches the pattern in `minsky-benchmark.mjs`).
 *  @param {string[]} args
 *  @param {number} i
 *  @param {ReportCliOptions} acc
 *  @returns {number}
 */
function applyReportFlag(args, i, acc) {
  switch (args[i]) {
    case "--baseline":
      acc.mode = "baseline";
      return i;
    case "--delta":
      acc.mode = "delta";
      return i;
    case "--repo":
      acc.repoRoot = args[i + 1] ?? acc.repoRoot;
      return i + 1;
    case "--help":
    case "-h":
      acc.help = true;
      return i;
    default:
      return i;
  }
}

/** Parse argv into `{ mode, repoRoot, help }`.
 *  @param {string[]} argv
 *  @returns {ReportCliOptions}
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  /** @type {ReportCliOptions} */
  const acc = { mode: "summary", repoRoot: process.cwd(), help: false };
  let i = 0;
  while (i < args.length) {
    i = applyReportFlag(args, i, acc) + 1;
  }
  return acc;
}

/**
 * @param {Snapshot | undefined} latest
 * @param {string} repoRoot
 * @returns {number}
 */
function runBaseline(latest, repoRoot) {
  if (!latest) {
    process.stderr.write(
      `minsky report: no snapshots in ${join(repoRoot, ".minsky", "metric-snapshots")}\n`,
    );
    return 1;
  }
  process.stdout.write(`${JSON.stringify(latest.data, null, 2)}\n`);
  return 0;
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
function main(argv) {
  const { mode, repoRoot, help } = parseArgs(argv);
  if (help) {
    process.stdout.write("Usage: minsky report [--baseline | --delta] [--repo <path>]\n");
    return 0;
  }
  const { latest, previous } = pickLatestTwo(readSnapshots(repoRoot));
  if (mode === "baseline") return runBaseline(latest, repoRoot);
  if (mode === "delta") {
    process.stdout.write(formatDelta(latest, previous));
    return 0;
  }
  process.stdout.write(formatSummary(latest));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv));
}
