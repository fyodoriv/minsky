#!/usr/bin/env node
// <!-- scope: TASKS.md `daemon-pre-pr-lint-gate` Measurement — promotes the
//   rolling-30d pass-rate query from prose in the task block + duplicated
//   inside `scripts/self-diagnose.mjs`'s `daemonPrLintPassRateInvariant` into
//   a versioned, paired-tested operator-facing script. Same shape as
//   `scripts/cto-audit-metrics.mjs`. Without this, the task block's
//   measurement command (`gh pr list --author "@minsky-bot" ...`) does not
//   match any PR in the repo (all PRs are authored by the operator account)
//   and the pre-registered metric is unmeasurable — exactly the "post-hoc
//   metric" failure mode rule #9 forbids. -->
// Pattern: pure transforms (`formatDateUtcYmd`, `daysAgoUtc`, `parsePrList`,
//   `computeStats`, `formatReport`) composed with one injected I/O seam
//   (`runGh`) above a thin CLI — same shape as `cto-audit-metrics.mjs` so
//   the operator surface stays uniform.
// Anchor: Munafò et al. 2017 (pre-registration discipline). The success
//   threshold (≥0.80) and the minimum-window size (≥10 PRs) are committed in
//   TASKS.md `daemon-pre-pr-lint-gate` before the result is observed; this
//   script evaluates them deterministically. Rule #2 (data-not-code: the
//   threshold constants are exported so the report formatter, the tests,
//   and the self-diagnose invariant share a single source).
// Conformance: full — pure transforms have no I/O; the orchestrator composes
//   the injected `runGh`; the CLI is the only `gh` call site.
// Pivot (rule #9 + TASKS.md `daemon-pre-pr-lint-gate` Pivot): if the
//   full-stage stack ever exceeds 5 min on a daemon iteration, pivot to a
//   staged gate (fast lints pre-PR, slow lints CI-only). This script does
//   not enforce that pivot — it reports the metric the pivot keys off.

import { spawn } from "node:child_process";
import process from "node:process";

/** Pre-registered success threshold for rolling 30d pass-rate.
 *  Source: TASKS.md `daemon-pre-pr-lint-gate` Measurement (≥80%). Mirrored
 *  in `scripts/self-diagnose.mjs` as `minPassRate` (default 0.8). */
export const ROLLING_30D_MIN_PASS_RATE = 0.8;

/** Minimum PR count before the ratio is meaningful. Mirrored in
 *  `scripts/self-diagnose.mjs` as `windowMinPrs` (default 10). Below this
 *  the ratio is too noisy and the verdict is INSUFFICIENT-DATA — not OK,
 *  not BELOW. */
export const ROLLING_30D_MIN_N = 10;

/** Width of the rolling window in days. Imported by self-diagnose
 *  (`recentDaemonPrs` + `daemonPrLintPassRateInvariant`) so the metric
 *  script, the invariant, and the task block can never disagree on the
 *  window size. */
export const ROLLING_WINDOW_DAYS = 30;

/** Canonical GitHub repo `owner/name` for the daemon's PRs. Pinned here
 *  (rather than relying on `gh`'s `origin`-based inference) because the
 *  cross-repo-runner integration tests have been observed to mutate the
 *  parent checkout's `origin` URL — pollution that silently zeroes the
 *  metric's PR set (`gh pr list --author @me` returns `[]` against a
 *  repo nobody pushed to). With `-R CANONICAL_REPO` threaded into the
 *  args helper, the metric and the self-diagnose invariant survive any
 *  remote-URL drift in the operator's checkout. Mirrors `gh pr view -R`
 *  flag from supervisor iteration 88 where the operator pushed via
 *  explicit-repo HTTPS for the same reason. Slice 14 of
 *  `daemon-pre-pr-lint-gate`. */
export const CANONICAL_REPO = "fyodoriv/minsky";

/** `gh pr list --limit` cap. The naive `--limit 100` query times out at
 *  GitHub's GraphQL gateway (HTTP 504/502) because expanding
 *  `statusCheckRollup` for ~100 PRs × ~30 checks each blows past the
 *  per-request budget — empirically observed at this repo's PR volume on
 *  2026-05-06 (slice 14 dogfood). 50 is the largest cap that returns
 *  reliably and still leaves the n≥10 threshold (`ROLLING_30D_MIN_N`)
 *  satisfiable. Sampling the most-recent 50 PRs of the rolling window
 *  doesn't bias the clean/dirty ratio — it caps time-resolution, not
 *  outcome-resolution. Slice 14 of `daemon-pre-pr-lint-gate`. */
export const GH_PR_LIST_LIMIT = 50;

