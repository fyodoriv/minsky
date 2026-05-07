/**
 * `@minsky/tick-loop/spawn-strategy` — the spawn-step Strategy seam (rule #2,
 * Gamma 1994) that decouples the daemon's per-iteration "run a tick" step
 * from the concrete subprocess machinery.
 *
 * Sub-task 1/3 of the decomposition of `tick-loop-daemon-real-spawn`:
 *
 *   1. **`tick-loop-daemon-spawn-strategy`** (this file) — introduce the
 *      interface + both Strategies; production stays defaulted to
 *      `DryRunSpawnStrategy` so behaviour is unchanged.
 *   2. `tick-loop-daemon-budget-guard-real` — wire the real
 *      `BudgetGuard.decide()` from `@minsky/budget-guard`.
 *   3. `tick-loop-daemon-real-spawn-flip` — drop `--dry-run` from the bin
 *      bootstrap + systemd unit; gate via `MINSKY_TICK_DRY_RUN=1` env var.
 *
 * Pattern conformance (rule #8 / vision.md § "Pattern conformance index"):
 *   - **Strategy** — Gamma 1994. `SpawnStrategy` is the interface; the two
 *     implementations are swap-in-able without touching `runDaemon`.
 *     Conformance: full.
 *   - **Adapter (seam)** — Wirfs-Brock & McKean 2003. The interface is the
 *     contract; tests inject `DryRunSpawnStrategy`; production v0 also
 *     defaults to it; the real-spawn flip in sub-task 3 is a one-line
 *     constructor swap. Conformance: full.
 *   - **Let-it-crash boundary** — Armstrong 2007. `ProcessSpawnStrategy`
 *     never catches mid-spawn; subprocess failure surfaces as a non-zero
 *     `exitCode` in the result, NOT a thrown exception. The daemon's
 *     supervisor (`Restart=on-failure`) is the respawn unit. Conformance:
 *     full.
 *
 * @module tick-loop/spawn-strategy
 */

import { spawn as nodeSpawn } from "node:child_process";

// ---- Types ----------------------------------------------------------------

/**
 * The arguments passed to `SpawnStrategy.spawn` per iteration. The daemon
 * builds these from the picked task + the brief; the Strategy is responsible
 * for shelling them out (or simulating).
 */
export interface SpawnInput {
  /** The picked task ID — included for logging + the synthetic dry-run output. */
  readonly taskId: string;
  /** The full brief that the spawned process should receive on stdin. */
  readonly brief: string;
  /** The env to pass to the subprocess (production: `process.env` + Claude config). */
  readonly env: NodeJS.ProcessEnv;
  /** Optional cancellation signal — the supervisor's stop signal. */
  readonly signal?: AbortSignal;
  /**
   * Optional per-iteration args appended to the Strategy's base args.
   * Used by `daemon-parallel-worktree-launch` slice 2.5 to inject
   * `--worktree <daemon-N-taskId>` per claimed task without re-constructing
   * the Strategy. `[]` or omitted preserves the v0 contract.
   */
  readonly extraArgs?: readonly string[];
}

/**
 * The shape returned by `SpawnStrategy.spawn`. Mirrors what a real
 * `child_process.spawn` produces: an exit code, a wall-clock duration,
 * and bounded stdout/stderr tails (last 4KB each — rule-7 graceful-degrade
 * over unbounded log capture).
 */
export interface SpawnResult {
  readonly exitCode: number;
  readonly durationMs: number;
  readonly stdoutTail: string;
  readonly stderrTail: string;
  /**
   * `true` when the strategy killed a hung child via the `timeoutMs` watchdog.
   * Distinguishes "child died on its own with exitCode -1" from "watchdog
   * SIGKILLed a child that never closed". Daemons should treat `timedOut: true`
   * as `failed` status with reason `claude-print-timeout: <ms>ms` so the
   * rolling-7d timeout-frequency invariant has a stable string to grep.
   *
   * Surfaced-by `daemon-claude-print-hang-watchdog` (operator 2026-05-07).
   */
  readonly timedOut?: boolean;
}

/**
 * The Strategy interface (Gamma 1994) the daemon dispatches over per
 * iteration. Two v0 implementations:
 *
 *   - `DryRunSpawnStrategy` — synthetic result, no subprocess. Production
 *     default in v0 + sub-task 1/3.
 *   - `ProcessSpawnStrategy` — real `node:child_process.spawn` with the
 *     brief written to stdin and bounded tails captured. Reachable but
 *     NOT default — the flag-flip is sub-task 3.
 */
