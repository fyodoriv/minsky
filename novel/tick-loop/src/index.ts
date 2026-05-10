/**
 * `@minsky/tick-loop` — deterministic mock-tick daemon (sub-task 2/3 of
 * `first-integration-test`).
 *
 * Loops `claim → mock-anthropic-call → complete` on a configurable cadence.
 * Used by the in-process 10-min smoke (this PR) and by sub-task 3 (nightly
 * self-hosted runner) at full 60-min cadence.
 *
 * Pattern conformance (rule #8 / vision.md § "Pattern conformance index"):
 *   - **Periodic-task scheduling** — Liu & Layland, "Scheduling Algorithms
 *     for Multiprogramming in a Hard Real-Time Environment", *JACM* 20 (1),
 *     1973. The cadence model (N ticks within a wall-clock budget) is the
 *     classic periodic-task envelope: each tick has its own deadline and the
 *     loop halts at budget-exhaustion. Conformance: full.
 *   - **Let-it-crash supervision** — Armstrong, *Programming Erlang*,
 *     Pragmatic Bookshelf, 2007. The mock client's chaos branches return
 *     failure shapes rather than throw, so the supervisor (the caller, or
 *     `runSmoke`) decides the respawn policy. Conformance: full.
 *
 * Architectural seams (rule #2):
 *   - `MockAnthropicClient` is an interface — the test fake is one
 *     implementation; production code never imports the SDK.
 *   - `tick(...)` is pure given a deterministic client + fixture.
 *   - `runSmoke(...)` is the I/O orchestrator (clock + loop).
 *
 * @module tick-loop
 */

// ---- Types ----------------------------------------------------------------

/**
 * The shape returned by `MockAnthropicClient.respond`. Mirrors the minimum
 * needed by a tick: the status (so `tick` can mark the task completed or
 * failed) and the output (so the run can be inspected post-hoc).
 */
export interface MockAnthropicResponse {
  readonly status: "success" | "failed";
  readonly output: string;
  /** Optional simulated HTTP status (5xx for chaos branches). */
  readonly httpStatus?: number;
}

export interface MockAnthropicRequest {
  readonly taskId: string;
  readonly prompt: string;
}

/**
 * The seam (Adapter, Gamma et al. 1994) — `tick` depends on this interface,
 * never on a concrete SDK. The test fake is the only implementation in v0;
 * production code will plug a real Anthropic-SDK adapter behind the same
 * interface.
 */
export interface MockAnthropicClient {
  respond(req: MockAnthropicRequest): Promise<MockAnthropicResponse>;
}

/**
 * Failure modes the test fake can simulate. The chaos table in `README.md`
 * binds each mode to a documented expected behavior (rule #7).
 */
export type MockFailureMode = "none" | "http-5xx" | "network-timeout" | "malformed-output";

export interface FakeClientOptions {
  /** Default `none` (happy path). */
  readonly failureMode?: MockFailureMode;
  /** For `network-timeout` — millisecond delay before resolution. Default 0. */
  readonly timeoutMs?: number;
  /** Override the success output text. Default `mock-success`. */
  readonly successOutput?: string;
}

export interface TickOpts {
  readonly taskId: string;
  readonly prompt: string;
  readonly client: MockAnthropicClient;
  /** Reference clock injected for determinism in tests. Default `Date.now`. */
  readonly now?: () => number;
  /** Optional span sink — one event per tick. */
  readonly emit?: (event: TickSpan) => void;
}

export interface TickSpan {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface TickResult {
  readonly taskId: string;
  readonly status: "completed" | "failed";
  readonly durationMs: number;
  readonly spanName: string;
  readonly output: string;
}

export interface SmokeOpts {
  readonly client: MockAnthropicClient;
  /** Task IDs to process (read from a fixture by the caller). */
  readonly taskIds: readonly string[];
  /**
   * Wall-clock budget in milliseconds. Default 10 minutes (600_000 ms).
   * The loop halts as soon as the next tick would exceed the budget.
   */
  readonly budgetMs?: number;
  /**
   * Cap on the number of ticks. Default 4 (the parent task's "≥1 OTEL span
   * per task type" Acceptance maps to four task types — see the
   * `synthetic-tasks.md` fixture).
   */
  readonly maxTicks?: number;
  readonly now?: () => number;
  readonly emit?: (event: TickSpan) => void;
}

export interface SmokeResult {
  readonly results: readonly TickResult[];
  readonly totalDurationMs: number;
  readonly budgetExhausted: boolean;
}

const DEFAULT_BUDGET_MS = 600_000;
const DEFAULT_MAX_TICKS = 4;

// ---- TestFakeMockAnthropic ------------------------------------------------

/**
 * A deterministic fake `MockAnthropicClient`. Configurable via
 * `failureMode` to exercise the chaos table rows in `README.md`.
 *
 * @otel-exempt test fake — no production code path; instrumentation is
 *   the caller's responsibility (the `tick` span wraps the `respond` call).
 */
export class TestFakeMockAnthropic implements MockAnthropicClient {
  readonly #opts: Required<Pick<FakeClientOptions, "failureMode" | "timeoutMs" | "successOutput">>;

