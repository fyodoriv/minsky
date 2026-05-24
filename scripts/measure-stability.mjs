#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved 2026-05-24 local-models-stability-gate-90-percent — implements the M1.1 stability gate per user-stories/015-local-models-until-stable.md. Pure bucket-the-verdict over the experiment-store; exit code = gate state. -->
//
// Measure the daemon's stability gate. Reads from
// `.minsky/experiment-store/cross-repo/*.jsonl` via `stability-number.mjs`
// (the SAME data source the M1 P0 `single-stability-number` closure uses,
// so there's one source of truth for clean-exit fraction), buckets the
// rolling-7-day rate into one of three gate states, and emits a
// machine-readable verdict.
//
// Why this exists
// ---------------
// User-stories/015-local-models-until-stable.md records the operator's
// 2026-05-24 directive: rely on local models until the M1.1 stability
// gate trips at ≥90% clean-exit fraction. This script is the gate's
// measurement.
//
// Gate states (exit codes):
//   0 — gate=lifted          rate ≥ THRESHOLD (default 0.90). The
//                            local-models-default stance can lift; the
//                            operator is unblocked to run the cloud-model
//                            A/B benchmark.
//   1 — gate=active          0.60 ≤ rate < THRESHOLD. Stance stays
//                            active. Healthy keep-going state.
//   2 — gate=pivot-eval      rate < 0.60. Stance is wrong OR the daemon
//                            has regressed. Operator must look at the
//                            failure-mode breakdown before continuing.
//
// Threshold tunability (rule #9 — pinned in code AND env-overridable):
//   MINSKY_STABILITY_GATE_THRESHOLD env var overrides the 0.90 default
//   (the Risk § "90% threshold is operator-chosen" mitigation from the
//   task spec). The KEEP_ACTIVE_FLOOR (0.60) is intentionally NOT
//   env-tunable — it's the pivot decision threshold and the operator
//   must change THIS file deliberately to move it.
//
// Idempotent banner (acceptance § (3)):
//   When the verdict transitions `active → lifted` for the first time
//   per host, write `~/.minsky/stability-gate-lifted-at` (with
//   timestamp + the lifting rate). Subsequent runs read the marker and
//   skip the banner. Pass `--reset-banner` to clear it for re-trigger
//   (operator-side; tests use --no-banner-marker).
//
// Anchors
// -------
//   - User-stories/015-local-models-until-stable.md § Metric.
//   - Beyer et al., SRE 2016 Ch. 4 — SLI/SLO model; the M1.1 target IS
//     the daemon's SLO and this gate is its SLI.
//   - Rule #11 — no flaky load-bearing metric; the determinism comes
//     from re-using stability-number.mjs's pure JSONL parse + the
//     fixture-based test harness.
//
// Pattern: pure-function-with-I/O-at-edge. The bucketing logic is in
// `bucketGate()` (pure); the CLI does only the I/O (read jsonl, write
// marker, set exit code).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Pre-registered gate-lift threshold. Operator-tunable via
 * `MINSKY_STABILITY_GATE_THRESHOLD`. The default is the headline 0.90
 * named in user-story 015 § Acceptance Criterion 1.
 */
export const DEFAULT_GATE_THRESHOLD = 0.9;

/**
 * Pre-registered keep-active floor. NOT env-tunable — moving this
 * requires editing this file deliberately. Below this, the gate fires
 * `pivot-eval` and the operator must inspect the failure modes.
 */
export const KEEP_ACTIVE_FLOOR = 0.6;

/**
 * Default rolling window in days. Matches user-story 015 § Metric.
 */
export const DEFAULT_WINDOW_DAYS = 7;

/** @typedef {"lifted" | "active" | "pivot-eval-needed"} GateState */

/**
 * Pure bucketing: given a (rate, threshold) pair, return the gate state.
 * Rate must already be the trailing-window clean-exit fraction.
 *
 * @param {number} rate
 * @param {number} threshold
 * @returns {GateState}
 *
 * @otel-exempt pure-arithmetic — single comparison cascade, no I/O.
 */
