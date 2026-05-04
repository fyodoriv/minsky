/**
 * `@minsky/tick-loop/daemon` — production tick-loop daemon (v0, dry-run only).
 *
 * `runDaemon(opts)` is the I/O orchestrator that loops:
 *
 *     pickTask → checkBudget → claim → spawnTick (dry-run) → complete
 *
 * with `setTimeout(tickInterval)` between iterations. v0 ships ONLY the
 * dry-run path: the spawnTick step calls a {@link MockAnthropicClient} from
 * `@minsky/tick-loop`'s existing test fakes (PR #83). The real-spawn path
 * (`child_process.spawn('claude', ...)`) is deferred to a follow-up
 * (`tick-loop-daemon-real-spawn`); passing `dryRun: false` throws.
 *
 * Pattern conformance (rule #8 / vision.md § "Pattern conformance index"):
 *   - **Periodic-task scheduling** — Liu & Layland, *JACM* 1973. The
 *     `tickInterval` cadence + `maxIterations` cap is the periodic-task
 *     envelope. Conformance: full.
 *   - **MAPE-K monitor** — Kephart & Chess, *IEEE Computer* 2003. The
 *     daemon IS the running monitor that the MAPE pipeline assumes.
 *     Conformance: partial (v0 dry-run; full conformance once real-spawn
 *     lands).
 *   - **Let-it-crash supervision** — Armstrong, *Programming Erlang*, 2007.
 *     The daemon never catches mid-iteration; supervisor (systemd /
 *     launchd) `Restart=on-failure` is the respawn policy. Conformance:
 *     full.
 *   - **Adapter (seam)** — Gamma 1994. `MockAnthropicClient` is the
 *     spawn-step seam; `BudgetGuardLike` is the budget-check seam.
 *     Conformance: full.
 *
 * Architectural seams (rule #2):
 *   - The CLI (`bin/tick-loop.mjs`) is the I/O boundary that constructs
 *     the dependencies and invokes `runDaemon`.
 *   - `runDaemon` itself takes injected I/O — `tasksMdReader`, `pausedSentinelReader`,
 *     `budgetGuard`, `mockClient`, `now`, `sleep`, `emit` — so tests are
 *     deterministic and pure given a fixed environment.
 *
 * @module tick-loop/daemon
 */

import { type MockAnthropicClient, type TickSpan, tick } from "./index.js";
import type { SpawnStrategy } from "./spawn-strategy.js";

// ---- Types ----------------------------------------------------------------

/**
 * Minimum surface of `BudgetGuard.decide()` we depend on. Defined as a
 * structural type so tests can pass a stub without pulling in the whole
 * `@minsky/budget-guard` runtime (which needs `@minsky/token-monitor`).
 *
 * The real `BudgetDecision` from `@minsky/budget-guard` carries more
 * fields (`snapshot`, `consumed`, `decidedAt`); the daemon only branches
 * on `action`, so the structural type is the minimum coupling.
 */
export interface BudgetDecisionLike {
  readonly action: "normal" | "graceful-degrade" | "circuit-break-and-notify" | "weekly-cap-warn";
  readonly reason: string;
}

export interface BudgetGuardLike {
  decide(): Promise<BudgetDecisionLike> | BudgetDecisionLike;
}

export type DaemonIterationStatus =
  | "completed"
  | "failed"
  | "paused"
  | "no-task"
  | "budget-paused"
  | "missing-tasks-md";

export interface DaemonIterationResult {
  readonly iteration: number;
  readonly status: DaemonIterationStatus;
  readonly taskId?: string;
  readonly reason?: string;
}

export interface DaemonRunResult {
  readonly iterations: readonly DaemonIterationResult[];
  readonly totalIterations: number;
  readonly stoppedReason: "max-iterations" | "missing-tasks-md";
}

