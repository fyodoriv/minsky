#!/usr/bin/env node
// @ts-check
// throughput-benchmark — the "code factory" pillar made falsifiable.
//
// The cross-repo runner walks N hosts at K iterations/host, but the
// operator's "code factory" vision pillar (scale + throughput) was
// UNMEASURED: there was no benchmark that exercises `--hosts-dir`
// against ≥5 fixture repos and reports PRs/day, iterations/day, or
// merge-rate at scale. This script closes that gap. It walks a fleet of
// git-init fixture hosts (default `test-fixtures/throughput/`), runs the
// cross-repo runner once per host (dry-run by default so CI spends no
// agent budget), and extrapolates the observed iteration→outcome
// distribution to a 24h window. The result is two falsifiable rows —
// `minsky_throughput_prs_per_day` and `minsky_draft_acceptance_rate` —
// written to `competitive-scorecard.json`.
//
// Usage:
//   node scripts/throughput-benchmark.mjs [--fixture-hosts=N]
//        [--duration=24h] [--hosts-dir PATH] [--scorecard PATH]
//        [--live] [--json] [--help]
//
// Defaults: --fixture-hosts=5, --duration=24h, hosts-dir
// test-fixtures/throughput, dry-run (does NOT spawn agents — exercises
// the multi-host walk + extrapolation shape for falsifiability without
// burning API budget). Pass `--live` to spawn real agents per host.
//
// Throughput definitions (M1.10 + the "code factory" pillar):
//   prs_per_day            = (PRs observed across the fleet / wall-clock
//                             observed seconds) × 86400, rounded.
//   iterations_per_day     = same extrapolation over iterations attempted.
//   draft_acceptance_rate  = accepted PRs / PRs observed, where "accepted"
//                            means the iteration produced useful output
//                            without scope-leak / force-push / destructive
//                            op (the dry-run fleet treats every clean
//                            `validated` host as an accepted draft).
//
// Pattern: pure helpers + thin CLI wrapper (matches
// scripts/minsky-benchmark.mjs). Conformance: full —
// `aggregateThroughput`, `classifyHostOutcome`, `scaleToWindow`,
// `buildScorecardRows`, `parseDuration`, `formatThroughputSummary` are
// all exported and unit-tested in scripts/throughput-benchmark.test.mjs.
// Source: TASKS.md `throughput-at-scale-benchmark`; the operator's
//   "code factory" vision directive (scale + throughput);
//   user-stories/016-code-factory-throughput.md; rule #15
//   (machine-utilisation budget); Forsgren-Humble-Kim 2018 (DORA —
//   deployment frequency as the throughput SLI); Ries 2011 (falsifiable
//   pre-registered metric, not a vanity count).

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");

/** Default fleet directory — git-init fixture repos with seed TASKS.md. */
export const DEFAULT_HOSTS_DIR = "test-fixtures/throughput";

/** Seconds in a 24h day — the canonical extrapolation window. */
export const SECONDS_PER_DAY = 86_400;

/**
 * @typedef {Object} HostOutcome
 * @property {string} host          absolute or relative path of the fixture host
 * @property {string | undefined} verdict
 * @property {number} durationMs    wall-clock the host's single iteration took
 * @property {boolean} producedPr   did the iteration produce a (draft) PR / candidate diff
 * @property {boolean} accepted     was the produced PR a clean draft (no scope-leak / destructive op)
 * @property {number | null} [exitCode]
 */

/**
 * @typedef {Object} ThroughputReport
 * @property {number} fixture_hosts
 * @property {number} duration_seconds       the requested extrapolation window
 * @property {number} observed_seconds       summed wall-clock across the fleet walk
 * @property {number} prs_observed
 * @property {number} prs_accepted
 * @property {number} minsky_throughput_prs_per_day
 * @property {number} minsky_throughput_iterations_per_day
 * @property {number} minsky_draft_acceptance_rate
 * @property {Record<string, number>} verdict_counts
 */