  constructor(opts: FakeClientOptions = {}) {
    this.#opts = {
      failureMode: opts.failureMode ?? "none",
      timeoutMs: opts.timeoutMs ?? 0,
      successOutput: opts.successOutput ?? "mock-success",
    };
  }

  /**
   * @otel-exempt test fake — see class JSDoc; the production tracing
   *   boundary is `tick`, not the fake.
   */
  async respond(req: MockAnthropicRequest): Promise<MockAnthropicResponse> {
    return await respondByMode(req, this.#opts);
  }
}

/**
 * Pure dispatch over `failureMode`. Extracted so `respond` is one
 * statement and cognitive complexity stays low (rule #6).
 *
 * (Internal helper, not exported — no JSDoc tag required.)
 */
async function respondByMode(
  req: MockAnthropicRequest,
  opts: Required<Pick<FakeClientOptions, "failureMode" | "timeoutMs" | "successOutput">>,
): Promise<MockAnthropicResponse> {
  if (opts.failureMode === "http-5xx") {
    return { status: "failed", output: `5xx error for task=${req.taskId}`, httpStatus: 503 };
  }
  if (opts.failureMode === "network-timeout") {
    await sleep(opts.timeoutMs);
    return { status: "failed", output: `network-timeout for task=${req.taskId}` };
  }
  if (opts.failureMode === "malformed-output") {
    // Returns a "success" status but the output is the malformed payload —
    // mirrors a 200 OK with garbage body. Downstream code must validate
    // (rule #6: don't trust upstream).
    return { status: "success", output: "<<<MALFORMED>>>" };
  }
  return { status: "success", output: opts.successOutput };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- tick -----------------------------------------------------------------

/**
 * One iteration of the periodic-task loop: call the mock-anthropic client,
 * map its response to a tick outcome, and emit one span. Pure given a
 * deterministic client + clock.
 *
 * The function never throws. The mock client's promise rejection path is
 * mapped to `status: "failed"` with the error message in `output` so the
 * supervisor (the caller of `runSmoke`) sees a structured failure rather
 * than an uncaught rejection (Armstrong 2007: let it crash, but at the
 * right boundary — here, the boundary is the tick).
 *
 * @otel tick-loop.tick
 */
export async function tick(opts: TickOpts): Promise<TickResult> {
  const now = opts.now ?? Date.now;
  const start = now();
  const spanName = "tick-loop.tick";

  const response = await runRespond(opts);
  const durationMs = now() - start;

  const status: TickResult["status"] = response.status === "success" ? "completed" : "failed";
  const result: TickResult = {
    taskId: opts.taskId,
    status,
    durationMs,
    spanName,
    output: response.output,
  };
  if (opts.emit !== undefined) {
    opts.emit({
      name: spanName,
      attributes: {
        "task.id": opts.taskId,
        "tick.status": status,
        "tick.duration_ms": durationMs,
        "mock.http_status": response.httpStatus ?? 0,
      },
    });
  }
  return result;
}

/**
 * Catch the mock client's rejection and convert it to a structured failure.
 * Extracted so `tick` itself has no try/catch (rule #6 — no try/catch
 * deeper than 1 level; the helper IS the boundary).
 *
 * (Internal helper, not exported — no JSDoc tag required.)
 */
async function runRespond(opts: TickOpts): Promise<MockAnthropicResponse> {
  try {
    return await opts.client.respond({ taskId: opts.taskId, prompt: opts.prompt });
    // rule-6: handled-locally — mock-client rejection is the supervisor boundary; converting to a structured failure shape is the documented behavior (Armstrong 2007 — let it crash AT the right boundary)
  } catch (err) {
    return {
      status: "failed",
      output: `mock-client-rejected: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---- runSmoke -------------------------------------------------------------

/**
 * Run N ticks within a wall-clock budget. The loop halts when:
 *   - all `taskIds` have been ticked, OR
 *   - `maxTicks` ticks have completed, OR
 *   - the next tick would exceed `budgetMs` (budget-exhaustion).
 *
 * One I/O orchestrator wrapping the pure `tick` (Martin, *Clean
 * Architecture*, 2017). The wall-clock check uses the injected `now` so
 * tests can drive deterministically.
 *
 * @otel tick-loop.run-smoke
 */
export async function runSmoke(opts: SmokeOpts): Promise<SmokeResult> {
  const now = opts.now ?? Date.now;
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const maxTicks = opts.maxTicks ?? DEFAULT_MAX_TICKS;
  const start = now();

  const results: TickResult[] = [];
  let budgetExhausted = false;

  for (let i = 0; i < opts.taskIds.length && i < maxTicks; i++) {
    if (now() - start >= budgetMs) {
      budgetExhausted = true;
      break;
    }
    const taskId = opts.taskIds[i] ?? "";
    const tickOpts: TickOpts = buildTickOpts(opts, taskId);
    const result = await tick(tickOpts);
    results.push(result);
  }
  return {
    results,
    totalDurationMs: now() - start,
    budgetExhausted,
  };
}

/**
 * Assemble a `TickOpts` for one iteration, threading optional fields
 * conditionally because `exactOptionalPropertyTypes: true` rejects
 * `{ key: undefined }`.
 *
 * (Internal helper, not exported — no JSDoc tag required.)
 */
function buildTickOpts(opts: SmokeOpts, taskId: string): TickOpts {
  const base: TickOpts = {
    taskId,
    prompt: `mock-prompt for ${taskId}`,
    client: opts.client,
  };
  const withNow = opts.now === undefined ? base : { ...base, now: opts.now };
  return opts.emit === undefined ? withNow : { ...withNow, emit: opts.emit };
}

// ---- SpanRecorder ---------------------------------------------------------

/**
 * In-memory span recorder for tests + the in-process smoke. Used by
 * `runSmoke` callers that want to assert "≥1 OTEL span per task type"
 * (the parent task's Acceptance) without wiring a real OTEL collector.
 *
 * Public minimum surface: `record(event)` is the sink, `spans` is the
 * accumulated read-only list. Production code should plug a real OTEL
 * exporter behind the same `(event: TickSpan) => void` shape.
 *
 * @otel-exempt in-memory test recorder — instrumentation surface, not
 *   instrumented surface; recording its own work would be circular.
 */
export class SpanRecorder {
  readonly #spans: TickSpan[] = [];

  /** @otel-exempt see class JSDoc — the recorder IS the instrumentation. */
  record(event: TickSpan): void {
    this.#spans.push(event);
  }

  /** @otel-exempt see class JSDoc — read accessor over an in-memory array. */
  get spans(): readonly TickSpan[] {
    return this.#spans;
  }
}

// ---- Fixture loader -------------------------------------------------------

/**
 * Parse task IDs from a synthetic TASKS.md fixture. Mirrors the canonical
 * `**ID**: <kebab-id>` block-marker shape used in the real TASKS.md (and
 * by `scripts/check-rule-7-chaos-coverage.mjs`'s `parseTaskIds`).
 *
 * Pure function — no I/O. The caller reads the fixture; this parses.
 *
 * @otel-exempt pure parser — string-in / array-out, no I/O. Calling code
 *   that does the file read carries the span (file-path attribute).
 */
export function parseFixtureTaskIds(source: string): readonly string[] {
  const ids: string[] = [];
  const re = /\*\*ID\*\*:\s*([a-z][a-z0-9-]*[a-z0-9])\b/g;
  for (const m of source.matchAll(re)) {
    const id = m[1];
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

// ---- Daemon re-exports ----------------------------------------------------

export {
  type BudgetDecisionLike,
  type BudgetGuardLike,
  type ChangelogSeam,
  type CtoAuditSeam,
  type DaemonIterationResult,
  type DaemonIterationStatus,
  type DaemonRunResult,
  type MetricsRenderSeam,
  type RunDaemonOpts,
  type SnapshotSeam,
  claim,
  listEligibleTasks,
  pickTask,
  runDaemon,
  spawnTickDryRun,
} from "./daemon.js";

// Sub-task of `daily-changelog-for-humans` — expose the changelog-runner
// primitives so the CLI (`bin/tick-loop.mjs`) can wire the seam without
// reaching past `dist/`. Mirrors the post-task-cto-audit re-export block.
export {
  CHANGELOG_PROMPT_HEADER,
  type ChangelogSkipReason,
  type ChangelogSpawn,
  type ReadChangelog,
  type RunChangelogArgs,
  type RunChangelogOutcome,
  hasDateSection,
  runChangelog,
  shouldRunChangelog,
} from "./changelog-runner.js";

// CLI-side construction of the `ChangelogSeam` (file-backed reader). Twin
// of `cto-audit-cli-wiring`'s `createFileBackedCtoAuditLock` — keeps the
// bin script (`bin/tick-loop.mjs`) thin: the bin only decides whether to
// opt-in (env var) and forwards the CHANGELOG.md path here.
export { createFileBackedChangelogReader } from "./changelog-cli-wiring.js";

// Sub-task of `daily-changelog-for-humans` Details (e) — daily snapshot
// capture I/O wrapper. Pure gate (`shouldRunSnapshot`) + injected
// existence-probe + capture seams; the daemon wire-in (`SnapshotSeam` on
// `RunDaemonOpts`) shipped in #190; CLI-side construction (file-backed
// existence probe + `pnpm changelog:snapshot --date <date>` capture)
// lives in `snapshot-cli-wiring`.
export {
  type RunSnapshotArgs,
  type RunSnapshotOutcome,
  type SnapshotCapture,
  type SnapshotExists,
  type SnapshotSkipReason,
  runSnapshot,
  shouldRunSnapshot,
} from "./snapshot-runner.js";

// CLI-side construction of the `SnapshotSeam` (file-backed existence probe
// + pnpm-backed capture). Twin of `changelog-cli-wiring`'s file-backed
// reader — keeps `bin/tick-loop.mjs` thin: the bin only decides whether to
// opt-in (env var) and forwards the repo root here.
export {
  type PnpmSnapshotCaptureOptions,
  createFileBackedSnapshotExists,
  createPnpmSnapshotCapture,
} from "./snapshot-cli-wiring.js";

// Sub-task of `canonical-metric-list-per-repo` Acceptance (3) — daily
// metrics-render I/O wrapper. Pure gate (`shouldRunMetricsRender`) +
// injected last-rendered-date probe + render seams; the daemon wire-in
// (`MetricsRenderSeam` on `RunDaemonOpts`) shipped in slice 4/N.
// CLI-side construction (file-backed METRICS.md mtime probe + `pnpm
// metrics:render --date <date>` capture) lives in `metrics-render-cli-wiring`.
export {
  type GetLastRenderedDate,
  type MetricsRender,
  type MetricsRenderSkipReason,
  type RunMetricsRenderArgs,
  type RunMetricsRenderOutcome,
  runMetricsRender,
  shouldRunMetricsRender,
} from "./metrics-render-runner.js";

// CLI-side construction of the `MetricsRenderSeam` (file-backed METRICS.md
// mtime probe + pnpm-backed render). Twin of `snapshot-cli-wiring` — keeps
// `bin/tick-loop.mjs` thin: the bin only decides whether to opt-in (env
// var) and forwards the METRICS.md path / repo root here.
export {
  type PnpmMetricsRenderOptions,
  createFileBackedLastRenderedDate,
  createPnpmMetricsRender,
} from "./metrics-render-cli-wiring.js";

// Sub-task (c) of `post-task-cto-audit` — expose the CTO-audit primitives
// so the CLI (`bin/tick-loop.mjs`) can wire the seam without reaching past
// `dist/`. The pure builder + gate stay testable in isolation; `runCtoAudit`
// is the I/O wrapper the daemon dispatches into.
export {
  CTO_PROMPT_HEADER,
  type CompletedIterationSignals,
  type CtoAuditLock,
  type CtoAuditSpawn,
  type RunCtoAuditArgs,
  type RunCtoAuditOutcome,
  type SkipReason,
  buildCtoBrief,
  runCtoAudit,
  shouldRunCtoAudit,
} from "./post-task-cto-audit.js";

// Sub-step (d/e/f) of `post-task-cto-audit` — CLI-side construction of the
// `CtoAuditSeam` (file-backed lock + git/gh signals collector). Keeps the
// CLI bin script (`bin/tick-loop.mjs`) thin: the bin only decides whether
// to opt-in (env var) and forwards `process.env` / a real `execFile` here.
export {
  CTO_AUDIT_ENABLE_ENV_VAR,
  type EnsureLabelOutcome,
  type EnvDriftOutcome,
  type ExecFileLike,
  type SignalsBuilderArgs,
  createFileBackedCtoAuditLock,
  createGitGhSignalsBuilder,
  detectCtoAuditEnvDrift,
  ensureCtoAuditLabel,
  extractPrUrl,
  parseFilesChangedFromGit,
  parsePlistEnv,
  parseRecentMainCommitsFromGit,
} from "./cto-audit-cli-wiring.js";

export { fromRealBudgetGuard } from "./budget-guard-facade.js";

// Sub-task 3/3 (`tick-loop-daemon-real-spawn-flip`): expose the Strategies
// so the CLI (`bin/tick-loop.mjs`) can pick between real spawn and dry-run
// from the `MINSKY_TICK_DRY_RUN` env-var without reaching past `dist/`.
export {
  DryRunSpawnStrategy,
  ProcessSpawnStrategy,
  type ProcessSpawnStrategyOptions,
  type SpawnInput,
  type SpawnResult,
  type SpawnStrategy,
} from "./spawn-strategy.js";

// Slice 1 of `local-llm-fallback-on-budget-pause`: expose the pure
// decision function + classifier so the CLI wiring (slice 3) can wire
// it into the spawn-strategy seam.
export {
  type BudgetState,
  type DecideProviderInput,
  type LastClaudeFailure,
  type LocalProbeResult,
  type ProviderDecision,
  decideProvider,
  isClaudeHardLimit,
} from "./llm-provider-selector.js";

// Slice 2 of `local-llm-fallback-on-budget-pause`: expose the invocation
// builders so the CLI wiring (slice 3) can hand them to
// `ProcessSpawnStrategy` as the per-iteration `invocation` opt.
export {
  type BuildAiderInvocationOpts,
  type BuildClaudePrintInvocationOpts,
  type BuildOpencodeInvocationOpts,
  type LlmInvocation,
  DEFAULT_AIDER_MODEL,
  DEFAULT_AIDER_OPENAI_API_BASE,
  DEFAULT_AIDER_OPENAI_API_KEY,
  DEFAULT_OPENCODE_MODEL,
  buildAiderInvocation,
  buildClaudePrintInvocation,
  buildOpencodeInvocation,
} from "./llm-invocation.js";

// Slice 3 of `local-llm-fallback-on-budget-pause`: expose the wrapping
// SpawnStrategy that dispatches between claude / local based on
// `decideProvider(...)`.
export {
  type BudgetStateProbe,
  type LlmProviderSpawnStrategyOptions,
  LlmProviderSpawnStrategy,
  probeWithErrorGuard,
  synthesiseHoldResult,
} from "./llm-provider-spawn-strategy.js";

// Slice 2 of `daemon-parallel-worktree-launch`: per-worker namespacing
// helpers exposed for the CLI (`bin/tick-loop.mjs`) so it can parse
// `--worker-id` / `--workers-total` and announce parallel mode on startup.
export {
  type WorkerConfig,
  buildChildWorkerArgs,
  claudeArgsForWorker,
  parseSpawnAdditionalWorkers,
  parseWorkerArgs,
  workerBranchName,
  workerStartupLine,
  workerWorktreeName,
} from "./worker-config.js";

// Slice 3 of `daemon-parallel-worktree-launch`: per-task `**Touches**` glob
// parser + pre-spawn collision check. Consumed by the supervisor to refuse
// starting a worker on a task whose globs overlap an open daemon PR's file
// list (which would create a merge conflict at land time).
//
// Slice 4 wiring (this PR): `parseTouchesOrFiles` + `extractFilePathsFromFilesField`
// give the daemon a Files-fallback path so file-collision prevention works
// against the existing TASKS.md surface without a `**Touches**:` migration.
export {
  type CollisionDecision,
  type TouchesPrSnapshot,
  decideTouchesCollision,
  extractFilePathsFromFilesField,
  globMatchesPath,
  parseTouchesField,
  parseTouchesOrFiles,
} from "./touches-glob.js";

// Slice 4 of `daemon-parallel-worktree-launch`: I/O wrapper that snapshots
// open daemon-authored PRs via `gh pr list` for the per-tick collision
// check. The pure decision (`decideTouchesCollision`) lives next door;
// this module is the thin Strategy seam.
export {
  type CreateOpenPrFetcherInput,
  type OpenPrFetcher,
  createOpenPrFetcher,
  isDaemonAuthoredBranch,
  parseGhPrListJson,
} from "./touches-glob-fetch.js";

// `auto-scale-workers` (operator 2026-05-07): pure decision function for the
// "should the supervisor fork another worker?" question. Given a snapshot
// of state (currentWorkers, maxWorkers, eligibleTaskCount, budgetState,
// recent-failure / recent-collision counts) it returns spawn-or-hold with
// a structured reason.
export {
  AUTO_SCALE_RULES,
  type AutoScaleDecision,
  type AutoScaleState,
  decideAutoScale,
} from "./auto-scale-workers.js";

// `auto-scale-runner` (slice 2 of auto-scale-workers): I/O wrapper that
// observes iteration spans, tracks rolling counters, and calls
// `decideAutoScale` periodically. When the verdict is `spawn`, calls the
// injected spawn callback (production: `child_process.spawn` of another
// tick-loop process; tests: a synthetic stub).
export {
  AUTO_SCALE_RUNNER_DEFAULTS,
  AutoScaleRunner,
  type AutoScaleEventEmitter,
  type AutoScaleRunnerInput,
  type ObservableEvent,
  type SpawnCallback,
} from "./auto-scale-runner.js";

// Slice 4 of `daemon-parallel-worktree-launch`: pure decisions for the
// per-tick sweeper that recovers stale .git/index.lock files (Claude Code
// #11005), expired .minsky/locks/task-*.lock claims, and orphaned
// daemon-namespace worktrees. The I/O wrapper (slice 5 — `parallel-sweeper-runner.ts`)
// executes the unlinks + `git worktree prune` and emits the counters.
export {
  type ClaimLockSnapshot,
  type SweepDecision,
  type WorktreeSnapshot,
  decideExpiredClaim,
  decideOrphanedWorktree,
  decideStaleIndexLock,
  summarizeSweepDecisions,
} from "./parallel-sweeper.js";

// Slice 5 of `daemon-parallel-worktree-launch`: I/O wrapper that ticks
// the sweeper. Walks `.git/index.lock` (root + per-worktree) + claim
// leases under `.minsky/locks/`, calls the slice-4 decisions, unlinks
// stale debris. The bin wires this on every iteration's start so a
// crashed worker's debris doesn't gate the next tick.
export {
  type SweeperIo,
  type SweeperRunInput,
  type SweeperTickResult,
  runParallelSweeper,
} from "./parallel-sweeper-runner.js";

// Operator-CLI ergonomics (2026-05-06): pretty-format the daemon's
// structured `[span] tick-loop.iteration {…}` lines into glanceable
// one-liners. Used by `bin/minsky.mjs`'s `start` and `logs` subcommands.
export { type FormatOpts, formatLogLine } from "./pretty-log.js";

// Daemon self-config analyzer (operator 2026-05-06): pure decision
// function that surfaces "you should turn this on" recommendations at
// daemon startup, and the formatter that renders them as one-line
// operator-facing log entries.
export {
  type ConfigContext,
  type ConfigRecommendation,
  type ImpactCategory,
  type RecommendationKind,
  analyzeConfig,
  formatRecommendations,
} from "./config-analyzer.js";

// Pre-PR lint-stack gate (TASKS.md `daemon-pre-pr-lint-gate`): TypeScript
// API for the gate the daemon's brief already mandates as text instructions.
// `runPrePrLintGate` retries up to 3× (injectable `PrePrLintRun` seam);
// `shouldRunPrePrLintGate` short-circuits on `Blocked: pre-pr-lint-failures`.
// Production binding: `createPnpmPrePrLintRun` spawns the canonical manifest
// (`scripts/run-pre-pr-lint-stack.mjs --json`) — same script `pnpm pre-pr-lint`
// and `lefthook pre-push` invoke (rule #10 deterministic enforcement).
export {
  type BodyAwarePrePrLintRunOptions,
  type PnpmPrePrLintRunOptions,
  type PrePrLintGateResult,
  type PrePrLintRun,
  type PrePrLintRunResult,
  type RunPrePrLintGateArgs,
  createBodyAwarePrePrLintRun,
  createPnpmPrePrLintRun,
  runPrePrLintGate,
  shouldRunPrePrLintGate,
} from "./pre-pr-lint-gate.js";

// Supervisor-sandbox mode resolver (vision.md § 13.3 — supervisor sandbox,
// the third minimum-bar item of rule #13). Slice 2 of
// `supervisor-sandbox-syscall-restriction`: `bin/tick-loop.mjs`'s startup
// banner consumes `sandboxModeStartupHint` so the resolved `MINSKY_SANDBOX`
// mode + any typo warning surface in the supervisor log at boot.
// Substrate-inert until slice 3+ wires the actual sandbox profile.
export {
  SANDBOX_MODE_DEFAULT,
  SANDBOX_MODE_ENV,
  type SandboxMode,
  resolveSandboxMode,
  sandboxModeStartupHint,
  sandboxModeWarning,
} from "./sandbox-mode.js";

// Daemon duplicate-work detection (P0 watchdog from #346, operator 2026-05-07):
// pure decision consulted by the daemon BEFORE `gh pr create` to avoid
// re-creating already-shipped/in-flight work. Surfaced-by 9h dogfood window
// 2026-05-06/07 (worker-1's #343 was a dup of merged #309).
export {
  type DuplicateDecision,
  type PrSnapshot,
  decideDuplicate,
  prTitleNamesTask,
} from "./duplicate-pr-detector.js";

// Daemon fix-own-PR-on-CI-failure detector (P0 task `daemon-fix-own-pr-on-ci-failure`,
// operator-flagged 2026-05-05): pure decision the daemon consults BEFORE building
// the iteration brief — no-pr / pr-clean / pr-failing / pr-retries-exhausted.
// Closes the 80+-iteration deadlock observed on PR #167 (`cross-repo-ci-action`)
// where the daemon couldn't merge a PR with red CI and had no path to fix it.
export {
  type CheckRunSnapshot,
  type DaemonOwnPrSnapshot,
  type DaemonPrStateVerdict,
  type DecideDaemonPrStateInput,
  decideDaemonPrState,
  isFailingConclusion,
  parseGhPrListForDaemonPrState,
} from "./daemon-pr-state.js";

// Daemon task-completion detector (P0 watchdog from #346, operator 2026-05-07):
// pure decision the daemon consults to auto-remove TASKS.md task blocks once
// their substrate has shipped (≥1 merged PR + Acceptance field has no
// unchecked boxes). Surfaced-by 9h dogfood window 2026-05-06/07 (worker-1
// kept re-picking `daemon-pre-pr-lint-gate` for 3h after #309 had merged).
export {
  type MergedPrSnapshot,
  type TaskCompletionVerdict,
  decideTaskCompletion,
  titleNamesTask,
} from "./task-completion-detector.js";

// Local-LLM auto-bootstrap (P0 from operator 2026-05-08, "git pull && minsky"
// UX target): pure detect + plan functions plus the executor that dispatches
// pipx / mlx-lm / aider / huggingface-cli / mlx_lm.server installs in
// dependency order, with one operator-facing confirm prompt. Slice 1-3 of
// `minsky-cli-auto-bootstrap-local-llm`.
export {
  type BootstrapPlan,
  type BootstrapPlanOptions,
  type BootstrapStepType,
  type ComponentState,
  type DetectProbes,
  DEFAULT_LOCAL_LLM_MODEL,
  DEFAULT_LOCAL_LLM_PROBE_URL,
  DEFAULT_MODEL_DOWNLOAD_MB,
  type InstallStep,
  type LocalLlmStackState,
  type ServerState,
  detectLocalLlmStack,
  planLocalLlmBootstrap,
  planRequiresTty,
  summarisePlan,
} from "./local-llm-bootstrap.js";
export {
  type ConfirmFn,
  type ExecuteOpts,
  type ExecuteResult,
  type ExecuteSpawnResult,
  type LogFn,
  type SpawnFn,
  confirmAlwaysNo,
  confirmAlwaysYes,
  executeBootstrapPlan,
  renderConfirmSummary,
} from "./local-llm-bootstrap-executor.js";
export {
  type BootstrapLocalLlmArgs,
  parseBootstrapLocalLlmArgs,
} from "./bootstrap-local-llm-args.js";
export {
  type ExistsSyncFn,
  type FetchFn,
  PYTHON_CANDIDATES,
  type WhichFn,
  buildExistsProbe,
  buildModelProbe,
  buildProductionProbes,
  buildServerProbe,
  buildWhichProbe,
  modelCachePath,
  probePythonWithDefaults,
  selectPythonPath,
} from "./local-llm-probes.js";

// Real `claude --print` probe — used by `bin/minsky.mjs` to detect
// "credits exhausted" vs "binary missing" vs "healthy" so the
// auto-bootstrap pre-flight fires when the operator's machine cannot
// actually use claude (not just when the binary is missing). Slice 4
// of `minsky-cli-auto-bootstrap-local-llm`.
export {
  type ClaudeHealthDecision,
  type ClaudeHealthVerdict,
  type ClaudeProbeOutput,
  classifyClaudeProbeOutput,
  needsLocalLlmBootstrap,
} from "./claude-health-probe.js";

// Slice 6 of `minsky-cli-arch-detection`: architecture detection for
// the local-LLM bootstrap. Catches x86_64-on-Apple-Silicon (Rosetta)
// and missing `/opt/homebrew/` so the planner can prepend the
// install-arm-homebrew step and route downstream commands through
// absolute `/opt/homebrew/bin/...` paths.
export {
  type ArchProbes,
  type ArchState,
  type HardwareArch,
  type ShellArch,
  describeArchState,
  detectArchState,
  needsArmHomebrewInstall,
  preferredBrewPath,
  preferredPipxPath,
  preferredPythonPath,
} from "./arch-probe.js";

// Slice 1 of `minsky-fresh-clone-health-checks`: pure pre-flight
// check that `node_modules/` exists, plus the doctor-substrate row
// renderer (4 new doctor rows: node_modules / pnpm-lock.yaml /
// dist/index.js / pnpm-on-PATH).
export {
  type NodeModulesCheckOutcome,
  checkNodeModulesExists,
  formatNodeModulesMissingMessage,
} from "./node-modules-existence-check.js";
export {
  type DoctorSubstrateRowState,
  renderDoctorSubstrateRows,
} from "./doctor-substrate-rows.js";

// Slice 2 of `minsky-runtime-resilience`: three pure helpers that
// graceful-degrade or loud-crash at the right boundary on the three
// runtime I/O failure modes.
//   - log-path-fallback: primary log path → tmp on EACCES/EROFS/ENOSPC
//   - workers-dir-mkdir: classify mkdir errnos into recovery hints
//   - tick-loop-bin-existence-check: defensive check before spawn
export { type LogPathOutcome, pickLogPath } from "./log-path-fallback.js";
export {
  type WorkersDirMkdirOutcome,
  ensureWorkersDir,
  formatWorkersDirRecoveryMessage,
} from "./workers-dir-mkdir.js";
export {
  type TickLoopBinCheckOutcome,
  checkTickLoopBinExists,
  formatTickLoopBinMissingMessage,
} from "./tick-loop-bin-existence-check.js";

// Slice 3 of `minsky-cross-machine-dotfile-checks`: pure detect-and-
// report helper for git config keys that point at filesystem paths
// synchronised across machines via dotfiles. Generalises PRs #394/
// #395's lefthook permission-denial fix to the broader set of
// dotfile-controlled git config keys.
export {
  type BrokenGitConfigPath,
  type GitConfigCheckOutcome,
  type GitConfigOrigin,
  type GitConfigValue,
  PATH_CONFIG_KEYS,
  checkGitConfigPaths,
  formatBrokenPathMessage,
} from "./git-config-path-checks.js";

// Slice 4 of `minsky-claude-exhaustion-persisted-state`: read/write
// `.minsky/state.json::last_claude_hard_limit` so a fresh `minsky`
// startup detects exhaustion without relying on the token-too-small
// live probe. Composes with the in-process per-iteration
// `decideProvider` logic.
export {
  type ReadHardLimitOutcome,
  readLastHardLimit,
  writeLastHardLimit,
} from "./claude-exhaustion-state.js";
