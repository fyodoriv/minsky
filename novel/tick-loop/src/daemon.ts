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
import {
  type ApplyRemoval,
  type GetTasksMd,
  type ListMergedPrs,
  type RunTaskRotationOutcome,
  runTaskRotation,
} from "./daemon-task-rotation.js";
import { type MockAnthropicClient, type TickSpan, tick } from "./index.js";
import {
  type GetLastRenderedDate,
  type MetricsRender,
  type RunMetricsRenderOutcome,
  runMetricsRender,
} from "./metrics-render-runner.js";
import {
  type CompletedIterationSignals,
  type CtoAuditLock,
  type CtoAuditSpawn,
  type RunCtoAuditOutcome,
  runCtoAudit,
} from "./post-task-cto-audit.js";
import {
  type PrePrLintGateResult,
  type PrePrLintRun,
  runPrePrLintGate,
} from "./pre-pr-lint-gate.js";
import {
  type RunSnapshotOutcome,
  type SnapshotCapture,
  type SnapshotExists,
  runSnapshot,
} from "./snapshot-runner.js";
import type { SpawnStrategy } from "./spawn-strategy.js";
import {
  type TouchesPrSnapshot,
  decideTouchesCollision,
  parseTouchesOrFiles,
} from "./touches-glob.js";
import { acquireTaskClaim } from "./worker-claim.js";
import { type WorkerConfig, claudeArgsForWorker } from "./worker-config.js";

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
  /**
   * Optional LLM provider tag — set by the slice-3 wiring of
   * `local-llm-fallback-on-budget-pause` when `LlmProviderSpawnStrategy`
   * is the injected `spawnStrategy`. Carries the provider chosen for
   * this iteration: `"claude"`, `"local"`, or `"hold"`. Surfaces in the
   * `tick-loop.iteration` span as `iteration.provider` so the
   * pre-registered measurement query can count provider usage.
   */
  readonly provider?: "claude" | "local" | "hold";
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
  /**
   * Optional daily metrics-render seam (rule #2). When injected, the daemon
   * fires `runMetricsRender` once per iteration; the runner's own gate
   * (`shouldRunMetricsRender`) filters env-off + already-rendered so that
   * only one spawn lands per UTC date. When omitted, the metrics render
   * never runs — supervisor daemons predating this seam keep working
   * unchanged. Substrate for `canonical-metric-list-per-repo` Acceptance
   * (3) "daemon refreshes daily". Independent of the `snapshot` seam: a
   * snapshot-capture failure (gh rate-limit, network) must NOT suppress
   * today's render — yesterday's snapshot still produces a usable
   * `METRICS.md` (visible-not-silent, Helland 2007).
   */
  readonly metricsRender?: MetricsRenderSeam;
  /**
   * Optional task-rotation seam (rule #2). When injected, the daemon fires
   * `runTaskRotation` once per iteration for the iteration's `taskId`; the
   * wrapper's own cheapest-gate-first skip order (env-off → no-task-id →
   * block-absent, the last short-circuiting BEFORE the `gh pr list`
   * round-trip) means an injected seam costs one TASKS.md read on the
   * common steady-state iteration and nothing more. When omitted, no
   * rotation runs — supervisor daemons predating this seam keep working
   * unchanged. Substrate for `daemon-task-rotation-on-completion`
   * Details (b): the daemon auto-removes a shipped task's block so N
   * workers stop re-picking it (the 9h 2026-05-07 dogfood failure mode —
   * worker-1 re-created #309 as #343). Conservative by construction: the
   * pure `decideTaskCompletion` only returns `remove` when a merged PR
   * names the task ID AND every `**Acceptance**:` checkbox parses ✅, so
   * an injected seam cannot mis-fire on an in-flight task.
   */
  readonly taskRotation?: TaskRotationSeam;
  /**
   * Optional outer lint-gate verification seam (rule #2). When injected, the
   * daemon runs one post-iteration lint check after every `completed` iteration
   * to verify the branch is lint-clean. Failure emits a
   * `tick-loop.pre-pr-lint-gate` span so the dashboard can track
   * pass-rate — the pre-registered metric for `daemon-pre-pr-lint-gate`
   * (rolling 30d ≥80%, measured by `pnpm daemon-pr-lint:metrics`).
   *
   * One attempt only (`maxAttempts: 1`): the inner Claude already ran up to 3
   * retries per the brief mandate; the outer check is a verification layer,
   * not a second retry loop. When omitted, no post-iteration lint check runs —
   * pre-existing daemons predating this seam keep working unchanged.
   *
   * Production binding: `createPnpmPrePrLintRun({ stage: "fast" })` from
   * `@minsky/tick-loop/pre-pr-lint-gate` — same script `pnpm pre-pr-lint`
   * invokes (rule #10 — single source of truth: `scripts/run-pre-pr-lint-stack.mjs`).
   */
  readonly preLintRun?: PrePrLintRun;
  /**
   * Optional per-worker config (slice 2 of `daemon-parallel-worktree-launch`).
   * When set:
   *   - the iteration acquires a per-task claim under `locksDir` before
   *     spawning; collisions surface as `no-task` with reason
   *     `claim-collision: held by ${heldBy}`,
   *   - the spawn-strategy receives `extraArgs: ["--worktree", "daemon-N-<taskId>"]`
   *     so the child runs in its own git worktree (per-process isolation).
   *
   * `undefined` (the default) preserves v0 single-process behaviour — the
   * daemon runs against the shared main checkout, no claim layer.
   */
  readonly workerConfig?: WorkerConfig;
  /**
   * Locks directory for per-task `acquireTaskClaim`. Default `.minsky/locks`
   * resolved against `MINSKY_HOME`. Only consulted when `workerConfig` is
   * set; ignored in single-process mode.
   */
  readonly locksDir?: string;
  /**
   * Claim TTL in milliseconds. Default 30 min — long enough to cover a
   * full iteration including post-spawn lints + PR creation, short enough
   * that a crashed worker's claim is recoverable within one tick of the
   * sweeper. Only consulted when `workerConfig` is set.
   */
  readonly claimTtlMs?: number;
  /**
   * Slice 4 of `daemon-parallel-worktree-launch`. When set + `workerConfig`
   * is set, the daemon fetches the open-PR snapshot once per iteration and
   * runs `decideTouchesCollision` against each candidate task BEFORE the
   * `acquireTaskClaim` attempt. Tasks whose `**Touches**:` (or fallback
   * `**Files**:`) overlap any open PR's changed files are skipped with a
   * `collision-prevented:` reason. The check is opt-in (caller wires the
   * fetcher); `undefined` preserves slice-1/2 claim-only behaviour.
   *
   * The fetcher is awaited at most once per iteration (the snapshot is
   * shared across all candidate-task collision checks). Callers should
   * filter to daemon-authored open PRs (e.g.
   * `gh pr list --author "@me" --state open --json number,files`).
   *
   * Failures inside the fetcher (network, gh auth, parse errors) bubble up
   * to `runDaemon` and surface as a failed iteration — rule #6 let-it-crash.
   */
  readonly openPrFetcher?: () => Promise<readonly TouchesPrSnapshot[]>;
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

