#!/usr/bin/env node
// @ts-check
/**
 * `tick-loop` CLI — the I/O boundary that constructs the daemon's
 * dependencies and invokes `runDaemon` from the compiled
 * `@minsky/tick-loop/dist/daemon.js`.
 *
 * Sub-task 3/3 of `tick-loop-daemon-real-spawn` (`tick-loop-daemon-real-spawn-flip`):
 * the production default is now `ProcessSpawnStrategy` — a real
 * `node:child_process.spawn('claude', ['--print'])` per iteration (headless;
 * brief on stdin, response on stdout). Dry-run is opt-in via the
 * `MINSKY_TICK_DRY_RUN=1` env var (the new control surface; the old
 * `--dry-run` argv flag has been retired). The `--print` default replaced
 * the legacy `--resume` default per `tick-loop-spawn-args-fresh-session`.
 *
 *   $ node bin/tick-loop.mjs --max-iterations=4         # real spawn
 *   $ MINSKY_TICK_DRY_RUN=1 node bin/tick-loop.mjs ...   # safe dry-run
 *
 * Args:
 *   --max-iterations=N                 (default: Infinity)
 *   --tick-interval-ms=MS              (default: 300_000 — 5 min)
 *   --tasks-md=PATH                    (default: ${MINSKY_HOME}/TASKS.md)
 *   --paused-sentinel=PATH             (default: ${MINSKY_HOME}/state/PAUSED)
 *
 * Env:
 *   MINSKY_TICK_DRY_RUN=1|true         opt-in dry-run (DryRunSpawnStrategy)
 *
 * Pattern: thin runner / I/O boundary (Martin, *Clean Architecture*, 2017).
 * The CLI does the file-reads and constructs the budget-guard + Strategy;
 * `runDaemon` is the pure orchestrator above.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { BudgetGuard } from "@minsky/budget-guard";
import { MaciekTokenMonitor, StubTokenMonitor } from "@minsky/token-monitor";

import {
  DryRunSpawnStrategy,
  ProcessSpawnStrategy,
  TestFakeMockAnthropic,
  fromRealBudgetGuard,
  runDaemon,
} from "../dist/index.js";

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
 * Decide dry-run from `MINSKY_TICK_DRY_RUN` env. `1` or `true` (case-insensitive)
 * → dry-run. Anything else (unset, `0`, `false`, …) → real spawn.
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
function readDryRunEnv(env) {
  const raw = env.MINSKY_TICK_DRY_RUN;
  if (raw === undefined) return false;
  const normalised = raw.trim().toLowerCase();
  return normalised === "1" || normalised === "true";
}

/**
 * @param {readonly string[]} argv
 * @returns {{
 *   maxIterations: number,
 *   tickIntervalMs: number,
 *   tasksMdPath: string,
 *   pausedSentinelPath: string,
 * }}
 */
function parseArgs(argv) {
  const minskyHome = process.env.MINSKY_HOME ?? resolve(PKG_ROOT, "..", "..");
  const out = {
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
 *   maxIterations: number,
 *   tickIntervalMs: number,
 *   tasksMdPath: string,
 *   pausedSentinelPath: string,
 * }} out
 */
function applyArg(arg, out) {
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
const dryRun = readDryRunEnv(process.env);

// Sub-task 2/3: wire the real `BudgetGuard` from `@minsky/budget-guard`.
// Dry-run uses a `StubTokenMonitor` (a fresh, full 5h window — no I/O against
// `~/.claude/projects`) so the local smoke stays hermetic; production
// (real spawn) uses `MaciekTokenMonitor` against the user's Claude Code
// config dir, the same data source Maciek's `claude-monitor` reads.
const tokenMonitor = dryRun
  ? new StubTokenMonitor()
  : new MaciekTokenMonitor({ configDir: resolve(homedir(), ".claude") });
const realGuard = new BudgetGuard(tokenMonitor, () => {
  /* push-decision side effects (flag-file, OTEL) live in a follow-up;
     the daemon only branches on `decide()`'s return value. */
});

// Sub-task 3/3: production default is `ProcessSpawnStrategy` (real
// `claude --print` headless subprocess — brief on stdin, response on stdout
// per `claude --help`); `MINSKY_TICK_DRY_RUN=1` opts back to
// `DryRunSpawnStrategy`. The Strategy is the spawn-step seam (rule #2,
// Gamma 1994) so the flip is a one-line constructor swap. The legacy
// `--resume` default opened an interactive session picker (TTY) and
// resumed the previous conversation — fixed by
// `tick-loop-spawn-args-fresh-session`; default args come from
// `ProcessSpawnStrategyOptions` (currently `["--print"]`).
const spawnStrategy = dryRun
  ? new DryRunSpawnStrategy()
  : new ProcessSpawnStrategy({ command: "claude" });

const result = await runDaemon({
  tickInterval: args.tickIntervalMs,
  maxIterations: args.maxIterations,
  // `dryRun` here is the legacy v0 guard inside `runDaemon`; setting it to
  // `true` keeps `runDaemon`'s legacy throw-on-misuse semantics quiet for
  // the dry-run Strategy, while injecting `spawnStrategy` makes the daemon
  // dispatch via the Strategy (real spawn or dry-run, decided above).
  dryRun,
  mockClient: new TestFakeMockAnthropic(),
  spawnStrategy,
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
