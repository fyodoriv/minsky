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

// Force synchronous (line-buffered) stdout/stderr writes when the daemon
// runs under launchd / systemd-user. Both supervisors redirect stdout to a
// regular file (`StandardOutPath` / `StandardOutput=file`), and Node block-
// buffers writes to a non-TTY file by default — so live `tail -f` against
// the supervisor log shows nothing for minutes at a time even though the
// daemon is iterating. `setBlocking(true)` is the documented Node API for
// this case (since Node 12; see the docs for `tty.WriteStream.setBlocking`,
// which `process.stdout` becomes when its handle supports it). The
// `?.setBlocking?.(true)` chain is defensive — the handle exists in normal
// runtimes but the API may be stripped in some embeds.
/** @type {{ setBlocking?: (b: boolean) => void } | undefined} */
const stdoutHandle = /** @type {{ _handle?: { setBlocking?: (b: boolean) => void } }} */ (
  process.stdout
)._handle;
stdoutHandle?.setBlocking?.(true);
/** @type {{ setBlocking?: (b: boolean) => void } | undefined} */
const stderrHandle = /** @type {{ _handle?: { setBlocking?: (b: boolean) => void } }} */ (
  process.stderr
)._handle;
stderrHandle?.setBlocking?.(true);

import { BudgetGuard } from "@minsky/budget-guard";
import { NtfyNotifier } from "@minsky/notifier";
import { OtelObservability } from "@minsky/observability/otel";
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
//
// Plan tier is operator-controlled via `MINSKY_PLAN`. Anthropic's 5h-window
// cap differs per tier: `pro` = 19k, `max5` = 88k (default — most common),
// `max20` = 220k, `custom` = 44k. An operator on Max20 who runs the daemon
// with the default `max5` cap will see spurious budget-paused iterations
// even when their actual budget has plenty of room. Set the env var in the
// plist's `EnvironmentVariables` (or systemd `Environment=`) to match the
// operator's actual subscription tier.
/** @type {"pro" | "max5" | "max20" | "custom"} */
const planEnv = /** @type {"pro" | "max5" | "max20" | "custom"} */ (
  process.env.MINSKY_PLAN ?? "max5"
);
const tokenMonitor = dryRun
  ? new StubTokenMonitor()
  : new MaciekTokenMonitor({ configDir: resolve(homedir(), ".claude"), plan: planEnv });
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

// Wire the push channel for `runDaemon`'s edge-triggered budget-paused
// notifier (P1 `daemon-budget-pause-observability`, shipped #113). The seam
// is optional in `RunDaemonOpts`; if `MINSKY_NTFY_TOPIC` isn't set the
// daemon still records the budget-paused span — it just doesn't push
// anywhere. This makes opt-in deliberate (rule #2 — every external
// dependency behind an interface; rule #7 — graceful-degrade when the
// dependency is absent). `MINSKY_NTFY_SERVER` overrides the public ntfy.sh
// default for self-hosted; `MINSKY_NTFY_AUTH_TOKEN` is the bearer for
// authenticated topics. None of these are required for the daemon to run.
// Wire the OTEL publisher half of the publish-then-read MAPE-K loop
// (P1 `daemon-otel-pipe`). When `MINSKY_OTEL_ENDPOINT` is set, every
// per-iteration `TickSpan` is forwarded to the OTLP backend (OpenObserve
// out of the box, post-#110); when unset, the daemon still writes the
// stdout line — graceful-degrade per rule #7. Without this, the
// dashboard's `OpenObserveStrategy` reads `(stub)` for every metric
// because the publisher side never wired up.
const otelEndpoint = process.env.MINSKY_OTEL_ENDPOINT;
const observability =
  otelEndpoint === undefined || otelEndpoint.trim() === ""
    ? undefined
    : new OtelObservability({ endpoint: otelEndpoint, serviceName: "minsky-tick-loop" });

const ntfyTopic = process.env.MINSKY_NTFY_TOPIC;
const notifier =
  ntfyTopic === undefined || ntfyTopic.trim() === ""
    ? undefined
    : new NtfyNotifier({
        topic: ntfyTopic,
        ...(process.env.MINSKY_NTFY_SERVER
          ? { serverBaseUrl: process.env.MINSKY_NTFY_SERVER }
          : {}),
        ...(process.env.MINSKY_NTFY_AUTH_TOKEN
          ? { authToken: process.env.MINSKY_NTFY_AUTH_TOKEN }
          : {}),
      });

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
  // Optional push channel; `undefined` when MINSKY_NTFY_TOPIC isn't set.
  ...(notifier !== undefined ? { notifier } : {}),
  emit: (event) => {
    // Plain-text line on stdout for terminal/journalctl visibility.
    process.stdout.write(`[span] ${event.name} ${JSON.stringify(event.attributes)}\n`);
    // Forward to OTEL when wired; the SDK ships to OpenObserve / whatever
    // OTLP backend MINSKY_OTEL_ENDPOINT points at — fire-and-forget per
    // rule #7 graceful-degrade (the OTEL SDK swallows transport errors).
    if (observability !== undefined) {
      observability.emitTickSpan(event);
    }
  },
});

if (notifier !== undefined) {
  process.stdout.write(`[tick-loop] notifier wired (ntfy topic=${ntfyTopic})\n`);
} else {
  process.stdout.write(
    "[tick-loop] no notifier wired (set MINSKY_NTFY_TOPIC to enable budget-paused pushes)\n",
  );
}
if (observability !== undefined) {
  process.stdout.write(`[tick-loop] OTEL wired (endpoint=${otelEndpoint})\n`);
} else {
  process.stdout.write(
    "[tick-loop] no OTEL wired (set MINSKY_OTEL_ENDPOINT to publish spans to OpenObserve)\n",
  );
}

process.stdout.write(
  `[tick-loop] ${result.totalIterations} iteration(s) (${result.stoppedReason})\n`,
);
for (const it of result.iterations) {
  process.stdout.write(
    `[tick-loop] iteration ${it.iteration}: ${it.status}${it.taskId ? ` task=${it.taskId}` : ""}${it.reason ? ` (${it.reason})` : ""}\n`,
  );
}
