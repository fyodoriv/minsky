#!/usr/bin/env node
// Measurement harness for the parent P0 `agent-mediated-install` task's
// 9-run cross-provider success criterion:
//
//   `node scripts/measure-agent-install.mjs --providers=claude-code,devin,cursor \
//     --runs-per-provider=3 --threshold-seconds=90 --threshold-prompts=1`
//
// Exit 0 iff every run passes both thresholds (duration ≤ N seconds AND
// prompt count ≤ N). The exit code is the aggregate verdict.
//
// Mock mode (`--providers=mock`) emits deterministic readings so CI has
// a regression gate on the harness machinery (arg parsing, JSON shape,
// aggregate logic, threshold semantics) without spending API budget on
// real agent invocations.
//
// Live mode (`--live` flag) is explicitly out-of-scope for v1 — the
// parent task's Pivot calls it out. Filed as a follow-up: `measure-agent-install-live-mode`.
//
// Source: P1 `measure-agent-install-harness`; parent P0 `agent-mediated-install` slice (3).
// Rule #9: this script IS the Measurement field of the parent task.
// Rule #1: emits the same JSON shape that parent task acceptance #1 asserts.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

const KNOWN_PROVIDERS = new Set(["mock", "claude-code", "devin", "cursor"]);
const DEFAULT_THRESHOLD_SECONDS = 90;
const DEFAULT_THRESHOLD_PROMPTS = 1;
const DEFAULT_RUNS_PER_PROVIDER = 3;

/**
 * @typedef {Object} RunReading
 * @property {string} provider
 * @property {number} run_index
 * @property {number} duration_seconds
 * @property {number} prompt_count
 * @property {"pass" | "fail" | "skipped"} verdict
 * @property {string} [reason]
 */

/**
 * @typedef {Object} HarnessReport
 * @property {string} timestamp
 * @property {{
 *   providers: string[],
 *   runs_per_provider: number,
 *   threshold_seconds: number,
 *   threshold_prompts: number,
 *   live: boolean,
 * }} config
 * @property {RunReading[]} runs
 * @property {{
 *   total: number,
 *   passed: number,
 *   failed: number,
 *   skipped: number,
 * }} totals
 * @property {"pass" | "fail"} aggregate_verdict
 * @property {number} runs_passed
 */

/**
 * @typedef {Object} CliArgs
 * @property {string[]} providers
 * @property {number} runsPerProvider
 * @property {number} thresholdSeconds
 * @property {number} thresholdPrompts
 * @property {boolean} live
 * @property {string | null} outFile
 * @property {boolean} json
 * @property {boolean} quiet
 */

/**
 * @typedef {Object} ArgHandler
 * @property {(a: string) => boolean} test
 * @property {(args: CliArgs, a: string) => void} apply
 */