/**
 * Optional daily metrics-render seam (rule #2). When injected, the daemon
 * dispatches into `runMetricsRender` once per iteration. Two sub-seams:
 *   - `render` — writes today's `METRICS.md`. Production binding spawns
 *     `pnpm metrics:render --date <date>` via the daemon's existing
 *     `SpawnStrategy`; tests inject a stub.
 *   - `getLastRenderedDate` — returns the UTC-date string of the last
 *     `METRICS.md` render (mtime-formatted in production), or `null` when
 *     `METRICS.md` does not yet exist (genesis case — flows through to
 *     render so the file is authored on the first daemon iteration of a
 *     fresh checkout).
 *
 * Independent of the `snapshot` seam: a snapshot-capture failure must NOT
 * suppress today's render — yesterday's snapshot still produces a usable
 * `METRICS.md` (visible-not-silent). Same calendar, separate gates — see
 * `metrics-render-runner.ts`.
 *
 * Idempotency comes from the file mtime itself, not a separate lock dir
 * (rule #2 — the file IS the "this happened" record). `pnpm metrics:render`
 * is byte-deterministic for a given snapshot, so a double-fire would write
 * identical bytes; the gate exists to keep span noise + write churn down,
 * not for correctness.
 */
export interface MetricsRenderSeam {
  readonly render: MetricsRender;
  readonly getLastRenderedDate: GetLastRenderedDate;
}

/**
 * Optional task-rotation seam (rule #2). When injected, the daemon
 * dispatches into `runTaskRotation` once per iteration. Three sub-seams,
 * passed straight through to the I/O wrapper (slice b/c,
 * `daemon-task-rotation.ts`):
 *   - `getTasksMd` — reads the current TASKS.md content. Production
 *     binding does an `fs.readFile`; tests inject a string.
 *   - `listMergedPrs` — lists recent merged PRs (production wraps
 *     `gh pr list --state merged --json number,title`; tests inject an
 *     array). Only consulted when the task block is still present —
 *     `runTaskRotation`'s `block-absent` short-circuit fires first, so
 *     the steady state (block already rotated out) never pays the `gh`
 *     round-trip (round-trip elimination, see the wrapper module doc).
 *   - `applyRemoval` — persists the block-stripped TASKS.md and commits
 *     it. Production does `fs.writeFile` + `git commit --only TASKS.md`;
 *     tests record the call. The commit message is supplied
 *     pre-formatted by the wrapper (`rotationCommitMessage`) so the git
 *     log names the criteria-checker decision (rule #9 visible-not-
 *     silent, Helland 2007 — the Hypothesis's "removal commit message
 *     names the criteria-checker decision").
 *
 * The conservatism lives entirely in the pure `decideTaskCompletion`
 * (slice a, PR #350): `remove` requires a merged PR naming the task ID
 * AND every `**Acceptance**:` checkbox parsing ✅ (or an explicit
 * `**Status**: shipped`). This seam only supplies I/O — it cannot widen
 * the removal criteria.
 */