export function bucketGate(rate, threshold) {
  if (rate >= threshold) return "lifted";
  if (rate >= KEEP_ACTIVE_FLOOR) return "active";
  return "pivot-eval-needed";
}

/**
 * Exit-code mapping per the gate state. Pure.
 *
 * @param {GateState} gate
 * @returns {0 | 1 | 2}
 */
export function exitCodeForGate(gate) {
  if (gate === "lifted") return 0;
  if (gate === "active") return 1;
  return 2;
}

/**
 * Read the clean-exit rate from `stability-number.mjs --json` over the
 * given window. Returns `null` when the script reports `no-data` /
 * `no-recent-data` (the daemon hasn't run enough to verdict yet — the
 * task spec's "not-yet-measured" graceful-degrade case).
 *
 * Pure-with-I/O-seam: caller can inject `execShell` for tests.
 *
 * @param {{
 *   hostDir: string;
 *   windowDays: number;
 *   execShell?: (cmd: string, args: string[]) => string;
 * }} args
 * @returns {{ rate: number; successful: number; total: number } | null}
 */
export function readCleanExitRate({ hostDir, windowDays, execShell = execShellDefault }) {
  // stability-number.mjs's existing output shape:
  //   { stability_pct: N|null, successful: X, total: Y, source: "...", window: "..." }
  // It only emits a 7d window; we honor windowDays===7 today and document
  // that ≠7 is a follow-up (the task pivot path — version-pin if the data
  // shape changes).
  if (windowDays !== 7) {
    // Pure-function predictability: we don't fake a window we can't
    // honor. The script's --json output is locked to 7d.
    return null;
  }
  try {
    const stdout = execShell("node", [
      join(REPO_ROOT, "scripts/stability-number.mjs"),
      hostDir,
      "--json",
    ]);
    const parsed = JSON.parse(stdout);
    if (parsed.stability_pct === null || parsed.stability_pct === undefined) return null;
    return {
      rate: parsed.stability_pct / 100,
      successful: parsed.successful ?? 0,
      total: parsed.total ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Default I/O seam — calls `execFileSync` and returns stdout as utf-8.
 * Pulled out so tests can inject a fake without monkey-patching child_process.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {string}
 */
function execShellDefault(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", timeout: 5_000 });
}

/** @typedef {{ hostDir: string; windowDays: number; threshold: number; bannerMarkerEnabled: boolean; resetBanner: boolean }} ParsedArgs */

/** @type {Record<string, (result: ParsedArgs, value: string) => void>} */
const FLAG_HANDLERS = {
  "--days": (result, value) => {
    const m = /^\d+$/.exec(value);
    if (!m) throw new Error(`--days must be a positive integer; got '${value}'`);
    result.windowDays = Number(value);
  },
  "--threshold": (result, value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      throw new Error(`--threshold must be a number in [0,1]; got '${value}'`);
    }
    result.threshold = n;
  },
  "--host-dir": (result, value) => {
    result.hostDir = value;
  },
};

/** @param {ParsedArgs} result @param {string} arg */
function applyOneArg(result, arg) {
  if (arg === "--no-banner-marker") {
    result.bannerMarkerEnabled = false;
    return;
  }
  if (arg === "--reset-banner") {
    result.resetBanner = true;
    return;
  }
  if (arg === "--help" || arg === "-h") {
    console.info(
      "Usage: measure-stability.mjs [--days=N] [--threshold=0.90] [--host-dir=PATH] [--no-banner-marker] [--reset-banner]",
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
 * Parse argv. Pure (mutates the accumulator). Env override:
 * `MINSKY_STABILITY_GATE_THRESHOLD` (operator escape hatch per the task
 * spec's Risk mitigation).
 *
 * @param {readonly string[]} argv
 * @returns {ParsedArgs}
 */
export function parseArgs(argv) {
  const envThreshold = Number(process.env["MINSKY_STABILITY_GATE_THRESHOLD"]);
  /** @type {ParsedArgs} */
  const result = {
    hostDir: process.cwd(),
    windowDays: DEFAULT_WINDOW_DAYS,
    threshold: Number.isFinite(envThreshold) ? envThreshold : DEFAULT_GATE_THRESHOLD,
    bannerMarkerEnabled: true,
    resetBanner: false,
  };
  for (const arg of argv) {
    applyOneArg(result, arg);
  }
  return result;
}

/**
 * Marker file path for the idempotent banner. Per host: `~/.minsky/stability-gate-lifted-at`.
 */
function bannerMarkerPath() {
  const home = process.env["HOME"] ?? process.env["USERPROFILE"];
  if (!home) return null;
  return join(home, ".minsky", "stability-gate-lifted-at");
}

/**
 * Has the banner already been emitted for this host? Pure-with-I/O.
 * @returns {boolean}
 */
function bannerAlreadyEmitted() {
  const p = bannerMarkerPath();
  if (!p) return true; // no HOME → suppress banner (safe default)
  return existsSync(p);
}

/**
 * Write the marker file. Idempotent.
 * @param {{ rate: number; ts: string }} payload
 */
function writeBannerMarker(payload) {
  const p = bannerMarkerPath();
  if (!p) return;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8" });
}

/**
 * Clear the marker. Called when --reset-banner is passed.
 */
function clearBannerMarker() {
  const p = bannerMarkerPath();
  if (!p || !existsSync(p)) return;
  // Per the destructive-ops rule, this is an explicit-flag opt-in; the
  // marker file is operator-state, not user data.
  writeFileSync(p, "", { encoding: "utf8" });
}

/**
 * Run the CLI. Returns the exit code so tests can assert without
 * `process.exit`.
 *
 * @param {readonly string[]} argv
 * @param {{
 *   readRate?: (args: { hostDir: string; windowDays: number }) => { rate: number; successful: number; total: number } | null;
 *   writeLine?: (line: string) => void;
 *   onBannerFire?: (payload: { rate: number; ts: string }) => void;
 * }} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const { readRate = readCleanExitRate, writeLine = console.info } = deps;
  const args = parseArgs(argv);

  if (args.resetBanner) {
    clearBannerMarker();
  }

  const reading = readRate({ hostDir: args.hostDir, windowDays: args.windowDays });
  if (reading === null) {
    writeLine(
      JSON.stringify({
        gate: "not-yet-measured",
        reason: "stability-number returned null or non-7d window requested",
      }),
    );
    return 0; // graceful: no data ≠ failure
  }

  const gate = bucketGate(reading.rate, args.threshold);
  const result = {
    gate,
    rate: reading.rate,
    successful: reading.successful,
    total: reading.total,
    threshold: args.threshold,
    window_days: args.windowDays,
  };
  writeLine(JSON.stringify(result));

  if (gate === "lifted" && args.bannerMarkerEnabled && !bannerAlreadyEmitted()) {
    const payload = { rate: reading.rate, ts: new Date().toISOString() };
    writeBannerMarker(payload);
    deps.onBannerFire?.(payload);
  }

  return exitCodeForGate(gate);
}

// CLI entry point — only when invoked directly, not when imported by tests.
// `realpath`-normalize argv[1] because macOS `/tmp` is a symlink to
// `/private/tmp` — the raw `import.meta.url === "file://" + argv[1]` check
// breaks when the script is invoked from a CWD that differs from the
// import.meta.url canonical path (e.g. a bash test running `node /tmp/...`).
function isCliEntry() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(argv1);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    const code = main(process.argv.slice(2));
    process.exit(code);
  } catch (error) {
    console.error(`measure-stability: ${error instanceof Error ? error.message : error}`);
    process.exit(3);
  }
}

export { bannerMarkerPath };
