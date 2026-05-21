// Host-daemon loop — `minsky-run --host <dir> --loop` keeps invoking
// `runLive` against the host's TASKS.md until the queue is empty or
// SIGTERM. Pure orchestrator over the same `SpawnLike` + `GitLike` seams
// `runLive` already uses, plus a `pickHostTask` selector and a
// `sleep` seam for the inter-iteration wait.
//
// Pattern: periodic-task scheduling (Liu & Layland, *JACM* 1973 — same
//   anchor `@minsky/tick-loop`'s `runDaemon` cites for the minsky-on-
//   itself surface) + let-it-crash AT the iteration boundary (Armstrong
//   2007 — supervisor handles iteration-level exceptions, not the loop
//   itself); the loop body is just dispatch.
// Source: TASKS.md `cross-repo-host-daemon-loop`; user-stories/006-
//   runner-on-any-repo.md § "Dual-purpose framing" — "same loop, same
//   constitution, parameterised by `MINSKY_HOST_ROOT`".
// Conformance: full — pure function over injected I/O seams; the CLI bin
//   is the I/O boundary that constructs the seams.

import type { HostCtoAuditOutcome, HostCtoSignals } from "./host-cto-audit.js";
import type { GitLike, LiveSpawnOutcome, SpawnLike } from "./runner.js";
import type { ParsedTask } from "./task-finder.js";

/**
 * Stop reasons {@link runHostLoop} can surface to the CLI. The CLI maps
 * each to an exit code; the operator can also see the reason in the
 * iteration record / OTEL span emitted per loop.
 *
 *   - `max-iterations` — `--max-iterations=N` cap reached. Healthy exit.
 *   - `empty-queue`    — `pickHostTask` returned `null`. Healthy exit
 *                        (no rule-#9-compliant P0/P1 task left).
 *   - `aborted`        — SIGTERM / AbortSignal fired mid-loop. Operator
 *                        asked us to stop; in-flight iteration finishes.
 *   - `scope-leak`     — `runLive` returned `verdict: scope-leak`. We
 *                        stop on the first leak so the operator can
 *                        inspect before another spawn fires; rule #7
 *                        circuit-break-and-notify shape.
 *   - `spawn-failed`   — `runLive` returned `verdict: spawn-failed`.
 *                        Stop on first failure so we don't burn budget
 *                        on a probably-systemic-failure (e.g. `claude`
 *                        binary missing, auth expired). Operator can
 *                        re-run after fixing.
 *   - `restart-requested` — `~/.minsky/restart-requested` sentinel was
 *                        present between iterations. The
 *                        `post-merge-auto-install` hook writes the
 *                        sentinel after a `git pull` lands runtime
 *                        code; the loop exits cleanly (code 0) so
 *                        launchd's `KeepAlive=true` (or systemd
 *                        `Restart=always`) respawns the daemon with
 *                        the new code. No in-flight iteration is
 *                        interrupted — Armstrong 2007 let-it-crash
 *                        AT the iteration boundary, not mid-spawn.
 *                        Source: TASKS.md `minsky-auto-restart-daemon-
 *                        on-pull` (rule #16 — `minsky update` becomes
 *                        the rare escape hatch, not the daily flow).
 */
export type LoopStopReason =
  | "max-iterations"
  | "empty-queue"
  | "aborted"
  | "scope-leak"
  | "spawn-failed"
  | "restart-requested";

/**
 * One iteration's contribution to the loop result. Mirrors the daemon's
 * `DaemonIterationResult` shape but scoped to the cross-repo verdicts.
 *
 * `stderrTail` and `exitCode` were added 2026-05-19 (rule #17 — proactive
 * healing) so the loop's `recordIteration` callback can surface the WHY
 * of a `spawn-failed` to the operator. Previously the runner captured
 * the agent's stderr but the loop threw it away before the daemon log
 * line was printed — leaving operators with `verdict=spawn-failed` and
 * no way to diagnose. Now the iteration record carries enough data to
 * print "stderr tail: ..." inline.
 */
export interface LoopIterationResult {
  readonly iteration: number;
  readonly taskId: string;
  readonly verdict: LiveSpawnOutcome["verdict"];
  readonly durationMs: number;
  readonly scopeLeakPaths: readonly string[];
  readonly prUrl: string | null;
  readonly stderrTail: string;
  readonly exitCode: number;
  /**
   * POSIX signal that killed the spawned child, if any. Threaded
   * from `LiveSpawnOutcome.signal` so the daemon log's
   * `recordIteration` callback can render `signal=SIGKILL` next
   * to `exit=-1` — without this field, every signal-killed devin
   * iteration looked identical to "exited with no code". Surfaced-by
   * `spawn-failed-exit-minus-one-silent-empty-stderr` (2026-05-19).
   */
  readonly signal?: NodeJS.Signals;
}