export interface TaskRotationSeam {
  readonly getTasksMd: GetTasksMd;
  readonly listMergedPrs: ListMergedPrs;
  readonly applyRemoval: ApplyRemoval;
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
    await maybeRunMetricsRender(opts, outcome.result);
    await maybeRunTaskRotation(opts, outcome.result);
    await maybeRunPrePrLintGate(opts, outcome.result);
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
 * Wire-in for the daily metrics-render runner (rule #2 — the daemon
 * orchestrates, `runMetricsRender` decides + spawns). Skip-fast on the
 * same operator-quiet iteration shapes as `maybeRunSnapshot`:
 *   - the seam isn't injected (daemons predating this seam),
 *   - `paused` (operator told us to be silent),
 *   - `budget-paused` (we're inside the 5h cap; `pnpm metrics:render`
 *     is a deterministic in-process build but the cap is the cap),
 *   - `missing-tasks-md` (the daemon stops anyway).
 *
 * Otherwise derive the UTC date and invoke `runMetricsRender`. The gate
 * inside `runMetricsRender` (`shouldRunMetricsRender`) is the per-day
 * debounce: env-off short-circuits before the mtime probe, and the
 * mtime probe filters days already rendered. So the daemon may safely
 * call this every iteration and still land exactly one spawn per UTC date.
 *
 * Failed iterations DO fire metrics-render. The render is the
 * always-visible operator-glance surface; "every minsky repo … always
 * be visible and updated" requires the substrate (METRICS.md) to be
 * refreshed even when the daemon's iteration failed.
 *
 * Outcome is emitted as a `tick-loop.metrics-render` span so the
 * dashboard can chart firing-rate + skip-reason distribution.
 *
 * Extracted so `runDaemon` stays dispatch-only (rule #6, biome ≤10).
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function maybeRunMetricsRender(
  opts: RunDaemonOpts,
  result: DaemonIterationResult,
): Promise<void> {
  if (opts.metricsRender === undefined) return;
  if (result.status === "paused") return;
  if (result.status === "budget-paused") return;
  if (result.status === "missing-tasks-md") return;

  const ms = opts.now === undefined ? Date.now() : opts.now();
  const today = new Date(ms).toISOString().slice(0, 10);
  const outcome = await runMetricsRender({
    today,
    env: process.env,
    getLastRenderedDate: opts.metricsRender.getLastRenderedDate,
    render: opts.metricsRender.render,
  });
  emitMetricsRenderSpan(opts, today, outcome);
}

/**
 * Emit a `tick-loop.metrics-render` span describing the runner's outcome.
 * One span per invocation (skipped or ran), so the dashboard can chart
 * firing-rate, skip-reason distribution, and exit-code distribution.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function emitMetricsRenderSpan(
  opts: RunDaemonOpts,
  date: string,
  outcome: RunMetricsRenderOutcome,
): void {
  if (opts.emit === undefined) return;
  const base: Record<string, string | number | boolean> = {
    "metrics-render.date": date,
    "metrics-render.outcome": outcome.outcome,
  };
  if (outcome.outcome === "skipped") {
    base["metrics-render.skip_reason"] = outcome.reason;
  } else {
    base["metrics-render.exit_code"] = outcome.exitCode;
    base["metrics-render.duration_ms"] = outcome.durationMs;
  }
  opts.emit({ name: "tick-loop.metrics-render", attributes: base });
}

/**
 * Wire-in for the task-rotation watchdog (rule #2 — the daemon
 * orchestrates, `runTaskRotation` decides + applies). Skip-fast when:
 *   - the seam isn't injected (production daemons predating this seam),
 *   - the iteration has no `taskId` (no-task / paused / missing-tasks-md
 *     — there is nothing to check for rotation; this mirrors
 *     `maybeRunCtoAudit`'s `taskId === undefined` guard and avoids the
 *     wrapper's redundant `no-task-id` round-trip).
 *
 * Deliberately NOT gated on `result.status === "completed"`: a task's
 * substrate can ship via *another* worker's merged PR while THIS
 * iteration failed (the exact N-worker race the task targets — worker-1
 * re-picked `daemon-pre-pr-lint-gate` after #309 merged elsewhere). The
 * removal decision is a function of the global merged-PR set + the task
 * block, not this iteration's outcome, so gating on `completed` would
 * re-introduce the bug for failed iterations. Conservatism is enforced
 * inside the pure `decideTaskCompletion` (a merged PR must name the task
 * ID AND every `**Acceptance**:` box must parse ✅), not here.
 *
 * `runTaskRotation` owns the remaining cheapest-gate-first skip order
 * (`MINSKY_TASK_ROTATION=off` → `block-absent`, the latter short-
 * circuiting BEFORE the `gh pr list` round-trip). Outcome is emitted as
 * a `tick-loop.task-rotation` span so the dashboard can chart firing-
 * rate + skip-reason distribution + the `removed`/`kept`/`no-merged-pr`
 * verdict mix (the pre-registered rolling-duplicate-PR metric's signal).
 *
 * Extracted so `runDaemon` stays dispatch-only (rule #6, biome ≤10).
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function maybeRunTaskRotation(
  opts: RunDaemonOpts,
  result: DaemonIterationResult,
): Promise<void> {
  if (opts.taskRotation === undefined) return;
  if (result.taskId === undefined) return;

  const outcome = await runTaskRotation({
    taskId: result.taskId,
    env: process.env,
    getTasksMd: opts.taskRotation.getTasksMd,
    listMergedPrs: opts.taskRotation.listMergedPrs,
    applyRemoval: opts.taskRotation.applyRemoval,
  });
  emitTaskRotationSpan(opts, result.taskId, outcome);
}

/**
 * Emit a `tick-loop.task-rotation` span describing the watchdog's
 * outcome. One span per invocation (skipped or acted), so the dashboard
 * can chart firing-rate + skip-reason distribution + verdict mix; a
 * `removed` span additionally carries the merged PR number so the audit
 * trail links the rotation to the shipping PR (rule #9 visible-not-
 * silent).
 *
 * (Internal helper — no JSDoc tag required.)
 */
function emitTaskRotationSpan(
  opts: RunDaemonOpts,
  taskId: string,
  outcome: RunTaskRotationOutcome,
): void {
  if (opts.emit === undefined) return;
  const base: Record<string, string | number | boolean> = {
    "task.id": taskId,
    "task-rotation.outcome": outcome.outcome,
    "task-rotation.reason": outcome.reason,
  };
  if (outcome.outcome === "removed") {
    base["task-rotation.via_pr"] = outcome.viaPrNumber;
  }
  opts.emit({ name: "tick-loop.task-rotation", attributes: base });
}

/**
 * Outer lint-gate verification: runs one post-iteration lint check on the
 * current branch after every `completed` iteration. One attempt only —
 * the inner Claude already ran up to 3 retries per the brief mandate; this
 * is a verification layer that creates the OTEL signal for the
 * `daemon-pre-pr-lint-gate` rolling pass-rate metric.
 *
 * Skip-fast when:
 *   - the seam isn't injected (pre-existing daemons),
 *   - the iteration didn't `complete` (lint is only meaningful after a real
 *     PR-creation attempt by inner Claude).
 *
 * Emits `tick-loop.pre-pr-lint-gate` span with `verdict` + optionally
 * `failedStep` so the OTEL dashboard can chart pass-rate distribution.
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function maybeRunPrePrLintGate(
  opts: RunDaemonOpts,
  result: DaemonIterationResult,
): Promise<void> {
  if (opts.preLintRun === undefined) return;
  if (result.status !== "completed") return;
  const gateResult = await runPrePrLintGate({ runLint: opts.preLintRun, maxAttempts: 1 });
  emitPrePrLintGateSpan(opts, result.taskId, gateResult);
}

/**
 * Emit a `tick-loop.pre-pr-lint-gate` span describing the gate's outcome.
 * One span per completed iteration (pass or fail), so the OTEL dashboard can
 * chart pass-rate and failing-step distribution.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function emitPrePrLintGateSpan(
  opts: RunDaemonOpts,
  taskId: string | undefined,
  gateResult: PrePrLintGateResult,
): void {
  if (opts.emit === undefined) return;
  const base: Record<string, string | number | boolean> = {
    "pre-pr-lint.verdict": gateResult.verdict,
    "pre-pr-lint.attempts": gateResult.attempts,
  };
  if (taskId !== undefined) base["task.id"] = taskId;
  if (gateResult.failedStep !== undefined) base["pre-pr-lint.failed_step"] = gateResult.failedStep;
  if (gateResult.bodyDiscovered !== undefined) {
    base["pre-pr-lint.body_discovered"] = gateResult.bodyDiscovered;
  }
  opts.emit({ name: "tick-loop.pre-pr-lint-gate", attributes: base });
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

  // Claim-aware pick: when workerConfig is set, walk eligible tasks in
  // priority order and attempt acquireTaskClaim on each — return the
  // first ID that successfully claims. Eliminates the wasted-tick
  // collision pattern where two workers picked the same first-priority
  // task and one slept 5 min for nothing. Single-process mode (no
  // workerConfig) keeps the legacy first-match pickTask path.
  //
  // Slice 4: when openPrFetcher is also set, fetch the open-PR snapshot
  // once and run `decideTouchesCollision` against each candidate before
  // the claim attempt. File-level disjointness composes with task-level
  // claim — workers refuse to start a task whose Touches/Files overlap
  // an open daemon PR, so 5x parallel mode doesn't produce conflict
  // storms.
  const openPrs =
    opts.openPrFetcher !== undefined && opts.workerConfig !== undefined
      ? await opts.openPrFetcher()
      : [];
  const picked = pickAndClaim(opts, taskSource, openPrs);
  if (picked.kind === "no-task") {
    const result: DaemonIterationResult = {
      iteration,
      status: "no-task",
      reason: picked.reason,
      ...(picked.taskId === undefined ? {} : { taskId: picked.taskId }),
    };
    emitIterationSpan(opts, result);
    return { result };
  }

  const { taskId, claim } = picked;
  try {
    const result = await runClaimedIteration({
      opts,
      iteration,
      taskId,
      tasksMdContent: taskSource,
    });
    emitIterationSpan(opts, result);
    return { result };
  } finally {
    if (claim?.acquired) claim.release();
  }
}

type PickAndClaimResult =
  | {
      readonly kind: "claimed";
      readonly taskId: string;
      readonly claim: WorkerClaimHandle | undefined;
    }
  | { readonly kind: "no-task"; readonly reason: string; readonly taskId?: string };

function pickAndClaim(
  opts: RunDaemonOpts,
  taskSource: string,
  openPrs: readonly TouchesPrSnapshot[],
): PickAndClaimResult {
  if (opts.workerConfig === undefined) {
    const taskId = pickTask(taskSource);
    if (taskId === undefined)
      return { kind: "no-task", reason: "no unblocked unclaimed P0/P1 task" };
    return { kind: "claimed", taskId, claim: undefined };
  }
  const candidates = listEligibleTasks(taskSource);
  if (candidates.length === 0)
    return { kind: "no-task", reason: "no unblocked unclaimed P0/P1 task" };
  const collisions: string[] = [];
  for (const taskId of candidates) {
    const verdict = tryClaimCandidate(opts, taskSource, openPrs, taskId);
    if (verdict.kind === "claimed") return verdict;
    collisions.push(verdict.collision);
  }
  return {
    kind: "no-task",
    reason: `claim-collision on ${candidates.length} eligible task(s): ${collisions.join(", ")}`,
    ...(candidates[0] === undefined ? {} : { taskId: candidates[0] }),
  };
}

/**
 * Per-candidate verdict: try the file-level collision check (slice 4),
 * then the task-level claim (slice 1). Either fails with a collision
 * string or succeeds with a claimed result.
 */
function tryClaimCandidate(
  opts: RunDaemonOpts,
  taskSource: string,
  openPrs: readonly TouchesPrSnapshot[],
  taskId: string,
):
  | { kind: "claimed"; taskId: string; claim: WorkerClaimHandle | undefined }
  | {
      kind: "skip";
      collision: string;
    } {
  const fileCollision = checkFileCollision(taskSource, openPrs, taskId);
  if (fileCollision !== undefined) return { kind: "skip", collision: fileCollision };
  const claim = tryAcquireWorkerClaim(opts, taskId);
  if (claim === undefined) return { kind: "claimed", taskId, claim: undefined };
  if (claim.acquired) return { kind: "claimed", taskId, claim };
  return { kind: "skip", collision: `${taskId}:held-by-${claim.heldBy}` };
}

/**
 * Slice 4: file-level disjointness check against open daemon PRs. Returns
 * a collision string when the candidate's `**Touches**:` (or fallback
 * `**Files**:`) overlaps any open PR's changed files; `undefined` when
 * the check is a no-op (no fetcher wired) or the candidate is safe.
 */
function checkFileCollision(
  taskSource: string,
  openPrs: readonly TouchesPrSnapshot[],
  taskId: string,
): string | undefined {
  if (openPrs.length === 0) return undefined;
  const block = extractTaskBlock(taskSource, taskId) ?? "";
  const taskGlobs = parseTouchesOrFiles(block);
  const collision = decideTouchesCollision({ taskGlobs, openPrs });
  if (collision.verdict !== "collision-prevented") return undefined;
  return `${taskId}:collision-prevented-by-PR-#${collision.prNumber}-on-${collision.overlapping.join("+")}`;
}

type WorkerClaimHandle =
  | { readonly acquired: true; readonly release: () => void }
  | { readonly acquired: false; readonly heldBy: string; readonly expiresAt: number };

/**
 * Acquire a per-task claim when `workerConfig` is set; return `undefined`
 * in single-process mode (no claim layer, v0 contract preserved).
 */
function tryAcquireWorkerClaim(opts: RunDaemonOpts, taskId: string): WorkerClaimHandle | undefined {
  if (opts.workerConfig === undefined) return undefined;
  const result = acquireTaskClaim({
    taskId,
    workerId: `${opts.workerConfig.workerId}`,
    ttlMs: opts.claimTtlMs ?? 30 * 60_000,
    locksDir: opts.locksDir ?? ".minsky/locks",
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  });
  if (result.acquired) return { acquired: true, release: result.release };
  return { acquired: false, heldBy: result.heldBy, expiresAt: result.expiresAt };
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
    return runStrategyIteration({ opts, iteration, taskId, tasksMdContent });
  }
  const tickResult = await spawnTickDryRun({ taskId, opts });
  return {
    iteration,
    status: tickResult.status === "completed" ? "completed" : "failed",
    taskId,
    reason: tickResult.output,
  };
}

/**
 * Strategy-dispatch branch of `runClaimedIteration`. Extracted so the
 * parent function stays under biome's cognitive-complexity cap (rule
 * #6, ≤10) once the slice-3 `provider` field added another conditional.
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function runStrategyIteration(args: {
  readonly opts: RunDaemonOpts;
  readonly iteration: number;
  readonly taskId: string;
  readonly tasksMdContent: string;
}): Promise<DaemonIterationResult> {
  const { opts, iteration, taskId, tasksMdContent } = args;
  if (opts.spawnStrategy === undefined) {
    throw new Error("runStrategyIteration called without spawnStrategy");
  }
  const extraArgs = claudeArgsForWorker({
    baseArgs: [],
    taskId,
    workerConfig: opts.workerConfig,
  });
  const stratResult = await opts.spawnStrategy.spawn({
    taskId,
    brief: buildDaemonBrief({ taskId, tasksMdContent }),
    // `daemon-aider-brief-shrinker`: the slim brief used by
    // `LlmProviderSpawnStrategy` when the iteration routes to local.
    // ≤2 KB so prompt processing on aider+Qwen3-class models finishes
    // inside the 30-min watchdog. Built unconditionally; the wrapper
    // ignores it on the claude path.
    localBrief: buildLocalBrief({ taskId, tasksMdContent }),
    env: process.env,
    extraArgs,
  });
  // `daemon-claude-print-hang-watchdog`: when the spawn-strategy SIGKILLs
  // a hung child, the result carries `timedOut: true`. Surface as a
  // stable `claude-print-timeout: <ms>ms` reason so the rolling-7d
  // invariant (filed under `claudePrintTimeoutFrequencyInvariant`) has a
  // grep-able string.
  const reason = buildIterationReason(stratResult);
  return {
    iteration,
    status: stratResult.exitCode === 0 ? "completed" : "failed",
    taskId,
    reason,
    // `local-llm-fallback-on-budget-pause` slice 3: surface the chosen
    // provider when the spawn-strategy was `LlmProviderSpawnStrategy`
    // (otherwise undefined; legacy single-strategy spawns leave the
    // field absent).
    ...(stratResult.provider === undefined ? {} : { provider: stratResult.provider }),
  };
}

/**
 * Build the `reason` field of a strategy-dispatched iteration.
 *
 * Timeout label includes the provider (when known) so the rolling-7d
 * `claudePrintTimeoutFrequencyInvariant` metric splits cleanly between
 * `claude-print-timeout` (the legacy claude path) and
 * `local-spawn-timeout` (the slice-3 local-LLM path). When provider is
 * unset (legacy single-strategy spawn), we keep the original
 * `claude-print-timeout` label for back-compat with the existing
 * measurement query.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function buildIterationReason(stratResult: {
  readonly timedOut?: boolean;
  readonly durationMs: number;
  readonly exitCode: number;
  readonly stdoutTail: string;
  readonly stderrTail: string;
  readonly provider?: "claude" | "local" | "hold";
}): string {
  if (stratResult.timedOut === true) {
    const label = stratResult.provider === "local" ? "local-spawn-timeout" : "claude-print-timeout";
    return `${label}: ${stratResult.durationMs}ms (child SIGKILLed by per-iteration watchdog)`;
  }
  if (stratResult.exitCode === 0) return stratResult.stdoutTail;
  return stratResult.stderrTail;
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
 * picked task's block + an anti-noop directive + a priority-discipline
 * gate.
 *
 * Section order (cache-friendliness, 2026-05-06): stable content first
 * (iteration directive, pre-PR lint-stack gate, optimization-discipline
 * gate — invariant across iterations) so Anthropic's prompt cache (5-min
 * TTL, longest-common-prefix matching, 90% read discount) sees a stable
 * prefix; volatile content last (priority-discipline gate, current task
 * block — change every iteration as tasks ship and queue shifts) so the
 * volatile suffix doesn't break the prefix chain. Slice 1 of
 * `daemon-cross-iteration-prompt-cache`.
 *
 * Anti-noop directive (2026-05-05): the placeholder brief
 * `"daemon brief for ${taskId}"` led claude to default to "refresh the
 * brief in TASKS.md" (1-line additions, no code, 87+ iterations of churn
 * on cross-repo-ci-action). The directive forbids brief-refresh-only PRs
 * and steers toward shipping the smallest meaningful code change.
 *
 * Priority-discipline gate (2026-05-05): operator observed that the
 * daemon picked `daily-changelog-for-humans` (P1) for 30 iterations
 * while genuine P0 work sat unclaimed. Root cause: `pickTask` walks file
 * ordering, so a p1-tagged block placed in the `## P0` section gets
 * picked first. The brief now lists all open unclaimed p0-tagged tasks
 * and tells claude to abort with a `noop, exiting` reason if the picked
 * task isn't among them — making the misordering visible-not-silent.
 * The architectural fix (teach `pickTask` to consult `**Tags**:`) is
 * filed as `daemon-priority-discipline-picktask-bug`.
 *
 * @otel-exempt pure builder of the spawn-strategy input.
 */
export function buildDaemonBrief(args: {
  readonly taskId: string;
  readonly tasksMdContent: string;
}): string {
  const block = extractTaskBlock(args.tasksMdContent, args.taskId);
  const openP0s = extractOpenP0TaskIds(args.tasksMdContent);
  const pickedIsP0 = openP0s.includes(args.taskId);
  const openP0List = openP0s.length === 0 ? "(none)" : openP0s.map((id) => `\`${id}\``).join(", ");
  const priorityVerdict = pickedIsP0
    ? `Your picked task \`${args.taskId}\` IS in the open P0 set above. Proceed.`
    : openP0s.length === 0
      ? `No open P0 tasks. Your picked task \`${args.taskId}\` is the highest-priority work available. Proceed.`
      : `**STOP.** Your picked task \`${args.taskId}\` is NOT in the open P0 set above. Output \`noop, exiting — priority discipline: '${args.taskId}' is not the highest-priority unclaimed P0; should pick '${openP0s[0]}' instead\` to stdout and DO NOT open a PR. Exception: if your picked task's block contains \`**Pick-next**: yes\` AND no open P0 has \`**Pick-next**: yes\`, the operator has explicitly overridden — proceed and note the override in your reason.`;
  return [
    `# Daemon iteration brief for \`${args.taskId}\``,
    "",
    "## Iteration directive",
    "",
    "Ship the smallest meaningful next iteration of this task. Open a PR with code changes that move the task toward its Acceptance criteria.",
    "",
    "**FORBIDDEN — anti-noop guard:**",
    "- DO NOT open a PR whose only change is a task-block append (so-called 'brief refresh'). If you cannot ship code this iteration, output `noop, exiting` to stdout and do NOT open a PR.",
    "- DO NOT add new task blocks to TASKS.md unless the task explicitly directs you to.",
    "",
    "Wire-in / config flip / one-line change on existing substrate IS a meaningful code change — ship it.",
    "",
    "## Pre-PR lint-stack gate",
    "",
    "Before invoking `gh pr create`, run the canonical pre-PR lint stack on your branch:",
    "",
    "```",
    "pnpm pre-pr-lint",
    "```",
    "",
    "Behaviour:",
    "",
    "- **Green** → proceed to `gh pr create`.",
    "- **Red** → fix failures and re-run, up to 3 attempts. The stderr tail names the failing step.",
    "- **Still red after 3 attempts** → output `noop, exiting — pre-pr-lint-failures: <step name>` to stdout and DO NOT open a PR. Filing a `Blocked: pre-pr-lint-failures` task is acceptable; opening a red PR is not.",
    "",
    "Body-only checks (`pr-self-grade`, `pr-security-review`): write `pr-body.md`; `pnpm pre-pr-lint` auto-picks it up (same retry budget). Then `gh pr create -F pr-body.md`.",
    "",
    "## Optimization-discipline gate",
    "",
    "Operator directive 2026-05-05: per iteration, ONE measurable optimization. Eligible: brief-shrinking · cached-prompt extension · skip-earlier gate · log-line dedup · round-trip elimination. Bundle on same PR; if none, note `optimization: none-this-iteration: <reason>`. Anti-vanity: ≥10-byte savings minimum.",
    "",
    "## PR self-grade template (copy-paste verbatim)",
    "",
    "The PR body's `## Hypothesis self-grade` MUST follow this exact format. Colon OUTSIDE bold tags; deviations fail `scripts/check-pr-self-grade.mjs`.",
    "",
    "DO NOT REWRITE THIS FORMAT. Paste it verbatim and fill in the four values:",
    "",
    "```",
    "## Hypothesis self-grade",
    "",
    "- **Predicted**: <re-state the hypothesis from the EXPERIMENT.yaml or PR body>",
    "- **Observed**: <the actual measurement output>",
    "- **Match**: yes | no | partial",
    "- **Lesson**: <one-sentence takeaway; what changes for the next experiment>",
    "```",
    "",
    "Forbidden: colon INSIDE bold (`**Predicted:**`, `**Match:**`) or capitalized values (`Yes`) — fails. Colon outside; values lowercase (`**Match**: yes`/`no`/`partial`).",
    "",
    "## PR security-review template",
    "",
    "vision.md § 13 — every PR body needs ONE or `scripts/check-pr-security-review.mjs` fails:",
    "- Security surface (auth/secrets/sandbox/PII/supply-chain): `## Security & privacy` section + threat+mitigation (or 'no new surface; § 13 reviewed').",
    "- No surface (typo/docs/brief): `<!-- security: not-applicable — <reason ≥3 chars> -->` (em-dash or `--`).",
    "",
    "## Priority-discipline gate",
    "",
    `Open P0 tasks (unclaimed, unblocked, tagged \`p0\`): ${openP0List}`,
    "",
    priorityVerdict,
    "",
    "## Task block (current TASKS.md)",
    "",
    block ??
      "(task block not found in TASKS.md — task may have been closed; if so, exit without writing files)",
    "",
  ].join("\n");
}

/**
 * Build a slim brief for the local-LLM (aider+Qwen) path.
 *
 * Why a separate brief: stock `buildDaemonBrief` is 7-10 KB and aider
 * auto-loads every file referenced in the task block. On a 32B-class
 * model running ~14 tok/s steady-state, prompt processing alone takes
 * 14-18 min and trips the 30-min watchdog before aider produces an
 * edit (live-fire 2026-05-07 against `daemon-claude-print-hang-watchdog`
 * — task `daemon-aider-brief-shrinker`). The slim brief drops everything
 * that doesn't change aider's edit decision: priority-discipline gate
 * (the daemon already picked the task), optimization-discipline gate
 * (operator directive doesn't apply to survival mode), pre-PR lint
 * stack (aider commits locally and the supervisor opens PRs), PR
 * self-grade and security-review templates (same reason), anti-noop
 * guard (aider's edit loop already implies "make a change"). Keeps:
 * task ID, tagline, Hypothesis, Details.
 *
 * The `**Files**:` cell is intentionally omitted: aider's `--yes` flag
 * auto-adds every path it sees in the brief to its chat context, and
 * task blocks routinely list 8-12 files in their `**Files**:` cell.
 * Live-fire 2026-05-09 multi-worker run showed workers blowing past
 * 50k tokens on auto-adds before mlx_lm.server crashed. Hypothesis and
 * Details still surface 1-3 file paths inline, which is the right
 * working-set size for a single iteration.
 *
 * Target: ≤2 KB regardless of task block size (Hypothesis/Details cells
 * are individually unbounded; the cap is enforced by truncating each
 * cell's value at 600 chars with a `…` ellipsis).
 *
 * @otel-exempt pure brief builder; instrumentation lives at the
 *   spawn-strategy dispatch span.
 */
export function buildLocalBrief(args: {
  readonly taskId: string;
  readonly tasksMdContent: string;
}): string {
  const block = extractTaskBlock(args.tasksMdContent, args.taskId);
  if (block === undefined) {
    return `Task \`${args.taskId}\` not found in TASKS.md — exit without writing files.`;
  }
  const tagline = extractTaskTagline(block);
  const progress = extractSlimField(block, "Progress");
  // When Progress is present it is the current-iteration directive (e.g.
  // "Slice N: do X in file Y"). The static Hypothesis/Details cells describe
  // prior work that is already in the codebase; surfacing them alongside the
  // Progress directive causes models to read the old context, conclude
  // "already implemented", and exit without commits. Omit them when Progress
  // is set so the model focuses exclusively on the live slice.
  const hypothesis = progress === undefined ? extractSlimField(block, "Hypothesis") : undefined;
  const details = progress === undefined ? extractSlimField(block, "Details") : undefined;
  const lines: string[] = [
    `# Task: \`${args.taskId}\``,
    "",
    "Edit code to ship the smallest meaningful next iteration. Commit locally; the supervisor opens the PR.",
  ];
  if (tagline !== undefined) {
    lines.push("", tagline);
  }
  if (progress !== undefined) {
    lines.push("", "## Current slice", progress);
  }
  if (hypothesis !== undefined) {
    lines.push("", "## Hypothesis", hypothesis);
  }
  if (details !== undefined) {
    lines.push("", "## Details", details);
  }
  return lines.join("\n");
}

const SLIM_FIELD_VALUE_CAP = 600;

function extractTaskTagline(block: string): string | undefined {
  const m = block.match(/^- \[ \] `[^`]+`\s+—\s+(.+)$/m);
  if (m === null) return undefined;
  const cap = m[1];
  return cap === undefined ? undefined : cap.trim();
}

function extractSlimField(block: string, field: string): string | undefined {
  const re = new RegExp(`\\*\\*${field}\\*\\*:\\s*([\\s\\S]*?)(?=\\n\\s*-\\s+\\*\\*[A-Z]|$)`);
  const m = block.match(re);
  if (m === null) return undefined;
  const cap = m[1];
  if (cap === undefined) return undefined;
  const raw = cap.trim();
  if (raw.length === 0) return undefined;
  return raw.length > SLIM_FIELD_VALUE_CAP ? `${raw.slice(0, SLIM_FIELD_VALUE_CAP)}…` : raw;
}

/**
 * Return task IDs in `## P0` that are unclaimed, unblocked, AND have a
 * `**Tags**:` line containing `p0`. Used by `buildDaemonBrief`'s
 * priority-discipline gate.
 *
 * @otel-exempt pure helper of `buildDaemonBrief`.
 */
export function extractOpenP0TaskIds(tasksMd: string): readonly string[] {
  const blocks = splitBlocks(sliceP0Section(tasksMd));
  const ids: string[] = [];
  for (const block of blocks) {
    const id = openP0Id(block);
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

function openP0Id(block: string): string | undefined {
  const id = parseId(block);
  if (id === undefined) return undefined;
  if (block.includes("(@minsky-tick-loop)")) return undefined;
  if (/\*\*Blocked by\*\*:/i.test(block)) return undefined;
  if (/\*\*Blocked\*\*:/.test(block)) return undefined;
  if (!/\*\*Tags\*\*:[^\n]*\bp0\b/i.test(block)) return undefined;
  return id;
}

function sliceP0Section(tasksMd: string): string {
  const p0Start = tasksMd.search(/\n##\s+P0\b/);
  if (p0Start < 0) return "";
  const after = tasksMd.slice(p0Start);
  const p1 = after.search(/\n##\s+P1\b/);
  return p1 < 0 ? after : after.slice(0, p1);
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
  const candidates = listEligibleTasks(tasksMd);
  return candidates.length === 0 ? undefined : candidates[0];
}

/**
 * Return ALL eligible task IDs from TASKS.md in priority order. Same
 * eligibility rules as `pickTask` (skip claimed, skip blocked-by, skip
 * blocked) but returns the full list rather than first-match. Used by the
 * claim-aware iteration path: walk candidates and attempt
 * `acquireTaskClaim` on each, returning the first ID that successfully
 * claims (eliminates the wasted-tick collision pattern when two workers
 * race on the same first-priority task).
 *
 * @otel-exempt pure helper of `pickTask`.
 */
/** Eligibility gate shared with pickTask: skip claimed + blocked blocks. */
function isEligibleBlock(block: string): boolean {
  if (block.includes("(@minsky-tick-loop)")) return false;
  if (/\*\*Blocked by\*\*:/i.test(block)) return false;
  if (/\*\*Blocked\*\*:/.test(block)) return false;
  return true;
}

interface RankedTask {
  readonly id: string;
  readonly pri: number;
  readonly idx: number;
}

/**
 * Collect eligible task blocks with their effective priority. Effective
 * priority = the `**Tags**:` p-token when present, else the section the
 * block physically sits in — so a `p1`-tagged block misplaced inside
 * `## P0` sorts AFTER genuine p0 work (the
 * `daemon-priority-discipline-picktask-bug` fix). `idx` preserves file
 * order as the stable tiebreaker within one priority.
 */
function collectRankedTasks(sliced: string): RankedTask[] {
  const ranked: RankedTask[] = [];
  let idx = 0;
  for (const { sectionPri, body } of splitByPrioritySection(sliced)) {
    for (const block of splitBlocks(body)) {
      const id = parseId(block);
      if (id === undefined || !isEligibleBlock(block)) continue;
      ranked.push({ id, pri: parseTagPriority(block) ?? sectionPri, idx: idx++ });
    }
  }
  return ranked;
}

/**
 * Rank the eligible P0/P1 task IDs of `tasksMd` by priority (Tags
 * override → section), then file order as the stable tiebreaker. Pure
 * string → ID list; the daemon's spawn span wraps the iteration that
 * consumes this, not the ranking itself.
 *
 * @otel-exempt pure task-list ranking; no I/O or spans.
 */
export function listEligibleTasks(tasksMd: string): readonly string[] {
  const ranked = collectRankedTasks(sliceP0P1(tasksMd));
  ranked.sort((a, b) => a.pri - b.pri || a.idx - b.idx);
  return ranked.map((r) => r.id);
}

/**
 * Split the P0+P1-sliced TASKS.md into its priority sections so each task
 * block carries the priority of the heading it lives under (0 = P0, 1 =
 * P1). The `## P1` heading is the boundary; absent it, everything is P0.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function splitByPrioritySection(sliced: string): readonly { sectionPri: number; body: string }[] {
  const p1 = sliced.search(/\n##\s+P1\b/);
  if (p1 < 0) return [{ sectionPri: 0, body: sliced }];
  return [
    { sectionPri: 0, body: sliced.slice(0, p1) },
    { sectionPri: 1, body: sliced.slice(p1) },
  ];
}

/**
 * Parse the priority declared in a task block's `**Tags**:` line (a
 * `p0`..`p3` token), or `undefined` when the block declares none. This is
 * what lets pickTask honour declared priority over physical file order.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function parseTagPriority(block: string): number | undefined {
  const tags = block.match(/\*\*Tags\*\*:\s*([^\n]*)/i);
  const group = tags?.[1];
  if (group === undefined) return undefined;
  const p = group.match(/\bp([0-3])\b/i);
  const digit = p?.[1];
  return digit === undefined ? undefined : Number(digit);
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
      // `local-llm-fallback-on-budget-pause` slice 3: emit the provider
      // attribute when set. Default `""` keeps the attribute schema
      // stable for OTEL consumers that don't expect missing keys.
      "iteration.provider": result.provider ?? "",
    },
  });
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
