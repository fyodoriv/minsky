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

import {
  type ChangelogSpawn,
  type ReadChangelog,
  type RunChangelogOutcome,
  runChangelog,
} from "./changelog-runner.js";
import { type MockAnthropicClient, type TickSpan, tick } from "./index.js";
import {
  type CompletedIterationSignals,
  type CtoAuditLock,
  type CtoAuditSpawn,
  type RunCtoAuditOutcome,
  runCtoAudit,
} from "./post-task-cto-audit.js";
import {
  type RunSnapshotOutcome,
  type SnapshotCapture,
  type SnapshotExists,
  runSnapshot,
} from "./snapshot-runner.js";
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
  /**
   * Optional push-notification seam (rule #2). When injected, the daemon
   * fires exactly one `push` per *transition* into `budget-paused` —
   * debounced across consecutive paused iterations so the operator gets
   * one alert per event, not one per tick. Recovery (any non-`budget-paused`
   * status) re-arms the trigger; the next budget-paused transition fires
   * a fresh push. Pattern: edge-triggered notification per Beyer SRE 2016
   * Ch. 6 (silence is failure for state changes operators care about).
   * `null` (the default) disables the channel — the daemon still records
   * the budget-paused span, it just doesn't push anywhere.
   */
  readonly notifier?: NotifierLike;
  /**
   * Optional CTO-audit seam (rule #2). When injected, the daemon fires
   * `runCtoAudit` after every `completed` iteration; the audit's own
   * gate (`shouldRunCtoAudit`) filters no-op + budget-paused + the
   * audit's own iteration. When omitted, audits never run — pre-existing
   * supervisor daemons predating this seam keep working unchanged.
   */
  readonly ctoAudit?: CtoAuditSeam;
  /**
   * Optional daily-changelog seam (rule #2). When injected, the daemon
   * fires `runChangelog` once per iteration; the runner's own gate
   * (`shouldRunChangelog`) filters env-off + already-authored so that
   * only one spawn lands per UTC date. When omitted, the changelog never
   * runs — supervisor daemons predating this seam keep working unchanged.
   * Substrate for `daily-changelog-for-humans` acceptance (3) "I/O wrapper
   * fires daily".
   */
  readonly changelog?: ChangelogSeam;
  /**
   * Optional daily-snapshot seam (rule #2). When injected, the daemon
   * fires `runSnapshot` once per iteration; the runner's own gate
   * (`shouldRunSnapshot`) filters env-off + already-captured so that
   * only one capture lands per UTC date. When omitted, the snapshot
   * never runs — supervisor daemons predating this seam keep working
   * unchanged. Substrate for `daily-changelog-for-humans` Details (e):
   * `.minsky/metric-snapshots/<date>.json` is the per-day record day-N's
   * Δ rendering depends on (without it, day-(N+1)'s changelog has no
   * `prevMetricsSnapshot` to diff against). Independent of the
   * `changelog` seam — manual CHANGELOG.md authoring must NOT suppress
   * snapshot writes.
   */
  readonly snapshot?: SnapshotSeam;
}

/**
 * Structural subset of `@minsky/notifier`'s `Notifier` shape — the daemon
 * only calls `push`, so depending on the full interface would force
 * tests + the daemon to import the whole package. The `@minsky/notifier`
 * `Notifier` and `StubNotifier` both satisfy this shape (rule #2 — every
 * dep behind an interface; the structural subtype IS the seam).
 */
export interface NotifierLike {
  push(n: {
    title: string;
    body: string;
    tags?: readonly string[];
    priority?: "low" | "normal" | "high";
  }): Promise<{ ok: boolean }>;
}

/**
 * Optional CTO-audit seam (rule #2). When injected, the daemon fires a
 * post-task CTO audit after every iteration that completes a real change
 * (the gate inside `runCtoAudit` filters no-op + budget-paused + failed
 * + the audit's own iteration — see `shouldRunCtoAudit`). When omitted,
 * the daemon never invokes the audit; supervisor pre-existing daemons
 * predating this seam keep working unchanged.
 *
 * Three sub-seams:
 *   - `spawn` — the I/O surface the audit shells out to (production:
 *     `ProcessSpawnStrategy` re-used; tests: in-memory stub). Structurally
 *     compatible with `SpawnStrategy` so the daemon can hand its existing
 *     spawn strategy in without an adapter.
 *   - `lock` — the per-task idempotency record (production: file-backed at
 *     `.minsky/cto-audit-lock/<taskId>`; tests: in-memory `Set`).
 *   - `buildSignals` — collects `CompletedIterationSignals` from external
 *     state (git/gh) for the just-completed iteration. Async because real
 *     collectors call `git log` / `gh pr list`. The daemon ONLY invokes
 *     this when `result.status === "completed"`, so the I/O is bounded.
 */
