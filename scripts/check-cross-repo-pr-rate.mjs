#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved 2026-05-24 cross-repo-iteration-ship-rate-ci-gate — CLI lint over the cross-repo runner's iteration→PR ship-rate. Rule-#9 pre-registered thresholds pinned in `iteration-ship-rate.ts`; rule-#4 visibility for the operator-side gate. -->
//
// CLI bin for the cross-repo runner's iteration→PR ship-rate gate.
//
// What it does
// ------------
// Reads every JSONL line from `<host-dir>/.minsky/experiment-store/cross-repo/*.jsonl`,
// filters to the rolling window (default 30d), calls the pure
// `computeShipRate` exported from `novel/cross-repo-runner/dist/iteration-ship-rate.js`,
// and prints a single-line JSON verdict on stdout.
//
// Exit codes:
//   0 — verdict is not BELOW (ABOVE / WARN / INSUFFICIENT-DATA). The gate
//       passes — pre-pr-lint --stage=full continues.
//   1 — verdict is BELOW (rate < SHIP_RATE_FLOOR). The gate fails — the
//       operator's push is blocked until the rate recovers.
//
// Why this exists
// ---------------
// `walker-drains-one-host-forever` (PR #644) made cross-repo distribution
// fair. This gate closes the *measurement* loop: the per-host iteration→PR
// ratio now surfaces in every operator push, so a regression (e.g. a
// broken `gh pr create` step that drops to 0% ship-rate) is caught in <1
// day instead of waiting for someone to hand-grep jsonl.
//
// Anchors
// -------
//   - Beyer et al., SRE 2016 Ch. 6 — aggregate visibility for the four
//     golden signals.
//   - Forsgren/Humble/Kim, Accelerate 2018 — DORA keys are ratios over a
//     window, not per-iteration spot checks.
//   - Munafò et al., Nature Human Behaviour 1, 0021 (2017) — pre-registered
//     thresholds pinned in code (`iteration-ship-rate.ts`); a future
//     threshold tune is a deliberate diff, not a silent drift.
//
// Pattern
// -------
// Pure-function-with-I/O-at-edge (Martin 2017): the verdict logic lives
// in `iteration-ship-rate.ts` (pure, unit-tested across 19 cases); this
// file does only the I/O — read jsonl, write JSON, set exit code. Both
// callers (this CLI + the `scripts/collect-metrics.mjs` collector + the
// optional runtime invariant) share one threshold constant.
//
// Usage
// -----
//   node scripts/check-cross-repo-pr-rate.mjs               # 30d window, cwd, exits non-zero on BELOW
//   node scripts/check-cross-repo-pr-rate.mjs --window=7d   # 7d window
//   node scripts/check-cross-repo-pr-rate.mjs --json        # always exits 0, machine-readable for collectors
//   node scripts/check-cross-repo-pr-rate.mjs --host-dir=<path>  # non-cwd host

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { computeShipRate } from "../novel/cross-repo-runner/dist/iteration-ship-rate.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * @typedef {Object} ParsedArgs
 * @property {number} windowDays
 * @property {string} hostDir
 * @property {boolean} json
 * @property {number | undefined} nowMs  // for deterministic fixture testing
 */

/** @type {Record<string, (result: ParsedArgs, value: string) => void>} */
const FLAG_HANDLERS = {
  "--window": (result, value) => {
    const m = /^(\d+)d$/.exec(value);
    if (!m) throw new Error(`--window must be in the form Nd (e.g. --window=30d); got '${value}'`);
    result.windowDays = Number(m[1]);
  },
  "--host-dir": (result, value) => {
    result.hostDir = value;
  },
  "--now": (result, value) => {
    const epoch = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
    if (Number.isNaN(epoch)) throw new Error(`--now must be ISO-8601 or epoch ms; got '${value}'`);
    result.nowMs = epoch;
  },
};

/**
 * Apply one argv token to the parsed-args accumulator. Pure (mutates the
 * passed-in result); extracted so `parseArgs` stays under biome's
 * cognitive-complexity ceiling.
 *
 * @param {ParsedArgs} result
 * @param {string} arg
 */