/**
 * @typedef {Object} CliOptions
 * @property {number} fixtureHosts
 * @property {string} durationRaw
 * @property {string | undefined} hostsDir
 * @property {string | undefined} scorecard
 * @property {boolean} live
 * @property {boolean} json
 * @property {boolean} help
 */

/**
 * Verdicts that mean the host's iteration shipped a PR-candidate without an
 * infrastructural failure. Mirrors `PASS_VERDICTS` in minsky-benchmark.mjs but
 * is scoped to throughput accounting: only verdicts that represent a clean
 * draft-PR-worthy outcome count toward `prs_accepted`. `no-change` and
 * `empty-queue` are clean (no destructive op) but produce NO PR, so they count
 * as accepted-clean but not as a PR.
 *
 * @type {ReadonlySet<string>}
 */
export const PR_PRODUCING_VERDICTS = Object.freeze(new Set(["pr-open", "validated"]));

/**
 * Verdicts that are clean — the iteration ran without scope-leak, force-push,
 * or a destructive op. Used to compute draft-acceptance: a PR is "accepted"
 * iff it was produced AND clean.
 *
 * @type {ReadonlySet<string>}
 */
export const CLEAN_VERDICTS = Object.freeze(
  new Set(["pr-open", "validated", "no-change", "empty-queue"]),
);

/**
 * Classify one host's runner output into a throughput outcome. Pure: takes the
 * verdict string + duration, returns whether a PR was produced and whether it
 * was a clean (acceptable) draft.
 *
 * @param {{ host: string, verdict: string | undefined, durationMs: number, exitCode?: number | null }} input
 * @returns {HostOutcome}
 */
export function classifyHostOutcome(input) {
  const verdict = input.verdict;
  const producedPr = verdict !== undefined && PR_PRODUCING_VERDICTS.has(verdict);
  const clean = verdict !== undefined && CLEAN_VERDICTS.has(verdict);
  return {
    host: input.host,
    verdict,
    durationMs: input.durationMs,
    producedPr,
    accepted: producedPr && clean,
    exitCode: input.exitCode ?? null,
  };
}

/**
 * Extrapolate an observed count over `observedSeconds` of wall-clock to the
 * requested `windowSeconds`. Linear projection — DORA deployment-frequency
 * shape. Guards against a zero/negative observed window (returns 0 rather than
 * dividing by zero, so a degenerate run can't fabricate an infinite rate).
 *
 * @param {number} observedCount
 * @param {number} observedSeconds
 * @param {number} windowSeconds
 * @returns {number} rate over the window, rounded to the nearest integer
 */
export function scaleToWindow(observedCount, observedSeconds, windowSeconds) {
  if (observedSeconds <= 0 || windowSeconds <= 0) return 0;
  return Math.round((observedCount * windowSeconds) / observedSeconds);
}

/**
 * Parse a duration spec like `24h`, `90m`, `3600s`, or a bare integer (seconds)
 * into seconds. Returns NaN on an unparseable spec so the caller can reject it.
 *
 * @param {string} raw
 * @returns {number} seconds, or NaN
 */
export function parseDuration(raw) {
  const m = /^(\d+(?:\.\d+)?)(h|m|s)?$/.exec(raw.trim());
  if (m === null || m[1] === undefined) return Number.NaN;
  const value = Number.parseFloat(m[1]);
  switch (m[2]) {
    case "h":
      return value * 3600;
    case "m":
      return value * 60;
    default:
      return value; // bare number OR explicit `s` → seconds
  }
}

/**
 * Aggregate per-host outcomes into the throughput report. Pure: takes the
 * outcomes + the requested window, returns the falsifiable rows.
 *
 * @param {HostOutcome[]} outcomes
 * @param {number} windowSeconds
 * @returns {ThroughputReport}
 */