/**
 * Final result of {@link runHostLoop}. The CLI walks `stopReason` →
 * exit code; the iteration list is the operator-facing audit trail.
 */
export interface LoopResult {
  readonly iterations: readonly LoopIterationResult[];
  readonly stopReason: LoopStopReason;
}

/**
 * Inputs to {@link runHostLoop}. All I/O behind injected seams (rule #2):
 * `pickTask` reads the host's current TASKS.md, `buildPlan` builds the
 * per-iteration plan from the picked task, `runLive` is slice A's pure
 * orchestrator, `sleep` is the inter-iteration wait, `now` is the
 * monotonic clock, `signal` is the operator's SIGTERM bridge.
 */
/**
 * Optional context passed to {@link RunHostLoopOpts.pickTask} on every
 * call. The loop fills in `skipTaskIds` with the set of task IDs that
 * have ALREADY completed `verdict: validated` earlier in this same
 * {@link runHostLoop} invocation. The picker honours the skip-set by
 * not returning those tasks again — this prevents the
 * `walker-drains-one-host-forever` regression where a worker that
 * validates but never actually removes the block from TASKS.md (or
 * never opens a PR, so the `openPrBranches` self-heal doesn't fire)
 * keeps getting the same task picked, starving every other host the
 * walker should reach next.
 *
 * The skip-set is loop-session-scoped: it's cleared on every fresh
 * `runHostLoop` invocation. The next walker pass gets a fresh chance
 * to re-attempt a still-listed task (operator may have edited TASKS.md
 * in the meantime); this is intentional per rule #6 — let the system
 * self-heal across passes instead of persisting failure state.
 *
 * Existing pickers that ignore the arg keep working (parameter
 * bivariance — a `() => null` is assignable here), so test fakes that
 * predate this contract don't need to change.
 */
export interface PickTaskArgs {
  readonly skipTaskIds?: ReadonlySet<string>;
}

