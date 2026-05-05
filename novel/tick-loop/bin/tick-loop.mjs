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

import { execFile as execFileCb } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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
  createFileBackedCtoAuditLock,
  createGitGhSignalsBuilder,
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
// `MINSKY_PLAN_CAP_OVERRIDE` (rule #2 escape hatch) lets the operator
// override the heuristic per-plan ceiling without code changes. Parsed
// here at the I/O boundary; non-integer / non-positive values fall back
// to the plan default (the constructor itself ignores invalid overrides
// — this is just an early-fail nicety so the operator sees a clean path).
const planCapOverride = (() => {
  const raw = process.env["MINSKY_PLAN_CAP_OVERRIDE"];
  if (raw === undefined || raw === "") return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
})();
const tokenMonitor = dryRun
  ? new StubTokenMonitor()
  : new MaciekTokenMonitor({
      configDir: resolve(homedir(), ".claude"),
      ...(planCapOverride === undefined ? {} : { cap: planCapOverride }),
    });
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

// Sub-step (d/e/f) of `post-task-cto-audit` — opt-in CLI-side construction
// of the `CtoAuditSeam`. Default is OFF so the audit's prompt-engineering
// surface ships behind an explicit flag (rule #9 pivot threshold #1: don't
// fire >5 audits/day on first rollout). Setting `MINSKY_CTO_AUDIT_ENABLE=1`
// (or `true`) constructs:
//   - `spawn` — re-uses the daemon's already-constructed `spawnStrategy`
//     (structurally compatible with `CtoAuditSpawn` per task spec sub-step (a));
//   - `lock` — file-backed at `<MINSKY_HOME>/.minsky/cto-audit-lock/<id>` so
//     the cap-1-per-task contract (sub-step f) survives daemon restart;
//   - `buildSignals` — `git log` / `gh issue/pr list` collector with rule-#7
//     graceful-degrade on offline / rate-limit.
// The audit's own gate (`shouldRunCtoAudit`) still respects
// `MINSKY_CTO_AUDIT=off` for per-iteration skips even when the seam is wired.
const ctoAuditEnabled = (() => {
  const raw = process.env.MINSKY_CTO_AUDIT_ENABLE;
  if (raw === undefined) return false;
  const normalised = raw.trim().toLowerCase();
  return normalised === "1" || normalised === "true";
})();
const ctoAuditSeam = (() => {
  if (!ctoAuditEnabled) return undefined;
  const minskyHome = process.env.MINSKY_HOME ?? resolve(PKG_ROOT, "..", "..");
  const lockDir = resolve(minskyHome, ".minsky", "cto-audit-lock");
  const execFile = promisify(execFileCb);
  /** @type {import("../dist/index.js").ExecFileLike} */
  const execFileLike = async (file, args) => {
    const { stdout } = await execFile(file, [...args], { encoding: "utf-8" });
    return stdout;
  };
  return {
    spawn: spawnStrategy,
    lock: createFileBackedCtoAuditLock(lockDir),
    buildSignals: createGitGhSignalsBuilder({ execFile: execFileLike }),
  };
})();

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
  // Optional CTO-audit seam; `undefined` when MINSKY_CTO_AUDIT_ENABLE isn't 1/true.
  ...(ctoAuditSeam !== undefined ? { ctoAudit: ctoAuditSeam } : {}),
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
if (ctoAuditSeam !== undefined) {
  process.stdout.write("[tick-loop] CTO audit wired (file-backed lock + git/gh signals)\n");
} else {
  process.stdout.write(
    "[tick-loop] no CTO audit wired (set MINSKY_CTO_AUDIT_ENABLE=1 to fire post-task audits)\n",
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