export interface RunDaemonOpts {
  /**
   * Milliseconds between iterations. Default 5 min in production (set by
   * the CLI). Tests pass small values (often 0) for determinism.
   */
  readonly tickInterval: number;
  /**
   * Cap on the number of iterations. Default `Infinity` for the
   * always-on daemon; tests pass small values.
   */
  readonly maxIterations: number;
  /**
   * Controls the v0 dry-run guard. When `true` (default production wiring
   * in v0 + sub-task 1/3) the dry-run path is taken via the dry-run
   * spawn-step `tick(...)` against the injected `mockClient`. When `false`,
   * dispatch is delegated to the injected `spawnStrategy` (if any); if the
   * Strategy is `DryRunSpawnStrategy`, behaviour is still synthetic — the
   * real flip lives in sub-task 3 (`tick-loop-daemon-real-spawn-flip`).
   *
   * Pre-existing `dryRun: false → throw` semantics are preserved when no
   * `spawnStrategy` is injected (the ProcessSpawnStrategy default would
   * shell out, which v0 must NOT do silently).
   */
  readonly dryRun: boolean;
  /** The mock client used by the dry-run spawn step. */
  readonly mockClient: MockAnthropicClient;
  /**
   * Optional spawn-step Strategy seam (rule #2, Gamma 1994). v0 does NOT
   * inject this — the daemon falls through to the original dry-run
   * `tick(...)` path. Sub-tasks 2/3 use this seam.
   */
  readonly spawnStrategy?: SpawnStrategy;
  /** I/O seam — reads TASKS.md content. May throw `ENOENT`. */
  readonly tasksMdReader: () => string;
  /** I/O seam — returns `true` when the `state/PAUSED` sentinel exists. */
  readonly pausedSentinelReader: () => boolean;
  /** I/O seam — the budget-guard adapter (or stub in tests). */
  readonly budgetGuard: BudgetGuardLike;
  /** Optional clock seam. Default `Date.now`. */
  readonly now?: () => number;
  /** Optional sleep seam. Default real `setTimeout`. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Optional span sink — one event per phase. */
  readonly emit?: (event: TickSpan) => void;
}

// ---- runDaemon ------------------------------------------------------------

/**
 * Run the daemon loop. v0 + sub-task 1/3 default to the dry-run path.
 *
 * Strategy dispatch (sub-task 1/3 of `tick-loop-daemon-real-spawn`):
 *   - When `spawnStrategy` is injected, the daemon delegates the per-tick
 *     spawn step to it (used by sub-tasks 2/3 + tests). The
 *     `DryRunSpawnStrategy` mirrors v0's existing synthetic behaviour
 *     exactly, so injecting it is observably equivalent to the v0 path.
 *   - When `spawnStrategy` is NOT injected, the legacy dispatch holds:
 *     `dryRun: true` runs the v0 `tick(...)` path against the injected
 *     `mockClient`; `dryRun: false` throws synchronously before any I/O
 *     (the v0 production guardrail). This is the "production default =
 *     dry-run" invariant the brief preserves.
 *
 * The loop body delegates to pure helpers (`pickTask`, `claim`,
 * `spawnTickDryRun`, `completeIteration`) so each step is independently
 * testable and `runDaemon` itself stays under the cognitive-complexity
 * cap (rule #6, biome ≤10).
 *
 * Never catches mid-iteration; the supervisor (systemd / launchd
 * `Restart=on-failure`) is the let-it-crash boundary (rule #6, Armstrong
 * 2007).
 *
 * @otel tick-loop.run-daemon
 */
export async function runDaemon(opts: RunDaemonOpts): Promise<DaemonRunResult> {
  if (!opts.dryRun && opts.spawnStrategy === undefined) {
    throw new Error(
      "tick-loop-daemon v0 supports only dry-run mode; real subprocess spawning is deferred to follow-up `tick-loop-daemon-real-spawn`",
    );
  }
  const sleep = opts.sleep ?? defaultSleep;
  const iterations: DaemonIterationResult[] = [];

  for (let i = 0; i < opts.maxIterations; i++) {
    const outcome = await runOneIteration({ opts, iteration: i });
    iterations.push(outcome.result);
    if (outcome.stop !== undefined) {
      return { iterations, totalIterations: iterations.length, stoppedReason: outcome.stop };
    }
    if (i < opts.maxIterations - 1) await sleep(opts.tickInterval);
  }
  return {
    iterations,
    totalIterations: iterations.length,
    stoppedReason: "max-iterations",
  };
}