export interface CtoAuditSeam {
  readonly spawn: CtoAuditSpawn;
  readonly lock: CtoAuditLock;
  readonly buildSignals: (args: {
    readonly taskId: string;
    readonly spawnStdoutTail: string;
  }) => Promise<CompletedIterationSignals>;
}

/**
 * Optional daily-changelog seam (rule #2). When injected, the daemon
 * dispatches into `runChangelog` once per iteration. Two sub-seams:
 *   - `spawn` — the I/O surface for `claude --print` in changelog-mode.
 *     Structurally compatible with `SpawnStrategy` so the daemon can
 *     hand its existing spawn strategy in without an adapter.
 *   - `readChangelog` — reads CHANGELOG.md so the gate
 *     (`hasDateSection`) can decide whether today is already authored.
 *     Returning `""` for missing-file is intentional — a fresh checkout
 *     pre-genesis still fires (the runner authors the genesis entry).
 *
 * Idempotency comes from CHANGELOG.md content itself, not a per-day
 * lock dir (rule #2 — one source of truth; the section header IS the
 * "this happened" record).
 */
export interface ChangelogSeam {
  readonly spawn: ChangelogSpawn;
  readonly readChangelog: ReadChangelog;
}

/**
 * Optional daily-snapshot seam (rule #2). When injected, the daemon
 * dispatches into `runSnapshot` once per iteration. Two sub-seams:
 *   - `capture` — writes today's snapshot to disk. Production binding
 *     spawns `pnpm changelog:snapshot --date <date>` via the daemon's
 *     existing `SpawnStrategy`; tests inject a stub.
 *   - `snapshotExists` — checks whether `<rootDir>/.minsky/metric-snapshots/
 *     <date>.json` already exists, so the gate can short-circuit on days
 *     the operator (or a prior daemon iteration) already captured.
 *
 * Independent of the `changelog` seam: manual CHANGELOG.md authoring must
 * NOT suppress snapshot capture (otherwise day-(N+1)'s Δ rendering loses
 * its baseline). Same calendar, separate gates — see `snapshot-runner.ts`.
 *
 * Idempotency comes from the snapshot file itself, not a separate lock
 * dir (rule #2 — the file IS the "this happened" record).
 */
export interface SnapshotSeam {
  readonly capture: SnapshotCapture;
  readonly snapshotExists: SnapshotExists;
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
  // Edge-triggered debounce for budget-paused pushes — see `notifyOnPauseTransition`.
  const pauseState = { inBudgetPause: false };