export interface SpawnStrategy {
  spawn(input: SpawnInput): Promise<SpawnResult>;
}

// ---- DryRunSpawnStrategy --------------------------------------------------

/**
 * The synthetic Strategy: returns a deterministic success result without
 * touching the OS. Mirrors v0's pre-existing dry-run behaviour so existing
 * tests pass unchanged when this is the injected Strategy.
 */
export class DryRunSpawnStrategy implements SpawnStrategy {
  /**
   * Resolve with a synthetic success result — no subprocess, no I/O.
   *
   * @otel tick-loop.spawn-strategy.dry-run.spawn
   */
  spawn(input: SpawnInput): Promise<SpawnResult> {
    const stdoutTail = `daemon dry-run prompt for ${input.taskId}`;
    return Promise.resolve({
      exitCode: 0,
      durationMs: 0,
      stdoutTail,
      stderrTail: "",
    });
  }
}

// ---- ProcessSpawnStrategy -------------------------------------------------

/**
 * Tail-cap for stdout / stderr capture. 4KB per stream is enough to
 * surface the last error message in operator logs without unbounded
 * memory growth on a chatty subprocess.
 */
const TAIL_CAP_BYTES = 4096;

/**
 * Configuration for `ProcessSpawnStrategy`. Defaults pick `claude --print` —
 * Claude Code's documented headless / non-interactive flag (`claude --help`:
 * "Print response and exit (useful for pipes). … workspace trust dialog is
 * skipped when Claude is run in non-interactive mode (via -p, or when stdout
 * is not a TTY)"). The brief is written to the child's stdin and the child
 * exits when the response is complete — that matches the daemon's contract
 * "feed the brief in, get the result out".
 *
 * The legacy `--resume` default opened an interactive session picker (TTY)
 * and resumed the previous conversation rather than reading the brief; that
 * default was the bug fixed by `tick-loop-spawn-args-fresh-session`.
 *
 * A test or operator can still override the command + args (e.g.
 * `omc /team <persona>`).
 */
export interface ProcessSpawnStrategyOptions {
  /** Command to spawn. Default `claude`. */
  readonly command?: string;
  /**
   * Arguments to pass to the command. Default `["--print"]` — Claude Code's
   * documented headless flag (`claude -p` / `claude --print`). The brief
   * is fed to the child's stdin; the child writes the response to stdout
   * and exits. Use `["--resume"]` ONLY if the operator explicitly wants
   * the interactive session picker (NOT the daemon's contract).
   */
  readonly args?: readonly string[];
  /**
   * Optional spawn override — a seam tests can use to inject a fake
   * `child_process.spawn` without touching the OS. Production omits.
   */
  readonly spawnFn?: typeof nodeSpawn;
  /**
   * Per-iteration timeout in milliseconds. When set, the strategy SIGKILLs
   * any child still running after `timeoutMs` and resolves with
   * `exitCode: -1`, `stderrTail: '<timed out after Nms>'`, and
   * `timedOut: true`. When omitted, the legacy unbounded behaviour is
   * preserved — the daemon waits forever for the child to close.
   *
   * Operator-recommended default in `bin/tick-loop.mjs`: 900_000 (15 min).
   * Higher than the 95th-percentile productive iteration; low enough that
   * a stuck `claude --print` doesn't silently freeze a worker for hours
   * (the worker-1 hang of 2026-05-07 ran for 1h 56min before manual
   * intervention).
   *
   * Surfaced-by `daemon-claude-print-hang-watchdog` (operator 2026-05-07).
   */
  readonly timeoutMs?: number;
}

/**
 * The real Strategy: invokes `node:child_process.spawn(command, args, …)`,
 * writes the brief to stdin, captures the last `TAIL_CAP_BYTES` of each of
 * stdout / stderr, and resolves with the result when the subprocess exits.
 *
 * **NOT yet wired as the production default.** v0 + sub-task 1/3 keeps
 * `DryRunSpawnStrategy` as the daemon's default; sub-task 3
 * (`tick-loop-daemon-real-spawn-flip`) swaps the default + drops the
 * `--dry-run` arg from the bin/systemd bootstrap.
 *
 * Let-it-crash AT the right boundary (rule #6, Armstrong 2007): a failing
 * subprocess surfaces as a non-zero `exitCode` in the result, not a thrown
 * exception. The daemon iterates over results; the supervisor handles the
 * respawn.
 */
