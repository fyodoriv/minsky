// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 2 (operator 2026-05-08) -->
// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 36 (operator 2026-05-11 — step-specific recovery hints: task Details "pipx install fails → loud-crash with the exact pipx error + a recovery hint (`brew install pipx`)") -->
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

import type { BootstrapPlan, BootstrapStepType, InstallStep } from "./local-llm-bootstrap.js";

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

/**
 * Detached-server seam — starts `mlx_lm.server` as a background
 * process that outlives the `minsky` CLI process. The production
 * implementation in `bin/minsky.mjs` uses `child_process.spawn` with
 * `{ detached: true }` + `child.unref()` and writes the PID to
 * `.minsky/local-llm.pid`. Returns a Promise that resolves with the
 * server's PID immediately (does NOT wait for server readiness — the
 * caller's next `minsky` invocation probes reachability via
 * `buildServerProbe`). Tests inject a fake that resolves instantly.
 *
 * Slice 33: separate from `SpawnFn` because `SpawnFn` resolves on
 * process-close — a long-running server would hang the executor forever
 * if routed through the generic spawn seam.
 */
export type StartServerFn = (command: string, args: readonly string[]) => Promise<{ pid: number }>;

/** Confirm seam — returns `true` to proceed, `false` to abort. */
export type ConfirmFn = (summary: string) => Promise<boolean>;

/** Log seam — `process.stdout.write` in production. */
export type LogFn = (line: string) => void;

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
  /**
   * Detached-server seam for `start-mlx-server` steps. When provided,
   * the executor routes `start-mlx-server` through this seam instead
   * of `spawnFn` — the server must outlive the CLI process and must NOT
   * be waited-on. When absent, falls back to `spawnFn` (test
   * environments where the fake returns immediately).
   */
  readonly startServerFn?: StartServerFn;
  /** Log seam — typically `process.stdout.write` in production. */
  readonly log: LogFn;
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
 * Dispatch the `start-mlx-server` step via the detached-server seam.
 * Extracted from {@link runOneStep} to keep its complexity ≤ biome's cap.
 *
 * (Internal — not exported.)
 */
async function runStartServerStep(
  step: InstallStep,
  cmd: string,
  args: string[],
  startServerFn: StartServerFn,
): Promise<{ success: boolean; failedStep?: InstallStep["type"]; reason?: string }> {
  try {
    await startServerFn(cmd, args);
    return { success: true };
    // rule-6: handled-locally — startServerFn rejection is a spawn-level failure (e.g. mlx_lm.server not on PATH); returned as failed-step so the caller emits it and continues
  } catch (err) {
    return {
      success: false,
      failedStep: step.type,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
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
  // Slice 33: start-mlx-server must outlive the CLI process — route
  // through startServerFn (detached spawn + PID write) when provided.
  // Falls back to spawnFn for test environments where the fake returns
  // immediately (no hang risk). The spawnFn path would wait for
  // process-close, which never happens for a long-running server.
  if (step.type === "start-mlx-server" && opts.startServerFn !== undefined) {
    return runStartServerStep(step, cmd, args, opts.startServerFn);
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

// ---- Step-specific recovery hints (slice 36) --------------------------------

/**
 * Return a short operator-actionable recovery hint for a failed install
 * step, or `undefined` if no hint is registered for that step type. Pure
 * function — no I/O.
 *
 * Implements the task's failure-mode specification: "pipx install fails →
 * loud-crash with the exact `pipx` error + a recovery hint (`brew install
 * pipx`)". The wiring layer (`bin/minsky.mjs` `executePlanWithProductionIo`)
 * emits this line after the failure line so the operator sees a concrete
 * recovery command without reading the docs.
 *
 * @otel-exempt pure formatter; no I/O, no span — parent span covers
 *   execution.
 */
export function recoveryHintForStep(stepType: BootstrapStepType): string | undefined {
  const hints: Record<BootstrapStepType, string> = {
    "install-arm-homebrew":
      '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    "install-pipx": "brew install pipx",
    "install-mlx-lm": "pipx install mlx-lm",
    "install-aider": "pipx install --python /opt/homebrew/bin/python3.12 aider-chat",
    "install-huggingface-cli": "pipx install huggingface-hub[cli]",
    "download-model": "retry is idempotent — rerun `minsky bootstrap-local-llm`",
    "start-mlx-server":
      "mlx_lm.server --model mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit --host 127.0.0.1 --port 8080 &",
  };
  return hints[stepType];
}