export function aggregateThroughput(outcomes, windowSeconds) {
  /** @type {Record<string, number>} */
  const verdictCounts = {};
  let observedMs = 0;
  let prsObserved = 0;
  let prsAccepted = 0;
  for (const o of outcomes) {
    const verdict = o.verdict ?? "unknown";
    verdictCounts[verdict] = (verdictCounts[verdict] ?? 0) + 1;
    observedMs += o.durationMs;
    if (o.producedPr) prsObserved++;
    if (o.accepted) prsAccepted++;
  }
  const observedSeconds = observedMs / 1000;
  const draftAcceptanceRate =
    prsObserved === 0 ? 0 : Math.round((prsAccepted / prsObserved) * 100) / 100;
  return {
    fixture_hosts: outcomes.length,
    duration_seconds: windowSeconds,
    observed_seconds: Math.round(observedSeconds * 1000) / 1000,
    prs_observed: prsObserved,
    prs_accepted: prsAccepted,
    minsky_throughput_prs_per_day: scaleToWindow(prsObserved, observedSeconds, windowSeconds),
    minsky_throughput_iterations_per_day: scaleToWindow(
      outcomes.length,
      observedSeconds,
      windowSeconds,
    ),
    minsky_draft_acceptance_rate: draftAcceptanceRate,
    verdict_counts: verdictCounts,
  };
}

/**
 * Resolve a CLI path argument: absolute paths are honoured as-is; relative
 * paths are resolved under `root` (the repo root) so `--hosts-dir foo` means
 * `<repo>/foo` while `--hosts-dir /tmp/x` means exactly `/tmp/x`. Pure.
 *
 * @param {string} p
 * @param {string} root
 * @returns {string}
 */
export function resolveUnderRoot(p, root) {
  return isAbsolute(p) ? p : resolve(root, p);
}

/**
 * Build the M1.10 scorecard rows from a throughput report. Pure: returns the
 * object that gets merged into `competitive-scorecard.json` under the
 * `minsky-self` competitor. Keys are the kebab/snake metric ids the
 * `throughput-at-scale-benchmark` task's Success criterion names.
 *
 * @param {ThroughputReport} report
 * @param {Date} [now]
 * @returns {{ minsky_throughput_prs_per_day: number, minsky_draft_acceptance_rate: number, minsky_throughput_iterations_per_day: number, measured_at: string }}
 */
export function buildScorecardRows(report, now = new Date()) {
  return {
    minsky_throughput_prs_per_day: report.minsky_throughput_prs_per_day,
    minsky_draft_acceptance_rate: report.minsky_draft_acceptance_rate,
    minsky_throughput_iterations_per_day: report.minsky_throughput_iterations_per_day,
    measured_at: now.toISOString(),
  };
}

/**
 * Format the throughput report as a human-readable summary. Deterministic
 * ordering so the output is diff-stable.
 *
 * @param {ThroughputReport} report
 * @returns {string}
 */
export function formatThroughputSummary(report) {
  let out = "minsky throughput-at-scale — summary\n";
  out += `${"─".repeat(50)}\n`;
  out += `  fixture hosts:        ${report.fixture_hosts}\n`;
  out += `  window:               ${report.duration_seconds}s\n`;
  out += `  observed wall-clock:  ${report.observed_seconds}s\n`;
  out += `  PRs observed:         ${report.prs_observed}\n`;
  out += `  PRs/day (projected):  ${report.minsky_throughput_prs_per_day}\n`;
  out += `  iters/day (projected):${report.minsky_throughput_iterations_per_day}\n`;
  out += `  draft-acceptance:     ${report.minsky_draft_acceptance_rate}\n`;
  out += "  verdicts:\n";
  for (const [v, c] of Object.entries(report.verdict_counts).sort()) {
    out += `    ${v.padEnd(20)} ${c}\n`;
  }
  return out;
}

// ---- I/O boundary (not unit-tested; exercised via the integration test) ----