/**
 * One iteration: PAUSED check → TASKS.md read → budget check → pick →
 * claim → dry-run spawn → complete. Extracted so `runDaemon` itself stays
 * under the cognitive-complexity cap (rule #6, biome ≤10).
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function runOneIteration(args: {
  readonly opts: RunDaemonOpts;
  readonly iteration: number;
}): Promise<{ readonly result: DaemonIterationResult; readonly stop?: "missing-tasks-md" }> {
  const { opts, iteration } = args;

  if (opts.pausedSentinelReader()) {
    const result: DaemonIterationResult = {
      iteration,
      status: "paused",
      reason: "state/PAUSED sentinel present",
    };
    emitIterationSpan(opts, result);
    return { result };
  }

  const taskSource = readTasksMd(opts);
  if (taskSource === undefined) {
    const result: DaemonIterationResult = {
      iteration,
      status: "missing-tasks-md",
      reason: "TASKS.md not found",
    };
    emitIterationSpan(opts, result);
    return { result, stop: "missing-tasks-md" };
  }

  const decision = await Promise.resolve(opts.budgetGuard.decide());
  if (decision.action === "circuit-break-and-notify") {
    const result: DaemonIterationResult = {
      iteration,
      status: "budget-paused",
      reason: `budget-guard circuit-break: ${decision.reason}`,
    };
    emitIterationSpan(opts, result);
    return { result };
  }

  const taskId = pickTask(taskSource);
  if (taskId === undefined) {
    const result: DaemonIterationResult = {
      iteration,
      status: "no-task",
      reason: "no unblocked unclaimed P0/P1 task",
    };
    emitIterationSpan(opts, result);
    return { result };
  }

  const result = await runClaimedIteration({ opts, iteration, taskId });
  emitIterationSpan(opts, result);
  return { result };
}

/**
 * Claim → spawn (dry-run) → complete for a known task. Extracted so
 * `runOneIteration` is dispatch-only and stays under the cognitive-complexity
 * cap (rule #6, biome ≤10).
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function runClaimedIteration(args: {
  readonly opts: RunDaemonOpts;
  readonly iteration: number;
  readonly taskId: string;
}): Promise<DaemonIterationResult> {
  const { opts, iteration, taskId } = args;
  // claim() is in-memory only in v0 (persistence in follow-up); we still
  // call it so the contract surface is exercised.
  claim({ taskId });
  // Strategy dispatch: when an explicit `spawnStrategy` is injected
  // (sub-task 2/3 use case + spawn-strategy tests), delegate to it. When
  // no Strategy is injected, fall through to v0's legacy `tick(...)` path
  // so the 13 dry-run tests keep their existing observable behaviour.
  if (opts.spawnStrategy !== undefined) {
    const stratResult = await opts.spawnStrategy.spawn({
      taskId,
      brief: `daemon brief for ${taskId}`,
      env: process.env,
    });
    return {
      iteration,
      status: stratResult.exitCode === 0 ? "completed" : "failed",
      taskId,
      reason: stratResult.exitCode === 0 ? stratResult.stdoutTail : stratResult.stderrTail,
    };
  }
  const tickResult = await spawnTickDryRun({ taskId, opts });
  return {
    iteration,
    status: tickResult.status === "completed" ? "completed" : "failed",
    taskId,
    reason: tickResult.output,
  };
}

// ---- Pure helpers ---------------------------------------------------------

/**
 * Read TASKS.md via the injected reader; return `undefined` on `ENOENT`
 * so the loop can exit gracefully (rule-6: handled-locally — file-not-found
 * is the documented graceful-exit path, not a crash).
 *
 * (Internal helper — no JSDoc tag required.)
 */
function readTasksMd(opts: RunDaemonOpts): string | undefined {
  try {
    return opts.tasksMdReader();
    // rule-6: handled-locally — file-not-found is the documented graceful-exit
    // path (rule #7 — graceful-degrade); other errors propagate up.
  } catch (err) {
    if (isEnoent(err)) return undefined;
    throw err;
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "ENOENT"
  );
}

/**
 * Pick the first unblocked, unclaimed P0/P1 task from a TASKS.md source.
 *
 * Heuristic (v0): scan top-down, find a `**ID**: <kebab-id>` line whose
 * preceding `- [ ] …` task heading does NOT contain `(@minsky-tick-loop)`,
 * whose subsequent `**Blocked by**:` line (if any) is absent (dependency
 * blocker), AND whose `**Blocked**:` line (if any) is absent (external-
 * constraint blocker — the safety surface for blocked-by-default actions
 * per the `/next-task` skill; see TASKS.md task
 * `tick-loop-picktask-honors-blocked-field`). The `**Blocked**` field
 * match is case-sensitive on the field name and triggers regardless of
 * the reason text — its mere presence means "do not pick autonomously".
 * Stops scanning at the `## P2` header so only P0/P1 tasks are considered.
 *
 * Pure function — no I/O.
 *
 * @otel tick-loop.pick-task
 */
