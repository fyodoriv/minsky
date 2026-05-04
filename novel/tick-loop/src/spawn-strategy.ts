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

  constructor(opts: ProcessSpawnStrategyOptions = {}) {
    this.command = opts.command ?? "claude";
    this.args = opts.args ?? ["--print"];
    this.spawnFn = opts.spawnFn ?? nodeSpawn;
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
    return new Promise<SpawnResult>((resolve, reject) => {
      const child = this.spawnFn(this.command, [...this.args], {
        env: input.env,
        stdio: ["pipe", "pipe", "pipe"],
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      child.on("error", (err) => {
        reject(err);
      });

      child.on("close", (code) => {
        resolve({
          exitCode: code ?? -1,
          durationMs: Date.now() - startedAt,
          stdoutTail: tailOf(stdoutChunks, TAIL_CAP_BYTES),
          stderrTail: tailOf(stderrChunks, TAIL_CAP_BYTES),
        });
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
