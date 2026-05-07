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
  LlmProviderSpawnStrategy,
  ProcessSpawnStrategy,
  TestFakeMockAnthropic,
  analyzeConfig,
  buildAiderInvocation,
  buildChildWorkerArgs,
  buildClaudePrintInvocation,
  createBodyAwarePrePrLintRun,
  createFileBackedChangelogReader,
  createFileBackedCtoAuditLock,
  createFileBackedLastRenderedDate,
  createFileBackedSnapshotExists,
  createGitGhSignalsBuilder,
  createOpenPrFetcher,
  createPnpmMetricsRender,
  createPnpmSnapshotCapture,
  detectCtoAuditEnvDrift,
  ensureCtoAuditLabel,
  formatRecommendations,
  fromRealBudgetGuard,
  isDaemonAuthoredBranch,
  parseSpawnAdditionalWorkers,
  parseWorkerArgs,
  runDaemon,
  sandboxModeStartupHint,
  workerStartupLine,
} from "../dist/index.js";

import { spawn as nodeSpawn } from "node:child_process";

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
// Top-level minskyHome — multiple downstream consumers (pre-PR lint gate,
// CTO-audit, changelog, snapshot, metrics-render) need this. Was previously
// only declared inside the seam IIFEs which left line-698's preLintRun ref
// to `minskyHome` referencing an undefined identifier (latent bug exposed
// when the bin runs end-to-end). Single source of truth here.
const minskyHome = process.env.MINSKY_HOME ?? resolve(PKG_ROOT, "..", "..");

// Slice 2 of `daemon-parallel-worktree-launch`: parse `--worker-id` /
// `--workers-total`. New default (2026-05-06): claim-aware worker-0-of-1 when
// neither flag is set, so additional workers can join later without a
// behaviour change on the existing process. `--workers-total=N` alone is OK
// (defaults `--worker-id=0`); `--worker-id=K` alone is an error.
const workerParseResult = parseWorkerArgs(process.argv.slice(2));
if ("error" in workerParseResult) {
  console.error(`tick-loop: ${workerParseResult.error}`);
  process.exit(2);
}

// Slice 2.6 of `daemon-parallel-worktree-launch`: `--spawn-additional-workers=N`
// makes the root process fork N children at startup, each with
// `--worker-id=K --workers-total=(N+1)` and `MINSKY_WORKER_SPAWNED=1` in env so
// they cannot recursively spawn (depth-2 cap: only grandchildren allowed).
const spawnDecision = parseSpawnAdditionalWorkers({
  argv: process.argv.slice(2),
  env: process.env,
});
if ("error" in spawnDecision) {
  console.error(`tick-loop: ${spawnDecision.error}`);
  process.exit(2);
}

let workerConfig = workerParseResult;
if (spawnDecision.count > 0) {
  const totalAfterSpawn = spawnDecision.count + 1;
  workerConfig = { workerId: 0, workersTotal: totalAfterSpawn };
  for (let i = 1; i <= spawnDecision.count; i++) {
    const childArgs = buildChildWorkerArgs({
      parentArgv: process.argv.slice(2),
      childIndex: i,
      totalAfterSpawn,
    });
    const child = nodeSpawn(process.execPath, [process.argv[1], ...childArgs], {
      env: { ...process.env, MINSKY_WORKER_SPAWNED: "1" },
      stdio: "inherit",
      detached: false,
    });
    console.error(
      `tick-loop: spawned worker ${i}/${spawnDecision.count} as PID ${child.pid} (worker-id=${i}, workers-total=${totalAfterSpawn})`,
    );
  }
}

console.error(workerStartupLine(workerConfig));

