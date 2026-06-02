#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved per TASKS.md `readme-honest-3-developer-user-test` Details (f) "Build scripts/user-test-results.mjs to parse the per-developer test files and emit the median-time + success-rate metric (the measurement command)." -->
//
// user-test-results — aggregator for the M1.11 honest-README user test.
//
// MILESTONES.md M1.11 requires that 3 developers who've never seen Minsky
// can go from `git clone` to first iteration in <5 min reading time, using
// only the README. This script is the MEASUREMENT half of that criterion: it
// parses the per-developer report files under `docs/user-tests/*.md` and
// emits the success-rate + median-time-to-first-iteration metric the task's
// `**Measurement**` field names:
//
//   node scripts/user-test-results.mjs --window=30d --json \
//     | jq '.successful_runs >= 3 && .median_time_minutes <= 5'
//
// This is the preparation half of the preparation-PR pattern: the script ships
// FIRST so that when the 3 human developers run the test, their reports drop
// into `docs/user-tests/` and this command immediately produces the M1.11
// pass/fail number. Until ≥3 real reports land, the aggregator honestly
// reports the current run count (the M1.11 criterion stays `🟡 partial`).
//
// Pattern: pure data-shape transforms (`parseReport`, `aggregateResults`)
//   composed with one I/O seam (`readReports`) above a thin CLI — same shape
//   as `changelog-snapshot.mjs`. Conformance: full — the transforms have no
//   I/O; the I/O lives in `defaultReadReports` and is replaceable via DI for
//   the paired tests.
// Anchor: MILESTONES.md M1.11 acceptance; Nielsen 1993 *Usability Engineering*
//   (5 users uncover ~85% of usability issues — 3 surface the most-likely
//   blockers fast); vision.md rule #3 (the user test IS the validation of
//   M1.11's claim) + rule #4 (everything measurable — the user-test outcome
//   becomes a parseable number, not prose).
// Pivot (rule #9): if the markdown-metadata-block shape proves too brittle for
//   real developers to fill in (they free-write instead), pivot the report
//   format to a tiny YAML front-matter block rather than retiring the
//   aggregator — the (dir → reports → metric) pipeline is the contract.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** Default location of the per-developer report files. */
export const DEFAULT_REPORTS_DIR = join(REPO_ROOT, "docs", "user-tests");

/** Report files in the dir that are NOT developer reports (methodology, etc.). */
const NON_REPORT_BASENAMES = Object.freeze(new Set(["README.md", "template.md"]));

/**
 * @typedef {"success" | "fail" | "blocked"} Outcome
 *
 * - `success` — the developer reached first iteration following only the README.
 * - `fail`    — the developer could not finish (timed out, gave up).
 * - `blocked` — the developer needed operator help mid-flow (M1.11 disqualifier).
 */

/**
 * @typedef {object} UserTestReport
 * @property {string} initials      developer initials (report identity)
 * @property {string} date          ISO date (YYYY-MM-DD) of the run
 * @property {number} timeMinutes   wall-clock minutes from clone → first iteration
 * @property {Outcome} outcome      success / fail / blocked
 * @property {boolean} neededHelp   true if the developer required operator help
 * @property {string} sourceFile    repo-relative path the report came from
 */

/**
 * @typedef {object} Aggregate
 * @property {string} window           the `--window` value echoed back
 * @property {number} total_runs       count of parsed reports in window
 * @property {number} successful_runs  count of `outcome: success` runs
 * @property {number} failed_runs      count of `outcome: fail` runs
 * @property {number} blocked_runs     count of `outcome: blocked` runs
 * @property {number | null} median_time_minutes  median time over SUCCESS runs (null when none)
 * @property {boolean} m1_11_pass      true iff ≥3 successful runs AND median ≤5 min
 * @property {string[]} runs           one-line summary per parsed report
 */

/**
 * Parse one developer-report markdown file's metadata block into a typed
 * record. The block is a bullet list of `**Field**: value` lines (the same
 * shape TASKS.md uses), authored from `docs/user-tests/template.md`:
 *
 *   - **Developer**: AB
 *   - **Date**: 2026-06-15
 *   - **Time to first iteration (minutes)**: 4
 *   - **Outcome**: success
 *   - **Needed operator help**: no
 *
 * Throws on a missing or unparseable required field — a half-filled report is
 * worse than no report (it would silently skew the median). The caller decides
 * whether to skip-and-warn or hard-fail (the CLI skips, recording the reason).
 *
 * @param {string} markdown    file contents
 * @param {string} sourceFile  repo-relative path (for error messages)
 * @returns {UserTestReport}
 */
export function parseReport(markdown, sourceFile) {
  const initials = requireField(markdown, "Developer", sourceFile);
  const date = requireField(markdown, "Date", sourceFile);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`${sourceFile}: **Date** must be ISO YYYY-MM-DD, got "${date}"`);
  }
  const timeRaw = requireField(markdown, "Time to first iteration (minutes)", sourceFile);
  const timeMinutes = Number.parseFloat(timeRaw);
  if (!Number.isFinite(timeMinutes) || timeMinutes < 0) {
    throw new Error(
      `${sourceFile}: **Time to first iteration (minutes)** must be a non-negative number, got "${timeRaw}"`,
    );
  }
  const outcome = parseOutcome(requireField(markdown, "Outcome", sourceFile), sourceFile);
  const neededHelp = parseYesNo(
    requireField(markdown, "Needed operator help", sourceFile),
    sourceFile,
  );
  return { initials, date, timeMinutes, outcome, neededHelp, sourceFile };
}

