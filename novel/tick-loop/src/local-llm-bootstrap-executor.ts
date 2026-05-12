// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 2 (operator 2026-05-08) -->
/**
 * `@minsky/tick-loop/local-llm-bootstrap-executor` — I/O boundary that
 * dispatches a {@link BootstrapPlan} to subprocess installs. Slice 2 of
 * P0 task `minsky-cli-auto-bootstrap-local-llm` per `TASKS.md`.
 *
 * Contract: takes a plan from {@link planLocalLlmBootstrap}, prompts the
 * operator once with a multi-line summary, and on `[Y/n]` confirm runs
 * each step sequentially with progress streamed to the operator's
 * terminal. Each step is a `child_process.spawn` of the step's argv.
 *
 * The confirm prompt is the only operator-blocking step. Subsequent
 * progress is non-blocking (each step's stdout/stderr is piped through
 * to `process.stdout` / `process.stderr` so the operator sees pip /
 * brew / huggingface-cli output live).
 *
 * Pattern conformance (rule #8):
 *   - **Plan-and-Execute** — Russell & Norvig, *AIMA* 3rd ed. 2010,
 *     Ch. 11 — the planner ({@link planLocalLlmBootstrap}) is pure;
 *     this module is the executor. Conformance: full.
 *   - **Adapter** — Wirfs-Brock & McKean, *Object Design*, 2003 — the
 *     `confirmFn` + `spawnFn` + `logFn` seams are I/O adapters so the
 *     paired tests inject synthetic implementations. Conformance: full.
 *   - **Streaming progress** — Cantrill, *DTrace*, ACM Queue 2008 — the
 *     executor streams subprocess output rather than buffering, so
 *     long-running installs (model download, ~10 min) show progress
 *     live rather than hanging silently. Conformance: full.
 *
 * Failure modes & chaos verification (rule #7).
 *
 * Steady-state hypothesis: every legitimate plan + confirmed user input
 * produces a well-defined `ExecuteResult` with `success: true` (all
 * steps green) or `success: false` + `failedStep` (first non-zero exit).
 * Blast radius: a single bootstrap attempt's installed packages.
 * Operator escape hatch: `MINSKY_NO_AUTO_BOOTSTRAP=1` (read by the
 * caller in `bin/minsky.mjs`) skips the executor entirely.
 *
 * | # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
 * |---|---|---|---|---|
 * | 1 | Operator declines confirm | `confirmFn` returns `false` | Returns `{ success: false, reason: "operator-declined" }` without running any step | "operator-declined" test |
 * | 2 | First step exits non-zero | `spawnFn` resolves with `{ exitCode: 1 }` | Stops at first failure, returns `failedStep` + reason | "step-1 fails — stops sequence" test |
 * | 3 | Step throws before spawn | `spawnFn` rejects (e.g. ENOENT on `brew`) | Returns `{ success: false, failedStep, reason: "<error.message>" }` — does NOT throw | "spawnFn rejects — captured as failure" test |
 * | 4 | Empty plan (already ready) | `plan.steps.length === 0` | Returns `{ success: true, stepsRun: 0 }` immediately, no confirm prompt | "empty plan — fast path" test |
 * | 5 | Non-TTY mode + plan non-empty | `confirmFn` is `confirmAlwaysYes` | Runs without prompting (deterministic for cron / launchd / CI) | "non-TTY confirms automatically" test |
 *
 * @module tick-loop/local-llm-bootstrap-executor
 */

import type { BootstrapPlan, InstallStep } from "./local-llm-bootstrap.js";

// ---- Types ----------------------------------------------------------------

/**
 * Minimal subprocess-spawn shape the executor consumes. Mirrors the
 * `node:child_process.spawn` callable shape but seam-able for tests
 * (rule #2 — every external dependency behind an interface). The
 * production wiring at `bin/minsky.mjs` passes `node:child_process.spawn`
 * directly.
 *
 * Returns a Promise that resolves with the child's exit code +
 * tail-capped stdout/stderr; rejects only on pre-spawn errors (ENOENT,
 * EACCES, etc.) per row 3 above.
 */
export interface ExecuteSpawnResult {
  readonly exitCode: number;
  readonly stdoutTail?: string;
  readonly stderrTail?: string;
}

/**
 * Spawn seam — pure function over (argv, opts) → Promise.
 *
 * Slice 6 extension: `stdinMode` lets specific steps claim the parent's
 * stdin for interactive prompts (notably `install-arm-homebrew`, which
 * wraps the Homebrew installer and needs sudo to prompt for a password
 * on the operator's terminal). Default `"ignore"` matches slice-1
 * behavior — most installers don't need stdin and letting them read
 * from the terminal would swallow keystrokes the CLI's Ctrl-C detach
 * handler wants.
 */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  opts?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    /** "ignore" (default) or "inherit" to pass the parent's stdin through. */
    stdinMode?: "ignore" | "inherit";
  },
) => Promise<ExecuteSpawnResult>;