/** Terminal `statusCheckRollup` outcomes that count as a *red* CI check —
 *  i.e. the PR did NOT "open with zero red CI checks" (the pre-registered
 *  observable in TASKS.md `daemon-pre-pr-lint-gate` Hypothesis). A
 *  `statusCheckRollup` entry is either a `CheckRun` (carries `conclusion`)
 *  or a legacy `StatusContext` (carries `state`); GitHub's GraphQL schema
 *  lists more red terminal values than the single `FAILURE` the original
 *  predicate matched:
 *
 *    - `FAILURE`          — check/status failed (both fields).
 *    - `ERROR`            — commit-status hard error (`StatusState`).
 *    - `TIMED_OUT`        — check run exceeded its time budget.
 *    - `STARTUP_FAILURE`  — check run never started (infra failure).
 *    - `ACTION_REQUIRED`  — check needs manual action; merge-blocking,
 *                           not green.
 *
 *  Counting only `FAILURE` silently scored a timed-out / errored / never-
 *  started run as *clean*, inflating the rolling pass-rate above its true
 *  value — exactly the "flattering observable" failure mode rule #9
 *  forbids (the metric must inspect "zero red CI checks", not a laxer
 *  proxy). `CANCELLED` / `STALE` / `NEUTRAL` / `SKIPPED` are intentionally
 *  excluded: a cancelled or stale check is usually a superseded re-run,
 *  and treating those as red would distort the ratio the *other* way
 *  (over-counting PRs that were actually green after a re-run).
 *
 *  Frozen + exported (rule #2 data-not-code) so the report formatter,
 *  the paired tests, and `scripts/self-diagnose.mjs` — which reuses
 *  `parsePrListEntries` via `ghJson` — share one source for the per-PR
 *  red rule. Slice 38/N of `daemon-pre-pr-lint-gate`. */
