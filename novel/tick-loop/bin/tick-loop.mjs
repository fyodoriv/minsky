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

import { execFile as execFileCb, execFileSync, execSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { cpus, getPriority, homedir } from "node:os";
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
  AutoScaleRunner,
  DryRunSpawnStrategy,
  LlmProviderSpawnStrategy,
  LocalLlmConcurrencyGate,
  MODEL_CATALOG,
  ProcessSpawnStrategy,
  TestFakeMockAnthropic,
  analyzeConfig,
  appendUsageHistory,
  buildAiderInvocation,
  buildChildWorkerArgs,
  buildClaudePrintInvocation,
  buildDevinPrintInvocation,
  buildOpencodeInvocation,
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
  detectOsThrottles,
  ensureCtoAuditLabel,
  ensureWorktree,
  formatRecommendations,
  fromRealBudgetGuard,
  isDaemonAuthoredBranch,
  listEligibleTasks,
  parseSpawnAdditionalWorkers,
  parseWorkerArgs,
  pickStrategicModel,
  predictExhaustionMs,
  resolvePrePrStage,
  // Slice 3 of `runany-dynamic-model-or-local-fallback` — the unified
  // pin>dynamic>local decider, wired into the run-anywhere entrypoint
  // (slices 1+2 shipped the pure decider + audit harness).
  resolveRunAnyModel,
  runDaemon,
  runParallelSweeper,
  sandboxModeStartupHint,
  workerStartupLine,
  // Slice 4 of `minsky-claude-exhaustion-persisted-state` — daemon
  // writes hard-limit hits to .minsky/state.json so the next
  // `minsky` invocation can skip the live probe and use local-LLM.
  writeLastHardLimit,
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
// CTO-audit, changelog, snapshot, metrics-render) need this. Hoisted here
// (not in each IIFE) to fix the ReferenceError at line ~575 where
// `createBodyAwarePrePrLintRun({ cwd: minskyHome })` was reached after the
// IIFEs' local `const minskyHome` had already gone out of scope. Single
// source of truth here.
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

// `operator-machine-budget-autoscale` slice 4/N — runtime OS-throttle
// wire-in. Slice 3 shipped the pure `detectOsThrottles` core; this is
// its caller (task part (c), the detect+report half — *applying* the
// corrections is a later slice). The budget % is resolved from
// `MINSKY_MACHINE_BUDGET_PCT` (default 70 — vision.md rule #15) at this
// I/O boundary; the live machine facts are gathered best-effort and
// the verdict logged so `tail .minsky/tick-loop.out.log` shows at boot
// whether the box can physically hit the budget the autoscaler targets.
//
// Optimization (operator 2026-05-05, one measurable/iter): a budget at
// or below the detector's trivial threshold is *always* reachable —
// `detectOsThrottles` short-circuits before touching any fact — so the
// live-fact gather is skipped entirely, eliminating one
// `sh -c 'ulimit -n'` subprocess fork plus the os.getPriority/os.cpus
// round-trips per daemon boot. Round-trip elimination, well over the
// ≥10-byte anti-vanity floor (a whole fork avoided).
const MACHINE_BUDGET_TRIVIAL_PCT = 10; // parity with TRIVIAL_BUDGET_PCT (slice 3)
const machineBudgetPct = (() => {
  const raw = process.env["MINSKY_MACHINE_BUDGET_PCT"];
  if (raw === undefined || raw === "") return 70;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : 70;
})();
if (machineBudgetPct <= MACHINE_BUDGET_TRIVIAL_PCT) {
  console.error(
    `[machine-budget] budget=${machineBudgetPct}% is trivial (≤${MACHINE_BUDGET_TRIVIAL_PCT}%) — OS throttles intended; live-fact probe skipped`,
  );
} else {
  // Each fact is best-effort: an unreadable one stays `undefined`, which
  // `detectOsThrottles` treats as *absent* (fail-safe, Saltzer &
  // Schroeder 1975) — never a false throttle, never a false "reachable".
  const cores = (() => {
    try {
      return cpus().length;
    } catch {
      return undefined;
    }
  })();
  const niceValue = (() => {
    try {
      return getPriority();
    } catch {
      return undefined;
    }
  })();
  const ulimitNofile = (() => {
    try {
      const out = execFileSync("/bin/sh", ["-c", "ulimit -n"], {
        encoding: "utf-8",
        timeout: 2000,
      }).trim();
      const n = Number.parseInt(out, 10);
      return Number.isInteger(n) && n > 0 ? n : undefined;
    } catch {
      return undefined;
    }
  })();
  // Effective launchd ProcessType is not exposed in the process env;
  // leaving it undefined keeps this honest — the slice-2 static gate
  // already covers the repo-tracked plist template, and the detector is
  // fail-safe on an absent fact.
  const throttleReport = detectOsThrottles({
    budgetPct: machineBudgetPct,
    cores: cores ?? 1,
    niceValue,
    ulimitNofile,
    env: process.env,
  });
  if (throttleReport.budgetReachable) {
    console.error(
      `[machine-budget] budget=${machineBudgetPct}% reachable — no live OS throttle contradicts it`,
    );
  } else {
    console.error(
      `[machine-budget] budget=${machineBudgetPct}% UNREACHABLE — ${throttleReport.throttles.length} live OS throttle(s):`,
    );
    for (const t of throttleReport.throttles) {
      console.error(`[machine-budget]   • ${t.kind}: ${t.observed} — ${t.reason}`);
    }
    console.error(
      "[machine-budget] corrections (the cross-repo slice mirrors these to ~/apps/dotfiles & ~/apps/agentbrew):",
    );
    for (const correction of throttleReport.corrections) {
      console.error(`[machine-budget]   $ ${correction}`);
    }
  }
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
// Slice 6 of `claude-usage-aware-strategic-model-router` — configurable
// poll interval. Operator's note: "minsky should be aware that claude
// can be used outside of it, so it should do checks often of usage."
// Default 30000ms (30s) — tighter than the BudgetGuard's stock 60s
// default — so the strategic picker sees fresh remaining-% within
// half a tick of any external claude usage. Operator can opt for
// 5000ms (5s) on hot-iteration days or 300000ms (5min) on idle ones.
// Invalid values fall back to the 30s default.
const usageRefreshIntervalMs = (() => {
  const raw = process.env.MINSKY_USAGE_REFRESH_INTERVAL_MS;
  if (raw === undefined) return 30_000;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1000) return 30_000;
  return parsed;
})();
const realGuard = new BudgetGuard(
  tokenMonitor,
  () => {
    /* push-decision side effects (flag-file, OTEL) live in a follow-up;
       the daemon only branches on `decide()`'s return value. */
  },
  undefined,
  usageRefreshIntervalMs,
);

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
// Local-model efficiency (B): separate, longer watchdog for local
// (aider/opencode) invocations. Local models are slower than Claude;
// the 15-min default is too short for Qwen3-class models on real tasks.
// Default 1800000 (30 min). MINSKY_CLAUDE_PRINT_TIMEOUT_MS overrides
// when set — the universal escape hatch keeps working for both providers.
const localWatchdogMs = (() => {
  if (process.env["MINSKY_CLAUDE_PRINT_TIMEOUT_MS"] !== undefined) return claudePrintTimeoutMs;
  const raw = process.env["MINSKY_LOCAL_WATCHDOG_MS"];
  if (raw === undefined) return 1_800_000;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1_800_000;
  return parsed;
})();
// Local-model efficiency (C): per-task consecutive-timeout counter.
// Incremented in the emit handler on each local-spawn-timeout; reset on
// any non-timeout outcome. The invocation callbacks read this to prepend
// a shrink directive on the third+ attempt.
/** @type {Map<string, number>} */
const consecutiveTimeoutsByTask = new Map();
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
// `local-only` — hard local mode: skip the cloud strategy entirely.
// The spawn strategy is the local strategy directly (no
// LlmProviderSpawnStrategy wrapper, no budget guard, no claude probing).
// Use when cloud tokens are exhausted or the operator wants zero cloud
// spend. CLI shorthand: `minsky --local`.
const forceLocalOnly = llmProviderOverride === "local-only";
// `support-opencode-lmstudio-mlx-qwen3-14b-stack` slice 2 — `MINSKY_LOCAL_AGENT`
// selects which CLI the local-dispatch path invokes. Default `aider` for
// back-compat. When set to `opencode`, the local strategy spawns
// `opencode run --model <id> --dangerously-skip-permissions <brief>`
// (per `buildOpencodeInvocation`) instead of `aider --message <brief>`.
// Hoisted above `localProbeUrl` so the slice-3 probe-URL default can
// branch on this value. Invalid values normalise to `aider` (rule #7
// graceful-degrade — don't crash over a typo).
const localAgent = (() => {
  const raw = (process.env.MINSKY_LOCAL_AGENT ?? "").trim().toLowerCase();
  return raw === "opencode" ? "opencode" : "aider";
})();
const opencodeBin = process.env.MINSKY_LOCAL_LLM_OPENCODE_BIN ?? "opencode";
// `devin-cloud-agent-spawn-strategy` slice (c) — `MINSKY_CLOUD_AGENT`
// selects which CLI the cloud-dispatch path invokes. Default `claude` for
// back-compat. When set to `devin`, the cloud strategy spawns
// `devin --print --model <model> --permission-mode dangerous` (brief on
// stdin, same I/O contract as claude --print) instead of `claude --print`.
// Per-machine config via dotfiles: `export MINSKY_CLOUD_AGENT=devin` in
// zshrc.ai-tools. Invalid values normalise to `claude` (rule #7
// graceful-degrade — don't crash over a typo).
const cloudAgent = (() => {
  const raw = (process.env.MINSKY_CLOUD_AGENT ?? "").trim().toLowerCase();
  return raw === "devin" ? "devin" : "claude";
})();
const cloudAgentModel = (process.env.MINSKY_CLOUD_AGENT_MODEL ?? "").trim() || undefined;
const devinBin = process.env.MINSKY_DEVIN_BIN ?? "devin";
// Slice 3 — per-agent probe URL default. LM Studio's documented default
// port is 1234 (`http://127.0.0.1:1234/v1/models`); mlx-lm.server's is
// 8080. When the operator pins `MINSKY_LOCAL_LLM_PROBE_URL` explicitly,
// that wins; otherwise the default tracks `MINSKY_LOCAL_AGENT`. Prevents
// the operator from having to set two env vars to switch stacks.
const localProbeUrl =
  process.env.MINSKY_LOCAL_LLM_PROBE_URL ??
  (localAgent === "opencode"
    ? "http://127.0.0.1:1234/v1/models"
    : "http://127.0.0.1:8080/v1/models");
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

// Slice 5 of `claude-usage-aware-strategic-model-router` — wire the
// pure picker into the bin so each iteration picks the highest-quality
// claude model (Opus 4.7 / Sonnet 4.6) that fits remaining usage,
// falling through to local on exhaustion. Operator 2026-05-10:
// "ensure minsky launches by default with the best params eg that
// router". Flipped to default-ON; opt-out is `MINSKY_STRATEGIC_ROUTER=0`
// (or `false`). The picker is conservative (Opus when budget allows,
// downgrade only when forced) — default-on is safe.
const strategicRouterEnabled = (() => {
  const raw = (process.env.MINSKY_STRATEGIC_ROUTER ?? "").trim().toLowerCase();
  if (raw === "0" || raw === "false") return false;
  // Default: enabled. Any unset / truthy value enables.
  return true;
})();
const strategicPin = (process.env.MINSKY_STRATEGIC_PIN_MODEL ?? "").trim();
// In-memory hysteresis state.
/** @type {string | undefined} */
let strategicPreviousPickId;
// Slice 6: in-memory ring buffer of recent (snapshot, pick) tuples.
// Used by the linear-regression exhaustion predictor; persists to
// `.minsky/state.json::usage_history` so trajectory survives daemon
// restarts.
/** @type {readonly import("../dist/index.js").UsageHistoryEntry[]} */
let usageHistory = [];
// `daemon-local-ratio-knob`: soft running-fraction target for the share
// of iterations that route to local (vs claude) when both providers are
// usable. Parses `MINSKY_LOCAL_RATIO=0.95` (≈ 5 % claude / 95 % local);
// invalid / out-of-range values are ignored (no override applied).
// Hard rules (forceClaude / circuit-break / hard-limit / unreachable)
// always win over the ratio.
const localRatio = (() => {
  const raw = process.env.MINSKY_LOCAL_RATIO;
  if (raw === undefined) return undefined;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return undefined;
  if (parsed < 0 || parsed > 1) return undefined;
  return parsed;
})();
// Per-machine model override — slice 0 of `worker-model-per-machine-config`
// resolution chain. When set, the aider invocation uses this model id
// (the bare HF id; aider auto-prefixes `openai/`). Operator can pin
// per-machine via `~/.zshrc` or by exporting at `pnpm minsky` time. The
// full resolution chain (env > .minsky/local-config.json > repo default)
// is the follow-up slice.
const localLlmModelId = (() => {
  const raw = process.env.MINSKY_LOCAL_LLM_MODEL_ID;
  if (raw === undefined || raw.trim() === "") return undefined;
  return raw.trim();
})();

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

function buildClaudeStrategy() {
  if (dryRun) return new DryRunSpawnStrategy();
  // `devin-cloud-agent-spawn-strategy` slice (c): dispatch between
  // claude --print and devin --print based on MINSKY_CLOUD_AGENT env.
  if (cloudAgent === "devin") {
    process.stdout.write(
      `[tick-loop] cloud-agent=devin (bin=${devinBin}${cloudAgentModel ? `, model=${cloudAgentModel}` : ""})\n`,
    );
    return new ProcessSpawnStrategy({
      command: devinBin,
      ...(claudePrintTimeoutMs !== undefined ? { timeoutMs: claudePrintTimeoutMs } : {}),
      invocation: (input) => {
        return buildDevinPrintInvocation({
          brief: input.brief,
          ...(cloudAgentModel === undefined ? {} : { model: cloudAgentModel }),
          command: devinBin,
          ...(input.extraArgs && input.extraArgs.length > 0 ? { extraArgs: input.extraArgs } : {}),
        });
      },
    });
  }
  return new ProcessSpawnStrategy({
    command: "claude",
    ...(claudePrintTimeoutMs !== undefined ? { timeoutMs: claudePrintTimeoutMs } : {}),
    invocation: (input) => {
      // Slice 5: strategic picker computes the model per-iteration
      // when `MINSKY_STRATEGIC_ROUTER=1`. The picker is pure; the
      // remaining-fractions snapshot is fresh per spawn (cheap —
      // Maciek parses cached JSONL).
      const strategicModel = strategicRouterEnabled ? pickAndLogStrategicModel() : undefined;
      return buildClaudePrintInvocation({
        brief: input.brief,
        ...(strategicModel === undefined ? {} : { model: strategicModel }),
        ...(input.extraArgs && input.extraArgs.length > 0 ? { extraArgs: input.extraArgs } : {}),
      });
    },
  });
}

// `resolveRunAnyModel`'s pin path (step 1) short-circuits *before* it
// reads `remaining` / `remoteBackends` / `localProbeResult`, so the pin
// wire-in above passes these frozen placeholders purely to satisfy the
// input type — no per-iteration allocation, no real probe (round-trip
// elimination on the hot pinned-iteration path).
const PIN_PATH_UNUSED_REMAINING = Object.freeze({
  fivehour: 1,
  weekly: 1,
  monthly: 1,
  observedAt: "1970-01-01T00:00:00Z",
});
const PIN_PATH_UNUSED_BACKENDS = Object.freeze([]);
const PIN_PATH_UNUSED_LOCAL_PROBE = Object.freeze({ reachable: true, observedAtMs: 0 });

// Slice 4 of `runany-dynamic-model-or-local-fallback` (Acceptance #3):
// when the budget guard has circuit-broken the only configured remote
// (claude), the run-anywhere contract is "switch fully to local". This
// model-router layer does not run a live local probe (the wrapper's
// `LlmProviderSpawnStrategy` owns the TTL-cached probe + bootstrap, per
// `minsky-cli-auto-bootstrap-local-llm`), so the probe state passed to
// `resolveRunAnyModel` here is honestly `false` with a reason that says
// the actual liveness/bootstrap is deferred to the wrapper. The
// all-remote-down branch returns local regardless of this flag — it
// only annotates the visible-not-silent reason string (Beyer SRE 2016).
const RUNANY_LOCAL_PROBE_DEFERRED = Object.freeze({
  reachable: false,
  observedAtMs: 0,
  reason: "deferred-to-wrapper-probe",
});
// One frozen claude-down backend list reused across every circuit-break
// iteration (no per-tick allocation on the degraded path — round-trip /
// GC elimination, same pattern as the audit harness's down fixture).
const RUNANY_CLAUDE_DOWN_BACKENDS = Object.freeze([
  Object.freeze({ id: "claude", reachable: false, reason: "budget-circuit-break" }),
]);

/**
 * Slice 5 of `claude-usage-aware-strategic-model-router` — invoke the
 * pure picker against a fresh remaining-fractions snapshot, log the
 * decision, and return the model id (or `undefined` when the picker
 * routes to `local`; the dispatch layer's `LlmProviderSpawnStrategy`
 * already handles claude→local transitions on the budget signal).
 *
 * Synchronous here so the `invocation` callback's signature stays
 * sync — the picker is pure, the snapshot read is async but we cache
 * it via the wrapper's TTL. v0 reads from a wrapper-side cache; if
 * the cache is cold or stale we just return `undefined` and let the
 * spawn use claude's session default. Slice 6 ratchets to a fresh
 * pre-spawn snapshot read with the 30s active TTL.
 *
 * @returns {string | undefined}
 */
/**
 * Emit the unified `tick-loop.runany-resolve` span for a
 * {@link resolveRunAnyModel} decision and map it to the model id the
 * `invocation` callback wants (`undefined` ⇒ local; the wrapper takes
 * over). Shared by the pin (slice 3) and all-remote-down (slice 4)
 * short-circuits so the span format + agent→model mapping live in one
 * place (log-line dedup; one definition can't drift from the other).
 *
 * @param {{model:string,agent:string,source:string,reason:string}} d
 * @param {boolean} withReason include the (longer) reason field — on for
 *   the degraded all-remote-down path (operator needs the cause), off
 *   for the pin path (the source alone is self-explanatory + shorter).
 * @returns {string | undefined}
 */
function dispatchRunAnyDecision(d, withReason) {
  const reasonField = withReason
    ? `,"reason":"${d.reason.replace(/"/g, '\\"').slice(0, 160)}"`
    : "";
  process.stdout.write(
    `[span] tick-loop.runany-resolve {"model":"${d.model}","agent":"${d.agent}","source":"${d.source}"${reasonField}}\n`,
  );
  return d.agent === "claude" ? d.model : undefined;
}

/**
 * Slice 3 of `runany-dynamic-model-or-local-fallback` (Acceptance #1 +
 * rule #9 skip-earlier gate): when the operator pinned a *catalog*
 * model, the decision is honored verbatim regardless of budget/liveness.
 * Extracted from {@link pickAndLogStrategicModel} so its
 * cognitive-complexity stays under biome's cap. The catalog-membership
 * guard keeps a *bogus* pin on the unchanged dynamic path (chaos row 3).
 *
 * @returns {{handled:boolean, model?:string}} `handled:false` ⇒ no
 *   catalog pin; caller falls through to the budget-aware path.
 */
function tryPinnedRunAnyModel() {
  if (strategicPin.length === 0 || !MODEL_CATALOG.some((e) => e.id === strategicPin)) {
    return { handled: false };
  }
  const pinned = resolveRunAnyModel({
    remaining: PIN_PATH_UNUSED_REMAINING,
    remoteBackends: PIN_PATH_UNUSED_BACKENDS,
    localProbeResult: PIN_PATH_UNUSED_LOCAL_PROBE,
    operatorPin: strategicPin,
  });
  return { handled: true, model: dispatchRunAnyDecision(pinned, false) };
}

/**
 * Slice 4 of `runany-dynamic-model-or-local-fallback` (Acceptance #3 +
 * rule #9 skip-earlier gate): the budget guard circuit-broke claude —
 * the only configured remote is inaccessible (budget exhausted). The
 * run-anywhere contract is "switch fully + visibly to local". Route
 * through the unified `resolveRunAnyModel` so the decision is one path
 * with a visible `all-remote-down` source + reason (Beyer SRE 2016
 * visible-not-silent). The wrapper's TTL-cached probe + bootstrap is
 * the real local-liveness gate; this layer only routes + logs.
 * Extracted to keep {@link pickAndLogStrategicModel} under the cap.
 *
 * @param {{action?:string}} lastDecision the budget guard's last decision.
 * @returns {{handled:boolean, model?:string}} `handled:false` ⇒ remote
 *   is not circuit-broken; caller falls through to the dynamic path.
 */
function tryCircuitBrokenRunAnyModel(lastDecision) {
  if (lastDecision.action !== "circuit-break") return { handled: false };
  const downDecision = resolveRunAnyModel({
    remaining: PIN_PATH_UNUSED_REMAINING,
    remoteBackends: RUNANY_CLAUDE_DOWN_BACKENDS,
    localProbeResult: RUNANY_LOCAL_PROBE_DEFERRED,
  });
  return { handled: true, model: dispatchRunAnyDecision(downDecision, true) };
}

function pickAndLogStrategicModel() {
  // Slice 3: pin short-circuits *before* the budget-snapshot read, the
  // usage-history ring-buffer append, and the exhaustion prediction —
  // a pinned run is honored verbatim, so all that dynamic machinery
  // (plus its ~400-byte span) is pure waste every iteration.
  const pin = tryPinnedRunAnyModel();
  if (pin.handled) return pin.model;
  // v0: synchronous picker driven by `realGuard.lastDecision()` which
  // is populated by the BudgetGuard's tick loop. The remaining %
  // snapshot is the most recent decision's snapshot.
  const lastDecision = realGuard.lastDecision?.();
  if (lastDecision === undefined) {
    // Cold start — no snapshot yet; let claude pick its session default.
    return undefined;
  }
  // Slice 4: all-remote-down short-circuits before the snapshot math,
  // the ring-buffer append, and the exhaustion regression (same
  // optimization class as slice 3's pin path).
  const down = tryCircuitBrokenRunAnyModel(lastDecision);
  if (down.handled) return down.model;
  return pickDynamicStrategicModel(lastDecision);
}

/**
 * The unchanged budget-aware dynamic path (slices 5+6 of
 * `claude-usage-aware-strategic-model-router`): derive remaining
 * fractions from the budget snapshot, run the pure picker, append to
 * the usage-history ring buffer, emit the rich `tick-loop.strategic-pick`
 * span, and return the model id (or `undefined` ⇒ local). Extracted
 * verbatim from {@link pickAndLogStrategicModel} so the slice-3/4
 * short-circuit guards added there keep the caller under biome's
 * cognitive-complexity cap (rule: clean up the complexity your own
 * change introduced). Behaviour is byte-for-byte identical.
 *
 * @param {{snapshot: any}} lastDecision the budget guard's last decision.
 * @returns {string | undefined}
 */
function pickDynamicStrategicModel(lastDecision) {
  const snap = lastDecision.snapshot;
  const remaining = {
    fivehour: snap.windowSizeTokens > 0 ? snap.tokensRemainingInWindow / snap.windowSizeTokens : 0,
    weekly: snap.weeklyHeadroomFraction ?? 1,
    monthly: snap.monthlyHeadroomFraction ?? 1,
    observedAt: snap.observedAt,
  };
  const pick = pickStrategicModel({
    remaining,
    catalog: MODEL_CATALOG,
    hysteresis: { previousPickId: strategicPreviousPickId },
    ...(strategicPin.length > 0 ? { operatorPin: strategicPin } : {}),
  });
  strategicPreviousPickId = pick.model;
  // Slice 6: append to ring-buffer trajectory + emit predicted exhaustion
  // ms per window. Predictor returns `undefined` until ≥2 entries.
  usageHistory = appendUsageHistory({
    history: usageHistory,
    entry: {
      observedAt: remaining.observedAt,
      fivehour: remaining.fivehour,
      weekly: remaining.weekly,
      monthly: remaining.monthly,
      pickedModel: pick.model,
    },
  });
  const exhaustion = predictExhaustionMs(usageHistory);
  process.stdout.write(
    `[span] tick-loop.strategic-pick {"model":"${pick.model}","agent":"${pick.agent}","kind":"${pick.kind}","reason":"${pick.reason.replace(/"/g, '\\"').slice(0, 200)}","fivehour":${remaining.fivehour.toFixed(3)},"weekly":${remaining.weekly.toFixed(3)},"monthly":${remaining.monthly.toFixed(3)},"history_size":${usageHistory.length},"exhaustion_ms_5h":${exhaustion.fivehour ?? "null"},"exhaustion_ms_weekly":${exhaustion.weekly ?? "null"},"exhaustion_ms_monthly":${exhaustion.monthly ?? "null"}}\n`,
  );
  // Only return a model id when the pick targets claude — the local
  // path goes through buildLocalStrategy and doesn't take --model from
  // here.
  return pick.agent === "claude" ? pick.model : undefined;
}

// P0 `local-worker-worktree-never-created`: the local (aider/opencode)
// spawn path must CREATE the worktree it cd's into. The claude path gets
// one from `claude --worktree`; the local path had no creator, so every
// local iteration spawned the model into a missing / stale-pointer dir
// and died at git setup before the model ran. Single-process (no
// workerConfig) keeps inheriting the parent cwd (minskyHome) as before —
// no worktree, returns undefined.
function ensureLocalWorktree(taskId) {
  if (workerConfig === undefined) return undefined;
  return ensureWorktree(
    { minskyHome, workerId: workerConfig.workerId, taskId },
    {
      exists: existsSync,
      git: (args) => {
        execFileSync("git", args, { stdio: "pipe" });
      },
    },
  );
}

// Local-model efficiency (A): time-budget prefix prepended to every local brief.
// Tells the model to stay within ~800s and scope to one file / one step.
const LOCAL_BRIEF_TIME_BUDGET_PREFIX =
  "[LOCAL MODEL — ~800s budget. Prefer editing ONE existing file. If the task is complex, identify the single smallest first step and do only that step. Do not read files you do not need to edit.]\n\n";

/**
 * Build the augmented brief for a local model invocation: prepend the
 * time-budget prefix (A) and, when consecutive timeouts ≥ 2, prepend the
 * auto-shrink directive (C).
 * @param {{ taskId: string, brief: string }} input
 * @returns {string}
 */
function buildLocalBriefAugmented(input) {
  const timeoutCount = consecutiveTimeoutsByTask.get(input.taskId) ?? 0;
  const shrinkPrefix =
    timeoutCount >= 2
      ? `CONSECUTIVE TIMEOUT #${timeoutCount} — previous ${timeoutCount} attempt${timeoutCount === 1 ? "" : "s"} timed out. Do ONLY the first bullet of the slice description. Ignore the rest.\n\n`
      : "";
  process.stdout.write(
    `[tick-loop] local-brief: prepended [LOCAL MODEL] time-budget prefix (task=${input.taskId}${timeoutCount >= 2 ? `, consecutive-timeout-shrink=#${timeoutCount}` : ""})\n`,
  );
  return `${LOCAL_BRIEF_TIME_BUDGET_PREFIX}${shrinkPrefix}${input.brief}`;
}

function buildLocalStrategy() {
  if (dryRun) return new DryRunSpawnStrategy();
  if (localAgent === "opencode") {
    return new ProcessSpawnStrategy({
      command: opencodeBin,
      ...(localWatchdogMs !== undefined ? { timeoutMs: localWatchdogMs } : {}),
      invocation: (input) => {
        const worktreeDir = ensureLocalWorktree(input.taskId);
        return buildOpencodeInvocation({
          brief: buildLocalBriefAugmented(input),
          command: opencodeBin,
          ...(worktreeDir !== undefined ? { cwd: worktreeDir } : {}),
          // `MINSKY_LOCAL_LLM_MODEL_ID` is the bare HF / model id; for
          // opencode's `provider/model` argv it defaults to the
          // `lmstudio/<id>` form. When the operator wants a non-lmstudio
          // provider key they can set the full `<provider>/<model>` shape.
          ...(localLlmModelId === undefined
            ? {}
            : {
                model: localLlmModelId.includes("/")
                  ? localLlmModelId
                  : `lmstudio/${localLlmModelId}`,
              }),
        });
      },
    });
  }
  return new ProcessSpawnStrategy({
    command: aiderBin,
    ...(localWatchdogMs !== undefined ? { timeoutMs: localWatchdogMs } : {}),
    invocation: (input) => {
      const worktreeDir = ensureLocalWorktree(input.taskId);
      return buildAiderInvocation({
        brief: buildLocalBriefAugmented(input),
        command: aiderBin,
        ...(worktreeDir !== undefined ? { cwd: worktreeDir } : {}),
        ...(localLlmModelId === undefined ? {} : { model: `openai/${localLlmModelId}` }),
      });
    },
  });
}

// Slice 2.5 of `local-server-concurrency-aware-worker-spawn`: when
// multiple workers are spawned with local-LLM enabled, mlx_lm.server
// (and LM Studio in default mode) GPU-OOM under concurrent inference.
// Wrap the local strategy in `LocalLlmConcurrencyGate` so cross-process
// O_EXCL-file-locking serializes the aider invocations. Default cap=1
// matches mlx_lm.server's per-process single-inference limit; operator
// can disable the gate via MINSKY_LOCAL_SERVER_MAX_CONCURRENT≥2 when
// running a concurrent-inference backend (vLLM, sglang, LM Studio Pro).
function maybeWrapLocalStrategyInGate(localStratRaw) {
  const cap = Number.parseInt(process.env.MINSKY_LOCAL_SERVER_MAX_CONCURRENT ?? "1", 10);
  if (!Number.isFinite(cap) || cap > 1) return localStratRaw;
  process.stdout.write(
    "[tick-loop] local-llm concurrency gate wired (cap=1; override via MINSKY_LOCAL_SERVER_MAX_CONCURRENT≥2 for vLLM/sglang/LM-Studio-Pro)\n",
  );
  return new LocalLlmConcurrencyGate({
    inner: localStratRaw,
    workerId: `worker-${workerConfig.workerId}`,
  });
}

// Extracted to stay under biome's cognitive-complexity cap (rule #6, ≤10).
function buildLocalOnlyStrategy() {
  const localStrat = maybeWrapLocalStrategyInGate(buildLocalStrategy());
  process.stdout.write(
    `[tick-loop] local-only mode (agent=${localAgent}, probe=${localProbeUrl}, watchdog=${localWatchdogMs ?? "disabled"}ms${localLlmModelId === undefined ? "" : `, model=${localLlmModelId}`}${dryRun ? ", dry-run" : ""})\n`,
  );
  return localStrat;
}

const spawnStrategy = (() => {
  if (forceLocalOnly) return buildLocalOnlyStrategy();
  const claudeStrat = buildClaudeStrategy();
  if (!localLlmEnabled) return claudeStrat;
  const localStrat = maybeWrapLocalStrategyInGate(buildLocalStrategy());
  process.stdout.write(
    `[tick-loop] local-llm fallback wired (agent=${localAgent}, probe=${localProbeUrl}, ttl=${localProbeTtlMs}ms, override=${llmProviderOverride || "auto"}, watchdog=${localWatchdogMs ?? "disabled"}ms${localRatio === undefined ? "" : `, localRatio=${localRatio}`}${localLlmModelId === undefined ? "" : `, model=${localLlmModelId}`}${dryRun ? ", dry-run" : ""})\n`,
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
    ...(localRatio === undefined ? {} : { localRatio }),
    emit: (event) => {
      // Forward the dispatch span to OTEL when wired; always also write
      // to stdout for the operator's `tail` view.
      process.stdout.write(`[span] ${event.name} ${JSON.stringify(event.attributes)}\n`);
      if (observability !== undefined) {
        observability.emitTickSpan(event);
      }
    },
    // Slice 4 of `minsky-claude-exhaustion-persisted-state`: persist
    // hard-limit hits to `.minsky/state.json` so the next `minsky`
    // invocation can skip the live probe and go straight to local-LLM.
    // Failures are graceful-degrade per rule #6 — the in-process
    // `lastClaudeFailure` carry-over still works either way.
    persistHardLimit: (failure) => {
      const stateFilePath = resolve(minskyHome, ".minsky", "state.json");
      const ts = new Date().toISOString();
      const reason = failure.stderrTail.slice(-200).trim();
      writeLastHardLimit({
        stateFilePath,
        readFileSyncFn: readFileSync,
        writeFileSyncFn: writeFileSync,
        ts,
        reason: reason.length > 0 ? reason : `claude exit ${failure.exitCode}`,
      });
      process.stdout.write(
        `[tick-loop] persisted hard-limit to ${stateFilePath} (next minsky startup will skip live probe within MINSKY_HARD_LIMIT_TTL_MIN)\n`,
      );
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
// Stage is env-gated (MINSKY_PRE_PR_STAGE). Default "fast" (back-compat /
// local-sprint budget); set "full" so the worker gate matches the
// autonomous merge authority's --stage=full — required for Sonnet workers
// so they only open PRs that will actually pass the merge-gate and land
// (a fast-gated PR that fails the full merge-gate wastes the iteration).
const prePrStage = resolvePrePrStage(process.env["MINSKY_PRE_PR_STAGE"]);
const preLintRun = createBodyAwarePrePrLintRun({ cwd: minskyHome, stage: prePrStage });
process.stdout.write(
  `[tick-loop] pre-PR lint gate wired (pnpm pre-pr-lint --stage=${prePrStage} — rule #10 deterministic enforcement; body-aware: pr-body.md auto-discovered)\n`,
);

// TASKS.md auto-lint-fix seam (`daemon-tasks-md-auto-lint-fix`): production
// binding for `runDaemon`'s `tasksMdLintExec`. The seam contract is "run one
// shell command, return combined stdout+stderr, never throw on non-zero" —
// the command itself carries `2>&1 || true` (see `buildMarkdownlintCommand`
// in `@minsky/tick-loop/tasks-md-lint-fix`), so `execSync` won't throw on
// markdownlint's violations-present non-zero exit. The catch is rule #7
// graceful-degrade: if `npx markdownlint-cli2` can't spawn at all, return
// "" — the pure helper parses that as zero violations and the daemon
// proceeds with its (structurally-correct) commit rather than deadlocking.
const tasksMdLintExec = (command) => {
  try {
    return execSync(command, { cwd: minskyHome, encoding: "utf8" });
  } catch {
    return "";
  }
};
const tasksMdPath = resolve(minskyHome, "TASKS.md");
process.stdout.write(
  `[tick-loop] TASKS.md auto-lint-fix wired (markdownlint-cli2 --fix ${tasksMdPath} after every completed iteration — daemon-tasks-md-auto-lint-fix)\n`,
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

// Slice 5 of `daemon-parallel-worktree-launch`: per-tick sweeper.
// Walks `.git/index.lock` (root + per-worktree) + `.minsky/locks/task-*.lock`,
// removes stale debris (Claude Code #11005 mitigation + crashed-worker
// claim cleanup). Runs once at supervisor boot — that's enough for
// recovery: the in-process worker-claim layer's O_EXCL retry handles
// inter-tick claim contention; this sweep handles BOOT-time debris
// from a previous crashed run. Skip in dry-run (no real .git or claim
// state to sweep) and in spawned-child mode (only the root sweeps so
// children don't race on unlinks). Operator escape:
// MINSKY_PARALLEL_SWEEPER=0 disables.
const sweeperEnabled =
  process.env["MINSKY_WORKER_SPAWNED"] !== "1" &&
  process.env["MINSKY_TICK_DRY_RUN"] !== "1" &&
  process.env["MINSKY_TICK_DRY_RUN"] !== "true" &&
  process.env["MINSKY_PARALLEL_SWEEPER"] !== "0" &&
  process.env["MINSKY_PARALLEL_SWEEPER"] !== "false";
if (sweeperEnabled) {
  try {
    const sweepResult = runParallelSweeper({
      minskyHome,
      io: {
        now: () => Date.now(),
        exists: (p) => existsSync(p),
        mtimeMs: (p) => {
          try {
            return statSync(p).mtimeMs;
            // rule-6: handled-locally — ENOENT / permission denied → undefined → caller flags errors
          } catch {
            return undefined;
          }
        },
        readText: (p) => {
          try {
            return readFileSync(p, "utf-8");
            // rule-6: handled-locally — read failure → undefined → caller flags errors
          } catch {
            return undefined;
          }
        },
        listDir: (d) => {
          try {
            return readdirSync(d);
            // rule-6: handled-locally — dir not found → [] → caller skips this leg
          } catch {
            return [];
          }
        },
        unlink: (p) => {
          try {
            unlinkSync(p);
            return true;
            // rule-6: handled-locally — unlink failure logged; sweep continues
          } catch {
            return false;
          }
        },
      },
    });
    process.stdout.write(
      `[span] tick-loop.parallel-sweeper.tick ${JSON.stringify({
        "sweeper.indexLocksSwept": sweepResult.indexLocksSwept,
        "sweeper.expiredClaimsSwept": sweepResult.expiredClaimsSwept,
        "sweeper.hadRecoverableErrors": sweepResult.hadRecoverableErrors,
        "sweeper.reasonsHead": sweepResult.reasons.slice(0, 5),
      })}\n`,
    );
    process.stdout.write(
      `[tick-loop] parallel-sweeper: swept ${sweepResult.indexLocksSwept} index-lock(s) + ${sweepResult.expiredClaimsSwept} expired claim(s)${sweepResult.hadRecoverableErrors ? " (with recoverable errors — see span)" : ""}\n`,
    );
    // rule-6: handled-locally — sweeper failure shouldn't gate boot; log and continue
  } catch (sweeperErr) {
    process.stdout.write(
      `[tick-loop] parallel-sweeper: skipped (boot-time error: ${sweeperErr instanceof Error ? sweeperErr.message : String(sweeperErr)})\n`,
    );
  }
} else if (process.env["MINSKY_WORKER_SPAWNED"] === "1") {
  process.stdout.write(
    "[tick-loop] parallel-sweeper off (this is a spawned child; only the root sweeps)\n",
  );
}

// Auto-scale workers (operator 2026-05-07 — slice 2/N). The root daemon
// observes its own iteration spans, tracks rolling counters, and forks
// another child via the existing --worker-id/--workers-total mechanism
// when `decideAutoScale` says spawn. Default ON; off via
// MINSKY_AUTO_SCALE_WORKERS=0/false. Children (MINSKY_WORKER_SPAWNED=1)
// never auto-scale — only the root.
const autoScaleEnabled =
  process.env["MINSKY_WORKER_SPAWNED"] !== "1" &&
  process.env["MINSKY_AUTO_SCALE_WORKERS"] !== "0" &&
  process.env["MINSKY_AUTO_SCALE_WORKERS"] !== "false";
const autoScaleMax = (() => {
  const raw = process.env["MINSKY_AUTO_SCALE_MAX"];
  if (raw === undefined || raw === "") return 5;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return 5;
  return n;
})();
let autoScaleRunner;
if (autoScaleEnabled) {
  // Production wiring: real spawn forks another tick-loop process with
  // --worker-id=<workerId> --workers-total=<totalAfter> and
  // MINSKY_WORKER_SPAWNED=1 in env so the child doesn't recurse.
  const autoSpawn = (input) => {
    const childArgs = buildChildWorkerArgs({
      parentArgv: process.argv.slice(2),
      childIndex: input.workerId,
      totalAfterSpawn: input.totalAfter,
    });
    const child = nodeSpawn(process.execPath, [process.argv[1], ...childArgs], {
      env: { ...process.env, MINSKY_WORKER_SPAWNED: "1" },
      stdio: "inherit",
      detached: false,
    });
    process.stdout.write(
      `[tick-loop] auto-scale: spawned worker ${input.workerId} as PID ${child.pid} (workers-total=${input.totalAfter})\n`,
    );
  };
  const initialWorkers = workerConfig !== undefined ? workerConfig.workersTotal : 1;
  autoScaleRunner = new AutoScaleRunner({
    maxWorkers: autoScaleMax,
    initialWorkers,
    getEligibleTaskCount: () => {
      try {
        return listEligibleTasks(readFileSync(args.tasksMdPath, "utf-8")).length;
        // rule-6: handled-locally — TASKS.md unreadable → 0 eligibles → no spawn
      } catch {
        return 0;
      }
    },
    getBudgetState: () => {
      const decision = realGuard.lastDecision?.();
      if (decision === undefined || decision === null) return "normal";
      if (decision.action === "circuit-break") return "circuit-break";
      const reason = decision.reason ?? "";
      if (reason.includes("weekly-cap-paused")) return "weekly-cap-paused";
      if (reason.includes("weekly-cap-warn")) return "weekly-cap-warn";
      return "normal";
    },
    spawn: autoSpawn,
    emit: (event) => {
      process.stdout.write(`[span] ${event.name} ${JSON.stringify(event.attributes)}\n`);
      if (observability !== undefined) observability.emitTickSpan(event);
    },
  });
  process.stdout.write(
    `[tick-loop] auto-scale workers wired (initial=${initialWorkers}, max=${autoScaleMax}; off via MINSKY_AUTO_SCALE_WORKERS=0)\n`,
  );
} else if (process.env["MINSKY_WORKER_SPAWNED"] === "1") {
  process.stdout.write(
    "[tick-loop] auto-scale workers off (this is a spawned child; only the root scales)\n",
  );
} else {
  process.stdout.write("[tick-loop] auto-scale workers disabled (MINSKY_AUTO_SCALE_WORKERS=0)\n");
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

// Local-model efficiency (C): track consecutive local-spawn-timeout failures
// per task. Extracted into a named function so the emit callback stays under
// biome's cognitive-complexity ceiling.
/**
 * @param {{ name: string, attributes: Record<string, unknown> }} event
 */
function observeIterationForTimeoutTracking(event) {
  if (event.name !== "tick-loop.iteration") return;
  const taskId = event.attributes["task.id"];
  const reason = event.attributes["iteration.reason"];
  if (typeof taskId !== "string" || taskId.length === 0) return;
  if (typeof reason === "string" && reason.startsWith("local-spawn-timeout")) {
    consecutiveTimeoutsByTask.set(taskId, (consecutiveTimeoutsByTask.get(taskId) ?? 0) + 1);
  } else {
    consecutiveTimeoutsByTask.delete(taskId);
  }
}

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
  // TASKS.md auto-lint-fix — always active; runs once per completed
  // iteration before the pre-PR gate so a progress/claim/completion write
  // that left an MD012 double blank can't deadlock the gate.
  tasksMdLintExec,
  tasksMdPath,
  emit: (event) => {
    observeIterationForTimeoutTracking(event);
    // Plain-text line on stdout for terminal/journalctl visibility.
    process.stdout.write(`[span] ${event.name} ${JSON.stringify(event.attributes)}\n`);
    // Forward to OTEL when wired; the SDK ships to OpenObserve / whatever
    // OTLP backend MINSKY_OTEL_ENDPOINT points at — fire-and-forget per
    // rule #7 graceful-degrade (the OTEL SDK swallows transport errors).
    if (observability !== undefined) {
      observability.emitTickSpan(event);
    }
    // Auto-scale workers (slice 2/N): the root daemon's runner observes
    // iteration spans and may spawn another child. Spawned children
    // (MINSKY_WORKER_SPAWNED=1) skip this — only the root scales.
    if (autoScaleRunner !== undefined) {
      autoScaleRunner.observeEvent(event);
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
