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
import { existsSync } from "node:fs";
import { join } from "node:path";

// ---- Types ----------------------------------------------------------------

/** Result of a single lint-stack invocation. */
export interface PrePrLintRunResult {
  readonly verdict: "pass" | "fail";
  /** Name of the first failing step (set when `verdict` is `"fail"`). */
  readonly failedStep?: string;
  /** Last ~80 lines of stderr from the failing step (set when `verdict` is `"fail"`). */
  readonly stderrTail?: string;
  /**
   * Whether the body-only checks (`pr-self-grade`, `pr-security-review`)
   * actually ran. `true` when a draft body file was discovered and forwarded
   * via `--body=<path>`; `false` when no body file was present and the body
   * checks were silently skipped; `undefined` when the run was body-blind by
   * construction (the legacy `createPnpmPrePrLintRun` direct binding).
   *
   * Set only by `createBodyAwarePrePrLintRun` (slice 34/N — surfacing the
   * silent skip so the OTEL signal can chart how often the daemon opens PRs
   * without writing `pr-body.md` to disk first). PR #337 was BLOCKED in CI
   * because the body-only `pr-security-review` check fired in CI but the
   * outer gate's body-only checks had silently skipped the same check
   * locally — this field makes that asymmetry visible per-iteration.
   */
  readonly bodyDiscovered?: boolean;
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
  /**
   * Body-discovery status from the last attempt — `true`/`false`/`undefined`
   * mirrors `PrePrLintRunResult.bodyDiscovered`. Forwarded so the daemon's
   * span emitter can surface `pre-pr-lint.body_discovered` per-iteration
   * (slice 34/N).
   */
  readonly bodyDiscovered?: boolean;
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
      return {
        verdict: "pass",
        attempts: attempt,
        ...(last.bodyDiscovered !== undefined && { bodyDiscovered: last.bodyDiscovered }),
      };
    }
  }
  return {
    verdict: "fail",
    attempts: maxAttempts,
    ...(last?.failedStep !== undefined && { failedStep: last.failedStep }),
    ...(last?.stderrTail !== undefined && { stderrTail: last.stderrTail }),
    ...(last?.bodyDiscovered !== undefined && { bodyDiscovered: last.bodyDiscovered }),
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
  /**
   * Path to a draft PR-body file. When set, the gate appends `--body=<path>`
   * so the two body-only CI checks (`pr-self-grade`, `pr-security-review`,
   * both env-dependent on PR-body context in CI) ride the same retry budget
   * as the branch-code lints. Slice 30/N added the flag to the canonical
   * runner; slice 32/N exposes it on the typed binding so the daemon's
   * programmatic gate can validate the body file the same way the brief
   * already instructs the inner Claude to via the shell. Unset → no
   * body-only checks (the existing daemon wire-in's behaviour).
   */
  readonly bodyPath?: string;
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
 * Per-step row emitted by `run-pre-pr-lint-stack.mjs --json` (NDJSON
 * format, one row per step + one trailing summary row carrying
 * `summary: true` + `allPass`).
 */
interface NdjsonStepRow {
  readonly name: string;
  readonly verdict: "pass" | "fail";
  readonly stderrTail?: string;
}

interface NdjsonSummaryRow {
  readonly summary: true;
  readonly allPass: boolean;
}

/**
 * Parse the script's NDJSON stdout into the shape `createPnpmPrePrLintRun`
 * expects. Throws when the input has zero parseable rows or when the
 * trailing summary row is missing — surfaces real script crashes
 * (rule #6 visible-not-silent) without dropping legitimate per-step rows.
 *
 * @otel-exempt pure parser; the I/O wrapper records the read.
 */
export function parseStackNdjson(raw: string): StackResultJson {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new Error("pre-pr-lint-gate: empty stdout (script crash before any output)");
  }
  const steps: NdjsonStepRow[] = [];
  let summary: NdjsonSummaryRow | undefined;
  for (const line of lines) {
    const obj = JSON.parse(line) as NdjsonStepRow | NdjsonSummaryRow;
    if ((obj as NdjsonSummaryRow).summary === true) {
      summary = obj as NdjsonSummaryRow;
    } else {
      steps.push(obj as NdjsonStepRow);
    }
  }
  if (summary === undefined) {
    throw new Error(
      `pre-pr-lint-gate: NDJSON output missing trailing summary row (got ${steps.length} step row(s) but no {"summary":true,...})`,
    );
  }
  return { allPass: summary.allPass, steps };
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
  const bodyPath = opts.bodyPath;

  return async (): Promise<PrePrLintRunResult> => {
    const args = [scriptPath, "--json", `--stage=${stage}`];
    if (bodyPath !== undefined) args.push(`--body=${bodyPath}`);
    const { stdout, stderr } = await runScriptCapture(spawnFn, nodePath, args, cwd);
    const parsed = parseStackOrThrow(stdout, stderr);
    return resultFromParsed(parsed);
  };
}