export interface RunHostLoopOpts {
  /**
   * Per-iteration task selection. Production wires
   * `(args) => pickHostTask(readFileSync(hostTasksMdPath, "utf8"), { ...args })`;
   * tests inject a queue-walker fake that returns successive tasks.
   *
   * The loop calls this with `args.skipTaskIds` filled in (the set of
   * task IDs already validated earlier in this run). Picker
   * implementations should treat the argument as advisory: it's
   * legal to ignore it (existing test fakes do), in which case the
   * loop falls back on the {@link RunHostLoopOpts.maxIterations} cap
   * to bound any drain-then-advance regression.
   */
  readonly pickTask: (args: PickTaskArgs) => ParsedTask | null;
  /**
   * Per-iteration plan builder. Production wires `buildSpawnPlan` from
   * `spawn-plan.ts` (slice A); tests inject a fake. The builder receives
   * the picked task and returns the `RunnerPlan` `runLive` consumes.
   */
  readonly buildPlan: (task: ParsedTask) => import("./spawn-plan.js").RunnerPlan;
  /**
   * Per-iteration scope source. Production wires
   * `(task, tasksMd) => extractAllowedPathsFromTaskBlock(extractBlock(tasksMd, task.id))`;
   * tests inject a fake that returns canned globs.
   */
  readonly resolveAllowedPaths: (task: ParsedTask) => readonly string[];
  /**
   * The live-spawn orchestrator from slice A. Tests pass a fake that
   * resolves with a canned `LiveSpawnOutcome`.
   */
  readonly runLive: (inputs: {
    readonly plan: import("./spawn-plan.js").RunnerPlan;
    readonly allowedPaths: readonly string[];
    readonly spawn: SpawnLike;
    readonly git: GitLike;
    readonly globMatchesPath: (glob: string, path: string) => boolean;
  }) => Promise<LiveSpawnOutcome>;
  /** Spawn seam (passed through to `runLive`). */
  readonly spawn: SpawnLike;
  /** Git seam (passed through to `runLive`). */
  readonly git: GitLike;
  /** Glob matcher seam (passed through to `runLive`). */
  readonly globMatchesPath: (glob: string, path: string) => boolean;
  /** Cap on iteration count. Default `Infinity`. Tests pass small values. */
  readonly maxIterations?: number;
  /** Milliseconds between iterations. Default 300_000 (5 min). */
  readonly tickIntervalMs?: number;
  /** Sleep seam. Default real `setTimeout`. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /**
   * Optional operator-driven abort. SIGTERM bridges into this signal at
   * the CLI boundary. When the signal aborts mid-iteration, the in-flight
   * spawn is killed (via the same signal threading through `SpawnLike`),
   * the iteration record is written, and the loop exits with stop reason
   * `aborted`.
   */
  readonly signal?: AbortSignal;
  /**
   * Optional record-emit seam. The CLI wires this to
   * `writeIterationRecord(...)`; tests inject a collector. Called per
   * iteration regardless of verdict (rule #4 — visible-not-silent).
   */
  readonly recordIteration?: (record: LoopIterationResult) => void;
  /**
   * Optional CTO-audit seam. When set, the loop fires the audit (a) after
   * every `validated`-verdict iteration AND (b) on `empty-queue` when
   * `seedOnEmpty` is true. The audit is a pure orchestrator over an
   * injected `SpawnLike` (typically a second `ProcessSpawnStrategy` with
   * a CTO-mode brief). When omitted, the loop runs the slice-B
   * stop-on-empty behaviour unchanged.
   *
   * The seam takes the trigger context + the just-completed verdict so
   * the gate inside the audit (`shouldRunHostCtoAudit`) can decide.
   */
  readonly ctoAudit?: (args: {
    readonly signals: HostCtoSignals;
    readonly completedVerdict: "validated" | "scope-leak" | "spawn-failed" | null;
  }) => Promise<HostCtoAuditOutcome>;
  /**
   * When true AND `ctoAudit` is set, an empty queue triggers a seed
   * audit instead of returning `empty-queue` immediately. After the
   * audit completes (regardless of outcome), the loop re-attempts
   * `pickTask`; if STILL null, returns `empty-queue` (one re-pick budget
   * to bound the retry loop). Default false — operators opt in to keep
   * the slice-B default stop-on-empty behaviour.
   */
  readonly seedOnEmpty?: boolean;
  /**
   * Scope-leak handling mode. Default `"warn"` — log the leak paths
   * and continue iterating (devin naturally touches related files
   * outside the task's **Files** declaration). Set `"hard"` to halt
   * the loop on scope-leak (legacy behavior).
   */
  readonly scopeLeakMode?: "warn" | "hard";
  /**
   * Builder for the audit's `HostCtoSignals`. The loop has the trigger
   * context (post-iteration vs queue-empty) and the just-completed
   * iteration; the builder fills in `hostRepo` / `hostRoot` /
   * `tasksMdPath` / `utcDate` from operator config. Required when
   * `ctoAudit` is set.
   */
  readonly buildCtoSignals?: (args: {
    readonly reason: "post-iteration" | "queue-empty";
    readonly completedTaskId: string | null;
    readonly prUrl: string | null;
    readonly filesChanged: readonly string[];
  }) => HostCtoSignals;
  /**
   * Optional restart-sentinel probe. Called once between iterations
   * (after the just-completed iteration's `recordIteration` callback
   * and BEFORE the next `pickTask`). When it returns a non-null
   * `RestartRequest`, the loop emits a daemon-log line, invokes
   * {@link RunHostLoopOpts.clearRestartRequest} (if wired), and exits
   * with stop reason `restart-requested`. The CLI maps this to
   * `process.exit(0)`; launchd's `KeepAlive=true` (or systemd
   * `Restart=always`) then respawns the daemon with the new code.
   *
   * Production wires this to a `~/.minsky/restart-requested` JSON
   * sentinel reader; tests inject a counter fake. The seam is the
   * function — its body must be pure-data over the filesystem.
   *
   * Source: TASKS.md `minsky-auto-restart-daemon-on-pull`. Composes
   * with `scripts/post-merge-auto-install.mjs`'s `request-daemon-
   * restart` action (the writer).
   */
  readonly checkRestartRequest?: () => RestartRequest | null;
  /**
   * Companion to {@link RunHostLoopOpts.checkRestartRequest}. Called
   * ONCE after the probe surfaces a non-null `RestartRequest` and
   * before the loop returns. Production removes the sentinel file so
   * the post-restart daemon doesn't see a stale request and bounce-
   * loop. Tests can observe the call to assert the clean-up step
   * fired exactly once.
   */
  readonly clearRestartRequest?: () => void;
  /**
   * Optional reporter for the operator-facing "restart-requested"
   * daemon-log line. Wired in production to `console.info`; tests
   * inject a collector. Single-string argument keeps the seam testable
   * without coupling to formatting choices made by the CLI.
   */
  readonly onRestartRequested?: (message: string) => void;
}