/**
 * @param {string} markdown
 * @param {string} field
 * @param {string} sourceFile
 * @returns {string}
 */
function requireField(markdown, field, sourceFile) {
  const value = readField(markdown, field);
  if (value === undefined) {
    throw new Error(`${sourceFile}: missing required field **${field}**`);
  }
  return value;
}

/**
 * Read a `**Field**: value` metadata line. Field names with regex-special
 * characters (parentheses in "Time to first iteration (minutes)") are escaped
 * before being interpolated, so the matcher is literal.
 *
 * @param {string} markdown
 * @param {string} field
 * @returns {string | undefined}
 */
function readField(markdown, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*-?\\s*\\*\\*${escaped}\\*\\*:\\s*(.+?)\\s*$`, "im");
  const m = re.exec(markdown);
  return m && m[1] !== undefined ? m[1].trim() : undefined;
}

/**
 * @param {string} raw
 * @param {string} sourceFile
 * @returns {Outcome}
 */
function parseOutcome(raw, sourceFile) {
  const norm = raw.toLowerCase();
  if (norm === "success" || norm === "fail" || norm === "blocked") return norm;
  throw new Error(`${sourceFile}: **Outcome** must be one of success|fail|blocked, got "${raw}"`);
}

/**
 * @param {string} raw
 * @param {string} sourceFile
 * @returns {boolean}
 */
function parseYesNo(raw, sourceFile) {
  const norm = raw.toLowerCase();
  if (norm === "yes" || norm === "true") return true;
  if (norm === "no" || norm === "false") return false;
  throw new Error(`${sourceFile}: **Needed operator help** must be yes|no, got "${raw}"`);
}

/**
 * Compute the median of a numeric list. Returns null for an empty list (no
 * runs → no median; the caller renders this honestly rather than as 0, which
 * would falsely look like an instant install). Pure.
 *
 * @param {readonly number[]} xs
 * @returns {number | null}
 */
export function median(xs) {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  if (sorted.length % 2 === 1) return hi ?? null;
  if (lo === undefined || hi === undefined) return null;
  return (lo + hi) / 2;
}

/**
 * Filter reports to those whose `date` falls within `windowDays` of `now`.
 * `windowDays === Infinity` keeps everything (the `--window=all` escape hatch).
 * Pure — `now` is injected so the test is deterministic.
 *
 * @param {readonly UserTestReport[]} reports
 * @param {number} windowDays
 * @param {Date} now
 * @returns {UserTestReport[]}
 */
export function withinWindow(reports, windowDays, now) {
  if (!Number.isFinite(windowDays)) return [...reports];
  const cutoffMs = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  return reports.filter((r) => {
    const t = Date.parse(`${r.date}T00:00:00Z`);
    return Number.isFinite(t) && t >= cutoffMs;
  });
}

/**
 * Aggregate a set of reports into the M1.11 metric. A run counts as
 * `successful` only when `outcome === "success"` AND the developer did NOT
 * need operator help (M1.11's Success criterion is explicit: "Zero blocking
 * issues that require operator clarification mid-flow"). The median is computed
 * over the SUCCESS runs only — a failed/timed-out run has no meaningful
 * time-to-first-iteration to fold into the central tendency. Pure.
 *
 * @param {readonly UserTestReport[]} reports
 * @param {string} window  the `--window` value to echo into the output
 * @returns {Aggregate}
 */
export function aggregateResults(reports, window) {
  const successRuns = reports.filter((r) => r.outcome === "success" && !r.neededHelp);
  const failedRuns = reports.filter((r) => r.outcome === "fail");
  const blockedRuns = reports.filter((r) => r.outcome === "blocked" || r.neededHelp);
  const medianTime = median(successRuns.map((r) => r.timeMinutes));
  const m1_11_pass = successRuns.length >= 3 && medianTime !== null && medianTime <= 5;
  return {
    window,
    total_runs: reports.length,
    successful_runs: successRuns.length,
    failed_runs: failedRuns.length,
    blocked_runs: blockedRuns.length,
    median_time_minutes: medianTime,
    m1_11_pass,
    runs: reports.map(
      (r) =>
        `${r.date} ${r.initials}: ${r.outcome} (${r.timeMinutes} min, help=${r.neededHelp ? "yes" : "no"})`,
    ),
  };
}

/**
 * @typedef {object} RawReport
 * @property {string} contents     file contents
 * @property {string} sourceFile   repo-relative path
 */

/**
 * I/O seam: read every developer report under `dir`, skipping the methodology
 * README and template. Returns `{ contents, sourceFile }` pairs — parsing is
 * the caller's pure concern. A missing directory yields an empty list (no
 * reports yet is a valid, honest state, not a crash) — the only swallowed I/O,
 * justified inline per rule #6.
 *
 * @param {string} dir
 * @returns {RawReport[]}
 */
export function defaultReadReports(dir) {
  /** @type {string[]} */
  let entries;
  try {
    entries = readdirSync(dir);
    // rule-6: handled-locally — a missing docs/user-tests dir means "no
    // reports filed yet", which is a legitimate pre-test state, not a bug.
    // Any other readdir error (permissions) is genuinely exceptional and is
    // re-thrown so the operator sees it loudly.
  } catch (err) {
    if (err && /** @type {{ code?: string }} */ (err).code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((name) => name.endsWith(".md") && !NON_REPORT_BASENAMES.has(name))
    .sort()
    .map((name) => ({
      contents: readFileSync(join(dir, name), "utf8"),
      sourceFile: join("docs", "user-tests", name),
    }));
}

/**
 * Orchestration: read → parse → window-filter → aggregate. Reports that fail
 * to parse are skipped, and the reason is collected into `warnings` so the
 * operator sees which report is malformed without the whole run crashing
 * (one half-filled report shouldn't hide three good ones). Pure over the
 * injected `readReports` seam + `now`.
 *
 * @param {object} opts
 * @param {string} opts.dir
 * @param {number} opts.windowDays
 * @param {string} opts.windowLabel
 * @param {(dir: string) => RawReport[]} [opts.readReports]
 * @param {Date} [opts.now]
 * @returns {{ aggregate: Aggregate, warnings: string[] }}
 */
export function runUserTestResults(opts) {
  const readReports = opts.readReports ?? defaultReadReports;
  const now = opts.now ?? new Date();
  const raw = readReports(opts.dir);
  /** @type {UserTestReport[]} */
  const parsed = [];
  /** @type {string[]} */
  const warnings = [];
  for (const { contents, sourceFile } of raw) {
    try {
      parsed.push(parseReport(contents, sourceFile));
    } catch (err) {
      warnings.push(err instanceof Error ? err.message : String(err));
    }
  }
  const inWindow = withinWindow(parsed, opts.windowDays, now);
  return { aggregate: aggregateResults(inWindow, opts.windowLabel), warnings };
}

// --------------------------------------------------------------- CLI -------

/**
 * Parse `--window=<N>d` / `--window=all` and `--json`. `30d` → 30 days; `all`
 * → Infinity (every report). Pure.
 *
 * @param {readonly string[]} argv
 * @returns {{ windowDays: number, windowLabel: string, json: boolean }}
 */
export function parseArgs(argv) {
  let windowDays = 30;
  let windowLabel = "30d";
  let json = false;
  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    const m = /^--window=(all|\d+)d?$/.exec(arg);
    if (m && m[1] !== undefined) {
      windowLabel = arg.slice("--window=".length);
      windowDays = m[1] === "all" ? Number.POSITIVE_INFINITY : Number.parseInt(m[1], 10);
    }
  }
  return { windowDays, windowLabel, json };
}

/**
 * @param {Aggregate} agg
 * @param {readonly string[]} warnings
 * @returns {string}
 */
export function renderHuman(agg, warnings) {
  const lines = [];
  lines.push(`user-test-results window=${agg.window}`);
  lines.push(`  total runs:      ${agg.total_runs}`);
  lines.push(`  successful:      ${agg.successful_runs}`);
  lines.push(`  failed:          ${agg.failed_runs}`);
  lines.push(`  blocked/helped:  ${agg.blocked_runs}`);
  lines.push(
    `  median time:     ${agg.median_time_minutes === null ? "n/a (no success runs)" : `${agg.median_time_minutes} min`}`,
  );
  lines.push(
    `  M1.11 pass:      ${agg.m1_11_pass ? "yes" : "no (need ≥3 success runs, median ≤5 min)"}`,
  );
  for (const r of agg.runs) lines.push(`    - ${r}`);
  for (const w of warnings) lines.push(`  [skipped] ${w}`);
  return lines.join("\n");
}

function main() {
  const { windowDays, windowLabel, json } = parseArgs(process.argv.slice(2));
  const { aggregate, warnings } = runUserTestResults({
    dir: DEFAULT_REPORTS_DIR,
    windowDays,
    windowLabel,
  });
  if (json) {
    // The Measurement command pipes this to jq:
    //   jq '.successful_runs >= 3 && .median_time_minutes <= 5'
    process.stdout.write(`${JSON.stringify(aggregate)}\n`);
  } else {
    process.stdout.write(`${renderHuman(aggregate, warnings)}\n`);
    for (const w of warnings) process.stderr.write(`[user-test-results] ${w}\n`);
  }
  // Exit 0 always — this is a measurement reporter, not a gate. The M1.11
  // verdict lives in the `m1_11_pass` field; the milestone-alignment lint and
  // the operator read it, but a not-yet-passing user test must not break the
  // build (the criterion is honestly `🟡 partial` until 3 developers run it).
  process.exit(0);
}

const invokedAsScript =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main();
}
