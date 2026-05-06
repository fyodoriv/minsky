#!/usr/bin/env node
// <!-- scope: human-approved 2026-05-05 user request "audit itself after every task completion with that cto-ish level loop" — task `post-task-cto-audit` Measurement line. Promotes the two `gh pr list --label minsky:cto-audit ...` queries from prose in TASKS.md / docs/post-task-cto-audit.md into a versioned, paired-tested script so a typo in the query (a silent failure mode) becomes a test break instead of a 7-day zero-reading. -->
// Pattern: pure transforms (`formatDateUtcYmd`, `daysAgoUtc`, `parseGhCount`,
//   `formatReport`) composed with one injected I/O seam (`runGh`) above a thin
//   CLI — same shape as `changelog-snapshot.mjs` so the operator surface stays
//   uniform.
// Anchor: Munafò et al. 2017 (pre-registration discipline) — the success
//   threshold and pivot threshold are committed BEFORE the result is observed,
//   in TASKS.md `post-task-cto-audit` Measurement / Pivot. This script
//   evaluates that pre-registration deterministically; without it the operator
//   re-types a 200-char `gh` invocation each Friday and a typo silently
//   undercounts. Rule #2 (data-not-code: the threshold constants are typed and
//   exported so the report formatter and the tests share a single source).
// Conformance: full — pure transforms have no I/O; the orchestrator composes
//   the injected `runGh`; the CLI is the only `gh` call site.
// Pivot (rule #9): if the operator finds the report's "INSUFFICIENT-DATA"
//   verdict noisy in the first weeks (small n, ratio undefined), add a
//   `--quiet-until-n=N` flag — don't retire the script. The thresholds
//   themselves are pre-registered and not tunable here.

import { spawn } from "node:child_process";
import process from "node:process";

/** Pre-registered success threshold for rolling 7d audit-PR creation count.
 *  Source: TASKS.md `post-task-cto-audit` Measurement (≥1/week). Exported so
 *  the report formatter and the tests pin the same number. */
export const ROLLING_7D_MIN_CREATED = 1;

/** Pre-registered success threshold for rolling 28d ship-rate ratio.
 *  Source: TASKS.md `post-task-cto-audit` Measurement (≥0.30 = 30%). */
export const ROLLING_28D_MIN_SHIP_RATIO = 0.3;

/** Pre-registered audit PR label. Mirrors `CTO_AUDIT_PR_LABEL` in
 *  `novel/tick-loop/src/post-task-cto-audit.ts` and `CTO_AUDIT_LABEL` in
 *  `scripts/check-cto-audit-pr-conventions.mjs`. Drift on this constant
 *  silently zeroes the metric — pinned in tests on both sides. */
export const CTO_AUDIT_PR_LABEL = "minsky:cto-audit";

/**
 * Format a `Date` as a UTC `YYYY-MM-DD` string for use in `gh ... --search
 * "created:>YYYY-MM-DD"`. UTC chosen to match the supervisor's clock
 * conventions (the daemon emits spans in UTC) and to keep the `gh` query
 * stable across operator tz changes.
 *
 * @param {Date} date
 * @returns {string}
 */
export function formatDateUtcYmd(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Subtract `days` from `now`, returning a new `Date`. Pure helper exposed so
 * tests can pin the boundary dates the script feeds into `gh --search`.
 *
 * @param {Date} now
 * @param {number} days  positive integer
 * @returns {Date}
 */
export function daysAgoUtc(now, days) {
  if (!Number.isInteger(days) || days < 0) {
    throw new Error(`days must be a non-negative integer, got ${days}`);
  }
  const ms = now.getTime() - days * 24 * 60 * 60 * 1000;
  return new Date(ms);
}

/**
 * Parse `gh ... --json number` raw stdout (an array of `{number}` records)
 * and return its length. Throws on malformed JSON or non-array — the caller
 * wants a hard failure over silently writing `0` and masking a real `gh`
 * outage (matches `changelog-snapshot.mjs`'s parseGhCount contract).
 *
 * @param {string} raw
 * @returns {number}
 */
export function parseGhCount(raw) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("expected gh JSON output to be an array");
  }
  return parsed.length;
}

/**
 * @typedef {Object} MetricsReportInputs
 * @property {string} dateNow            UTC YMD on which the report was run
 * @property {string} date7dAgo          UTC YMD floor for the 7d window
 * @property {string} date28dAgo         UTC YMD floor for the 28d window
 * @property {number} created7d          PRs created with the audit label in the 7d window
 * @property {number} merged28d          PRs merged with the audit label in the 28d window
 * @property {number} created28d         PRs created with the audit label in the 28d window
 */

/**
 * Format a stable, human-readable report of the two pre-registered metrics.
 * Pure function — every dynamic input is in `inputs`, every constant is
 * pinned at module top so the test suite can compare against a frozen
 * fixture. The format is deliberately operator-friendly (3 columns: value,
 * threshold, verdict) rather than machine-parseable; downstream automation
 * should consume the queries directly via `runCtoAuditMetrics`.
 *
 * @param {MetricsReportInputs} inputs
 * @returns {string}
 */