/**
 * Operator-facing payload returned by
 * {@link RunHostLoopOpts.checkRestartRequest} when a restart has been
 * requested. The fields mirror the JSON the
 * `post-merge-auto-install` hook writes into the sentinel file —
 * `ts` lets the daemon log show how long ago the request was filed,
 * `reason` is the one-line "why" (e.g. `bin/minsky changed`),
 * `changedFiles` is the relevant subset of the pull's diff.
 */
export interface RestartRequest {
  readonly ts: string;
  readonly reason: string;
  readonly changedFiles: readonly string[];
}

/**
 * Run the host-daemon loop. Pure orchestration over the injected seams:
 * pickTask → buildPlan → runLive → recordIteration → sleep → loop.
 *
 * Stop conditions (evaluated in this order each iteration):
 *   1. `signal?.aborted` → exit with `aborted`.
 *   2. iteration count ≥ `maxIterations` → exit with `max-iterations`.
 *   3. `pickTask()` returns null → exit with `empty-queue`.
 *   4. `runLive` returns `verdict: scope-leak` → exit with `scope-leak`.
 *   5. `runLive` returns `verdict: spawn-failed` → exit with `spawn-failed`.
 *   6. Otherwise (validated) → sleep `tickIntervalMs` and loop.
 *
 * Never catches mid-iteration; an exception from `pickTask` / `buildPlan`
 * / `runLive` propagates per rule #6 let-it-crash. The CLI's top-level
 * handler maps the throw to exit 1.
 *
 * @otel cross-repo-runner.host-loop
 */
export async function runHostLoop(opts: RunHostLoopOpts): Promise<LoopResult> {
  const maxIterations = opts.maxIterations ?? Number.POSITIVE_INFINITY;
  const tickIntervalMs = opts.tickIntervalMs ?? 300_000;
  const sleep = opts.sleep ?? defaultSleep;
  const iterations: LoopIterationResult[] = [];
  // Task IDs that completed with `validated` in this run. Threaded into
  // every subsequent `pickTask` call as `skipTaskIds` so the picker
  // advances to the next eligible task — `walker-drains-one-host-forever`
  // fix (b). Cleared on every fresh `runHostLoop` invocation, so the
  // walker's NEXT pass over this host gets a fresh chance to re-attempt
  // any validated-but-still-listed task (the persistent fix is for the
  // worker to actually open a PR / remove the block; this is the
  // self-healing fallback that keeps the walk from starving other hosts).
  const validatedTaskIds = new Set<string>();

  for (let i = 0; i < maxIterations; i++) {
    const stop = await stepIteration({
      opts,
      iteration: i,
      iterations,
      validatedTaskIds,
      maxIterations,
      tickIntervalMs,
      sleep,
    });
    if (stop !== undefined) return { iterations, stopReason: stop };
  }
  return { iterations, stopReason: "max-iterations" };
}

/**
 * One full iteration step: pre-iteration checks (abort signal,
 * restart-sentinel) → iteration body → inter-iteration sleep. Returns
 * the stop reason when any step halts the loop, otherwise `undefined`
 * (the outer loop advances). Extracted from {@link runHostLoop} so the
 * orchestrator stays under the cognitive-complexity cap (rule #6,
 * biome ≤ 10).
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function stepIteration(args: {
  readonly opts: RunHostLoopOpts;
  readonly iteration: number;
  readonly iterations: LoopIterationResult[];
  readonly validatedTaskIds: Set<string>;
  readonly maxIterations: number;
  readonly tickIntervalMs: number;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}): Promise<LoopStopReason | undefined> {
  const { opts, iteration, iterations, validatedTaskIds, maxIterations, tickIntervalMs, sleep } =
    args;
  const earlyStop = checkAbort(opts.signal);
  if (earlyStop !== undefined) return earlyStop;
  // Restart-sentinel check fires BEFORE pickTask on every iteration
  // (including iteration #0 — a sentinel left over from before the
  // daemon started must NOT be ignored). When the probe surfaces a
  // request, the loop exits cleanly with `restart-requested` and
  // launchd's KeepAlive respawns the daemon. The post-iteration
  // boundary is the "right" boundary for let-it-crash (Armstrong
  // 2007) — never kill an in-flight spawn.
  const restartStop = checkRestartSentinel(opts);
  if (restartStop !== undefined) return restartStop;
  const stop = await runOneIteration({ opts, iteration, iterations, validatedTaskIds });
  if (stop !== undefined) return stop;
  return sleepBetween({
    iteration,
    maxIterations,
    tickIntervalMs,
    sleep,
    signal: opts.signal,
  });
}

/**
 * Probe the restart-sentinel seam. Returns `"restart-requested"` when
 * the probe surfaces a non-null `RestartRequest`; otherwise `undefined`.
 * On a hit: emits the operator-facing log line via
 * {@link RunHostLoopOpts.onRestartRequested} (default console.info)
 * and clears the sentinel via {@link RunHostLoopOpts.clearRestartRequest}
 * so the post-restart daemon doesn't see the same request twice (which
 * would cause a respawn storm — see the task's Pivot threshold).
 *
 * Extracted from {@link runHostLoop} so the orchestrator stays under
 * the cognitive-complexity cap (rule #6, biome ≤ 10).
 *
 * (Internal helper — no JSDoc tag required.)
 */
