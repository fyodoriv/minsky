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
 */
export type LoopStopReason =
  | "max-iterations"
  | "empty-queue"
  | "aborted"
  | "scope-leak"
  | "spawn-failed";

/**
 * One iteration's contribution to the loop result. Mirrors the daemon's
 * `DaemonIterationResult` shape but scoped to the cross-repo verdicts.
 */
export interface LoopIterationResult {
  readonly iteration: number;
  readonly taskId: string;
  readonly verdict: LiveSpawnOutcome["verdict"];
  readonly durationMs: number;
  readonly scopeLeakPaths: readonly string[];
  readonly prUrl: string | null;
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
export interface RunHostLoopOpts {
  /**
   * Per-iteration task selection. Production wires
   * `() => pickHostTask(readFileSync(hostTasksMdPath, "utf8"))`; tests
   * inject a queue-walker fake that returns successive tasks.
   */
  readonly pickTask: () => ParsedTask | null;
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
   * How many CONSECUTIVE `spawn-failed` iterations the loop tolerates
   * before exiting with stop reason `spawn-failed`. Default 1 (current
   * behavior — halt on first failure). Production reads `MINSKY_SPAWN_FAILED_BUDGET`
   * at the CLI boundary; tests pass a literal.
   *
   * Rationale: a single failure on Claude-binary-not-found or net-blip
   * shouldn't burn a watchdog respawn — the supervisor already restarts
   * the daemon, so a 1-failure exit gives the watchdog a fresh process
   * that may fail the same way again. A small budget (e.g. 3) lets the
   * loop skip the broken task and continue; a long streak still halts so
   * we don't burn Claude budget on a systemic failure.
   *
   * Consecutive — a successful or scope-leak iteration resets the count.
   */
  readonly spawnFailedBudget?: number;
}

/**
 * Read the operator-tunable spawn-failed budget from the environment.
 * Returns `undefined` when the env is unset / blank / non-numeric so the
 * caller falls through to the in-code default. Exported so the CLI can
 * resolve the budget at the I/O boundary; the loop itself stays pure.
 *
 * @otel-exempt pure env-reader.
 */
export function readSpawnFailedBudgetFromEnv(): number | undefined {
  const raw = process.env["MINSKY_SPAWN_FAILED_BUDGET"];
  if (raw === undefined || raw.length === 0) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1) return undefined;
  return parsed;
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
  const config = resolveLoopConfig(opts);
  const iterations: LoopIterationResult[] = [];
  const spawnFailState: SpawnFailState = { consecutive: 0 };

  for (let i = 0; i < config.maxIterations; i++) {
    const stop = await runIterationCycle({ opts, config, i, iterations, spawnFailState });
    if (stop !== null) return { iterations, stopReason: stop };
  }
  return { iterations, stopReason: "max-iterations" };
}

interface ResolvedLoopConfig {
  readonly maxIterations: number;
  readonly tickIntervalMs: number;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly spawnFailedBudget: number;
}

/**
 * Resolve operator-tunable knobs from {@link RunHostLoopOpts} into a
 * config bundle with concrete defaults. Pulled out of {@link runHostLoop}
 * so the loop body stays under the cognitive-complexity cap.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function resolveLoopConfig(opts: RunHostLoopOpts): ResolvedLoopConfig {
  return {
    maxIterations: opts.maxIterations ?? Number.POSITIVE_INFINITY,
    tickIntervalMs: opts.tickIntervalMs ?? 300_000,
    sleep: opts.sleep ?? defaultSleep,
    // Budget resolution order: opts (test seam) → env (operator) → 1 (default).
    // 1 = current behavior: halt on first spawn-failed (rule #6 let-it-crash).
    spawnFailedBudget: opts.spawnFailedBudget ?? readSpawnFailedBudgetFromEnv() ?? 1,
  };
}

/**
 * One full cycle of the host loop: abort-check → run iteration →
 * disposition → optional sleep. Returns the stop reason when the cycle
 * halts the loop, `null` when the loop should continue. Pulled out of
 * {@link runHostLoop} so the loop body stays under the cognitive-
 * complexity cap.
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function runIterationCycle(args: {
  readonly opts: RunHostLoopOpts;
  readonly config: ResolvedLoopConfig;
  readonly i: number;
  readonly iterations: LoopIterationResult[];
  readonly spawnFailState: SpawnFailState;
}): Promise<LoopStopReason | null> {
  const { opts, config, i, iterations, spawnFailState } = args;
  const earlyStop = checkAbort(opts.signal);
  if (earlyStop !== undefined) return earlyStop;
  const stop = await runOneIteration({ opts, iteration: i, iterations });
  const disposition = handleIterationStop({
    stop,
    spawnFailState,
    spawnFailedBudget: config.spawnFailedBudget,
  });
  if (disposition.kind === "halt") return disposition.stopReason;
  if (disposition.kind === "skip-sleep") return null; // budget remains; retry immediately
  return (
    (await sleepBetween({
      iteration: i,
      maxIterations: config.maxIterations,
      tickIntervalMs: config.tickIntervalMs,
      sleep: config.sleep,
      signal: opts.signal,
    })) ?? null
  );
}

interface SpawnFailState {
  consecutive: number;
}

type IterationDisposition =
  | { readonly kind: "halt"; readonly stopReason: LoopStopReason }
  | { readonly kind: "skip-sleep" }
  | { readonly kind: "continue" };

/**
 * Per-iteration stop disposition: halt with a stop reason, skip the
 * inter-iteration sleep (budget-remains retry), or continue normally.
 * Extracted so {@link runHostLoop} stays under the cognitive-complexity cap.
 *
 * Mutates `state.consecutive` — increments on spawn-failed, resets on any
 * other completed iteration.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function handleIterationStop(args: {
  readonly stop: LoopStopReason | undefined;
  readonly spawnFailState: SpawnFailState;
  readonly spawnFailedBudget: number;
}): IterationDisposition {
  const { stop, spawnFailState, spawnFailedBudget } = args;
  if (stop === "spawn-failed") {
    spawnFailState.consecutive += 1;
    if (spawnFailState.consecutive >= spawnFailedBudget) {
      return { kind: "halt", stopReason: "spawn-failed" };
    }
    return { kind: "skip-sleep" };
  }
  if (stop !== undefined) return { kind: "halt", stopReason: stop };
  // Non-spawn-failed completion resets the streak — the next failure gets
  // the full budget again.
  spawnFailState.consecutive = 0;
  return { kind: "continue" };
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
}): Promise<LoopStopReason | undefined> {
  const { opts, iteration, iterations } = args;
  const task = await pickTaskOrSeed(opts);
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
  };
  iterations.push(iterationResult);
  opts.recordIteration?.(iterationResult);
  await maybeFirePostIterationAudit(opts, task, outcome);
  if (outcome.verdict === "scope-leak") return "scope-leak";
  if (outcome.verdict === "spawn-failed") return "spawn-failed";
  return undefined;
}

/**
 * Pick the next task, OR fire a queue-empty seed audit and re-pick if
 * `seedOnEmpty` is enabled. One re-pick budget per iteration to bound
 * the retry loop (if the audit ran but added no eligible tasks, we
 * exit `empty-queue` next).
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function pickTaskOrSeed(opts: RunHostLoopOpts): Promise<ParsedTask | null> {
  const first = opts.pickTask();
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
  // exits empty-queue normally.
  return opts.pickTask();
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