/**
 * Run the script via `spawnFn`, accumulate stdout + stderr, and resolve
 * once the child closes (exit code is encoded as `allPass=false` in the
 * JSON; the caller parses).
 */
async function runScriptCapture(
  spawnFn: typeof nodeSpawn,
  nodePath: string,
  args: readonly string[],
  cwd: string | undefined,
): Promise<{ stdout: string; stderr: string }> {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const child: ChildProcess = spawnFn(nodePath, args.slice(), {
      stdio: ["ignore", "pipe", "pipe"],
      ...(cwd === undefined ? {} : { cwd }),
    });
    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", () => resolve());
  });
  return {
    stdout: Buffer.concat(stdoutChunks as Buffer[])
      .toString("utf8")
      .trim(),
    stderr: Buffer.concat(stderrChunks as Buffer[])
      .toString("utf8")
      .trimEnd(),
  };
}

/** Parse the script's NDJSON output, surfacing crashes with stderr context. */
function parseStackOrThrow(stdout: string, stderr: string): StackResultJson {
  try {
    return parseStackNdjson(stdout);
    // rule-6: handled-locally — NDJSON parse is the I/O boundary; invalid
    // input (script crash, missing summary row) surfaces as a real Error.
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `pre-pr-lint-gate: script produced unparseable output (${cause})\nstdout: ${stdout}\nstderr: ${stderr}`,
    );
  }
}

/** Map the parsed result into a `PrePrLintRunResult`. */
function resultFromParsed(parsed: StackResultJson): PrePrLintRunResult {
  if (parsed.allPass) return { verdict: "pass" };
  const firstFail = parsed.steps.find((s) => s.verdict === "fail");
  return {
    verdict: "fail",
    ...(firstFail?.name !== undefined && { failedStep: firstFail.name }),
    ...(firstFail?.stderrTail !== undefined && { stderrTail: firstFail.stderrTail }),
  };
}

// ---- Body-aware production binding ----------------------------------------

/** Options for `createBodyAwarePrePrLintRun`. */
export interface BodyAwarePrePrLintRunOptions {
  /**
   * Working directory for the spawn AND the directory the body file is
   * looked up in. In production this is the daemon's worktree root
   * (`minskyHome` in `tick-loop.mjs`).
   */
  readonly cwd: string;
  /**
   * Filename to look for, relative to `cwd`. Default `"pr-body.md"` —
   * the path the daemon brief instructs the inner Claude to write the
   * draft PR body to (see `daemon.ts § buildDaemonBrief` body-only line).
   */
  readonly bodyFilename?: string;
  /** Stage forwarded to `createPnpmPrePrLintRun`. Default `"fast"`. */
  readonly stage?: "fast" | "full";
  /** Existence-check seam (rule #2). Default `node:fs.existsSync`. */
  readonly fileExists?: (path: string) => boolean;
  /** Spawn seam — forwarded to `createPnpmPrePrLintRun`. */
  readonly spawnFn?: typeof nodeSpawn;
}

/**
 * Build a `PrePrLintRun` that auto-discovers a draft PR-body file in `cwd`
 * each invocation and passes it through as `--body=<path>` when present.
 *
 * Why per-call detection (not bind-once-at-startup): the body file is
 * authored by the inner Claude *during* an iteration; binding the path at
 * daemon boot would miss it. Per-call `existsSync` is cheap (one stat per
 * iteration) and closes the loop the brief already documents — inner
 * Claude writes `pr-body.md`, outer gate validates it on the same retry
 * budget as the branch-code lints. Without this, the outer gate is blind
 * to the body file and only catches branch-code drift.
 *
 * Pattern (rule #2): pure factory — file existence is the only I/O, and
 * it's behind the `fileExists` seam. The spawn happens inside the
 * delegated `createPnpmPrePrLintRun` binding.
 *
 * @otel-exempt pure factory; the span lives at the call-site
 *   (`tick-loop.pre-pr-lint-gate` in `daemon.ts § maybeRunPrePrLintGate`).
 */
export function createBodyAwarePrePrLintRun(opts: BodyAwarePrePrLintRunOptions): PrePrLintRun {
  const filename = opts.bodyFilename ?? "pr-body.md";
  const fileExists = opts.fileExists ?? existsSync;
  return async (): Promise<PrePrLintRunResult> => {
    const fullPath = join(opts.cwd, filename);
    const bodyPath = fileExists(fullPath) ? fullPath : undefined;
    const inner = createPnpmPrePrLintRun({
      cwd: opts.cwd,
      ...(opts.stage !== undefined && { stage: opts.stage }),
      ...(opts.spawnFn !== undefined && { spawnFn: opts.spawnFn }),
      ...(bodyPath !== undefined && { bodyPath }),
    });
    const result = await inner();
    return { ...result, bodyDiscovered: bodyPath !== undefined };
  };
}
