// <!-- scope: human-approved 2026-05-05 operator directive "daemon runs all in-tree CI lints locally before opening any PR; refuses to open if any fails" — task `daemon-pre-pr-lint-gate` Details (a)+(c) "New step in the daemon's iteration end-of-task path; cap retries at 3 per task" -->
/**
 * `@minsky/tick-loop/pre-pr-lint-gate` — programmatic wrapper around
 * `pnpm pre-pr-lint` that the daemon's inner Claude invokes before
 * `gh pr create` (brief mandate: TASKS.md `daemon-pre-pr-lint-gate`).
 *
 * Pattern (rule #2): pure gate (`runPrePrLintGate`) + injectable
 * `PrePrLintRun` seam. Production binding (`createPnpmPrePrLintRun`)
 * spawns `node scripts/run-pre-pr-lint-stack.mjs --json`; tests inject a
 * stub.
 *
 * Retry cap (TASKS.md `daemon-pre-pr-lint-gate` Detail c):
 *   - Attempts 1–N: re-run lint after each fix iteration.
 *   - All N fail → verdict `"fail"` with `failedStep` set; caller should
 *     emit `noop, exiting — pre-pr-lint-failures: <failedStep>`.
 *
 * Opt-out (`shouldRunPrePrLintGate`): skip when the task already carries
 * a `Blocked: pre-pr-lint-failures` marker so a re-claimed blocked task
 * doesn't burn another 3 retries on a known-red branch.
 *
 * Pivot (rule #9): if the full-stage exceeds 5 min, switch to
 * `--stage=fast` (~80% coverage). The injected seam controls which stage
 * fires; the production binding defaults to `--stage=fast`.
 *
 * @module tick-loop/pre-pr-lint-gate
 */

import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";

// ---- Types ----------------------------------------------------------------

/** Result of a single lint-stack invocation. */
export interface PrePrLintRunResult {
  readonly verdict: "pass" | "fail";
  /** Name of the first failing step (set when `verdict` is `"fail"`). */
  readonly failedStep?: string;
  /** Last ~80 lines of stderr from the failing step (set when `verdict` is `"fail"`). */
  readonly stderrTail?: string;
}

/**
 * Seam (rule #2) — one lint-stack invocation.
 * Production binding: `createPnpmPrePrLintRun`. Tests inject a stub.
 */
export type PrePrLintRun = () => Promise<PrePrLintRunResult>;

/** Verdict after up to `maxAttempts` lint runs. */
export interface PrePrLintGateResult {
  readonly verdict: "pass" | "fail";
  /** Total number of `runLint` calls made. */
  readonly attempts: number;
  /** Failing step name from the last attempt (set when `verdict` is `"fail"`). */
  readonly failedStep?: string;
  /** Stderr tail from the last failing attempt (set when `verdict` is `"fail"`). */
  readonly stderrTail?: string;
}

export interface RunPrePrLintGateArgs {
  readonly runLint: PrePrLintRun;
  /**
   * Maximum number of attempts before declaring defeat. Default 3.
   * (TASKS.md `daemon-pre-pr-lint-gate` Detail c: "Cap retries at 3 per task".)
   */
  readonly maxAttempts?: number;
}

// ---- Pure gate ------------------------------------------------------------

/**
 * Run the lint stack up to `maxAttempts` times, returning `"pass"` as soon
 * as one run succeeds. After `maxAttempts` failures, returns `"fail"` with
 * the failing step from the last attempt.
 *
 * Why retry? The brief instructs inner Claude to fix failing lint steps
 * between invocations; the gate re-runs after each fix attempt. Without a
 * cap, a persistent failure would loop forever.
 *
 * @otel-exempt pure retry orchestrator; spans live at the call-site
 *   (`tick-loop.iteration` in `daemon.ts`).
 */
export async function runPrePrLintGate(args: RunPrePrLintGateArgs): Promise<PrePrLintGateResult> {
  const maxAttempts = args.maxAttempts ?? 3;
  let last: PrePrLintRunResult | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await args.runLint();
    if (last.verdict === "pass") {
      return { verdict: "pass", attempts: attempt };
    }
  }
  return {
    verdict: "fail",
    attempts: maxAttempts,
    ...(last?.failedStep !== undefined && { failedStep: last.failedStep }),
    ...(last?.stderrTail !== undefined && { stderrTail: last.stderrTail }),
  };
}

/**
 * Guard: should the daemon run the pre-PR lint gate for this task?
 *
 * Skip when the task block contains `Blocked: pre-pr-lint-failures` so a
 * re-claimed task that exhausted its retry budget doesn't burn another N
 * attempts on a branch the operator already knows is lint-red.
 *
 * @otel-exempt pure predicate; no I/O.
 */