export function pickTask(tasksMd: string): string | undefined {
  const sliced = sliceP0P1(tasksMd);
  const blocks = splitBlocks(sliced);
  for (const block of blocks) {
    const id = parseId(block);
    if (id === undefined) continue;
    if (block.includes("(@minsky-tick-loop)")) continue;
    if (/\*\*Blocked by\*\*:/i.test(block)) continue;
    // `**Blocked**:` (closing asterisks before the colon) is the external-
    // constraint blocker — distinct from `**Blocked by**:` above. Match is
    // case-sensitive on the field name. Any non-empty reason after the
    // colon disqualifies the task; an empty reason still disqualifies (the
    // field's presence is the signal).
    if (/\*\*Blocked\*\*:/.test(block)) continue;
    return id;
  }
  return undefined;
}

/**
 * Trim TASKS.md to the P0 + P1 sections only. The `## P2` heading marks
 * the boundary; everything below is dropped.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function sliceP0P1(tasksMd: string): string {
  const p2 = tasksMd.search(/\n##\s+P2\b/);
  return p2 < 0 ? tasksMd : tasksMd.slice(0, p2);
}

function splitBlocks(source: string): readonly string[] {
  return source.split(/\n(?=- \[[ x]\])/g);
}

function parseId(block: string): string | undefined {
  const m = block.match(/\*\*ID\*\*:\s*([a-z][a-z0-9-]*[a-z0-9])\b/);
  return m === null ? undefined : m[1];
}

/**
 * Append `(@minsky-tick-loop)` to the in-memory representation of the
 * task line. v0 is in-memory only — persistence (writing back to TASKS.md
 * with file locking) is deferred to the follow-up brief. Pure function.
 *
 * @otel tick-loop.claim
 */
export function claim(args: { readonly taskId: string }): {
  readonly taskId: string;
  readonly leasedBy: string;
} {
  return { taskId: args.taskId, leasedBy: "@minsky-tick-loop" };
}

/**
 * The dry-run spawn step: invoke the mock client through `tick(...)`
 * from `./index.ts`. In v0 this is the ONLY spawn path; real subprocess
 * spawning is deferred to `tick-loop-daemon-real-spawn`.
 *
 * @otel tick-loop.spawn-tick
 */
export async function spawnTickDryRun(args: {
  readonly taskId: string;
  readonly opts: RunDaemonOpts;
}): Promise<{ readonly status: "completed" | "failed"; readonly output: string }> {
  const tickOpts = buildTickOpts(args);
  const result = await tick(tickOpts);
  return { status: result.status, output: result.output };
}

/**
 * Build a `TickOpts` for one dry-run iteration. Threads optional fields
 * conditionally because `exactOptionalPropertyTypes: true` rejects
 * `{ key: undefined }`.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function buildTickOpts(args: { readonly taskId: string; readonly opts: RunDaemonOpts }): Parameters<
  typeof tick
>[0] {
  const base = {
    taskId: args.taskId,
    prompt: `daemon dry-run prompt for ${args.taskId}`,
    client: args.opts.mockClient,
  };
  const withNow = args.opts.now === undefined ? base : { ...base, now: args.opts.now };
  return args.opts.emit === undefined ? withNow : { ...withNow, emit: args.opts.emit };
}

/**
 * Emit the per-iteration parent span (`tick-loop.iteration`). The
 * underlying `tick(...)` call already emits its own `tick-loop.tick`
 * span; this adds one parent so consumers can group ticks by iteration.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function emitIterationSpan(opts: RunDaemonOpts, result: DaemonIterationResult): void {
  if (opts.emit === undefined) return;
  opts.emit({
    name: "tick-loop.iteration",
    attributes: {
      "iteration.index": result.iteration,
      "iteration.status": result.status,
      "task.id": result.taskId ?? "",
      "iteration.reason": result.reason ?? "",
    },
  });
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