export const RED_CHECK_OUTCOMES = Object.freeze(
  new Set(["FAILURE", "ERROR", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"]),
);

/**
 * Format a `Date` as a UTC `YYYY-MM-DD` string for use in `gh ... --search
 * "created:>=YYYY-MM-DD"`. UTC chosen to match the supervisor's clock
 * conventions and to keep the `gh` query stable across operator tz changes.
 *
 * @param {Date} date
 * @returns {string}
 */
export function formatDateUtcYmd(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Subtract `days` from `now`, returning a new `Date`.
 *
 * @param {Date} now
 * @param {number} days  non-negative integer
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
 * @typedef {Object} PrSummary
 * @property {number} number
 * @property {boolean} hasFailure  true iff any statusCheckRollup entry's `conclusion` or `state` is in `RED_CHECK_OUTCOMES`
 */

/**
 * @typedef {Object} PrStats
 * @property {number} total
 * @property {number} clean
 * @property {readonly number[]} dirtyNumbers
 * @property {number | null} passRate  `clean / total`, or `null` when `total === 0`
 */

/**
 * Parse a pre-decoded array of PR records (the shape `gh pr list --json
 * number,statusCheckRollup` returns) into PR summaries. Extracted so the
 * self-diagnose invariant (which already JSON-parses via `ghJson`) shares
 * the same per-PR rule for `hasFailure` as the metric report — slice 12 of
 * `daemon-pre-pr-lint-gate`. Throws on non-array — caller wants a hard
 * failure over a misleading verdict.
 *
 * @param {unknown} parsed
 * @returns {readonly PrSummary[]}
 */
export function parsePrListEntries(parsed) {
  if (!Array.isArray(parsed)) {
    throw new Error("expected gh JSON output to be an array");
  }
  /** @type {PrSummary[]} */
  const out = [];
  for (const pr of parsed) {
    /** @type {readonly { conclusion?: string, state?: string }[]} */
    const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
    // `?? ""` keeps the `Set<string>.has` argument a `string` under the
    // strict `scripts` tsconfig (a missing `conclusion`/`state` is just
    // "not red"; the empty string is never a GitHub outcome).
    const hasFailure = checks.some(
      (c) =>
        Boolean(c) &&
        (RED_CHECK_OUTCOMES.has(c.conclusion ?? "") || RED_CHECK_OUTCOMES.has(c.state ?? "")),
    );
    out.push({ number: Number(pr.number), hasFailure });
  }
  return out;
}

/**
 * Parse `gh pr list --json number,statusCheckRollup` raw stdout into a list
 * of PR summaries. Throws on malformed JSON or non-array — the caller
 * wants a hard failure over silently writing a misleading verdict.
 *
 * @param {string} raw
 * @returns {readonly PrSummary[]}
 */
export function parsePrList(raw) {
  return parsePrListEntries(JSON.parse(raw));
}

/**
 * Canonical `gh pr list` argv for the rolling-window query. Single source
 * of truth shared between the metric report (`runDaemonPrLintMetrics`) and
 * the self-diagnose invariant (`recentDaemonPrs` in
 * `scripts/self-diagnose.mjs`) — slice 12 of `daemon-pre-pr-lint-gate`.
 * Drift between the two callers (e.g., one adds `--state open` and the
 * other doesn't) used to be possible because each caller built the args
 * inline; with this helper the args can only diverge on purpose.
 *
 * Slice 14: `-R CANONICAL_REPO` is threaded ahead of the selector so the
 * query no longer depends on `gh`'s `origin`-based repo inference. See
 * the constant's docstring for the polluted-origin failure mode this
 * closes.
 *
 * @param {string} sinceYmd  YYYY-MM-DD lower bound for `created:>=`
 * @returns {readonly string[]}
 */
export function buildRecentPrListGhArgs(sinceYmd) {
  return [
    "pr",
    "list",
    "-R",
    CANONICAL_REPO,
    "--author",
    "@me",
    "--state",
    "all",
    "--search",
    `created:>=${sinceYmd}`,
    "--json",
    "number,statusCheckRollup",
    "--limit",
    String(GH_PR_LIST_LIMIT),
  ];
}

/**
 * Reduce a list of PR summaries to the pass-rate stats used by the report.
 *
 * @param {readonly PrSummary[]} prs
 * @returns {PrStats}
 */
export function computeStats(prs) {
  const total = prs.length;
  const clean = prs.filter((p) => !p.hasFailure).length;
  const dirtyNumbers = prs.filter((p) => p.hasFailure).map((p) => p.number);
  const passRate = total === 0 ? null : clean / total;
  return { total, clean, dirtyNumbers, passRate };
}

/**
 * @typedef {Object} MetricsReportInputs
 * @property {string} dateNow
 * @property {string} date30dAgo
 * @property {PrStats} stats
 */

/**
 * Format a stable, human-readable report. Pure function — every dynamic
 * input is in `inputs`, every constant is pinned at module top. The
 * format mirrors `cto-audit-metrics.mjs`'s 3-column "value / threshold /
 * verdict" shape so an operator switching between the two sees a uniform
 * surface.
 *
 * @param {MetricsReportInputs} inputs
 * @returns {string}
 */
export function formatReport(inputs) {
  const { dateNow, date30dAgo, stats } = inputs;
  const { total, clean, passRate, dirtyNumbers } = stats;
  const valueCell =
    passRate === null
      ? `${clean}/${total} (n/a — no PRs in window)`
      : `${clean}/${total} (${passRate.toFixed(3)})`;
  const verdict =
    total < ROLLING_30D_MIN_N
      ? "INSUFFICIENT-DATA"
      : passRate !== null && passRate >= ROLLING_30D_MIN_PASS_RATE
        ? "OK"
        : "BELOW";
  const dirtyLine =
    dirtyNumbers.length === 0
      ? "  Failed:    none"
      : `  Failed:    ${dirtyNumbers.map((n) => `#${n}`).join(", ")}`;

  return [
    "Daemon pre-PR lint-gate pre-registered metric (anchor: TASKS.md `daemon-pre-pr-lint-gate` Measurement)",
    `Run at ${dateNow}Z; selector = \`-R ${CANONICAL_REPO} --author @me\` (single-operator repo proxy for daemon-authored PRs — see scripts/self-diagnose.mjs § daemonPrLintPassRateInvariant)`,
    "",
    `Rolling ${ROLLING_WINDOW_DAYS}d clean-CI fraction (PRs created with zero red \`statusCheckRollup\` checks — ${[...RED_CHECK_OUTCOMES].join("/")}; window >= ${date30dAgo}):`,
    `  Value:     ${valueCell}`,
    `  Threshold: >= ${ROLLING_30D_MIN_PASS_RATE.toFixed(2)} (with n >= ${ROLLING_30D_MIN_N})`,
    `  Verdict:   ${verdict}`,
    dirtyLine,
    "",
    "Pivot trigger: if Verdict stays BELOW after pre-pr-lint manifest matches CI's `needs:` aggregator AND the brief still emits the `pnpm pre-pr-lint` mandate, pivot to a staged gate per the task block (fast lints pre-PR, slow lints CI-only).",
    "See docs/daemon-pre-pr-gate.md for the gate's components and drift hazards.",
    "",
  ].join("\n");
}

/**
 * @typedef {(args: ReadonlyArray<string>) => Promise<string>} GhRunner
 *   Async runner returning stdout from `gh <args…>`. Tests inject a stub;
 *   the production binding shells out to the real `gh`.
 */

/**
 * @typedef {Object} DaemonPrLintMetricsResult
 * @property {string} report
 * @property {PrStats} stats
 */

/**
 * Top-level orchestrator: derive the date window from `clock`, fire one
 * `gh` call, parse, and format. Returns both the report string and the
 * raw stats so callers (tests, future automation) can branch on them
 * without re-parsing the report.
 *
 * @param {{ clock: () => Date, runGh: GhRunner }} opts
 * @returns {Promise<DaemonPrLintMetricsResult>}
 */
export async function runDaemonPrLintMetrics({ clock, runGh }) {
  const now = clock();
  const dateNow = formatDateUtcYmd(now);
  const date30dAgo = formatDateUtcYmd(daysAgoUtc(now, ROLLING_WINDOW_DAYS));

  const raw = await runGh(buildRecentPrListGhArgs(date30dAgo));

  const prs = parsePrList(raw);
  const stats = computeStats(prs);
  const report = formatReport({ dateNow, date30dAgo, stats });
  return { report, stats };
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
  const result = await runDaemonPrLintMetrics({ clock: () => new Date(), runGh: spawnGh });
  process.stdout.write(result.report);
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("daemon-pr-lint-metrics.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