export function formatReport(inputs) {
  const { dateNow, date7dAgo, date28dAgo, created7d, merged28d, created28d } = inputs;
  const ratio = created28d === 0 ? null : merged28d / created28d;
  const ratioCell =
    ratio === null
      ? `${merged28d}/${created28d} (n/a — no PRs in window)`
      : `${merged28d}/${created28d} (${ratio.toFixed(2)})`;
  const ratioVerdict =
    ratio === null ? "INSUFFICIENT-DATA" : ratio >= ROLLING_28D_MIN_SHIP_RATIO ? "OK" : "BELOW";
  const createdVerdict = created7d >= ROLLING_7D_MIN_CREATED ? "OK" : "BELOW";

  return [
    "CTO-audit pre-registered metrics (anchor: TASKS.md `post-task-cto-audit` Measurement)",
    `Run at ${dateNow}Z; label = \`${CTO_AUDIT_PR_LABEL}\``,
    "",
    `Rolling 7d (PRs created with the label, window > ${date7dAgo}):`,
    `  Value:     ${created7d}`,
    `  Threshold: >= ${ROLLING_7D_MIN_CREATED}`,
    `  Verdict:   ${createdVerdict}`,
    "",
    `Rolling 28d ship-rate (merged / created with the label, window > ${date28dAgo}):`,
    `  Value:     ${ratioCell}`,
    `  Threshold: >= ${ROLLING_28D_MIN_SHIP_RATIO.toFixed(2)}`,
    `  Verdict:   ${ratioVerdict}`,
    "",
    "Hard-pivot trigger: 4 consecutive weeks of `Rolling 7d Verdict = BELOW` with no shipped audit PR.",
    "See docs/post-task-cto-audit.md for the prompt-tuning escape hatches before that trigger fires.",
    "",
  ].join("\n");
}

/**
 * @typedef {(args: ReadonlyArray<string>) => Promise<string>} GhRunner
 *   Async runner returning stdout from `gh <args…>`. Tests inject a stub;
 *   the production binding shells out to the real `gh`.
 */

/**
 * @typedef {Object} CtoAuditMetricsResult
 * @property {string} report  the formatted, human-readable report (stdout content)
 * @property {number} created7d
 * @property {number} merged28d
 * @property {number} created28d
 */

/**
 * Top-level orchestrator: derive the date windows from `clock`, fire the
 * three `gh` calls in parallel (independent — `Promise.all`), parse, and
 * format. Returns both the report string and the raw counts so callers
 * (tests, future automation) can branch on them without re-parsing the
 * report.
 *
 * @param {{ clock: () => Date, runGh: GhRunner }} opts
 * @returns {Promise<CtoAuditMetricsResult>}
 */
export async function runCtoAuditMetrics({ clock, runGh }) {
  const now = clock();
  const dateNow = formatDateUtcYmd(now);
  const date7dAgo = formatDateUtcYmd(daysAgoUtc(now, 7));
  const date28dAgo = formatDateUtcYmd(daysAgoUtc(now, 28));

  const labelArgs = ["--label", CTO_AUDIT_PR_LABEL];
  const jsonArgs = ["--json", "number"];

  const [created7dRaw, merged28dRaw, created28dRaw] = await Promise.all([
    runGh([
      "pr",
      "list",
      ...labelArgs,
      "--state",
      "all",
      "--search",
      `created:>${date7dAgo}`,
      ...jsonArgs,
    ]),
    runGh([
      "pr",
      "list",
      ...labelArgs,
      "--state",
      "merged",
      "--search",
      `merged:>${date28dAgo}`,
      ...jsonArgs,
    ]),
    runGh([
      "pr",
      "list",
      ...labelArgs,
      "--state",
      "all",
      "--search",
      `created:>${date28dAgo}`,
      ...jsonArgs,
    ]),
  ]);

  const created7d = parseGhCount(created7dRaw);
  const merged28d = parseGhCount(merged28dRaw);
  const created28d = parseGhCount(created28dRaw);

  const report = formatReport({
    dateNow,
    date7dAgo,
    date28dAgo,
    created7d,
    merged28d,
    created28d,
  });

  return { report, created7d, merged28d, created28d };
}

// ---- CLI thin wrapper -----------------------------------------------------

/** @type {GhRunner} */
function spawnGh(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", [...args], { stdio: ["ignore", "pipe", "pipe"] });
    /** @type {Buffer[]} */ const out = [];
    /** @type {Buffer[]} */ const err = [];
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => err.push(c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(out).toString("utf8"));
      } else {
        reject(
          new Error(`gh ${args.join(" ")} exited ${code}: ${Buffer.concat(err).toString("utf8")}`),
        );
      }
    });
  });
}

async function main() {
  const result = await runCtoAuditMetrics({ clock: () => new Date(), runGh: spawnGh });
  process.stdout.write(result.report);
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("cto-audit-metrics.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