export class ProcessSpawnStrategy implements SpawnStrategy {
  private readonly command: string;
  private readonly args: readonly string[];
  private readonly spawnFn: typeof nodeSpawn;
  private readonly timeoutMs: number | undefined;

  constructor(opts: ProcessSpawnStrategyOptions = {}) {
    this.command = opts.command ?? "claude";
    this.args = opts.args ?? ["--print"];
    this.spawnFn = opts.spawnFn ?? nodeSpawn;
    this.timeoutMs = opts.timeoutMs;
  }

  /**
   * Spawn the child process via `node:child_process.spawn`, write the
   * brief to stdin, capture bounded stdout/stderr tails, and resolve
   * with the result on close.
   *
   * @otel tick-loop.spawn-strategy.process.spawn
   */
  spawn(input: SpawnInput): Promise<SpawnResult> {
    const startedAt = Date.now();
    const argv = [...this.args, ...(input.extraArgs ?? [])];
    const timeoutMs = this.timeoutMs;
    return new Promise<SpawnResult>((resolve, reject) => {
      const child = this.spawnFn(this.command, argv, {
        env: input.env,
        stdio: ["pipe", "pipe", "pipe"],
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let timedOut = false;
      let watchdog: NodeJS.Timeout | undefined;

      // Per-iteration watchdog: SIGKILL the child if it doesn't close within
      // `timeoutMs`. The `claude --print` hang of 2026-05-07 ran for 1h 56min
      // with 0.1% CPU before manual intervention; this prevents that class.
      // Surfaced-by `daemon-claude-print-hang-watchdog` (operator 2026-05-07).
      if (timeoutMs !== undefined && timeoutMs > 0) {
        watchdog = setTimeout(() => {
          timedOut = true;
          // SIGKILL (not SIGTERM): `claude --print` ignores SIGTERM in some
          // hang modes; SIGKILL is the let-it-crash boundary (rule #6).
          child.kill("SIGKILL");
        }, timeoutMs);
      }

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      child.on("error", (err) => {
        if (watchdog !== undefined) clearTimeout(watchdog);
        reject(err);
      });

      child.on("close", (code) => {
        if (watchdog !== undefined) clearTimeout(watchdog);
        resolve(
          buildSpawnResult({
            code,
            timedOut,
            timeoutMs,
            startedAt,
            stdoutChunks,
            stderrChunks,
          }),
        );
      });

      // Write the brief to stdin and close — `claude --print`'s headless
      // path reads the brief from stdin and exits when the response is
      // complete (per `claude --help`: "Print response and exit").
      if (child.stdin !== null && child.stdin !== undefined) {
        child.stdin.end(input.brief);
      }
    });
  }
}

/**
 * Build a `SpawnResult` from the close-event inputs. Extracted so the
 * `child.on('close', …)` handler stays under biome's cognitive-complexity
 * cap (rule #6 / biome ≤10) once the watchdog branch was added.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function buildSpawnResult(input: {
  readonly code: number | null;
  readonly timedOut: boolean;
  readonly timeoutMs: number | undefined;
  readonly startedAt: number;
  readonly stdoutChunks: readonly Buffer[];
  readonly stderrChunks: readonly Buffer[];
}): SpawnResult {
  const exitCode = input.timedOut ? -1 : (input.code ?? -1);
  const stderrTail = input.timedOut
    ? `<timed out after ${input.timeoutMs}ms>`
    : tailOf(input.stderrChunks, TAIL_CAP_BYTES);
  return {
    exitCode,
    durationMs: Date.now() - input.startedAt,
    stdoutTail: tailOf(input.stdoutChunks, TAIL_CAP_BYTES),
    stderrTail,
    ...(input.timedOut ? { timedOut: true } : {}),
  };
}

/**
 * Concatenate the chunks and return the last `cap` bytes as a UTF-8 string.
 * Used to bound the stdout/stderr tails captured by `ProcessSpawnStrategy`.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function tailOf(chunks: readonly Buffer[], cap: number): string {
  const full = Buffer.concat(chunks as Buffer[]);
  const sliced = full.length <= cap ? full : full.subarray(full.length - cap);
  return sliced.toString("utf8");
}