// Daemon self-config analyzer (operator 2026-05-06): inspect env + argv at
// boot and print recommendations the operator should consider. Heuristics:
//   - isSelfDogfood: the package.json at MINSKY_HOME has "name": "minsky"
//     (the parent repo); falls back to "true when MINSKY_HOME contains a
//     package.json with a `minsky` name field, false otherwise".
//   - isLaunchd: parent process is launchd (PPID == 1 on macOS user agent
//     mode; we just inspect process.env.LAUNCHD_SOCKET as a signal).
const isSelfDogfood = (() => {
  try {
    const pj = JSON.parse(readFileSync(resolve(args.tasksMdPath, "..", "package.json"), "utf-8"));
    return pj?.name === "minsky";
  } catch {
    return false;
  }
})();
const isLaunchd = process.env["LAUNCHD_SOCKET_NAME"] !== undefined;
const recs = analyzeConfig({
  env: process.env,
  argv: process.argv.slice(2),
  isSelfDogfood,
  isLaunchd,
});
if (recs.length > 0) {
  console.error(formatRecommendations(recs));
} else {
  console.error("[config-analyzer] OK — no recommendations.");
}

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
// `daemon-claude-print-hang-watchdog` (operator 2026-05-07): per-iteration
// timeout on the `claude --print` subprocess. Default 900_000ms (15 min) — well
// above the 95th-percentile productive iteration but low enough that a stuck
// child doesn't silently freeze a worker for hours (the worker-1 hang of
// 2026-05-07 ran 1h 56min before manual intervention). Operator-overridable
// via `MINSKY_CLAUDE_PRINT_TIMEOUT_MS` env var; non-positive disables.
const claudePrintTimeoutMs = (() => {
  const raw = process.env["MINSKY_CLAUDE_PRINT_TIMEOUT_MS"];
  if (raw === undefined) return 900_000;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
})();
// Wire the OTEL publisher EARLY (was below; moved up for the slice-3
// local-llm wrapper to capture the `emit` callback). When
// `MINSKY_OTEL_ENDPOINT` is set, every span is forwarded to the OTLP
// backend (OpenObserve out of the box, post-#110); when unset, the
// daemon still writes the stdout line — graceful-degrade per rule #7.
const otelEndpoint = process.env.MINSKY_OTEL_ENDPOINT;
const observability =
  otelEndpoint === undefined || otelEndpoint.trim() === ""
    ? undefined
    : new OtelObservability({ endpoint: otelEndpoint, serviceName: "minsky-tick-loop" });

// Slice 3 of `local-llm-fallback-on-budget-pause` — opt-in local-LLM
// fallback via env vars:
//   - MINSKY_LOCAL_LLM=1 enables the fallback wrapper. When unset, the
//     daemon uses the legacy single-strategy claude path (back-compat
//     with all existing operator deployments).
//   - MINSKY_LLM_PROVIDER=claude-only forces claude regardless of state
//     (operator escape hatch — the wrapper still wraps, it just always
//     dispatches to claude). MINSKY_LLM_PROVIDER=local-preferred opts
//     into local-when-reachable.
//   - MINSKY_LOCAL_LLM_PROBE_URL overrides the default probe URL
//     (default: http://127.0.0.1:8080/v1/models — the mlx-lm.server
//     endpoint per docs/local-llm-fallback.md).
//   - MINSKY_LOCAL_LLM_PROBE_TTL_MS overrides the probe cache TTL
//     (default: 60000).
//   - MINSKY_LOCAL_LLM_AIDER_BIN overrides the aider binary path
//     (default: bare `aider` on PATH; useful when aider is in a venv).
const localLlmEnabled = (() => {
  const raw = process.env.MINSKY_LOCAL_LLM;
  if (raw === undefined) return false;
  const normalised = raw.trim().toLowerCase();
  return normalised === "1" || normalised === "true";
})();
const llmProviderOverride = (process.env.MINSKY_LLM_PROVIDER ?? "").trim().toLowerCase();
const forceClaude = llmProviderOverride === "claude-only";
const preferLocal = llmProviderOverride === "local-preferred";
const localProbeUrl = process.env.MINSKY_LOCAL_LLM_PROBE_URL ?? "http://127.0.0.1:8080/v1/models";
const localProbeTtlMs = (() => {
  const raw = process.env.MINSKY_LOCAL_LLM_PROBE_TTL_MS;
  if (raw === undefined) return 60_000;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
})();
// Slice 4: switchback-probe interval — every Nth iteration on local,
// the wrapper forces a claude probe (suppresses the carried hard-limit
// failure) so the operator's quota window rollover is detected within
// `N × tickIntervalMs` minutes. Default 5 (unspecified env). Set to 0
// to disable probing entirely.
const switchbackProbeEvery = (() => {
  const raw = process.env.MINSKY_LOCAL_LLM_SWITCHBACK_PROBE_EVERY;
  if (raw === undefined) return undefined; // wrapper picks default 5
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
})();
const aiderBin = process.env.MINSKY_LOCAL_LLM_AIDER_BIN ?? "aider";