export function shouldRunPrePrLintGate(args: {
  /** Raw text of the task's TASKS.md block. */
  readonly taskBlock: string;
}): boolean {
  return !args.taskBlock.includes("pre-pr-lint-failures");
}

// ---- Production binding ---------------------------------------------------

/** Options for `createPnpmPrePrLintRun`. */
export interface PnpmPrePrLintRunOptions {
  /**
   * Stage to pass to the manifest runner. Default `"fast"` (daemon sprint
   * budget; closes ~80% of failure modes per TASKS.md `daemon-pre-pr-lint-gate`
   * Pivot). The operator-side gate uses `"full"` via `lefthook` `pre-push`.
   */
  readonly stage?: "fast" | "full";
  /**
   * Working directory for the spawn. Default: inherited from parent
   * (= repo root in production under systemd/launchd with `WorkingDirectory`).
   */
  readonly cwd?: string;
  /**
   * Node executable path. Default: `process.execPath` (same Node version
   * the daemon runs — avoids version skew between the runner and the manifest).
   */
  readonly nodePath?: string;
  /**
   * Script path passed to node. Default: `scripts/run-pre-pr-lint-stack.mjs`
   * (resolved relative to `cwd`, which is the repo root in production).
   */
  readonly scriptPath?: string;
  /** Optional spawn override — a seam tests use to inject a fake subprocess. */
  readonly spawnFn?: typeof nodeSpawn;
}

/** JSON shape emitted by `run-pre-pr-lint-stack.mjs --json`. */
interface StackResultJson {
  readonly allPass: boolean;
  readonly steps: readonly {
    readonly name: string;
    readonly verdict: "pass" | "fail";
    readonly stderrTail?: string;
  }[];
}

/**
 * Build a `PrePrLintRun` that spawns
 * `node scripts/run-pre-pr-lint-stack.mjs --json [--stage=<stage>]`
 * and parses the JSON output into a structured result.
 *
 * Error model (rule #6 — let-it-crash at the right boundary):
 *   - Non-zero exit with valid JSON → structured `"fail"` result (normal path).
 *   - Spawn failure (ENOENT — Node not on PATH) → promise rejects (misconfigured env).
 *   - Invalid JSON output (script crashed mid-write) → `Error` with stdout + stderr
 *     for the operator to diagnose — not swallowed, not silenced.
 *
 * @otel-exempt pure factory; the `tick-loop.pre-pr-lint` span lives at the
 *   call-site when this is wired into the daemon.
 */
export function createPnpmPrePrLintRun(opts: PnpmPrePrLintRunOptions = {}): PrePrLintRun {
  const stage = opts.stage ?? "fast";
  const nodePath = opts.nodePath ?? process.execPath;
  const scriptPath = opts.scriptPath ?? "scripts/run-pre-pr-lint-stack.mjs";
  const spawnFn = opts.spawnFn ?? nodeSpawn;
  const cwd = opts.cwd;

  return async (): Promise<PrePrLintRunResult> => {
    const args = [scriptPath, "--json", `--stage=${stage}`];
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      const child: ChildProcess = spawnFn(nodePath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        ...(cwd === undefined ? {} : { cwd }),
      });

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      child.on("error", reject);

      child.on("close", () => {
        // exitCode is encoded as allPass=false in the JSON; parse below.
        resolve();
      });
    });

    const raw = Buffer.concat(stdoutChunks as Buffer[])
      .toString("utf8")
      .trim();
    let parsed: StackResultJson;
    try {
      parsed = JSON.parse(raw) as StackResultJson;
      // rule-6: handled-locally — JSON parse is the I/O boundary; invalid JSON
      // (script crash) is surfaced as a real Error with stdout+stderr context.
    } catch {
      const stderr = Buffer.concat(stderrChunks as Buffer[])
        .toString("utf8")
        .trimEnd();
      throw new Error(
        `pre-pr-lint-gate: script produced non-JSON output (crash?)\nstdout: ${raw}\nstderr: ${stderr}`,
      );
    }

    if (parsed.allPass) {
      return { verdict: "pass" };
    }

    const firstFail = parsed.steps.find((s) => s.verdict === "fail");
    return {
      verdict: "fail",
      ...(firstFail?.name !== undefined && { failedStep: firstFail.name }),
      ...(firstFail?.stderrTail !== undefined && { stderrTail: firstFail.stderrTail }),
    };
  };
}