/** Confirm seam — returns `true` to proceed, `false` to abort. */
export type ConfirmFn = (summary: string) => Promise<boolean>;

/** Log seam — `process.stdout.write` in production. */
export type LogFn = (line: string) => void;

/**
 * Detached-spawn seam for the `start-mlx-server` step. Spawns the
 * server process detached (does NOT wait for exit) and returns its PID.
 * Production wiring calls `child_process.spawn({ detached: true })` +
 * `child.unref()`; tests inject `(_cmd, _args) => ({ pid: 99999 })`.
 *
 * Throws on pre-spawn errors (ENOENT, EACCES) — captured by the caller
 * as a failure result (chaos row C).
 */
export type SpawnDetachedFn = (
  command: string,
  args: readonly string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => { pid: number };

/**
 * Server readiness poll — retries GET against the server URL until it
 * responds with HTTP 200 or `timeoutMs` elapses. Returns `true` on
 * first success, `false` on timeout. Production wiring uses
 * `globalThis.fetch`; tests inject `async () => true` / `async () => false`.
 */
export type PollServerFn = (url: string, timeoutMs: number) => Promise<boolean>;

/**
 * PID-file write seam — `writeFileSync(path, String(pid))` in
 * production. Tests inject a capture function. Failure is non-fatal:
 * the caller logs a warning and continues (PID file is informational).
 */
export type WritePidFn = (path: string, pid: number) => void;

export interface ExecuteOpts {
  /**
   * Operator-confirm function. Receives the human-readable plan
   * summary; returns `true` to proceed, `false` to abort. Production
   * wiring uses a one-character `[Y/n]` reader on `process.stdin`.
   * Tests inject synthetic `() => true` / `() => false`.
   */
  readonly confirm: ConfirmFn;
  /**
   * Subprocess spawn seam. Production wiring wraps
   * `node:child_process.spawn`; tests inject a fake.
   */
  readonly spawnFn: SpawnFn;
  /** Log seam — typically `process.stdout.write` in production. */
  readonly log: LogFn;
  /**
   * Slice 58: detached-spawn seam for the `start-mlx-server` step.
   * When present, `runOneStep` dispatches to `runServerStep` which
   * spawns the server detached (non-blocking), writes its PID, and
   * polls for readiness. When absent, falls through to `spawnFn`
   * (backward-compat for tests that don't need the detached path).
   */
  readonly spawnDetachedFn?: SpawnDetachedFn;
  /**
   * Server readiness poll — called after detached spawn. Returns `true`
   * once the server is reachable. When absent, the step returns success
   * immediately without polling (test fast path).
   */
  readonly pollServerFn?: PollServerFn;
  /**
   * PID-file write — called with the server's PID after detached spawn.
   * Non-fatal on failure. When absent (or `localLlmPidPath` absent), no
   * PID file is written.
   */
  readonly writePidFn?: WritePidFn;
  /**
   * Absolute path for the server PID file. Typically
   * `<MINSKY_HOME>/.minsky/local-llm.pid`. No-op when `writePidFn` is
   * absent.
   */
  readonly localLlmPidPath?: string;
}

export interface ExecuteResult {
  readonly success: boolean;
  /** Number of steps that ran (whether or not they succeeded). */
  readonly stepsRun: number;
  /** When `success === false`, the first failing step's type. */
  readonly failedStep?: InstallStep["type"];
  /**
   * When `success === false`, a short human-readable reason
   * ("operator-declined", "exit code 1: <stderr-tail>", "spawn ENOENT
   * brew", etc.).
   */
  readonly reason?: string;
}

// ---- executeBootstrapPlan -------------------------------------------------

/**
 * Execute the plan with the operator-confirm + sequential-spawn pipeline.
 * Pure-over-injection: all I/O is behind the seams in {@link ExecuteOpts}.
 *
 * Sequential not parallel: most steps depend on prior steps (pipx
 * before mlx-lm; mlx-lm before mlx_lm.server). Parallelism would not
 * meaningfully reduce wall-clock since the model download dominates.
 *
 * The function never throws. Spawn rejections are captured as
 * `failedStep` per failure-mode row 3.
 *
 * @otel tick-loop.local-llm-bootstrap.execute
 */
export async function executeBootstrapPlan(
  plan: BootstrapPlan,
  opts: ExecuteOpts,
): Promise<ExecuteResult> {
  // Empty plan fast path (failure-mode row 4).
  if (plan.steps.length === 0 || plan.ready) {
    opts.log("Local-LLM stack already ready — skipping bootstrap.\n");
    return { success: true, stepsRun: 0 };
  }

  // Confirm prompt (failure-mode row 1 / row 5).
  const proceed = await opts.confirm(renderConfirmSummary(plan));
  if (!proceed) {
    opts.log("Bootstrap aborted by operator.\n");
    return { success: false, stepsRun: 0, reason: "operator-declined" };
  }

  // Sequential dispatch — one step per loop. The per-step handler
  // (extracted as `runOneStep`) keeps the outer loop's complexity ≤ 10
  // per biome's cognitive-complexity cap (rule #6).
  let stepsRun = 0;
  for (const step of plan.steps) {
    stepsRun += 1;
    opts.log(`\n[${stepsRun}/${plan.steps.length}] ${step.description}\n`);
    opts.log(`  $ ${step.command.join(" ")}\n`);
    const stepResult = await runOneStep(step, opts);
    if (!stepResult.success) {
      opts.log(`  ✗ ${stepResult.reason ?? "unknown failure"}\n`);
      return {
        success: false,
        stepsRun,
        ...(stepResult.failedStep !== undefined && { failedStep: stepResult.failedStep }),
        ...(stepResult.reason !== undefined && { reason: stepResult.reason }),
      };
    }
    opts.log("  ✓ done\n");
  }

  opts.log("\nLocal-LLM bootstrap complete.\n");
  return { success: true, stepsRun };
}

/**
 * Extract the `http://<host>:<port>/v1/models` probe URL from the
 * `start-mlx-server` command argv. Pure helper — reads `--host` and
 * `--port` flags; falls back to `127.0.0.1:8080` when absent.
 *
 * @otel-exempt pure parser, no I/O, no span.
 */
function extractServerUrl(command: readonly string[]): string {
  const hostIdx = command.indexOf("--host");
  const portIdx = command.indexOf("--port");
  const host = hostIdx !== -1 ? (command[hostIdx + 1] ?? "127.0.0.1") : "127.0.0.1";
  const port = portIdx !== -1 ? (command[portIdx + 1] ?? "8080") : "8080";
  return `http://${host}:${port}/v1/models`;
}

/**
 * Attempt detached spawn; return `{ pid }` on success or an error string on failure.
 * Extracted so `runServerStep` stays under biome's cognitive-complexity cap of 10.
 */
function trySpawnDetached(
  cmd: string,
  args: readonly string[],
  spawnDetachedFn: SpawnDetachedFn,
): { pid: number } | { err: string } {
  try {
    return { pid: spawnDetachedFn(cmd, args).pid };
    // rule-6: handled-locally — pre-spawn ENOENT/EACCES typed as err-string, bubbles to caller as a failed-step result
  } catch (err) {
    return { err: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Write the server PID file, logging a non-fatal warning on failure.
 * Extracted so `runServerStep` stays under biome's cognitive-complexity cap of 10.
 */
function tryWritePid(path: string, pid: number, opts: ExecuteOpts): void {
  if (opts.writePidFn === undefined) return;
  try {
    opts.writePidFn(path, pid);
    // rule-6: handled-locally — PID file is informational; write failure is non-fatal and logged as a warning
  } catch (err) {
    opts.log(
      `  ⚠ PID file write failed (${err instanceof Error ? err.message : String(err)}) — continuing\n`,
    );
  }
}

/**
 * Detached-spawn path for the `start-mlx-server` step. Extracted from
 * `runOneStep` to keep the outer loop's cognitive complexity ≤ biome's
 * cap of 10.
 *
 * Sequence:
 *   1. Spawn the server process detached (non-blocking; returns PID).
 *   2. Write PID to `opts.localLlmPidPath` via `opts.writePidFn` (non-fatal
 *      on failure — log warning + continue; PID file is informational).
 *   3. Poll `opts.pollServerFn` until reachable or timeout.
 *
 * Failure modes:
 *   - Pre-spawn ENOENT/EACCES → captured as failure (chaos row C).
 *   - PID write error → non-fatal; logged + continue.
 *   - Poll timeout → failure: "server did not become reachable within timeout".
 */
async function runServerStep(
  step: InstallStep,
  opts: ExecuteOpts & { readonly spawnDetachedFn: SpawnDetachedFn },
): Promise<{ success: boolean; failedStep?: InstallStep["type"]; reason?: string }> {
  const [cmd, ...args] = step.command;
  if (cmd === undefined) {
    return { success: false, failedStep: step.type, reason: "empty command vector" };
  }
  const spawnResult = trySpawnDetached(cmd, args, opts.spawnDetachedFn);
  if ("err" in spawnResult) {
    return { success: false, failedStep: step.type, reason: spawnResult.err };
  }
  if (opts.localLlmPidPath !== undefined) {
    tryWritePid(opts.localLlmPidPath, spawnResult.pid, opts);
  }
  if (opts.pollServerFn !== undefined) {
    const probeUrl = extractServerUrl(step.command);
    const timeoutMs = step.estimatedDurationMs ?? 60_000;
    const reachable = await opts.pollServerFn(probeUrl, timeoutMs);
    if (!reachable) {
      return {
        success: false,
        failedStep: step.type,
        reason: "server did not become reachable within timeout",
      };
    }
  }
  return { success: true };
}

/**
 * Run one install step. Internal helper extracted from
 * {@link executeBootstrapPlan} so the outer loop's cognitive complexity
 * stays ≤ biome's cap of 10. Returns a discriminated union over
 * `{ success: true }` / `{ success: false, failedStep, reason }`.
 *
 * (Internal — not exported; no JSDoc tag required.)
 */
async function runOneStep(
  step: InstallStep,
  opts: ExecuteOpts,
): Promise<{
  success: boolean;
  failedStep?: InstallStep["type"];
  reason?: string;
}> {
  const [cmd, ...args] = step.command;
  if (cmd === undefined) {
    return { success: false, failedStep: step.type, reason: "empty command vector" };
  }
  // Slice 58: start-mlx-server is a long-running server — dispatch to
  // runServerStep (detached spawn + PID file + readiness poll) when the
  // spawnDetachedFn seam is present. Without it, fall through to the
  // regular spawnFn (backward compat for tests that don't supply the seam).
  if (step.type === "start-mlx-server" && opts.spawnDetachedFn !== undefined) {
    return await runServerStep(step, opts as ExecuteOpts & { spawnDetachedFn: SpawnDetachedFn });
  }
  // Slice 6: install-arm-homebrew wraps the Homebrew installer which
  // sudo-escalates to create /opt/homebrew/. That needs the parent's
  // stdin so sudo can prompt for a password. Every other step is
  // non-interactive and keeps the slice-1 "ignore stdin" default.
  const stdinMode: "ignore" | "inherit" =
    step.type === "install-arm-homebrew" ? "inherit" : "ignore";
  let result: ExecuteSpawnResult;
  try {
    result = await opts.spawnFn(cmd, args, { stdinMode });
    // rule-6: handled-locally — pre-spawn errors (ENOENT/EACCES) typed as failed step, not loud-crash.
  } catch (err) {
    return {
      success: false,
      failedStep: step.type,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
  if (result.exitCode !== 0) {
    const tail = result.stderrTail !== undefined ? `: ${result.stderrTail.slice(0, 200)}` : "";
    return {
      success: false,
      failedStep: step.type,
      reason: `exit code ${result.exitCode}${tail}`,
    };
  }
  return { success: true };
}

/**
 * Render the operator-facing multi-line confirm summary. Internal —
 * exported only for tests to inspect format drift. Same input → same
 * output.
 *
 * @otel-exempt pure formatter; no I/O, no span — the parent span
 *   (`tick-loop.local-llm-bootstrap.execute`) covers the call.
 */
export function renderConfirmSummary(plan: BootstrapPlan): string {
  if (plan.ready || plan.steps.length === 0) {
    return "Local-LLM stack already ready — nothing to do.";
  }
  const lines: string[] = [
    "",
    "Claude appears to be exhausted. To keep the daemon iterating, Minsky",
    "wants to install the local-LLM fallback stack:",
    "",
  ];
  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = plan.steps[i];
    if (step === undefined) continue;
    lines.push(`  ${i + 1}. ${step.description}`);
  }
  const minutes = Math.ceil(plan.totalEstimatedDurationMs / 60_000);
  const gb = (plan.totalEstimatedDownloadMb / 1024).toFixed(1);
  lines.push("");
  lines.push(
    `Estimated total: ~${minutes} min wall-clock${plan.totalEstimatedDownloadMb > 0 ? `; ~${gb} GB download` : ""}.`,
  );
  lines.push("");
  lines.push("Proceed?");
  return lines.join("\n");
}

// ---- Confirm helpers ------------------------------------------------------

/**
 * Confirm helper that always returns `true` — used for non-TTY
 * automation (cron, launchd, CI) where there's no operator to prompt.
 * Mirrors `MINSKY_NON_INTERACTIVE=1` semantics from the no-args UX
 * planner (slice in `minsky-cli-context-aware-ux`).
 *
 * @otel-exempt constant function — no I/O, no decision logic.
 */
export const confirmAlwaysYes: ConfirmFn = async () => true;

/**
 * Confirm helper that always returns `false` — used for `--dry-run`
 * mode where the operator wants to see the plan without any side
 * effects.
 *
 * @otel-exempt constant function — no I/O, no decision logic.
 */
export const confirmAlwaysNo: ConfirmFn = async () => false;
