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
  type RunDaemonOpts,
  type SnapshotSeam,
  claim,
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
// existence-probe + capture seams; the daemon wire-in and CLI-side
// construction (production: spawns `pnpm changelog:snapshot`) land in
// follow-ups, mirroring the #181 → #182 → #183 split for `runChangelog`.
export {
  type RunSnapshotArgs,
  type RunSnapshotOutcome,
  type SnapshotCapture,
  type SnapshotExists,
  type SnapshotSkipReason,
  runSnapshot,
  shouldRunSnapshot,
} from "./snapshot-runner.js";

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
  type ExecFileLike,
  type SignalsBuilderArgs,
  createFileBackedCtoAuditLock,
  createGitGhSignalsBuilder,
  extractPrUrl,
  parseFilesChangedFromGit,
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