function applyOneArg(result, arg) {
  if (arg === "--json") {
    result.json = true;
    return;
  }
  if (arg === "--help" || arg === "-h") {
    console.info(
      "Usage: check-cross-repo-pr-rate.mjs [--window=Nd] [--host-dir=PATH] [--json] [--now=ISO|EPOCH]",
    );
    process.exit(0);
  }
  const eqIdx = arg.indexOf("=");
  if (eqIdx === -1) throw new Error(`unknown flag: '${arg}'`);
  const handler = FLAG_HANDLERS[arg.slice(0, eqIdx)];
  if (!handler) throw new Error(`unknown flag: '${arg}'`);
  handler(result, arg.slice(eqIdx + 1));
}

/**
 * Parse argv. Pure: no side effects beyond returning the parsed shape.
 * Table-driven via FLAG_HANDLERS so each branch lives in one place.
 * @param {readonly string[]} argv
 * @returns {ParsedArgs}
 */
export function parseArgs(argv) {
  /** @type {ParsedArgs} */
  const result = { windowDays: 30, hostDir: process.cwd(), json: false, nowMs: undefined };
  for (const arg of argv) {
    applyOneArg(result, arg);
  }
  return result;
}

/**
 * Read every `.jsonl` file under `<hostDir>/.minsky/experiment-store/cross-repo/`
 * and yield parsed IterationRecord-shaped objects. Skips malformed lines
 * (the daemon's append is line-atomic, but the file can be truncated
 * mid-write under hard kills — let-it-crash via skip + log).
 *
 * @param {string} hostDir
 * @returns {Array<{ ts: string; pr_url: string | null; [k: string]: unknown }>}
 */
export function readCrossRepoRecords(hostDir) {
  const dir = join(hostDir, ".minsky", "experiment-store", "cross-repo");
  if (!existsSync(dir)) return [];
  const records = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".jsonl")) continue;
    const content = readFileSync(join(dir, file), "utf8");
    for (const line of content.split("\n")) {
      const record = parseJsonlLine(line);
      if (record !== null) records.push(record);
    }
  }
  return records;
}

/**
 * Parse one JSONL line into a ShipRateRecord-shaped object, or return
 * null when the line is blank, malformed, or missing the `ts` field.
 * Extracted so `readCrossRepoRecords` stays under the cognitive-complexity
 * ceiling (biome's noExcessiveCognitiveComplexity).
 *
 * @param {string} line
 * @returns {{ ts: string; pr_url: string | null; [k: string]: unknown } | null}
 */
function parseJsonlLine(line) {
  if (!line.trim()) return null;
  try {
    const record = JSON.parse(line);
    if (typeof record.ts !== "string") return null;
    return record;
  } catch {
    return null;
  }
}

/**
 * Run the CLI. Returns the exit code so tests can assert without
 * `process.exit`.
 *
 * @param {readonly string[]} argv
 * @param {{
 *   readRecords?: (hostDir: string) => Array<{ ts: string; pr_url: string | null; [k: string]: unknown }>;
 *   writeLine?: (line: string) => void;
 * }} [deps]
 * @returns {number} exit code
 */
export function main(argv, deps = {}) {
  const { readRecords = readCrossRepoRecords, writeLine = console.info } = deps;
  const args = parseArgs(argv);
  const records = readRecords(args.hostDir);
  /** @type {{ windowDays: number; nowMs?: number }} */
  const opts = { windowDays: args.windowDays };
  if (args.nowMs !== undefined) {
    opts.nowMs = args.nowMs;
  }
  const result = computeShipRate(records, opts);
  writeLine(JSON.stringify(result));
  if (args.json) return 0;
  return result.verdict === "BELOW" ? 1 : 0;
}

// CLI entry point — only when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const code = main(process.argv.slice(2));
    process.exit(code);
  } catch (error) {
    console.error(`check-cross-repo-pr-rate: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
}

// Silence the unused-import warning if the linter doesn't see the import
// chain — REPO_ROOT is exported for debug.
export { REPO_ROOT };