  for (let i = 0; i < opts.maxIterations; i++) {
    const outcome = await runOneIteration({ opts, iteration: i });
    iterations.push(outcome.result);
    notifyOnPauseTransition(opts, outcome.result, pauseState);
    await maybeRunCtoAudit(opts, outcome.result);
    await maybeRunChangelog(opts, outcome.result);
    await maybeRunSnapshot(opts, outcome.result);
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
 * Edge-triggered debounce for `budget-paused` pushes. Stays `false` while
 * we're outside budget-paused state; flips to `true` on entry; resets on
 * ANY non-budget-paused status (recovery OR transition to a different
 * failure mode like supervisor-pause). One push per entry, full stop.
 *
 * Extracted from `runDaemon` to keep the orchestrator under the
 * cognitive-complexity cap (rule #6, biome ≤10). Mutates `state.inBudgetPause`
 * in place as the loop's only side effect on the closed-over scope.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function notifyOnPauseTransition(
  opts: RunDaemonOpts,
  result: DaemonIterationResult,
  state: { inBudgetPause: boolean },
): void {
  if (result.status !== "budget-paused") {
    state.inBudgetPause = false;
    return;
  }
  if (state.inBudgetPause || opts.notifier === undefined) {
    state.inBudgetPause = true;
    return;
  }
  // Fire-and-forget; rule #7 graceful-degrade — a missed push must never
  // crash the daemon, and the notifier itself promises not to throw on
  // transport errors.
  void opts.notifier.push({
    title: "Minsky paused — budget exhausted",
    body: result.reason ?? "budget-guard circuit-break",
    tags: ["pause", "budget"],
    priority: "high",
  });
  state.inBudgetPause = true;
}

/**
 * Wire-in for the post-task CTO audit (rule #2 — the daemon orchestrates,
 * `runCtoAudit` decides + spawns). Skip-fast when:
 *   - the seam isn't injected (production daemons predating this seam),
 *   - the iteration didn't `complete` (the gate inside `runCtoAudit` would
 *     also skip, but checking here avoids a spurious `buildSignals` call
 *     with its git/gh I/O),
 *   - the iteration has no `taskId` (no-task / paused / missing-tasks-md).
 *
 * Otherwise build signals (`spawnStdoutTail` is the spawn's tail captured
 * in `result.reason` for the completed-via-strategy path) and invoke
 * `runCtoAudit`. Outcome is emitted as a `tick-loop.cto-audit` span so the
 * dashboard can chart audit firing-rate + skip-reason distribution.
 *
 * The audit's spawn is fire-and-await within the iteration: a long audit
 * delays the next tick, but rule #9's pivot threshold (>5 audits/day or
 * 0/week sustained) is the operator-side back-pressure, not a circuit
 * inside the daemon. Audit failures (non-zero exitCode) surface in the
 * span attributes; the daemon does NOT retry — the operator review surface
 * (the audit's PR) is the success boundary, not the spawn's exitCode.
 *
 * Extracted so `runDaemon` stays dispatch-only (rule #6, biome ≤10).
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function maybeRunCtoAudit(opts: RunDaemonOpts, result: DaemonIterationResult): Promise<void> {
  if (opts.ctoAudit === undefined) return;
  if (result.status !== "completed") return;
  if (result.taskId === undefined) return;

  const signals = await opts.ctoAudit.buildSignals({
    taskId: result.taskId,
    spawnStdoutTail: result.reason ?? "",
  });
  const outcome = await runCtoAudit({
    signals,
    status: result.status,
    env: process.env,
    spawn: opts.ctoAudit.spawn,
    lock: opts.ctoAudit.lock,
  });
  emitCtoAuditSpan(opts, result.taskId, outcome);
}

/**
 * Emit a `tick-loop.cto-audit` span describing the audit's outcome. One
 * span per audit invocation (skipped or ran), so the dashboard can chart
 * firing-rate + skip-reason distribution + exit-code distribution.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function emitCtoAuditSpan(opts: RunDaemonOpts, taskId: string, outcome: RunCtoAuditOutcome): void {
  if (opts.emit === undefined) return;
  const base: Record<string, string | number | boolean> = {
    "task.id": taskId,
    "audit.outcome": outcome.outcome,
  };
  if (outcome.outcome === "skipped") {
    base["audit.skip_reason"] = outcome.reason;
  } else {
    base["audit.exit_code"] = outcome.exitCode;
    base["audit.duration_ms"] = outcome.durationMs;
  }
  opts.emit({ name: "tick-loop.cto-audit", attributes: base });
}

/**
 * Wire-in for the daily changelog runner (rule #2 — the daemon orchestrates,
 * `runChangelog` decides + spawns). Skip-fast when:
 *   - the seam isn't injected (production daemons predating this seam),
 *   - the iteration is operator-quiet (`paused` sentinel — operator told
 *     us to be silent),
 *   - the iteration is `budget-paused` (we're inside the 5h cap; firing
 *     a daily spawn here would consume the budget the cap is protecting),
 *   - the iteration is `missing-tasks-md` (the daemon stops anyway).
 *
 * Otherwise derive the UTC date from the clock seam (or `Date.now()`)
 * and invoke `runChangelog`. The gate inside `runChangelog`
 * (`shouldRunChangelog`) is the per-day debounce: env-off short-circuits
 * before the file read, and `hasDateSection` filters days that are
 * already authored. So the daemon can call this every iteration and
 * still land exactly one spawn per UTC date.
 *
 * Failed iterations DO fire the changelog: the per-day cadence is
 * "every day with merged PRs has a corresponding section within 24h"
 * (Acceptance pre-registration), not "every day with a successful
 * daemon iteration" — PRs may merge from human work even when the
 * daemon's own iteration failed.
 *
 * Outcome is emitted as a `tick-loop.changelog` span so the dashboard
 * can chart firing-rate + skip-reason distribution.
 *
 * Extracted so `runDaemon` stays dispatch-only (rule #6, biome ≤10).
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function maybeRunChangelog(
  opts: RunDaemonOpts,
  result: DaemonIterationResult,
): Promise<void> {
  if (opts.changelog === undefined) return;
  if (result.status === "paused") return;
  if (result.status === "budget-paused") return;
  if (result.status === "missing-tasks-md") return;

  const ms = opts.now === undefined ? Date.now() : opts.now();
  const date = new Date(ms).toISOString().slice(0, 10);
  const outcome = await runChangelog({
    date,
    env: process.env,
    readChangelog: opts.changelog.readChangelog,
    spawn: opts.changelog.spawn,
  });
  emitChangelogSpan(opts, date, outcome);
}

/**
 * Emit a `tick-loop.changelog` span describing the runner's outcome. One
 * span per invocation (skipped or ran), so the dashboard can chart
 * firing-rate, skip-reason distribution, and exit-code distribution.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function emitChangelogSpan(opts: RunDaemonOpts, date: string, outcome: RunChangelogOutcome): void {
  if (opts.emit === undefined) return;
  const base: Record<string, string | number | boolean> = {
    "changelog.date": date,
    "changelog.outcome": outcome.outcome,
  };
  if (outcome.outcome === "skipped") {
    base["changelog.skip_reason"] = outcome.reason;
  } else {
    base["changelog.exit_code"] = outcome.exitCode;
    base["changelog.duration_ms"] = outcome.durationMs;
  }
  opts.emit({ name: "tick-loop.changelog", attributes: base });
}

/**
 * Wire-in for the daily snapshot runner (rule #2 — the daemon orchestrates,
 * `runSnapshot` decides + writes). Skip-fast on the same operator-quiet
 * iteration shapes as `maybeRunChangelog`:
 *   - the seam isn't injected (production daemons predating this seam),
 *   - `paused` (operator told us to be silent),
 *   - `budget-paused` (we're inside the 5h cap; `pnpm changelog:snapshot`
 *     is two `gh` calls + a JSON write, but the cap is the cap),
 *   - `missing-tasks-md` (the daemon stops anyway).
 *
 * Otherwise derive the UTC date and invoke `runSnapshot`. The gate inside
 * `runSnapshot` (`shouldRunSnapshot`) is the per-day debounce: env-off
 * short-circuits before the existence probe, and the existence probe
 * filters days already captured. So the daemon may safely call this every
 * iteration and still land exactly one capture per UTC date.
 *
 * Failed iterations DO fire snapshot capture. The snapshot is the
 * baseline day-(N+1)'s Δ rendering depends on; "every day with merged
 * PRs has a corresponding section within 24h" requires the substrate
 * (snapshots) to be captured even when the daemon's iteration failed.
 *
 * Outcome is emitted as a `tick-loop.snapshot` span so the dashboard can
 * chart firing-rate + skip-reason distribution.
 *
 * Extracted so `runDaemon` stays dispatch-only (rule #6, biome ≤10).
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function maybeRunSnapshot(opts: RunDaemonOpts, result: DaemonIterationResult): Promise<void> {
  if (opts.snapshot === undefined) return;
  if (result.status === "paused") return;
  if (result.status === "budget-paused") return;
  if (result.status === "missing-tasks-md") return;

  const ms = opts.now === undefined ? Date.now() : opts.now();
  const date = new Date(ms).toISOString().slice(0, 10);
  const outcome = await runSnapshot({
    date,
    env: process.env,
    snapshotExists: opts.snapshot.snapshotExists,
    capture: opts.snapshot.capture,
  });
  emitSnapshotSpan(opts, date, outcome);
}

/**
 * Emit a `tick-loop.snapshot` span describing the runner's outcome. One
 * span per invocation (skipped or ran), so the dashboard can chart
 * firing-rate, skip-reason distribution, and exit-code distribution.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function emitSnapshotSpan(opts: RunDaemonOpts, date: string, outcome: RunSnapshotOutcome): void {
  if (opts.emit === undefined) return;
  const base: Record<string, string | number | boolean> = {
    "snapshot.date": date,
    "snapshot.outcome": outcome.outcome,
  };
  if (outcome.outcome === "skipped") {
    base["snapshot.skip_reason"] = outcome.reason;
  } else {
    base["snapshot.exit_code"] = outcome.exitCode;
    base["snapshot.duration_ms"] = outcome.durationMs;
  }
  opts.emit({ name: "tick-loop.snapshot", attributes: base });
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

  const result = await runClaimedIteration({ opts, iteration, taskId, tasksMdContent: taskSource });
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
  readonly tasksMdContent: string;
}): Promise<DaemonIterationResult> {
  const { opts, iteration, taskId, tasksMdContent } = args;
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
      brief: buildDaemonBrief({ taskId, tasksMdContent }),
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
 * Build the brief the spawn strategy hands to claude --print. Loads the
 * picked task's block + an anti-noop directive — observation 2026-05-05:
 * the placeholder brief `"daemon brief for ${taskId}"` led claude to
 * default to "refresh the brief in TASKS.md" (1-line additions, no code,
 * 87+ iterations of churn on cross-repo-ci-action). The directive
 * forbids brief-refresh-only PRs and steers toward shipping the smallest
 * meaningful code change.
 *
 * @otel-exempt pure builder of the spawn-strategy input.
 */
export function buildDaemonBrief(args: {
  readonly taskId: string;
  readonly tasksMdContent: string;
}): string {
  const block = extractTaskBlock(args.tasksMdContent, args.taskId);
  return [
    `# Daemon iteration brief for \`${args.taskId}\``,
    "",
    "## Task block (current TASKS.md)",
    "",
    block ??
      "(task block not found in TASKS.md — task may have been closed; if so, exit without writing files)",
    "",
    "## Iteration directive",
    "",
    "Ship the smallest meaningful next iteration of this task. Open a PR with code changes that move the task toward its Acceptance criteria.",
    "",
    "**FORBIDDEN — anti-noop guard:**",
    "- DO NOT open a PR whose only change is appending to the task block in TASKS.md (so-called 'brief refresh'). That is the noop pattern observed on iterations 87-93 of cross-repo-ci-action before the operator intervened. If you cannot ship a code change this iteration (the task is blocked, the substrate already exists, or the next step is a separate human-approval action), output `noop, exiting` to stdout and do NOT open a PR.",
    "- DO NOT add new task blocks to TASKS.md unless the task you are executing explicitly directs you to.",
    "",
    "If the task's substrate already exists on main and what's left is a wire-in / config flip / one-line change, that IS a meaningful code change — ship it. Don't refresh briefs about it.",
    "",
  ].join("\n");
}

/**
 * Extract a single task block from TASKS.md by ID. The block runs from
 * the `- [ ] ` heading to (a) the next `- [ ] ` heading, (b) the next
 * `## ` section heading, or (c) end-of-file. Returns `undefined` when
 * the ID isn't found.
 *
 * @otel-exempt pure helper of `buildDaemonBrief`.
 */
export function extractTaskBlock(tasksMd: string, taskId: string): string | undefined {
  const headingPattern = new RegExp(
    `^- \\[ \\] \`${taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\``,
    "m",
  );
  const start = tasksMd.search(headingPattern);
  if (start < 0) return undefined;
  const after = tasksMd.slice(start);
  const endMatch = after.match(/\n(?:- \[ \] |## )/);
  return endMatch === null ? after.trim() : after.slice(0, endMatch.index ?? after.length).trim();
}

/**
 * Pick the first unblocked, unclaimed P0/P1 task from a TASKS.md source.
 * v0 heuristic: scan top-down, skip claimed (`(@minsky-tick-loop)`),
 * skip `**Blocked by**:` (dependency blocker) AND `**Blocked**:`
 * (external-constraint blocker — the `/next-task` safety surface). Stops
 * at `## P2` so only P0/P1 are considered. Pure function.
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
