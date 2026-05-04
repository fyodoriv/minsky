#!/usr/bin/env node
// @ts-check
/**
 * `tick-loop` CLI — the I/O boundary that constructs the daemon's
 * dependencies and invokes `runDaemon` from the compiled
 * `@minsky/tick-loop/dist/daemon.js`.
 *
 * v0 ships ONLY the dry-run path (per the brief — `tick-loop-daemon-v0`):
 *   $ node bin/tick-loop.mjs --dry-run --max-iterations=4
 *
 * Real subprocess spawning is deferred to `tick-loop-daemon-real-spawn`;
 * passing `--dry-run=false` (or omitting `--dry-run` and not setting the
 * env-var override) makes the daemon throw before any I/O.
 *
 * Args:
 *   --dry-run                          (required in v0; v0 throws otherwise)
 *   --max-iterations=N                 (default: Infinity)
 *   --tick-interval-ms=MS              (default: 300_000 — 5 min)
 *   --tasks-md=PATH                    (default: ${MINSKY_HOME}/TASKS.md)
 *   --paused-sentinel=PATH             (default: ${MINSKY_HOME}/state/PAUSED)
 *
 * Pattern: thin runner / I/O boundary (Martin, *Clean Architecture*, 2017).
 * The CLI does the file-reads and constructs the budget-guard stub;
 * `runDaemon` is the pure orchestrator above.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { BudgetGuard } from "@minsky/budget-guard";
import { MaciekTokenMonitor, StubTokenMonitor } from "@minsky/token-monitor";

import { TestFakeMockAnthropic, fromRealBudgetGuard, runDaemon } from "../dist/index.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PKG_ROOT = resolve(HERE, "..");

/**
 * Strip `--key=` from an arg if it matches; return the value or undefined.
 * @param {string} arg
 * @param {string} prefix
 * @returns {string|undefined}
 */
function valueAfter(arg, prefix) {
  return arg.startsWith(prefix) ? arg.slice(prefix.length) : undefined;
}

/**
 * @param {readonly string[]} argv
 * @returns {{
 *   dryRun: boolean,
 *   maxIterations: number,
 *   tickIntervalMs: number,
 *   tasksMdPath: string,
 *   pausedSentinelPath: string,
 * }}
 */
function parseArgs(argv) {
  const minskyHome = process.env.MINSKY_HOME ?? resolve(PKG_ROOT, "..", "..");
  const out = {
    dryRun: false,
    maxIterations: Number.POSITIVE_INFINITY,
    tickIntervalMs: 300_000, // 5 min
    tasksMdPath: resolve(minskyHome, "TASKS.md"),
    pausedSentinelPath: resolve(minskyHome, "state", "PAUSED"),
  };
  for (const arg of argv) {
    applyArg(arg, out);
  }
  return out;
}

/**
 * @param {string} arg
 * @param {{
 *   dryRun: boolean,
 *   maxIterations: number,
 *   tickIntervalMs: number,
 *   tasksMdPath: string,
 *   pausedSentinelPath: string,
 * }} out
 */
function applyArg(arg, out) {
  if (arg === "--dry-run") {
    out.dryRun = true;
    return;
  }
  const max = valueAfter(arg, "--max-iterations=");
  if (max !== undefined) out.maxIterations = Number(max);
  const interval = valueAfter(arg, "--tick-interval-ms=");
  if (interval !== undefined) out.tickIntervalMs = Number(interval);
  const tasks = valueAfter(arg, "--tasks-md=");
  if (tasks !== undefined) out.tasksMdPath = tasks;
  const paused = valueAfter(arg, "--paused-sentinel=");
  if (paused !== undefined) out.pausedSentinelPath = paused;
}

const args = parseArgs(process.argv.slice(2));

// Sub-task 2/3 of `tick-loop-daemon-real-spawn`: wire the real
// `BudgetGuard` from `@minsky/budget-guard`. For `--dry-run` we still use a
// `StubTokenMonitor` (a fresh, full 5h window — no I/O against
// `~/.claude/projects`) so the local smoke stays hermetic; production
// (non-dry-run) uses `MaciekTokenMonitor` against the user's Claude Code
// config dir, the same data source Maciek's `claude-monitor` reads.
const tokenMonitor = args.dryRun
  ? new StubTokenMonitor()
  : new MaciekTokenMonitor({ configDir: resolve(homedir(), ".claude") });
const realGuard = new BudgetGuard(tokenMonitor, () => {
  /* push-decision side effects (flag-file, OTEL) live in a follow-up;
     the daemon only branches on `decide()`'s return value. */
});

const result = await runDaemon({
  tickInterval: args.tickIntervalMs,
  maxIterations: args.maxIterations,
  dryRun: args.dryRun,
  mockClient: new TestFakeMockAnthropic(),
  tasksMdReader: () => readFileSync(args.tasksMdPath, "utf-8"),
  pausedSentinelReader: () => existsSync(args.pausedSentinelPath),
  // Real `BudgetGuard.tick()` wrapped behind the daemon's `BudgetGuardLike.decide()` shape.
  budgetGuard: fromRealBudgetGuard(realGuard),
  emit: (event) => {
    // Plain-text span emission to stdout — operator can pipe to journalctl
    // (systemd) or `tail -f` (launchd). Real OTEL wiring is `tick-loop-daemon-real-spawn`.
    process.stdout.write(`[span] ${event.name} ${JSON.stringify(event.attributes)}\n`);
  },
});

process.stdout.write(
  `[tick-loop] ${result.totalIterations} iteration(s) (${result.stoppedReason})\n`,
);
for (const it of result.iterations) {
  process.stdout.write(
    `[tick-loop] iteration ${it.iteration}: ${it.status}${it.taskId ? ` task=${it.taskId}` : ""}${it.reason ? ` (${it.reason})` : ""}\n`,
  );
}