// Dispatch table — keeps parseArgs flat enough for biome's cognitive
// complexity threshold. Each entry's `apply` mutates `args` in-place.
/** @type {ArgHandler[]} */
const ARG_HANDLERS = [
  {
    test: (a) => a.startsWith("--providers="),
    apply: (args, a) => {
      args.providers = a
        .slice("--providers=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    },
  },
  {
    test: (a) => a.startsWith("--runs-per-provider="),
    apply: (args, a) => {
      args.runsPerProvider = Number.parseInt(a.slice("--runs-per-provider=".length), 10);
    },
  },
  {
    test: (a) => a.startsWith("--threshold-seconds="),
    apply: (args, a) => {
      args.thresholdSeconds = Number.parseInt(a.slice("--threshold-seconds=".length), 10);
    },
  },
  {
    test: (a) => a.startsWith("--threshold-prompts="),
    apply: (args, a) => {
      args.thresholdPrompts = Number.parseInt(a.slice("--threshold-prompts=".length), 10);
    },
  },
  {
    test: (a) => a === "--live",
    apply: (args) => {
      args.live = true;
    },
  },
  {
    test: (a) => a.startsWith("--out="),
    apply: (args, a) => {
      args.outFile = a.slice("--out=".length);
    },
  },
  {
    test: (a) => a === "--quiet",
    apply: (args) => {
      args.quiet = true;
    },
  },
  {
    test: (a) => a === "--no-json",
    apply: (args) => {
      args.json = false;
    },
  },
];

/**
 * @param {string[]} argv
 * @returns {CliArgs}
 */
function parseArgs(argv) {
  /** @type {CliArgs} */
  const args = {
    providers: ["mock"],
    runsPerProvider: DEFAULT_RUNS_PER_PROVIDER,
    thresholdSeconds: DEFAULT_THRESHOLD_SECONDS,
    thresholdPrompts: DEFAULT_THRESHOLD_PROMPTS,
    live: false,
    outFile: null,
    json: true,
    quiet: false,
  };
  for (const a of argv) {
    const h = ARG_HANDLERS.find((x) => x.test(a));
    if (h) h.apply(args, a);
  }
  return args;
}

/**
 * @param {CliArgs} args
 * @returns {string[]}
 */
function validateArgs(args) {
  const errs = [];
  if (!Number.isFinite(args.runsPerProvider) || args.runsPerProvider < 1) {
    errs.push(`--runs-per-provider must be a positive integer (got ${args.runsPerProvider})`);
  }
  if (!Number.isFinite(args.thresholdSeconds) || args.thresholdSeconds < 1) {
    errs.push(`--threshold-seconds must be a positive integer (got ${args.thresholdSeconds})`);
  }
  if (!Number.isFinite(args.thresholdPrompts) || args.thresholdPrompts < 0) {
    errs.push(`--threshold-prompts must be a non-negative integer (got ${args.thresholdPrompts})`);
  }
  if (args.providers.length === 0) {
    errs.push("--providers list is empty (pass at least one provider name)");
  }
  for (const p of args.providers) {
    if (!KNOWN_PROVIDERS.has(p)) {
      errs.push(`unknown provider "${p}" (known: ${[...KNOWN_PROVIDERS].join(", ")})`);
    }
  }
  return errs;
}

/**
 * Deterministic mock reading — exists so CI has a regression gate on
 * the harness machinery without spending API budget. Returns a reading
 * that satisfies the default thresholds (≤90s, ≤1 prompt).
 *
 * Determinism via the (provider, runIndex) pair: seed-stable, no
 * randomness, no clock dependency.
 *
 * @param {{ provider: string, runIndex: number, thresholdSeconds: number, thresholdPrompts: number }} input
 * @returns {RunReading}
 */
export function mockReading({ provider, runIndex, thresholdSeconds, thresholdPrompts }) {
  // Deterministic duration: 30-60s window, varying by runIndex so the
  // test can detect run-to-run differences but always under threshold.
  const duration = 30 + runIndex * 10;
  // The mock agent asks exactly 1 prompt (the verbatim consent) per
  // the INSTALL.md contract.
  const promptCount = 1;
  const durationOk = duration <= thresholdSeconds;
  const promptsOk = promptCount <= thresholdPrompts;
  return {
    provider,
    run_index: runIndex,
    duration_seconds: duration,
    prompt_count: promptCount,
    verdict: durationOk && promptsOk ? "pass" : "fail",
  };
}

/**
 * @param {{ provider: string, runIndex: number, live: boolean }} input
 * @returns {RunReading}
 */
function liveReadingPlaceholder({ provider, runIndex }) {
  // Live mode is out-of-scope for v1 per parent task Pivot. Emit a
  // skipped reading with a clear reason so the operator (and `--live`
  // users) see exactly what's missing.
  return {
    provider,
    run_index: runIndex,
    duration_seconds: -1,
    prompt_count: -1,
    verdict: "skipped",
    reason: `live mode not implemented in v1 — file follow-up "measure-agent-install-live-mode" P2 task`,
  };
}

/**
 * Pure: given args + a reading function, produce a HarnessReport.
 *
 * @param {{
 *   providers: string[],
 *   runsPerProvider: number,
 *   thresholdSeconds: number,
 *   thresholdPrompts: number,
 *   live: boolean,
 *   readingFn?: (input: { provider: string, runIndex: number, thresholdSeconds: number, thresholdPrompts: number, live: boolean }) => RunReading,
 * }} input
 * @returns {HarnessReport}
 */
export function buildReport({
  providers,
  runsPerProvider,
  thresholdSeconds,
  thresholdPrompts,
  live,
  readingFn,
}) {
  const fn = readingFn ?? defaultReadingFn;
  /** @type {RunReading[]} */
  const runs = [];
  for (const provider of providers) {
    for (let i = 1; i <= runsPerProvider; i++) {
      runs.push(fn({ provider, runIndex: i, thresholdSeconds, thresholdPrompts, live }));
    }
  }
  const passed = runs.filter((r) => r.verdict === "pass").length;
  const failed = runs.filter((r) => r.verdict === "fail").length;
  const skipped = runs.filter((r) => r.verdict === "skipped").length;
  return {
    timestamp: new Date().toISOString(),
    config: {
      providers,
      runs_per_provider: runsPerProvider,
      threshold_seconds: thresholdSeconds,
      threshold_prompts: thresholdPrompts,
      live,
    },
    runs,
    totals: { total: runs.length, passed, failed, skipped },
    // `aggregate_verdict == "pass"` requires ALL runs to be "pass".
    // A single "skipped" or "fail" → aggregate "fail" so the operator
    // never reads `aggregate_verdict == "pass"` from a partial run.
    aggregate_verdict: passed === runs.length && runs.length > 0 ? "pass" : "fail",
    runs_passed: passed,
  };
}

/**
 * Default reading dispatcher: routes to mock for `mock` provider, to
 * live placeholder otherwise. Live mode itself is gated behind --live;
 * without it, real-provider names are reported as skipped (so a stray
 * `--providers=claude-code` in CI without `--live` doesn't fail the
 * harness — it produces a clean skipped reading).
 *
 * @param {{ provider: string, runIndex: number, thresholdSeconds: number, thresholdPrompts: number, live: boolean }} input
 * @returns {RunReading}
 */
function defaultReadingFn({ provider, runIndex, thresholdSeconds, thresholdPrompts, live }) {
  if (provider === "mock") {
    return mockReading({ provider, runIndex, thresholdSeconds, thresholdPrompts });
  }
  if (live) {
    return liveReadingPlaceholder({ provider, runIndex, live });
  }
  return {
    provider,
    run_index: runIndex,
    duration_seconds: -1,
    prompt_count: -1,
    verdict: "skipped",
    reason: `real-agent provider "${provider}" requires --live (omitted)`,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const errs = validateArgs(args);
  if (errs.length > 0) {
    for (const e of errs) console.error(`measure-agent-install: ${e}`);
    console.error(
      "Usage: node scripts/measure-agent-install.mjs --providers=mock --runs-per-provider=3 --threshold-seconds=90 --threshold-prompts=1",
    );
    process.exit(2);
  }
  const report = buildReport({
    providers: args.providers,
    runsPerProvider: args.runsPerProvider,
    thresholdSeconds: args.thresholdSeconds,
    thresholdPrompts: args.thresholdPrompts,
    live: args.live,
  });
  if (args.outFile) {
    const target = resolve(REPO_ROOT, args.outFile);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (args.json && !args.quiet) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (!args.quiet) {
    process.stdout.write(
      `measure-agent-install: ${report.aggregate_verdict} (${report.runs_passed}/${report.totals.total} runs passed)\n`,
    );
  }
  // Exit 0 only when every run passed (parent task contract).
  process.exit(report.aggregate_verdict === "pass" ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