/**
 * Probe the local mlx-lm.server. Reuses the same logic as
 * `scripts/check-mlx-server.mjs` but inlined here so we don't shell out
 * once per tick. Returns a `LocalProbeResult`.
 *
 * @returns {Promise<{reachable: boolean, observedAtMs: number, reason?: string}>}
 */
async function probeLocalLlm() {
  const observedAtMs = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5_000);
  try {
    const resp = await fetch(localProbeUrl, { signal: ac.signal, method: "GET" });
    if (resp.ok) return { reachable: true, observedAtMs };
    return { reachable: false, observedAtMs, reason: `http ${resp.status}` };
  } catch (err) {
    /** @type {{cause?: {code?: string}, code?: string, name?: string, message?: string}} */
    const e = /** @type {any} */ (err);
    const code = e?.cause?.code ?? e?.code;
    const reason =
      typeof code === "string"
        ? code
        : e?.name === "AbortError"
          ? "timeout"
          : (e?.message ?? "unknown");
    return { reachable: false, observedAtMs, reason: String(reason).slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

const spawnStrategy = (() => {
  // Build the underlying claude strategy. In dry-run mode it's a
  // `DryRunSpawnStrategy` (synthetic — no subprocess); in production
  // it's `ProcessSpawnStrategy` over `claude --print`.
  const claudeStrat = dryRun
    ? new DryRunSpawnStrategy()
    : new ProcessSpawnStrategy({
        command: "claude",
        ...(claudePrintTimeoutMs !== undefined ? { timeoutMs: claudePrintTimeoutMs } : {}),
        invocation: (input) =>
          buildClaudePrintInvocation({
            brief: input.brief,
            ...(input.extraArgs && input.extraArgs.length > 0
              ? { extraArgs: input.extraArgs }
              : {}),
          }),
      });
  if (!localLlmEnabled) return claudeStrat;
  // Local-LLM fallback wired. Build the aider strategy (also dry-run-
  // aware so the chaos test in slice 6 can exercise the dispatch path
  // without spawning real aider subprocesses) and wrap both in
  // `LlmProviderSpawnStrategy`.
  const localStrat = dryRun
    ? new DryRunSpawnStrategy()
    : new ProcessSpawnStrategy({
        command: aiderBin,
        ...(claudePrintTimeoutMs !== undefined ? { timeoutMs: claudePrintTimeoutMs } : {}),
        invocation: (input) =>
          buildAiderInvocation({
            brief: input.brief,
            command: aiderBin,
          }),
      });
  process.stdout.write(
    `[tick-loop] local-llm fallback wired (probe=${localProbeUrl}, ttl=${localProbeTtlMs}ms, override=${llmProviderOverride || "auto"}${dryRun ? ", dry-run" : ""})\n`,
  );
  return new LlmProviderSpawnStrategy({
    claude: claudeStrat,
    local: localStrat,
    probe: probeLocalLlm,
    // The wrapper consumes the daemon's `BudgetGuardLike.decide()` shape,
    // not the real `BudgetGuard.tick()` shape. `fromRealBudgetGuard` is
    // the one-line Adapter (per `budget-guard-facade.ts`).
    budgetGuard: fromRealBudgetGuard(realGuard),
    probeTtlMs: localProbeTtlMs,
    ...(switchbackProbeEvery === undefined ? {} : { switchbackProbeEvery }),
    forceClaude,
    preferLocal,
    emit: (event) => {
      // Forward the dispatch span to OTEL when wired; always also write
      // to stdout for the operator's `tail` view.
      process.stdout.write(`[span] ${event.name} ${JSON.stringify(event.attributes)}\n`);
      if (observability !== undefined) {
        observability.emitTickSpan(event);
      }
    },
  });
})();
if (!localLlmEnabled) {
  process.stdout.write(
    "[tick-loop] no local-llm fallback wired (set MINSKY_LOCAL_LLM=1 + run mlx-lm.server to enable claude→local switch on hard-limit)\n",
  );
}

// Wire the push channel for `runDaemon`'s edge-triggered budget-paused
// notifier (P1 `daemon-budget-pause-observability`, shipped #113). The seam
// is optional in `RunDaemonOpts`; if `MINSKY_NTFY_TOPIC` isn't set the
// daemon still records the budget-paused span — it just doesn't push
// anywhere. This makes opt-in deliberate (rule #2 — every external
// dependency behind an interface; rule #7 — graceful-degrade when the
// dependency is absent). `MINSKY_NTFY_SERVER` overrides the public ntfy.sh
// default for self-hosted; `MINSKY_NTFY_AUTH_TOKEN` is the bearer for
// authenticated topics. None of these are required for the daemon to run.
//
// (OTEL `observability` was wired earlier — moved up so the slice-3
// local-llm wrapper can capture `observability` in its `emit` closure.)

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
/**
 * Promisified `execFile` adapter that returns trimmed stdout and rejects
 * on non-zero exit. Reused by both the CTO-audit signals collector and
 * the audit-label preflight below.
 *
 * @type {import("../dist/index.js").ExecFileLike}
 */
const execFileLike = (() => {
  const execFile = promisify(execFileCb);
  return async (file, args) => {
    const { stdout } = await execFile(file, [...args], { encoding: "utf-8" });
    return stdout;
  };
})();
const ctoAuditSeam = (() => {
  if (!ctoAuditEnabled) return undefined;
  const minskyHome = process.env.MINSKY_HOME ?? resolve(PKG_ROOT, "..", "..");
  const lockDir = resolve(minskyHome, ".minsky", "cto-audit-lock");
  return {
    spawn: spawnStrategy,
    lock: createFileBackedCtoAuditLock(lockDir),
    buildSignals: createGitGhSignalsBuilder({ execFile: execFileLike }),
  };
})();

// Audit-label preflight: when the CTO-audit seam is wired, idempotently
// ensure the `minsky:cto-audit` label exists on the current GitHub repo
// before the supervisor enters its tick loop. Without this, the audit's
// first PR-create can fail with "label not found" and the pre-registered
// measurement query (`gh pr list --label minsky:cto-audit ...`) is unable
// to see audit PRs from the moment they open. The CTO_PROMPT_HEADER also
// instructs the spawned agent to create the label idempotently as a
// fallback, but that path is LLM-runtime-dependent; this preflight is the
// deterministic substrate so the agent never has to.
//
// Graceful-degrade per rule #7: outcome `"skipped-degraded"` (gh missing,
// offline, unauthenticated) does not crash the supervisor — the lint
// (`scripts/check-cto-audit-pr-conventions.mjs`) is the post-hoc gate
// that blocks any audit PR that lands without the label.
if (ctoAuditSeam !== undefined) {
  const outcome = await ensureCtoAuditLabel({ execFile: execFileLike });
  process.stdout.write(`[tick-loop] cto-audit label preflight: ${outcome}\n`);
}

// Source-plist ↔ live-env drift detector. Surfaces install drift between
// `distribution/launchd/com.minsky.tick-loop.plist` (source of truth) and
// `~/Library/LaunchAgents/com.minsky.tick-loop.plist` (installed copy)
// without waiting for a supervisor restart. The install-drift case
// (source enables MINSKY_CTO_AUDIT_ENABLE but live env is unset) silently
// zeroes the pre-registered measurement query
// (`gh pr list --label minsky:cto-audit ...` returns 0 forever) — PR #214's
// wire-status announcement only catches it post-restart, but the operator
// running `tail` against the supervisor log sees the loud warning here at
// boot. Runs unconditionally — even when the seam isn't wired, the
// drift-stale-install case IS itself the reason the seam wasn't wired
// (live env unset because the installed plist is older than the source).
const envDrift = detectCtoAuditEnvDrift({
  sourcePlistPath: resolve(
    process.env.MINSKY_HOME ?? resolve(PKG_ROOT, "..", ".."),
    "distribution/launchd/com.minsky.tick-loop.plist",
  ),
  liveEnv: process.env,
});
if (envDrift === "drift-stale-install") {
  process.stdout.write(
    "[tick-loop] WARN cto-audit env drift (drift-stale-install): source plist enables " +
      "MINSKY_CTO_AUDIT_ENABLE=1 but the supervisor's live env doesn't. The installed " +
      "launchd agent (~/Library/LaunchAgents/com.minsky.tick-loop.plist) is older than " +
      "the source plist. Re-install via `pnpm dogfood:install` then restart the agent " +
      "(`launchctl kickstart -k gui/$(id -u)/com.minsky.tick-loop`) to load the new env.\n",
  );
} else {
  process.stdout.write(`[tick-loop] cto-audit env drift check: ${envDrift}\n`);
}

// Daily-changelog acceptance criterion (3) — CLI-side construction of the
// `ChangelogSeam`. Default is OFF for parity with the CTO-audit opt-in
// (rule #9 pivot threshold #1: don't fire >1 spawn/day on first rollout).
// Setting `MINSKY_CHANGELOG_ENABLE=1` (or `true`) constructs:
//   - `spawn` — re-uses the daemon's already-constructed `spawnStrategy`
//     (structurally compatible with `ChangelogSpawn` per task spec sub-step (a));
//   - `readChangelog` — file-backed reader at `<MINSKY_HOME>/CHANGELOG.md`
//     with ENOENT graceful-degrade (genesis-entry case fires on a fresh
//     checkout pre-CHANGELOG.md).
// The runner's own gate (`shouldRunChangelog`) still respects
// `MINSKY_CHANGELOG=off` for ad-hoc skips even when the seam is wired.
const changelogEnabled = (() => {
  const raw = process.env.MINSKY_CHANGELOG_ENABLE;
  if (raw === undefined) return false;
  const normalised = raw.trim().toLowerCase();
  return normalised === "1" || normalised === "true";
})();
const changelogSeam = (() => {
  if (!changelogEnabled) return undefined;
  const minskyHome = process.env.MINSKY_HOME ?? resolve(PKG_ROOT, "..", "..");
  const changelogPath = resolve(minskyHome, "CHANGELOG.md");
  return {
    spawn: spawnStrategy,
    readChangelog: createFileBackedChangelogReader(changelogPath),
  };
})();

// Daily-changelog acceptance criterion (3) — CLI-side construction of the
// `SnapshotSeam` (the per-day snapshot-writer leg of `daily-changelog-for-humans`).
// Wires under the same umbrella opt-in as the changelog seam: snapshots are
// the data substrate `pnpm changelog:today` reads via `loadSnapshot`, so it
// would be incoherent to wire the changelog author without also wiring the
// per-day writer (the next-day Δ rendering would have nothing to diff
// against). When `MINSKY_CHANGELOG_ENABLE=1` is set, the CLI constructs:
//   - `snapshotExists` — file-backed probe at `<MINSKY_HOME>/.minsky/metric-snapshots/<date>.json`
//     (the snapshot file IS the per-day "this happened" record; rule #2
//     data-not-code, one source of truth);
//   - `capture` — spawns `pnpm changelog:snapshot --date <date>` (the
//     producer CLI shipped #188) with bounded stdout/stderr tails.
// Both seams' per-iteration gates still respect `MINSKY_CHANGELOG=off`
// for ad-hoc skips; idempotency comes from the snapshot file presence,
// not a separate lock dir (rule #2 — one source of truth).
const snapshotSeam = (() => {
  if (!changelogEnabled) return undefined;
  const minskyHome = process.env.MINSKY_HOME ?? resolve(PKG_ROOT, "..", "..");
  return {
    snapshotExists: createFileBackedSnapshotExists(minskyHome),
    capture: createPnpmSnapshotCapture({ cwd: minskyHome }),
  };
})();

// `canonical-metric-list-per-repo` Acceptance (3) — CLI-side construction
// of the `MetricsRenderSeam` (the per-day `METRICS.md` writer). Wires
// under the same umbrella opt-in as the changelog + snapshot seams: the
// renderer reads from `.minsky/metric-snapshots/<date>.json` (the
// substrate the snapshot seam writes), so it would be incoherent to wire
// the renderer without the snapshot writer below it. When
// `MINSKY_CHANGELOG_ENABLE=1` is set, the CLI constructs:
//   - `getLastRenderedDate` — file-backed mtime probe at
//     `<MINSKY_HOME>/METRICS.md` (genesis case returns `null` so the
//     first daemon iteration of a fresh checkout authors the file —
//     rule #2, the file mtime IS the per-day "this happened" record);
//   - `render` — spawns `pnpm metrics:render --date <date>` (the operator
//     CLI shipped slice 3/N, #196) with bounded stdout/stderr tails.
// The runner's own gate (`shouldRunMetricsRender`) still respects
// `MINSKY_CHANGELOG=off` for ad-hoc skips; idempotency comes from the
// METRICS.md mtime, not a separate lock dir.
const metricsRenderSeam = (() => {
  if (!changelogEnabled) return undefined;
  const minskyHome = process.env.MINSKY_HOME ?? resolve(PKG_ROOT, "..", "..");
  return {
    getLastRenderedDate: createFileBackedLastRenderedDate(resolve(minskyHome, "METRICS.md")),
    render: createPnpmMetricsRender({ cwd: minskyHome }),
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

// Wire-status announcements emitted at supervisor STARTUP, before
// `runDaemon` enters its (in production, non-terminating) loop. Without
// this, the symmetric "no X wired" lines fire only after `runDaemon`
// returns — unreachable under launchd/systemd-user, where the supervisor
// runs indefinitely. The visible failure mode this guards against:
// install drift between `distribution/launchd/com.minsky.tick-loop.plist`
// (source) and `~/Library/LaunchAgents/com.minsky.tick-loop.plist`
// (installed) silently zeroes `MINSKY_CTO_AUDIT_ENABLE`, which silently
// zeroes the pre-registered measurement query
// (`gh pr list --label minsky:cto-audit ...`). Surfacing the not-wired
// state in the first lines of `.minsky/tick-loop.out.log` lets an
// operator running `tail` catch the drift in seconds rather than
// waiting 7 days for the rolling weekly window to expire with a
// 0-reading whose root cause is configuration, not the audit feature.
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
if (changelogSeam !== undefined) {
  process.stdout.write("[tick-loop] daily changelog wired (file-backed CHANGELOG.md reader)\n");
} else {
  process.stdout.write(
    "[tick-loop] no daily changelog wired (set MINSKY_CHANGELOG_ENABLE=1 to fire daily entries)\n",
  );
}
if (snapshotSeam !== undefined) {
  process.stdout.write(
    "[tick-loop] daily snapshot wired (file-backed existence probe + pnpm changelog:snapshot capture)\n",
  );
} else {
  process.stdout.write(
    "[tick-loop] no daily snapshot wired (set MINSKY_CHANGELOG_ENABLE=1 to capture per-day metric snapshots)\n",
  );
}
if (metricsRenderSeam !== undefined) {
  process.stdout.write(
    "[tick-loop] daily metrics render wired (file-backed METRICS.md mtime probe + pnpm metrics:render)\n",
  );
} else {
  process.stdout.write(
    "[tick-loop] no daily metrics render wired (set MINSKY_CHANGELOG_ENABLE=1 to refresh METRICS.md daily)\n",
  );
}

// Pre-PR lint gate: always wired — no env-var opt-in needed. Runs
// `pnpm pre-pr-lint --stage=fast` after every completed iteration to verify
// the branch is lint-clean. Emits `tick-loop.pre-pr-lint-gate` spans for the
// rolling pass-rate metric (`pnpm daemon-pr-lint:metrics`).
//
// Slice 33/N (`daemon-pre-pr-lint-gate`): `createBodyAwarePrePrLintRun`
// stats `<minskyHome>/pr-body.md` on each call and forwards `--body=<path>`
// when present, so the body-only checks (`pr-self-grade`,
// `pr-security-review`) ride the same retry budget as the branch-code
// lints — closing the loop the brief already documents (inner Claude
// writes the file, outer gate validates it).
const preLintRun = createBodyAwarePrePrLintRun({ cwd: minskyHome });
process.stdout.write(
  "[tick-loop] pre-PR lint gate wired (pnpm pre-pr-lint --stage=fast — rule #10 deterministic enforcement; body-aware: pr-body.md auto-discovered)\n",
);

// Slice 4 of `daemon-parallel-worktree-launch`: file-collision pre-spawn
// check. Only meaningful in parallel mode (workerConfig set). On every
// iteration the daemon snapshots open daemon-authored PRs (branch shape
// `daemon/<id>/<task-id>`) and refuses to claim a candidate task whose
// `**Touches**:` (or `**Files**:` fallback) overlaps a PR's changed
// files — preventing two workers from picking conflict-prone tasks.
//
// Operator escape hatch: `MINSKY_TOUCHES_GLOB_CHECK=0` disables the
// fetcher (useful when `gh` isn't authenticated locally and the operator
// wants the claim layer to stand alone). Default = on when
// `workerConfig` is set.
const touchesGlobCheckEnabled =
  workerConfig !== undefined &&
  process.env["MINSKY_TOUCHES_GLOB_CHECK"] !== "0" &&
  process.env["MINSKY_TOUCHES_GLOB_CHECK"] !== "false";
const openPrFetcher = touchesGlobCheckEnabled
  ? createOpenPrFetcher({ branchFilter: isDaemonAuthoredBranch })
  : undefined;
if (touchesGlobCheckEnabled) {
  process.stdout.write(
    "[tick-loop] file-collision check wired (gh pr list --author @me --state open --json files; branch filter: daemon/<id>/<task-id>; off via MINSKY_TOUCHES_GLOB_CHECK=0)\n",
  );
} else if (workerConfig === undefined) {
  process.stdout.write(
    "[tick-loop] no file-collision check (single-process mode — no parallel workers to collide)\n",
  );
} else {
  process.stdout.write("[tick-loop] file-collision check disabled (MINSKY_TOUCHES_GLOB_CHECK=0)\n");
}

// Supervisor-sandbox mode banner (vision.md § 13.3): surface the resolved
// `MINSKY_SANDBOX` mode + any typo warning in the supervisor log at boot.
// Slice 2 of `supervisor-sandbox-syscall-restriction`: substrate-inert —
// the resolver still defaults to `'off'` and no profile is applied, so
// flipping the env to `enforce` today does not actually sandbox anything.
// The banner is honest about that. Visible-not-silent (rule #6) so an
// operator running `tail .minsky/tick-loop.out.log` sees a stale typo
// (`MINSKY_SANDBOX=enforcde`) immediately, instead of silently running
// 'off' against a value they thought was 'enforce'.
process.stdout.write(`${sandboxModeStartupHint(process.env)}\n`);

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
  // Slice 2.5 of `daemon-parallel-worktree-launch`: per-worker config when
  // `--worker-id` / `--workers-total` are passed. `undefined` preserves
  // single-process v0 behaviour.
  ...(workerConfig !== undefined ? { workerConfig } : {}),
  // Slice 4 of `daemon-parallel-worktree-launch`: file-collision pre-spawn
  // check. `undefined` keeps the slice-1/2 claim-only path.
  ...(openPrFetcher !== undefined ? { openPrFetcher } : {}),
  // Optional push channel; `undefined` when MINSKY_NTFY_TOPIC isn't set.
  ...(notifier !== undefined ? { notifier } : {}),
  // Optional CTO-audit seam; `undefined` when MINSKY_CTO_AUDIT_ENABLE isn't 1/true.
  ...(ctoAuditSeam !== undefined ? { ctoAudit: ctoAuditSeam } : {}),
  // Optional daily-changelog seam; `undefined` when MINSKY_CHANGELOG_ENABLE isn't 1/true.
  ...(changelogSeam !== undefined ? { changelog: changelogSeam } : {}),
  // Optional daily-snapshot seam; same opt-in as the changelog seam (the two
  // share the daily-changelog umbrella — see SnapshotSeam construction above).
  ...(snapshotSeam !== undefined ? { snapshot: snapshotSeam } : {}),
  // Optional daily-metrics-render seam; same umbrella as the snapshot seam
  // (it consumes the snapshot file and writes METRICS.md).
  ...(metricsRenderSeam !== undefined ? { metricsRender: metricsRenderSeam } : {}),
  // Outer lint-gate verification — always active; no env opt-in.
  preLintRun,
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

process.stdout.write(
  `[tick-loop] ${result.totalIterations} iteration(s) (${result.stoppedReason})\n`,
);
for (const it of result.iterations) {
  process.stdout.write(
    `[tick-loop] iteration ${it.iteration}: ${it.status}${it.taskId ? ` task=${it.taskId}` : ""}${it.reason ? ` (${it.reason})` : ""}\n`,
  );
}