function checkRestartSentinel(opts: RunHostLoopOpts): LoopStopReason | undefined {
  if (opts.checkRestartRequest === undefined) return undefined;
  const request = opts.checkRestartRequest();
  if (request === null) return undefined;
  const message = `restart-requested: ${request.reason} (filed ${request.ts})`;
  (opts.onRestartRequested ?? defaultReportRestart)(message);
  opts.clearRestartRequest?.();
  return "restart-requested";
}

/**
 * Default `onRestartRequested` reporter — writes a single line to
 * stdout via `console.info`. The CLI inherits this default; tests
 * override with a collector. Kept as a module-level constant so the
 * runtime branch in {@link checkRestartSentinel} doesn't allocate a
 * closure on every iteration.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function defaultReportRestart(message: string): void {
  console.info(message);
}

/**
 * Pre-iteration abort check. Returns `"aborted"` when the signal has
 * fired; otherwise `undefined`. Extracted so {@link runHostLoop} stays
 * under the cognitive-complexity cap.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function checkAbort(signal: AbortSignal | undefined): LoopStopReason | undefined {
  return signal?.aborted ? "aborted" : undefined;
}

/**
 * Inter-iteration sleep with abort short-circuit. Skips the sleep on the
 * final iteration so the loop doesn't wait `tickIntervalMs` before
 * returning `max-iterations`. Returns the stop reason when the abort
 * signal fires during the wait, otherwise `undefined`.
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function sleepBetween(args: {
  readonly iteration: number;
  readonly maxIterations: number;
  readonly tickIntervalMs: number;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly signal: AbortSignal | undefined;
}): Promise<LoopStopReason | undefined> {
  if (args.iteration >= args.maxIterations - 1) return undefined;
  await args.sleep(args.tickIntervalMs, args.signal);
  return checkAbort(args.signal);
}

/**
 * One iteration body: pick → buildPlan → runLive → record. Returns the
 * stop reason when the iteration's verdict halts the loop, otherwise
 * `undefined` (loop continues). Extracted from {@link runHostLoop} so the
 * orchestrator stays under the cognitive-complexity cap (rule #6, biome
 * ≤ 10).
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function runOneIteration(args: {
  readonly opts: RunHostLoopOpts;
  readonly iteration: number;
  readonly iterations: LoopIterationResult[];
  readonly validatedTaskIds: Set<string>;
}): Promise<LoopStopReason | undefined> {
  const { opts, iteration, iterations, validatedTaskIds } = args;
  const task = await pickTaskOrSeed(opts, validatedTaskIds);
  if (task === null) return "empty-queue";
  const plan = opts.buildPlan(task);
  const allowedPaths = opts.resolveAllowedPaths(task);
  const outcome = await opts.runLive({
    plan,
    allowedPaths,
    spawn: opts.spawn,
    git: opts.git,
    globMatchesPath: opts.globMatchesPath,
  });
  const iterationResult: LoopIterationResult = {
    iteration,
    taskId: task.id,
    verdict: outcome.verdict,
    durationMs: outcome.durationMs,
    scopeLeakPaths: outcome.scopeLeakPaths,
    prUrl: outcome.prUrl,
    stderrTail: outcome.stderrTail,
    exitCode: outcome.exitCode,
    // Pass the signal field through — exactOptionalPropertyTypes means
    // we must omit the key entirely when undefined (don't synthesise
    // `signal: undefined`, which the type doesn't allow).
    ...(outcome.signal !== undefined ? { signal: outcome.signal } : {}),
  };
  iterations.push(iterationResult);
  opts.recordIteration?.(iterationResult);
  await maybeFirePostIterationAudit(opts, task, outcome);
  // Scope-leak: configurable soft vs hard mode.
  // Soft (default): log warning + continue — devin naturally touches
  // related files outside **Files**: declaration.
  // Hard: halt the loop (legacy behavior, opt-in via opts.scopeLeakMode).
  if (outcome.verdict === "scope-leak") {
    if (opts.scopeLeakMode === "hard") return "scope-leak";
    // Soft mode: log the leak paths, record the iteration, continue.
    // The iteration record already has scopeLeakPaths for post-hoc review.
  }
  if (outcome.verdict === "spawn-failed") return "spawn-failed";
  // After a validated iteration, mark the task so the next pickTask
  // call rotates past it. Without this, a worker that validates but
  // does NOT open a PR (e.g. devin in --print mode pre-fix-2026-05-18,
  // or a brief that doesn't instruct `gh pr create`) keeps getting
  // the same task picked forever, blocking the walker from reaching
  // other hosts. `walker-drains-one-host-forever` fix (b).
  if (outcome.verdict === "validated") {
    validatedTaskIds.add(task.id);
  }
  return undefined;
}

/**
 * Pick the next task, OR fire a queue-empty seed audit and re-pick if
 * `seedOnEmpty` is enabled. One re-pick budget per iteration to bound
 * the retry loop (if the audit ran but added no eligible tasks, we
 * exit `empty-queue` next).
 *
 * `validatedTaskIds` is the loop's live skip-set. We snapshot it into a
 * fresh `ReadonlySet` before each call so the picker sees an immutable
 * point-in-time view; without the snapshot, a picker that stores the
 * argument (e.g. a test fake recording call history, or a future
 * stateful picker) would observe mutations from later iterations and
 * misattribute them to earlier calls. Source: rule #6 (pure data flow
 * at the boundary — pickers should not be coupled to internal loop
 * timing) and the test
 * `host-loop.test.ts › threads validated task IDs into the next pickTask
 * call as skipTaskIds`, which fails without the snapshot.
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function pickTaskOrSeed(
  opts: RunHostLoopOpts,
  validatedTaskIds: ReadonlySet<string>,
): Promise<ParsedTask | null> {
  const first = opts.pickTask({ skipTaskIds: new Set(validatedTaskIds) });
  if (first !== null) return first;
  if (!opts.seedOnEmpty || opts.ctoAudit === undefined || opts.buildCtoSignals === undefined) {
    return null;
  }
  const signals = opts.buildCtoSignals({
    reason: "queue-empty",
    completedTaskId: null,
    prUrl: null,
    filesChanged: [],
  });
  await opts.ctoAudit({ signals, completedVerdict: null });
  // Re-attempt pick once. If still null, the audit didn't help (no PR
  // merged yet, or audit produced no rule-#9-compliant blocks); the loop
  // exits empty-queue normally. Snapshot again — the audit may have run
  // long enough that the operator added another task in the meantime,
  // but the skip-set semantics shouldn't change between the two calls.
  return opts.pickTask({ skipTaskIds: new Set(validatedTaskIds) });
}

/**
 * Fire the post-iteration CTO audit when the verdict is `validated`. No-op
 * when the seam isn't wired or when the verdict isn't validated.
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function maybeFirePostIterationAudit(
  opts: RunHostLoopOpts,
  task: ParsedTask,
  outcome: LiveSpawnOutcome,
): Promise<void> {
  if (opts.ctoAudit === undefined || opts.buildCtoSignals === undefined) return;
  if (outcome.verdict !== "validated") return;
  const signals = opts.buildCtoSignals({
    reason: "post-iteration",
    completedTaskId: task.id,
    prUrl: outcome.prUrl,
    filesChanged: [],
  });
  await opts.ctoAudit({ signals, completedVerdict: outcome.verdict });
}

/**
 * Default sleep implementation: `setTimeout` resolved via Promise, with
 * abort-signal short-circuit so SIGTERM during the inter-iteration wait
 * exits the loop within one event-loop tick (not the full
 * `tickIntervalMs`).
 *
 * (Internal helper — no JSDoc tag required.)
 */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