/** Extract a verdict from one runner stdout/stderr block. Same parser shape as
 *  minsky-benchmark.mjs `parseRunnerOutput`.
 *  @param {string} text
 *  @returns {string | undefined}
 */
export function parseRunnerVerdict(text) {
  const m1 = text.match(/verdict=([a-z][\w-]*)/);
  if (m1) return m1[1];
  const m2 = text.match(/stopReason:\s*([a-z][\w-]*)/);
  if (m2) return m2[1];
  return undefined;
}

/** Discover fixture hosts: every immediate subdirectory of `hostsDir` that is a
 *  git repo or carries a TASKS.md. Sorted for deterministic ordering. Returns
 *  at most `limit` hosts.
 *  @param {{ hostsDir: string, limit: number }} input
 *  @returns {string[]}
 */
function discoverFixtureHosts({ hostsDir, limit }) {
  if (!existsSync(hostsDir)) return [];
  const entries = readdirSync(hostsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(hostsDir, e.name))
    .filter((p) => existsSync(join(p, ".git")) || existsSync(join(p, "TASKS.md")))
    .sort();
  return entries.slice(0, limit);
}

/** Run the cross-repo runner once against one host. In dry-run mode it passes
 *  `--dry-run` so no agent spawns; the runner still walks the pipeline and
 *  emits a `validated` verdict, which is the canonical clean-fixture outcome.
 *  @param {{ host: string, live: boolean }} input
 *  @returns {HostOutcome}
 */
function runOneHost({ host, live }) {
  const runnerBin = join(REPO_ROOT, "bin", "minsky-run.sh");
  const args = ["--host", host, "--max-iterations", "1", "--iterations-per-host", "1"];
  if (!live) args.push("--dry-run");
  const t0 = Date.now();
  const result = spawnSync("bash", [runnerBin, ...args], {
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, MINSKY_NON_INTERACTIVE: "1" },
  });
  const durationMs = Date.now() - t0;
  const verdict = parseRunnerVerdict(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  return classifyHostOutcome({ host, verdict, durationMs, exitCode: result.status });
}

// --------------------------------------------------------------- CLI -------

/** Apply one CLI flag at index `i`. Returns the new index.
 *  @param {string[]} args
 *  @param {number} i
 *  @param {CliOptions} acc
 *  @returns {number}
 */
function applyFlag(args, i, acc) {
  const arg = args[i] ?? "";
  const eq = /^--([a-z-]+)=(.+)$/.exec(arg);
  if (eq !== null) {
    switch (eq[1]) {
      case "fixture-hosts":
        acc.fixtureHosts = Number.parseInt(eq[2] ?? "", 10);
        return i;
      case "duration":
        acc.durationRaw = eq[2] ?? "";
        return i;
      case "hosts-dir":
        acc.hostsDir = eq[2];
        return i;
      case "scorecard":
        acc.scorecard = eq[2];
        return i;
      default:
        return i;
    }
  }
  switch (arg) {
    case "--fixture-hosts":
      acc.fixtureHosts = Number.parseInt(args[i + 1] ?? "", 10);
      return i + 1;
    case "--duration":
      acc.durationRaw = args[i + 1] ?? "";
      return i + 1;
    case "--hosts-dir":
      acc.hostsDir = args[i + 1];
      return i + 1;
    case "--scorecard":
      acc.scorecard = args[i + 1];
      return i + 1;
    case "--live":
      acc.live = true;
      return i;
    case "--json":
      acc.json = true;
      return i;
    case "--help":
    case "-h":
      acc.help = true;
      return i;
    default:
      return i;
  }
}

/**
 * @param {string[]} argv
 * @returns {CliOptions}
 */
export function parseArgs(argv) {
  const args = argv.slice(2);
  /** @type {CliOptions} */
  const acc = {
    fixtureHosts: 5,
    durationRaw: "24h",
    hostsDir: undefined,
    scorecard: undefined,
    live: false,
    json: false,
    help: false,
  };
  let i = 0;
  while (i < args.length) {
    i = applyFlag(args, i, acc) + 1;
  }
  return acc;
}

function printUsage() {
  process.stdout.write(
    [
      "Usage: minsky benchmark --throughput [options]",
      "",
      "Walk a fleet of fixture hosts, run the cross-repo runner once per",
      "host, and project the observed outcomes to a 24h window — the",
      "falsifiable 'code factory' throughput claim (PRs/day at scale).",
      "",
      "Options:",
      "  --fixture-hosts=N   Number of fixture hosts to walk (default: 5)",
      "  --duration=24h      Extrapolation window: 24h | 90m | 3600s (default: 24h)",
      "  --hosts-dir PATH    Fixture fleet dir (default: test-fixtures/throughput)",
      "  --scorecard PATH    Write the scorecard JSON here (default: competitive-scorecard.json)",
      "  --live              Spawn real agents per host (default: dry-run pipeline)",
      "  --json              Emit machine-readable JSON instead of human summary",
      "  --help, -h          Print this message",
      "",
      "Metrics written: minsky_throughput_prs_per_day,",
      "  minsky_draft_acceptance_rate, minsky_throughput_iterations_per_day.",
      "",
    ].join("\n"),
  );
}

/** Merge the throughput rows into the scorecard file under `minsky-self`. Reads
 *  the existing file if present (so re-runs accrete rather than clobber other
 *  competitors), else starts a fresh shape. Let-it-crash: a corrupt existing
 *  file should surface loudly, not be silently overwritten.
 *  @param {{ scorecardPath: string, rows: Record<string, number | string> }} input
 *  @returns {void}
 */
function writeScorecard({ scorecardPath, rows }) {
  /** @type {Record<string, unknown>} */
  let doc = { competitors: {} };
  if (existsSync(scorecardPath)) {
    doc = JSON.parse(readFileSync(scorecardPath, "utf8"));
  }
  if (typeof doc["competitors"] !== "object" || doc["competitors"] === null) {
    doc["competitors"] = {};
  }
  const competitors = /** @type {Record<string, unknown>} */ (doc["competitors"]);
  competitors["minsky-self"] = { values: rows };
  writeFileSync(scorecardPath, `${JSON.stringify(doc, null, 2)}\n`);
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printUsage();
    return 0;
  }
  if (!Number.isFinite(opts.fixtureHosts) || opts.fixtureHosts < 1) {
    process.stderr.write(
      `minsky throughput: --fixture-hosts must be a positive integer (got ${opts.fixtureHosts})\n`,
    );
    return 2;
  }
  const windowSeconds = parseDuration(opts.durationRaw);
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    process.stderr.write(
      `minsky throughput: --duration must be like 24h | 90m | 3600s (got '${opts.durationRaw}')\n`,
    );
    return 2;
  }
  const hostsDir = resolveUnderRoot(opts.hostsDir ?? DEFAULT_HOSTS_DIR, REPO_ROOT);
  const hosts = discoverFixtureHosts({ hostsDir, limit: opts.fixtureHosts });
  if (hosts.length === 0) {
    process.stderr.write(
      `minsky throughput: no fixture hosts under '${hostsDir}' (expected ≥1 git-init repo with TASKS.md)\n`,
    );
    return 2;
  }
  /** @type {HostOutcome[]} */
  const outcomes = hosts.map((host) => runOneHost({ host, live: opts.live }));
  const report = aggregateThroughput(outcomes, windowSeconds);
  const rows = buildScorecardRows(report);
  const scorecardPath = resolveUnderRoot(opts.scorecard ?? "competitive-scorecard.json", REPO_ROOT);
  writeScorecard({ scorecardPath, rows });
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatThroughputSummary(report));
    process.stdout.write(`  scorecard:            ${scorecardPath}\n`);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv));
}
