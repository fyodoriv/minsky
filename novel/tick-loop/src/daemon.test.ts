/**
 * Tests for `@minsky/tick-loop/daemon` — sub-task `tick-loop-daemon-v0`.
 *
 * Coverage targets (parent task Verification cell):
 *   1. Happy path: 4-iteration dry-run completes against a synthetic fixture.
 *   2. PAUSED sentinel honored within 1 iteration.
 *   3. Missing TASKS.md graceful exit.
 *   4. Budget-guard PAUSE skips iteration with logged advisory.
 *   5. Mock-anthropic 5xx → release-on-failure (status: 'failed').
 *   6. max-iterations cap respected.
 *   7. Throws on `dryRun: false`.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BudgetGuard } from "@minsky/budget-guard";
import { StubTokenMonitor } from "@minsky/token-monitor";
import { describe, expect, it } from "vitest";

import { fromRealBudgetGuard } from "./budget-guard-facade.js";
import type { ChangelogSpawn, ReadChangelog } from "./changelog-runner.js";
import {
  type BudgetDecisionLike,
  type BudgetGuardLike,
  type ChangelogSeam,
  type CtoAuditSeam,
  type MetricsRenderSeam,
  type SnapshotSeam,
  buildDaemonBrief,
  extractOpenP0TaskIds,
  extractTaskBlock,
  pickTask,
  runDaemon,
} from "./daemon.js";
import { SpanRecorder, TestFakeMockAnthropic, type TickSpan } from "./index.js";
import type { GetLastRenderedDate, MetricsRender } from "./metrics-render-runner.js";
import type {
  CompletedIterationSignals,
  CtoAuditLock,
  CtoAuditSpawn,
} from "./post-task-cto-audit.js";
import type { SnapshotCapture, SnapshotExists } from "./snapshot-runner.js";
import {
  DryRunSpawnStrategy,
  ProcessSpawnStrategy,
  type SpawnInput,
  type SpawnStrategy,
} from "./spawn-strategy.js";

// ---- Parsers used by the brief↔manifest fast-stage drift test (slice 22/N) -
// Lifted to module scope so the test body's cognitive complexity stays under
// biome's noExcessiveCognitiveComplexity ceiling (max 10). Same shape as the
// extractor helpers in scripts/run-pre-pr-lint-stack.test.mjs (slice 17/N): a
// pure regex parse over a source string the repo owns.

/**
 * Parse `STACK_MANIFEST` entries from `scripts/run-pre-pr-lint-stack.mjs` and
 * return the set of step names whose `stages:` array includes `"fast"`.
 */
function extractManifestFastStageNames(src: string): Set<string> {
  const stepRegex = /\{\s*name:\s*"([^"]+)",\s*stages:\s*\[([^\]]+)\]/g;
  const out = new Set<string>();
  for (const match of src.matchAll(stepRegex)) {
    const name = match[1];
    const stages = match[2];
    if (name !== undefined && stages !== undefined && /"fast"/.test(stages)) {
      out.add(name);
    }
  }
  return out;
}

/**
 * Extract the backtick-quoted step names from the brief's "Red →" bullet's
 * parenthesized enumeration: `... names the exact failing step (\`a\` /
 * \`b\` / ...)`. Returns an empty set if the bullet isn't found — callers
 * combine that with set-equality to surface the failure (a missing-bullet
 * brief produces `missingFromBrief = <every fast step>`).
 */
function extractBriefRedBulletNames(brief: string): Set<string> {
  const enumMatch = /names the exact failing step \(([^)]+)\)/.exec(brief);
  const out = new Set<string>();
  for (const m of (enumMatch?.[1] ?? "").matchAll(/`([a-z][a-z0-9-]*)`/g)) {
    if (m[1] !== undefined) out.add(m[1]);
  }
  return out;
}

/**
 * Extract the noop-exit token prefix from the brief's `noop, exiting —
 * TOKEN: <PLACEHOLDER>` instruction and return it with the trailing colon
 * (e.g., `pre-pr-lint-failures:`). The token is the load-bearing string
 * the daemon emits to stdout when the gate stays red after 3 retries; the
 * docs and the self-diagnose invariant's `suggestedFix` both tell operators
 * to grep `.minsky/tick-loop.out.log` for this exact prefix. Slice 24/N
 * pins all three surfaces equal — see the parity test below for the
 * mutation-test rationale.
 */
function extractBriefNoopExitTokenPrefix(brief: string): string {
  const m = /noop, exiting — ([a-z0-9-]+):/.exec(brief);
  if (m === null || m[1] === undefined) {
    throw new Error("brief: missing `noop, exiting — TOKEN:` noop-exit instruction");
  }
  return `${m[1]}:`;
}

/**
 * Slice 29/N: pull the `## Pre-PR lint-stack gate` body out of the brief so
 * parity tests on the gate's contents don't accidentally pass on a token
 * appearing in a sibling section (e.g., the PR self-grade or security-review
 * templates further down the brief). Section bounded by its `##` heading and
 * the next `##` heading.
 */
function extractGateSection(brief: string): string {
  const start = brief.indexOf("## Pre-PR lint-stack gate");
  if (start === -1) throw new Error("brief: missing `## Pre-PR lint-stack gate` heading");
  const tail = brief.slice(start);
  const nextH2 = tail.slice(2).search(/\n## /);
  return nextH2 === -1 ? tail : tail.slice(0, 2 + nextH2);
}

// ---- Fixtures -------------------------------------------------------------

const FIXTURE_TASKS_MD = `# Tasks

## P0

- [ ] \`alpha\` — alpha task
  - **ID**: alpha
  - **Tags**: novel
  - **Estimate**: 1h
  - **Hypothesis**: alpha completes via mock.

- [ ] \`beta\` — beta task
  - **ID**: beta
  - **Tags**: novel
  - **Estimate**: 1h
  - **Hypothesis**: beta completes via mock.

- [ ] \`gamma\` — gamma task
  - **ID**: gamma
  - **Tags**: novel
  - **Estimate**: 1h
  - **Hypothesis**: gamma completes via mock.

- [ ] \`delta\` — delta task
  - **ID**: delta
  - **Tags**: novel
  - **Estimate**: 1h
  - **Hypothesis**: delta completes via mock.

## P2

- [ ] \`p2-task\` — should not be picked
  - **ID**: p2-task
  - **Hypothesis**: never picked.
`;

const FIXTURE_WITH_BLOCKED = `# Tasks

## P0

- [ ] \`first\` — has Blocked-by, must be skipped
  - **ID**: first
  - **Blocked by**: some-other-task
  - **Hypothesis**: blocked.

- [ ] \`second\` — first unblocked
  - **ID**: second
  - **Hypothesis**: ready.
`;

// Regression fixture for `tick-loop-picktask-honors-blocked-field`: the
// `**Blocked**:` field (external-constraint blocker — distinct from
// `**Blocked by**:`) must disqualify a task from autonomous pickup. This
// is the safety surface that prevents the daemon from spawning claude
// against tasks like `omc-tasksmd-issue` (Blocked: needs-user-approval),
// which would file a public GitHub issue without user approval.
const FIXTURE_WITH_BLOCKED_FIELD = `# Tasks

## P0

- [ ] \`needs-approval\` — has Blocked field, must be skipped
  - **ID**: needs-approval
  - **Blocked**: needs-user-approval — third-party action requires opt-in
  - **Hypothesis**: blocked-by-default per /next-task skill.

- [ ] \`ready\` — fully unblocked
  - **ID**: ready
  - **Hypothesis**: ready.
`;

const FIXTURE_WITH_CLAIMED = `# Tasks

## P0

- [ ] \`first\` — already claimed (@minsky-tick-loop)
  - **ID**: first
  - **Hypothesis**: in-flight.

- [ ] \`second\` — next available
  - **ID**: second
  - **Hypothesis**: ready.
`;

function normalBudgetGuard(): BudgetGuardLike {
  return {
    decide: (): BudgetDecisionLike => ({ action: "normal", reason: "within thresholds" }),
  };
}

function pausingBudgetGuard(): BudgetGuardLike {
  return {
    decide: (): BudgetDecisionLike => ({
      action: "circuit-break-and-notify",
      reason: "5h window 90% consumed",
    }),
  };
}

function staticReader(content: string): () => string {
  return () => content;
}

function noPaused(): () => boolean {
  return () => false;
}

function pausedNow(): () => boolean {
  return () => true;
}

const noSleep = async (_ms: number): Promise<void> => {
  /* immediate — deterministic tests */
};

// ---- Tests ----------------------------------------------------------------

describe("tick-loop / daemon / runDaemon", () => {
  it("happy path: 4-iteration dry-run completes against synthetic fixture", async () => {
    const client = new TestFakeMockAnthropic();
    const recorder = new SpanRecorder();
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 4,
      dryRun: true,
      mockClient: client,
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      emit: (e: TickSpan) => recorder.record(e),
    });
    expect(result.totalIterations).toBe(4);
    expect(result.stoppedReason).toBe("max-iterations");
    // Every iteration should have completed (the fixture stays the same; in
    // production the persisted claim would advance the picker — v0 is
    // in-memory-only per the brief).
    expect(result.iterations.every((i) => i.status === "completed")).toBe(true);
    // Both per-iteration parent spans AND per-tick child spans recorded.
    const iterationSpans = recorder.spans.filter((s) => s.name === "tick-loop.iteration");
    const tickSpans = recorder.spans.filter((s) => s.name === "tick-loop.tick");
    expect(iterationSpans).toHaveLength(4);
    expect(tickSpans).toHaveLength(4);
  });

  it("honors state/PAUSED sentinel within 1 iteration", async () => {
    const client = new TestFakeMockAnthropic();
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 3,
      dryRun: true,
      mockClient: client,
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: pausedNow(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
    });
    expect(result.totalIterations).toBe(3);
    expect(result.iterations.every((i) => i.status === "paused")).toBe(true);
    expect(result.iterations[0]?.reason).toContain("PAUSED");
  });

  it("graceful exit on missing TASKS.md (ENOENT)", async () => {
    const missingReader = (): string => {
      const err = new Error("ENOENT: no such file or directory");
      (err as Error & { code?: string }).code = "ENOENT";
      throw err;
    };
    const client = new TestFakeMockAnthropic();
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 5,
      dryRun: true,
      mockClient: client,
      tasksMdReader: missingReader,
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
    });
    expect(result.totalIterations).toBe(1);
    expect(result.stoppedReason).toBe("missing-tasks-md");
    expect(result.iterations[0]?.status).toBe("missing-tasks-md");
  });

  it("budget-guard circuit-break skips iteration with logged advisory", async () => {
    const client = new TestFakeMockAnthropic();
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 2,
      dryRun: true,
      mockClient: client,
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: pausingBudgetGuard(),
      sleep: noSleep,
    });
    expect(result.iterations.every((i) => i.status === "budget-paused")).toBe(true);
    expect(result.iterations[0]?.reason).toContain("circuit-break");
  });

  it("budget-paused fires exactly 1 notifier push across 3 paused iterations (debounce on transition)", async () => {
    const pushCalls: Array<{ title: string; body: string; tags?: readonly string[] }> = [];
    const stubNotifier = {
      push: async (n: { title: string; body: string; tags?: readonly string[] }) => {
        pushCalls.push(n);
        return { ok: true };
      },
    };
    const client = new TestFakeMockAnthropic();
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 3,
      dryRun: true,
      mockClient: client,
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: pausingBudgetGuard(),
      notifier: stubNotifier,
      sleep: noSleep,
    });
    // All 3 iterations are budget-paused.
    expect(result.iterations.every((i) => i.status === "budget-paused")).toBe(true);
    // But the notifier fires EXACTLY ONCE — debounced on the entry transition.
    // Without the debounce, the operator would get a push every 5 minutes
    // for as long as the 5h budget window stays exhausted (catastrophic spam).
    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0]?.title).toContain("paused");
    expect(pushCalls[0]?.body).toContain("circuit-break");
    expect(pushCalls[0]?.tags).toEqual(["pause", "budget"]);
  });

  it("budget-paused → recovery → re-pause fires 2 notifier pushes (re-arm after exit)", async () => {
    const pushCalls: Array<{ title: string }> = [];
    const stubNotifier = {
      push: async (n: { title: string; body: string }) => {
        pushCalls.push({ title: n.title });
        return { ok: true };
      },
    };
    // Sequenced budget-guard: paused → normal → paused → normal.
    let call = 0;
    const sequencedGuard: BudgetGuardLike = {
      decide: (): BudgetDecisionLike => {
        const sequence: BudgetDecisionLike[] = [
          { action: "circuit-break-and-notify", reason: "5h window 90% consumed (entry 1)" },
          { action: "normal", reason: "within thresholds (recovery 1)" },
          { action: "circuit-break-and-notify", reason: "5h window 90% consumed (entry 2)" },
          { action: "normal", reason: "within thresholds (recovery 2)" },
        ];
        const decision = sequence[call] ?? { action: "normal", reason: "fallthrough" };
        call += 1;
        return decision;
      },
    };
    const client = new TestFakeMockAnthropic();
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 4,
      dryRun: true,
      mockClient: client,
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: sequencedGuard,
      notifier: stubNotifier,
      sleep: noSleep,
    });
    // 2 distinct pause events → 2 pushes (the recovery in between re-arms
    // the trigger; otherwise the second pause would silently coalesce).
    expect(result.iterations[0]?.status).toBe("budget-paused");
    expect(result.iterations[1]?.status).not.toBe("budget-paused");
    expect(result.iterations[2]?.status).toBe("budget-paused");
    expect(pushCalls).toHaveLength(2);
  });

  it("budget-paused with no notifier injected emits the span but does not throw", async () => {
    const client = new TestFakeMockAnthropic();
    const recorder = new SpanRecorder();
    // No `notifier` field — the daemon must not throw and must still
    // record the span. Pre-existing daemons predating this seam should
    // keep working.
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 2,
      dryRun: true,
      mockClient: client,
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: pausingBudgetGuard(),
      sleep: noSleep,
      emit: (event) => recorder.record(event),
    });
    expect(result.iterations.every((i) => i.status === "budget-paused")).toBe(true);
    expect(recorder.spans.some((e) => e.attributes["iteration.status"] === "budget-paused")).toBe(
      true,
    );
  });

  it("mock-anthropic 5xx → iteration status: 'failed' (release-on-failure)", async () => {
    const client = new TestFakeMockAnthropic({ failureMode: "http-5xx" });
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: client,
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
    });
    expect(result.iterations).toHaveLength(1);
    expect(result.iterations[0]?.status).toBe("failed");
    expect(result.iterations[0]?.reason).toContain("5xx");
  });

  it("respects --max-iterations cap", async () => {
    const client = new TestFakeMockAnthropic();
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 2,
      dryRun: true,
      mockClient: client,
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
    });
    expect(result.totalIterations).toBe(2);
    expect(result.stoppedReason).toBe("max-iterations");
  });

  it("throws on dryRun: false WITHOUT a SpawnStrategy injected (v0 production guardrail preserved)", async () => {
    const client = new TestFakeMockAnthropic();
    await expect(
      runDaemon({
        tickInterval: 0,
        maxIterations: 1,
        dryRun: false,
        mockClient: client,
        tasksMdReader: staticReader(FIXTURE_TASKS_MD),
        pausedSentinelReader: noPaused(),
        budgetGuard: normalBudgetGuard(),
        sleep: noSleep,
      }),
    ).rejects.toThrow(/real subprocess spawning is deferred/);
  });

  // Sub-task 3/3 (`tick-loop-daemon-real-spawn-flip`): with an explicit
  // `DryRunSpawnStrategy` injected, `dryRun: false` no longer throws — the
  // Strategy IS the spawn-step seam. This is the new opt-in shape after the
  // flip: the CLI passes the env-decided Strategy and the legacy throw fires
  // ONLY when neither dry-run nor a Strategy is set (the v0 guardrail).
  it("dryRun: false with DryRunSpawnStrategy injected dispatches via Strategy (no throw)", async () => {
    const client = new TestFakeMockAnthropic();
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 2,
      dryRun: false,
      mockClient: client,
      spawnStrategy: new DryRunSpawnStrategy(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
    });
    expect(result.totalIterations).toBe(2);
    expect(result.iterations.every((i) => i.status === "completed")).toBe(true);
  });

  // Sub-task 2/3 (`tick-loop-daemon-budget-guard-real`): drives the real
  // `BudgetGuard` from `@minsky/budget-guard` (wrapped via the facade
  // pivot) against a fixture `StubTokenMonitor`. Asserts that a snapshot
  // past the 85 % circuit-break threshold flips the daemon to
  // `budget-paused`, while a fresh window keeps it on the happy path.
  it("real BudgetGuard wired via facade: circuit-break flips iteration to budget-paused", async () => {
    const monitor = new StubTokenMonitor({
      tokensRemainingInWindow: 100_000,
      windowSizeTokens: 1_000_000,
      // 90 % consumed → ≥ 85 % → circuit-break-and-notify
    });
    const realGuard = new BudgetGuard(monitor, () => {
      /* no-op */
    });
    const guard: BudgetGuardLike = fromRealBudgetGuard(realGuard);
    const client = new TestFakeMockAnthropic();
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 2,
      dryRun: true,
      mockClient: client,
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: guard,
      sleep: noSleep,
    });
    expect(result.iterations.every((i) => i.status === "budget-paused")).toBe(true);
    expect(result.iterations[0]?.reason).toContain("circuit-break");
    // Now the same daemon, same fixture, but a fresh window → normal action,
    // tick proceeds to completion.
    const freshMonitor = new StubTokenMonitor({
      tokensRemainingInWindow: 1_000_000,
      windowSizeTokens: 1_000_000,
    });
    const freshGuard = fromRealBudgetGuard(
      new BudgetGuard(freshMonitor, () => {
        /* no-op */
      }),
    );
    const happy = await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: freshGuard,
      sleep: noSleep,
    });
    expect(happy.iterations[0]?.status).toBe("completed");
  });

  // Sub-task 3/3 (`tick-loop-daemon-real-spawn-flip`): the integration test.
  // Drives `runDaemon` with a real `ProcessSpawnStrategy` against a synthetic
  // task fixture and asserts the subprocess started, the exitCode is
  // populated, and at least one OTEL `tick-loop.iteration` span was emitted.
  // Gated on `claude` being on PATH — skipped in CI where it isn't installed.
  // The Strategy is constructed with `process.execPath` (node) instead of
  // `claude` so the test is hermetic, but the gate proves the same wiring
  // works on a host with the real CLI; the production CLI uses
  // `command: 'claude'` (see `bin/tick-loop.mjs`). The rationale for the
  // gate convention is documented in `vision.md` row 67.
  const hasClaude = (() => {
    try {
      execSync("which claude", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  it.skipIf(!hasClaude)(
    "real ProcessSpawnStrategy: subprocess started, exitCode populated, OTEL span emitted",
    async () => {
      // Use `node -e 'process.exit(0)'` as a stand-in so the assertion is
      // deterministic regardless of which `claude` build is on PATH; the
      // gate proves the host has `claude` available, the body proves the
      // Strategy + daemon dispatch wiring shells out and resolves.
      const strat = new ProcessSpawnStrategy({
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
      });
      const recorder = new SpanRecorder();
      const result = await runDaemon({
        tickInterval: 0,
        maxIterations: 1,
        dryRun: false,
        mockClient: new TestFakeMockAnthropic(),
        spawnStrategy: strat,
        tasksMdReader: staticReader(FIXTURE_TASKS_MD),
        pausedSentinelReader: noPaused(),
        budgetGuard: normalBudgetGuard(),
        sleep: noSleep,
        emit: (e: TickSpan) => recorder.record(e),
      });
      expect(result.totalIterations).toBe(1);
      expect(result.iterations[0]?.status).toBe("completed");
      expect(result.iterations[0]?.taskId).toBe("alpha");
      const iterationSpans = recorder.spans.filter((s) => s.name === "tick-loop.iteration");
      expect(iterationSpans.length).toBeGreaterThanOrEqual(1);
    },
  );

  it("sleeps tickInterval between iterations (but not after the last)", async () => {
    const client = new TestFakeMockAnthropic();
    const sleepCalls: number[] = [];
    const recordSleep = async (ms: number): Promise<void> => {
      sleepCalls.push(ms);
    };
    await runDaemon({
      tickInterval: 250,
      maxIterations: 3,
      dryRun: true,
      mockClient: client,
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: recordSleep,
    });
    // 3 iterations → 2 inter-iteration sleeps.
    expect(sleepCalls).toEqual([250, 250]);
  });

  // ---- post-task CTO audit wire-in ---------------------------------------
  //
  // These tests cover the wire-in in `runDaemon` → `maybeRunCtoAudit`. The
  // audit's own gate / no-recurse / lock semantics are tested in
  // `post-task-cto-audit.test.ts`; here we only verify that the daemon
  // dispatches into `runCtoAudit` for the right iteration shapes and
  // emits the `tick-loop.cto-audit` span.

  /**
   * Build a `CtoAuditSeam` whose `spawn` and `buildSignals` record their
   * calls so tests can assert dispatch.
   */
  function makeAuditSeam(
    opts: {
      readonly initialLocks?: readonly string[];
      readonly buildSignalsOverride?: (args: {
        taskId: string;
        spawnStdoutTail: string;
      }) => Partial<CompletedIterationSignals>;
    } = {},
  ): {
    readonly seam: CtoAuditSeam;
    readonly spawnCalls: Array<{ taskId: string; brief: string }>;
    readonly buildSignalsCalls: Array<{ taskId: string; spawnStdoutTail: string }>;
    readonly heldLocks: Set<string>;
  } {
    const spawnCalls: Array<{ taskId: string; brief: string }> = [];
    const buildSignalsCalls: Array<{ taskId: string; spawnStdoutTail: string }> = [];
    const heldLocks = new Set<string>(opts.initialLocks ?? []);
    const spawn: CtoAuditSpawn = {
      spawn: async (input) => {
        spawnCalls.push({ taskId: input.taskId, brief: input.brief });
        return { exitCode: 0, durationMs: 5, stdoutTail: "audit ran", stderrTail: "" };
      },
    };
    const lock: CtoAuditLock = {
      lockExists: (taskId) => heldLocks.has(taskId),
      acquireLock: (taskId) => {
        heldLocks.add(taskId);
      },
    };
    const buildSignals: CtoAuditSeam["buildSignals"] = async (args) => {
      buildSignalsCalls.push({ taskId: args.taskId, spawnStdoutTail: args.spawnStdoutTail });
      const baseline: CompletedIterationSignals = {
        completedTaskId: args.taskId,
        prUrl: "https://github.com/fyodoriv/minsky/pull/999",
        filesChanged: ["src/foo.ts"],
        recentMainCommits: ["feat: shipped"],
        openWorkItems: 0,
        lintScores: {},
      };
      const override = opts.buildSignalsOverride?.(args) ?? {};
      return { ...baseline, ...override };
    };
    return { seam: { spawn, lock, buildSignals }, spawnCalls, buildSignalsCalls, heldLocks };
  }

  it("ctoAudit wire-in: completed iteration triggers the audit spawn + emits a cto-audit span", async () => {
    const recorder = new SpanRecorder();
    const audit = makeAuditSeam();
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      emit: (e: TickSpan) => recorder.record(e),
      ctoAudit: audit.seam,
    });
    expect(result.iterations[0]?.status).toBe("completed");
    expect(audit.spawnCalls).toHaveLength(1);
    expect(audit.spawnCalls[0]?.taskId).toBe("cto-audit:alpha");
    expect(audit.buildSignalsCalls).toHaveLength(1);
    expect(audit.buildSignalsCalls[0]?.taskId).toBe("alpha");
    expect(audit.heldLocks.has("alpha")).toBe(true);
    const auditSpans = recorder.spans.filter((s) => s.name === "tick-loop.cto-audit");
    expect(auditSpans).toHaveLength(1);
    expect(auditSpans[0]?.attributes["audit.outcome"]).toBe("ran");
    expect(auditSpans[0]?.attributes["task.id"]).toBe("alpha");
  });

  it("ctoAudit wire-in: failed iteration does NOT trigger the audit (gate skip pre-buildSignals)", async () => {
    const audit = makeAuditSeam();
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic({ failureMode: "http-5xx" }),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      ctoAudit: audit.seam,
    });
    expect(result.iterations[0]?.status).toBe("failed");
    // No audit spawn AND no buildSignals call — the daemon short-circuits
    // before invoking the (potentially expensive) git/gh I/O surface when
    // the iteration didn't ship.
    expect(audit.spawnCalls).toHaveLength(0);
    expect(audit.buildSignalsCalls).toHaveLength(0);
  });

  it("ctoAudit wire-in: budget-paused iteration does NOT trigger the audit", async () => {
    const audit = makeAuditSeam();
    await runDaemon({
      tickInterval: 0,
      maxIterations: 2,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: pausingBudgetGuard(),
      sleep: noSleep,
      ctoAudit: audit.seam,
    });
    expect(audit.spawnCalls).toHaveLength(0);
    expect(audit.buildSignalsCalls).toHaveLength(0);
  });

  it("ctoAudit wire-in: gate-skipped audit (no files + no PR) emits a skipped span", async () => {
    const recorder = new SpanRecorder();
    // The signals collector returns a no-op shape (no files, no PR) so the
    // audit's gate (`shouldRunCtoAudit`) skips with `gate-rejected`.
    const audit = makeAuditSeam({
      buildSignalsOverride: () => ({ filesChanged: [], prUrl: null }),
    });
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      emit: (e: TickSpan) => recorder.record(e),
      ctoAudit: audit.seam,
    });
    expect(audit.spawnCalls).toHaveLength(0);
    expect(audit.buildSignalsCalls).toHaveLength(1);
    const auditSpans = recorder.spans.filter((s) => s.name === "tick-loop.cto-audit");
    expect(auditSpans).toHaveLength(1);
    expect(auditSpans[0]?.attributes["audit.outcome"]).toBe("skipped");
    expect(auditSpans[0]?.attributes["audit.skip_reason"]).toBe("gate-rejected");
  });

  it("ctoAudit wire-in: omitted seam (production daemons predating the seam) keeps working unchanged", async () => {
    // No `ctoAudit` field — the daemon must complete iterations without
    // throwing and without emitting any audit spans.
    const recorder = new SpanRecorder();
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 2,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      emit: (e: TickSpan) => recorder.record(e),
    });
    expect(result.iterations.every((i) => i.status === "completed")).toBe(true);
    const auditSpans = recorder.spans.filter((s) => s.name === "tick-loop.cto-audit");
    expect(auditSpans).toHaveLength(0);
  });

  it("ctoAudit wire-in: spawnStdoutTail threads through from the iteration's reason field", async () => {
    // The `result.reason` for completed iterations carries the spawn's
    // stdoutTail — the audit's `buildSignals` collector parses PR URLs
    // out of this in production. Verify the value reaches buildSignals.
    let captured = "";
    const audit = makeAuditSeam({
      buildSignalsOverride: ({ spawnStdoutTail }) => {
        captured = spawnStdoutTail;
        return {};
      },
    });
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: false,
      spawnStrategy: new DryRunSpawnStrategy(),
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      ctoAudit: audit.seam,
    });
    // `DryRunSpawnStrategy` returns `daemon dry-run prompt for ${taskId}` as
    // its stdoutTail, which the daemon's `runClaimedIteration` puts in
    // `result.reason` for completed iterations.
    expect(captured).toContain("alpha");
  });

  // ---- daily-changelog wire-in -------------------------------------------
  //
  // These tests cover the wire-in in `runDaemon` → `maybeRunChangelog`. The
  // runner's own gate / prompt / dispatch semantics are tested in
  // `changelog-runner.test.ts`; here we only verify that the daemon
  // dispatches into `runChangelog` for the right iteration shapes,
  // skips for the operator-quiet states, and emits the
  // `tick-loop.changelog` span.

  /**
   * Build a `ChangelogSeam` whose `spawn` and `readChangelog` record their
   * calls. `content` is what `readChangelog` returns; defaults to "" so
   * the gate fires.
   */
  function makeChangelogSeam(opts: { content?: string } = {}): {
    readonly seam: ChangelogSeam;
    readonly spawnCalls: Array<{ taskId: string; brief: string }>;
    readonly readCalls: { count: number };
  } {
    const readCalls = { count: 0 };
    const spawnCalls: Array<{ taskId: string; brief: string }> = [];
    const readChangelog: ReadChangelog = async () => {
      readCalls.count++;
      return opts.content ?? "";
    };
    const spawn: ChangelogSpawn = {
      spawn: async (input) => {
        spawnCalls.push({ taskId: input.taskId, brief: input.brief });
        return { exitCode: 0, durationMs: 7, stdoutTail: "changelog ran", stderrTail: "" };
      },
    };
    return { seam: { spawn, readChangelog }, spawnCalls, readCalls };
  }

  // 2026-05-05 UTC midnight — ISO-formats to "2026-05-05".
  const FIXED_NOW_2026_05_05 = Date.UTC(2026, 4, 5);

  it("changelog wire-in: empty CHANGELOG triggers spawn + emits a ran span tagged with today's UTC date", async () => {
    const recorder = new SpanRecorder();
    const cl = makeChangelogSeam({ content: "" });
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      now: () => FIXED_NOW_2026_05_05,
      emit: (e: TickSpan) => recorder.record(e),
      changelog: cl.seam,
    });
    expect(cl.readCalls.count).toBe(1);
    expect(cl.spawnCalls).toHaveLength(1);
    expect(cl.spawnCalls[0]?.taskId).toBe("changelog:2026-05-05");
    expect(cl.spawnCalls[0]?.brief).toContain("2026-05-05");
    const spans = recorder.spans.filter((s) => s.name === "tick-loop.changelog");
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes["changelog.outcome"]).toBe("ran");
    expect(spans[0]?.attributes["changelog.date"]).toBe("2026-05-05");
    expect(spans[0]?.attributes["changelog.exit_code"]).toBe(0);
  });

  it("changelog wire-in: existing date section skips with already-authored span", async () => {
    const recorder = new SpanRecorder();
    const cl = makeChangelogSeam({ content: "## 2026-05-05\n\nGenesis entry.\n" });
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      now: () => FIXED_NOW_2026_05_05,
      emit: (e: TickSpan) => recorder.record(e),
      changelog: cl.seam,
    });
    expect(cl.readCalls.count).toBe(1);
    expect(cl.spawnCalls).toHaveLength(0);
    const spans = recorder.spans.filter((s) => s.name === "tick-loop.changelog");
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes["changelog.outcome"]).toBe("skipped");
    expect(spans[0]?.attributes["changelog.skip_reason"]).toBe("already-authored");
  });

  it("changelog wire-in: omitted seam (production daemons predating this seam) keeps working unchanged", async () => {
    const recorder = new SpanRecorder();
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 2,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      emit: (e: TickSpan) => recorder.record(e),
    });
    expect(result.iterations.every((i) => i.status === "completed")).toBe(true);
    const spans = recorder.spans.filter((s) => s.name === "tick-loop.changelog");
    expect(spans).toHaveLength(0);
  });

  it("changelog wire-in: paused iteration does NOT fire (operator-quiet)", async () => {
    const cl = makeChangelogSeam();
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: pausedNow(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      now: () => FIXED_NOW_2026_05_05,
      changelog: cl.seam,
    });
    expect(cl.readCalls.count).toBe(0);
    expect(cl.spawnCalls).toHaveLength(0);
  });

  it("changelog wire-in: budget-paused iteration does NOT fire (don't burn the cap on a daily-fire)", async () => {
    const cl = makeChangelogSeam();
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: pausingBudgetGuard(),
      sleep: noSleep,
      now: () => FIXED_NOW_2026_05_05,
      changelog: cl.seam,
    });
    expect(cl.readCalls.count).toBe(0);
    expect(cl.spawnCalls).toHaveLength(0);
  });

  it("changelog wire-in: failed iteration STILL fires (per-day cadence, not per-shipped-task)", async () => {
    // Acceptance contract: "every day with merged PRs has a corresponding
    // section within 24h" — PRs may merge from human work even when the
    // daemon's own iteration failed. The CTO audit gates on completed-only;
    // the changelog explicitly does not.
    const cl = makeChangelogSeam({ content: "" });
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic({ failureMode: "http-5xx" }),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      now: () => FIXED_NOW_2026_05_05,
      changelog: cl.seam,
    });
    expect(cl.readCalls.count).toBe(1);
    expect(cl.spawnCalls).toHaveLength(1);
  });

  it("changelog wire-in: multi-iteration same day fires read every tick but spawn only once (gate idempotency)", async () => {
    // The first iteration's spawn would author `## <date>` to CHANGELOG.md;
    // the second iteration's read returns that updated content and the
    // gate skips. Simulate by mutating the seam's read source after the
    // first spawn call.
    let content = "";
    const readCalls = { count: 0 };
    const spawnCalls: Array<{ taskId: string }> = [];
    const readChangelog: ReadChangelog = async () => {
      readCalls.count++;
      return content;
    };
    const spawn: ChangelogSpawn = {
      spawn: async (input) => {
        spawnCalls.push({ taskId: input.taskId });
        // The runner's spawn would append `## 2026-05-05` to CHANGELOG.md;
        // mirror that side effect on our in-memory content store.
        content = "## 2026-05-05\n";
        return { exitCode: 0, durationMs: 7, stdoutTail: "ran", stderrTail: "" };
      },
    };
    await runDaemon({
      tickInterval: 0,
      maxIterations: 3,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      now: () => FIXED_NOW_2026_05_05,
      changelog: { spawn, readChangelog },
    });
    expect(readCalls.count).toBe(3);
    expect(spawnCalls).toHaveLength(1);
  });

  // ---- daily-snapshot wire-in --------------------------------------------
  //
  // These tests cover the wire-in in `runDaemon` → `maybeRunSnapshot`. The
  // runner's own gate / dispatch semantics are tested in
  // `snapshot-runner.test.ts`; here we only verify that the daemon
  // dispatches into `runSnapshot` for the right iteration shapes, skips
  // for the operator-quiet states, and emits the `tick-loop.snapshot` span.

  /**
   * Build a `SnapshotSeam` whose `capture` and `snapshotExists` record
   * their calls. `existsByDate` is the existence map; defaults to empty
   * (every date "missing", so the gate fires).
   */
  function makeSnapshotSeam(opts: { existsByDate?: ReadonlySet<string> } = {}): {
    readonly seam: SnapshotSeam;
    readonly captureCalls: Array<{ date: string }>;
    readonly existsCalls: { count: number };
  } {
    const existsCalls = { count: 0 };
    const captureCalls: Array<{ date: string }> = [];
    const known = opts.existsByDate ?? new Set<string>();
    const snapshotExists: SnapshotExists = async (date) => {
      existsCalls.count++;
      return known.has(date);
    };
    const capture: SnapshotCapture = {
      capture: async (input) => {
        captureCalls.push({ date: input.date });
        return { exitCode: 0, durationMs: 11, stdoutTail: "snapshot ran", stderrTail: "" };
      },
    };
    return { seam: { capture, snapshotExists }, captureCalls, existsCalls };
  }

  it("snapshot wire-in: missing snapshot triggers capture + emits a ran span tagged with today's UTC date", async () => {
    const recorder = new SpanRecorder();
    const snap = makeSnapshotSeam();
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      now: () => FIXED_NOW_2026_05_05,
      emit: (e: TickSpan) => recorder.record(e),
      snapshot: snap.seam,
    });
    expect(snap.existsCalls.count).toBe(1);
    expect(snap.captureCalls).toEqual([{ date: "2026-05-05" }]);
    const spans = recorder.spans.filter((s) => s.name === "tick-loop.snapshot");
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes["snapshot.outcome"]).toBe("ran");
    expect(spans[0]?.attributes["snapshot.date"]).toBe("2026-05-05");
    expect(spans[0]?.attributes["snapshot.exit_code"]).toBe(0);
  });

  it("snapshot wire-in: existing snapshot skips with already-captured span", async () => {
    const recorder = new SpanRecorder();
    const snap = makeSnapshotSeam({ existsByDate: new Set(["2026-05-05"]) });
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      now: () => FIXED_NOW_2026_05_05,
      emit: (e: TickSpan) => recorder.record(e),
      snapshot: snap.seam,
    });
    expect(snap.existsCalls.count).toBe(1);
    expect(snap.captureCalls).toHaveLength(0);
    const spans = recorder.spans.filter((s) => s.name === "tick-loop.snapshot");
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes["snapshot.outcome"]).toBe("skipped");
    expect(spans[0]?.attributes["snapshot.skip_reason"]).toBe("already-captured");
  });

  it("snapshot wire-in: omitted seam (production daemons predating this seam) keeps working unchanged", async () => {
    const recorder = new SpanRecorder();
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 2,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      emit: (e: TickSpan) => recorder.record(e),
    });
    expect(result.iterations.every((i) => i.status === "completed")).toBe(true);
    const spans = recorder.spans.filter((s) => s.name === "tick-loop.snapshot");
    expect(spans).toHaveLength(0);
  });

  it("snapshot wire-in: paused iteration does NOT fire (operator-quiet)", async () => {
    const snap = makeSnapshotSeam();
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: pausedNow(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      now: () => FIXED_NOW_2026_05_05,
      snapshot: snap.seam,
    });
    expect(snap.existsCalls.count).toBe(0);
    expect(snap.captureCalls).toHaveLength(0);
  });

  it("snapshot wire-in: budget-paused iteration does NOT fire (don't burn the cap on a daily-fire)", async () => {
    const snap = makeSnapshotSeam();
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: pausingBudgetGuard(),
      sleep: noSleep,
      now: () => FIXED_NOW_2026_05_05,
      snapshot: snap.seam,
    });
    expect(snap.existsCalls.count).toBe(0);
    expect(snap.captureCalls).toHaveLength(0);
  });

  it("snapshot wire-in: failed iteration STILL fires (per-day cadence — the snapshot IS the baseline tomorrow's Δ depends on)", async () => {
    // Acceptance contract for `daily-changelog-for-humans` Details (e):
    // snapshots are captured every UTC day so the next-day Δ render has
    // data to diff against. Even on a failed iteration, that contract
    // holds — same rationale as `maybeRunChangelog` firing on failed.
    const snap = makeSnapshotSeam();
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic({ failureMode: "http-5xx" }),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      now: () => FIXED_NOW_2026_05_05,
      snapshot: snap.seam,
    });
    expect(snap.existsCalls.count).toBe(1);
    expect(snap.captureCalls).toHaveLength(1);
  });

  it("snapshot wire-in: multi-iteration same day probes every tick but captures only once (gate idempotency)", async () => {
    // The first iteration's capture would write `.minsky/metric-snapshots/<date>.json`;
    // the second iteration's existence probe returns `true` and the gate
    // skips. Simulate by mutating an in-memory existence set in the capture
    // stub.
    const knownDates = new Set<string>();
    const existsCalls = { count: 0 };
    const captureCalls: Array<{ date: string }> = [];
    const snapshotExists: SnapshotExists = async (date) => {
      existsCalls.count++;
      return knownDates.has(date);
    };
    const capture: SnapshotCapture = {
      capture: async (input) => {
        captureCalls.push({ date: input.date });
        // The runner's capture would write `<date>.json`; mirror that
        // side effect on our in-memory set.
        knownDates.add(input.date);
        return { exitCode: 0, durationMs: 11, stdoutTail: "ran", stderrTail: "" };
      },
    };
    await runDaemon({
      tickInterval: 0,
      maxIterations: 3,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      now: () => FIXED_NOW_2026_05_05,
      snapshot: { capture, snapshotExists },
    });
    expect(existsCalls.count).toBe(3);
    expect(captureCalls).toHaveLength(1);
  });

  it("snapshot wire-in: independent of the changelog seam — manual-author day still captures snapshot", async () => {
    // Critical contract: if the operator (or someone else) authored
    // CHANGELOG.md manually for today, `runChangelog` skips with
    // `already-authored`. But the snapshot still needs writing — without
    // it, day-(N+1)'s Δ rendering has no `prevMetricsSnapshot` to diff
    // against. This test asserts the two gates are truly independent.
    const cl = makeChangelogSeam({ content: "## 2026-05-05\n\nManual entry.\n" });
    const snap = makeSnapshotSeam();
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      now: () => FIXED_NOW_2026_05_05,
      changelog: cl.seam,
      snapshot: snap.seam,
    });
    // changelog skipped (manually authored)…
    expect(cl.spawnCalls).toHaveLength(0);
    // …but the snapshot still fired.
    expect(snap.captureCalls).toHaveLength(1);
  });

  // ---- daily metrics-render wire-in --------------------------------------
  //
  // These tests cover the wire-in in `runDaemon` → `maybeRunMetricsRender`.
  // The runner's own gate / dispatch semantics are tested in
  // `metrics-render-runner.test.ts`; here we only verify that the daemon
  // dispatches into `runMetricsRender` for the right iteration shapes,
  // skips for the operator-quiet states, and emits the
  // `tick-loop.metrics-render` span. Substrate for
  // `canonical-metric-list-per-repo` Acceptance (3) "daemon refreshes daily".

  /**
   * Build a `MetricsRenderSeam` whose `render` and `getLastRenderedDate`
   * record their calls. `lastRenderedDate` defaults to `null` (genesis case
   * — `METRICS.md` not yet authored, so the gate fires).
   */
  function makeMetricsRenderSeam(opts: { lastRenderedDate?: string | null } = {}): {
    readonly seam: MetricsRenderSeam;
    readonly renderCalls: Array<{ date: string }>;
    readonly probeCalls: { count: number };
  } {
    const probeCalls = { count: 0 };
    const renderCalls: Array<{ date: string }> = [];
    const last = opts.lastRenderedDate ?? null;
    const getLastRenderedDate: GetLastRenderedDate = async () => {
      probeCalls.count++;
      return last;
    };
    const render: MetricsRender = {
      render: async (input) => {
        renderCalls.push({ date: input.date });
        return { exitCode: 0, durationMs: 13, stdoutTail: "metrics ran", stderrTail: "" };
      },
    };
    return { seam: { render, getLastRenderedDate }, renderCalls, probeCalls };
  }

  it("metrics-render wire-in: missing METRICS.md (genesis) triggers render + emits a ran span tagged with today's UTC date", async () => {
    const recorder = new SpanRecorder();
    const mr = makeMetricsRenderSeam();
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      now: () => FIXED_NOW_2026_05_05,
      emit: (e: TickSpan) => recorder.record(e),
      metricsRender: mr.seam,
    });
    expect(mr.probeCalls.count).toBe(1);
    expect(mr.renderCalls).toEqual([{ date: "2026-05-05" }]);
    const spans = recorder.spans.filter((s) => s.name === "tick-loop.metrics-render");
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes["metrics-render.outcome"]).toBe("ran");
    expect(spans[0]?.attributes["metrics-render.date"]).toBe("2026-05-05");
    expect(spans[0]?.attributes["metrics-render.exit_code"]).toBe(0);
  });

  it("metrics-render wire-in: today's render already done skips with already-rendered span", async () => {
    const recorder = new SpanRecorder();
    const mr = makeMetricsRenderSeam({ lastRenderedDate: "2026-05-05" });
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      now: () => FIXED_NOW_2026_05_05,
      emit: (e: TickSpan) => recorder.record(e),
      metricsRender: mr.seam,
    });
    expect(mr.probeCalls.count).toBe(1);
    expect(mr.renderCalls).toHaveLength(0);
    const spans = recorder.spans.filter((s) => s.name === "tick-loop.metrics-render");
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes["metrics-render.outcome"]).toBe("skipped");
    expect(spans[0]?.attributes["metrics-render.skip_reason"]).toBe("already-rendered");
  });

  it("metrics-render wire-in: omitted seam (production daemons predating this seam) keeps working unchanged", async () => {
    const recorder = new SpanRecorder();
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 2,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      emit: (e: TickSpan) => recorder.record(e),
    });
    expect(result.iterations.every((i) => i.status === "completed")).toBe(true);
    const spans = recorder.spans.filter((s) => s.name === "tick-loop.metrics-render");
    expect(spans).toHaveLength(0);
  });

  it("metrics-render wire-in: paused iteration does NOT fire (operator-quiet)", async () => {
    const mr = makeMetricsRenderSeam();
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: pausedNow(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      now: () => FIXED_NOW_2026_05_05,
      metricsRender: mr.seam,
    });
    expect(mr.probeCalls.count).toBe(0);
    expect(mr.renderCalls).toHaveLength(0);
  });

  it("metrics-render wire-in: budget-paused iteration does NOT fire (don't burn the cap on a daily-fire)", async () => {
    const mr = makeMetricsRenderSeam();
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: pausingBudgetGuard(),
      sleep: noSleep,
      now: () => FIXED_NOW_2026_05_05,
      metricsRender: mr.seam,
    });
    expect(mr.probeCalls.count).toBe(0);
    expect(mr.renderCalls).toHaveLength(0);
  });

  it("metrics-render wire-in: failed iteration STILL fires (the render IS the always-visible operator-glance surface)", async () => {
    // Acceptance contract for `canonical-metric-list-per-repo`:
    // "every minsky repo … always be visible and updated". Even on a failed
    // iteration, that contract holds — same rationale as `maybeRunSnapshot`
    // firing on failed.
    const mr = makeMetricsRenderSeam();
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic({ failureMode: "http-5xx" }),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      now: () => FIXED_NOW_2026_05_05,
      metricsRender: mr.seam,
    });
    expect(mr.probeCalls.count).toBe(1);
    expect(mr.renderCalls).toHaveLength(1);
  });

  it("metrics-render wire-in: multi-iteration same day probes every tick but renders only once (gate idempotency)", async () => {
    // The first iteration's render would update METRICS.md mtime; the
    // second iteration's probe returns today's date and the gate skips.
    let lastRenderedDate: string | null = null;
    const probeCalls = { count: 0 };
    const renderCalls: Array<{ date: string }> = [];
    const getLastRenderedDate: GetLastRenderedDate = async () => {
      probeCalls.count++;
      return lastRenderedDate;
    };
    const render: MetricsRender = {
      render: async (input) => {
        renderCalls.push({ date: input.date });
        // Mirror the side effect of the real `pnpm metrics:render`:
        // METRICS.md is rewritten with mtime === today.
        lastRenderedDate = input.date;
        return { exitCode: 0, durationMs: 13, stdoutTail: "ran", stderrTail: "" };
      },
    };
    await runDaemon({
      tickInterval: 0,
      maxIterations: 3,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      now: () => FIXED_NOW_2026_05_05,
      metricsRender: { render, getLastRenderedDate },
    });
    expect(probeCalls.count).toBe(3);
    expect(renderCalls).toHaveLength(1);
  });

  it("metrics-render wire-in: independent of the snapshot seam — snapshot-capture failure does NOT suppress today's render", async () => {
    // Critical contract: a snapshot-capture failure (gh rate-limit, network)
    // must NOT suppress today's render. Yesterday's snapshot still produces
    // a usable METRICS.md (visible-not-silent, Helland 2007). This test
    // asserts the two gates are truly independent.
    const failingCapture: SnapshotCapture = {
      capture: async () => ({
        exitCode: 1,
        durationMs: 5,
        stdoutTail: "",
        stderrTail: "gh: rate-limited",
      }),
    };
    const snapshotExists: SnapshotExists = async () => false;
    const mr = makeMetricsRenderSeam();
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: true,
      mockClient: new TestFakeMockAnthropic(),
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      now: () => FIXED_NOW_2026_05_05,
      snapshot: { capture: failingCapture, snapshotExists },
      metricsRender: mr.seam,
    });
    // metrics render fired despite the snapshot-capture failure.
    expect(mr.renderCalls).toHaveLength(1);
  });

  it("worker mode: passes extraArgs (--worktree daemon-N-taskId) to the spawn strategy", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "minsky-daemon-worker-"));
    const seenInputs: SpawnInput[] = [];
    const fakeStrategy: SpawnStrategy = {
      spawn: (input: SpawnInput) => {
        seenInputs.push(input);
        return Promise.resolve({ exitCode: 0, durationMs: 0, stdoutTail: "ok", stderrTail: "" });
      },
    };
    const client = new TestFakeMockAnthropic();
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: false,
      mockClient: client,
      spawnStrategy: fakeStrategy,
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      workerConfig: { workerId: 0, workersTotal: 2 },
      locksDir: tmp,
    });
    expect(seenInputs).toHaveLength(1);
    expect(seenInputs[0]?.extraArgs).toEqual(["--worktree", "daemon-0-alpha"]);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("single-process (no workerConfig): does NOT include extraArgs / --worktree", async () => {
    const seenInputs: SpawnInput[] = [];
    const fakeStrategy: SpawnStrategy = {
      spawn: (input: SpawnInput) => {
        seenInputs.push(input);
        return Promise.resolve({ exitCode: 0, durationMs: 0, stdoutTail: "ok", stderrTail: "" });
      },
    };
    const client = new TestFakeMockAnthropic();
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: false,
      mockClient: client,
      spawnStrategy: fakeStrategy,
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
    });
    expect(seenInputs).toHaveLength(1);
    expect(seenInputs[0]?.extraArgs ?? []).toEqual([]);
  });

  it("worker mode: walks past a held claim and picks the next eligible task (claim-aware pickTask)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "minsky-daemon-claim-walk-"));
    // Lock alpha (first eligible) — daemon should walk past to beta, claim, run.
    writeFileSync(
      join(tmp, "task-alpha.lock"),
      JSON.stringify({
        taskId: "alpha",
        workerId: "9",
        claimedAt: 0,
        expiresAt: Number.MAX_SAFE_INTEGER,
      }),
    );
    const seenTasks: string[] = [];
    const fakeStrategy: SpawnStrategy = {
      spawn: (input) => {
        seenTasks.push(input.taskId);
        return Promise.resolve({ exitCode: 0, durationMs: 0, stdoutTail: "ok", stderrTail: "" });
      },
    };
    const client = new TestFakeMockAnthropic();
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: false,
      mockClient: client,
      spawnStrategy: fakeStrategy,
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      workerConfig: { workerId: 0, workersTotal: 2 },
      locksDir: tmp,
    });
    // Walked past locked `alpha` → claimed `beta` → completed.
    expect(seenTasks).toEqual(["beta"]);
    expect(result.iterations[0]?.status).toBe("completed");
    expect(result.iterations[0]?.taskId).toBe("beta");
    rmSync(tmp, { recursive: true, force: true });
  });

  it("worker mode: returns no-task only when ALL eligible tasks are claim-collided", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "minsky-daemon-all-locked-"));
    // Lock every fixture P0 task.
    for (const id of ["alpha", "beta", "gamma", "delta"]) {
      writeFileSync(
        join(tmp, `task-${id}.lock`),
        JSON.stringify({
          taskId: id,
          workerId: "9",
          claimedAt: 0,
          expiresAt: Number.MAX_SAFE_INTEGER,
        }),
      );
    }
    const fakeStrategy: SpawnStrategy = {
      spawn: () =>
        Promise.resolve({
          exitCode: 0,
          durationMs: 0,
          stdoutTail: "should-not-spawn",
          stderrTail: "",
        }),
    };
    const client = new TestFakeMockAnthropic();
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: false,
      mockClient: client,
      spawnStrategy: fakeStrategy,
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      workerConfig: { workerId: 0, workersTotal: 2 },
      locksDir: tmp,
    });
    expect(result.iterations[0]?.status).toBe("no-task");
    expect(result.iterations[0]?.reason).toContain("claim-collision");
    expect(result.iterations[0]?.reason).toContain("alpha");
    expect(result.iterations[0]?.reason).toContain("beta");
    rmSync(tmp, { recursive: true, force: true });
  });

  it("worker mode: claim is released after a successful iteration (subsequent acquire works)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "minsky-daemon-release-"));
    const fakeStrategy: SpawnStrategy = {
      spawn: () =>
        Promise.resolve({ exitCode: 0, durationMs: 0, stdoutTail: "ok", stderrTail: "" }),
    };
    const client = new TestFakeMockAnthropic();
    await runDaemon({
      tickInterval: 0,
      maxIterations: 2,
      dryRun: false,
      mockClient: client,
      spawnStrategy: fakeStrategy,
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      workerConfig: { workerId: 0, workersTotal: 2 },
      locksDir: tmp,
    });
    // Two iterations would BOTH fail with claim-collision if the release
    // weren't called — assert both completed.
    const lockExists = existsSync(join(tmp, "task-alpha.lock"));
    expect(lockExists).toBe(false);
    rmSync(tmp, { recursive: true, force: true });
  });

  // ---- Slice 4: openPrFetcher / decideTouchesCollision wire-in ----------

  it("worker mode + openPrFetcher: skips a candidate whose Files overlap an open PR's changed files", async () => {
    // alpha's **Files**: lists `novel/tick-loop/src/daemon.ts`.
    // An open PR has changed that file → alpha must be skipped.
    // beta's **Files**: lists `scripts/lint.mjs` (no overlap) → claimed.
    const fixture = `# Tasks\n
## P0\n
- [ ] \`alpha\` — alpha
  - **ID**: alpha
  - **Files**: \`novel/tick-loop/src/daemon.ts\` (impl), \`novel/tick-loop/src/daemon.test.ts\` (paired tests).

- [ ] \`beta\` — beta
  - **ID**: beta
  - **Files**: \`scripts/lint.mjs\` (lint script).
`;
    const tmp = mkdtempSync(join(tmpdir(), "minsky-daemon-touches-skip-"));
    const seenTasks: string[] = [];
    const fakeStrategy: SpawnStrategy = {
      spawn: (input) => {
        seenTasks.push(input.taskId);
        return Promise.resolve({ exitCode: 0, durationMs: 0, stdoutTail: "ok", stderrTail: "" });
      },
    };
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: false,
      mockClient: new TestFakeMockAnthropic(),
      spawnStrategy: fakeStrategy,
      tasksMdReader: staticReader(fixture),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      workerConfig: { workerId: 0, workersTotal: 5 },
      locksDir: tmp,
      openPrFetcher: () =>
        Promise.resolve([{ number: 42, files: ["novel/tick-loop/src/daemon.ts"] }]),
    });
    // alpha was collision-prevented; beta got picked.
    expect(seenTasks).toEqual(["beta"]);
    expect(result.iterations[0]?.status).toBe("completed");
    expect(result.iterations[0]?.taskId).toBe("beta");
    rmSync(tmp, { recursive: true, force: true });
  });

  it("worker mode + openPrFetcher: returns no-task when ALL eligible tasks collide with open PRs", async () => {
    const fixture = `# Tasks\n
## P0\n
- [ ] \`alpha\` — alpha
  - **ID**: alpha
  - **Files**: \`novel/tick-loop/src/daemon.ts\` (impl).

- [ ] \`beta\` — beta
  - **ID**: beta
  - **Files**: \`scripts/lint.mjs\` (lint).
`;
    const tmp = mkdtempSync(join(tmpdir(), "minsky-daemon-touches-all-"));
    const fakeStrategy: SpawnStrategy = {
      spawn: () =>
        Promise.resolve({
          exitCode: 0,
          durationMs: 0,
          stdoutTail: "should-not-spawn",
          stderrTail: "",
        }),
    };
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: false,
      mockClient: new TestFakeMockAnthropic(),
      spawnStrategy: fakeStrategy,
      tasksMdReader: staticReader(fixture),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      workerConfig: { workerId: 0, workersTotal: 5 },
      locksDir: tmp,
      openPrFetcher: () =>
        Promise.resolve([
          { number: 42, files: ["novel/tick-loop/src/daemon.ts"] },
          { number: 43, files: ["scripts/lint.mjs"] },
        ]),
    });
    expect(result.iterations[0]?.status).toBe("no-task");
    expect(result.iterations[0]?.reason).toContain("collision-prevented");
    expect(result.iterations[0]?.reason).toContain("alpha");
    expect(result.iterations[0]?.reason).toContain("beta");
    rmSync(tmp, { recursive: true, force: true });
  });

  it("worker mode + openPrFetcher with empty snapshot: no-op (legacy claim-only behaviour)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "minsky-daemon-touches-empty-"));
    const seenTasks: string[] = [];
    const fakeStrategy: SpawnStrategy = {
      spawn: (input) => {
        seenTasks.push(input.taskId);
        return Promise.resolve({ exitCode: 0, durationMs: 0, stdoutTail: "ok", stderrTail: "" });
      },
    };
    const result = await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: false,
      mockClient: new TestFakeMockAnthropic(),
      spawnStrategy: fakeStrategy,
      tasksMdReader: staticReader(FIXTURE_TASKS_MD),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      workerConfig: { workerId: 0, workersTotal: 2 },
      locksDir: tmp,
      openPrFetcher: () => Promise.resolve([]),
    });
    expect(seenTasks).toEqual(["alpha"]);
    expect(result.iterations[0]?.status).toBe("completed");
    rmSync(tmp, { recursive: true, force: true });
  });

  it("worker mode without openPrFetcher: file-collision check is skipped (slice-1/2 path preserved)", async () => {
    // No openPrFetcher passed → the candidate's Files field is ignored,
    // so a task whose Files would have collided still gets claimed. This
    // is the back-compat invariant.
    const fixture = `# Tasks\n
## P0\n
- [ ] \`alpha\` — alpha
  - **ID**: alpha
  - **Files**: \`novel/tick-loop/src/daemon.ts\` (impl).
`;
    const tmp = mkdtempSync(join(tmpdir(), "minsky-daemon-touches-noop-"));
    const seenTasks: string[] = [];
    const fakeStrategy: SpawnStrategy = {
      spawn: (input) => {
        seenTasks.push(input.taskId);
        return Promise.resolve({ exitCode: 0, durationMs: 0, stdoutTail: "ok", stderrTail: "" });
      },
    };
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: false,
      mockClient: new TestFakeMockAnthropic(),
      spawnStrategy: fakeStrategy,
      tasksMdReader: staticReader(fixture),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      workerConfig: { workerId: 0, workersTotal: 5 },
      locksDir: tmp,
      // openPrFetcher intentionally omitted
    });
    expect(seenTasks).toEqual(["alpha"]);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("worker mode + openPrFetcher: prefers Touches when both Touches and Files are present", async () => {
    // alpha has both Touches (narrow) and Files (broad). The Touches glob
    // doesn't match the open PR's file → proceed. If the daemon were
    // reading Files instead, alpha WOULD collide.
    const fixture = `# Tasks\n
## P0\n
- [ ] \`alpha\` — alpha
  - **ID**: alpha
  - **Files**: \`novel/tick-loop/src/daemon.ts\` (broader).
  - **Touches**: scripts/*.mjs

- [ ] \`beta\` — beta
  - **ID**: beta
  - **Files**: \`other/dir/file.ts\`.
`;
    const tmp = mkdtempSync(join(tmpdir(), "minsky-daemon-touches-prefers-"));
    const seenTasks: string[] = [];
    const fakeStrategy: SpawnStrategy = {
      spawn: (input) => {
        seenTasks.push(input.taskId);
        return Promise.resolve({ exitCode: 0, durationMs: 0, stdoutTail: "ok", stderrTail: "" });
      },
    };
    await runDaemon({
      tickInterval: 0,
      maxIterations: 1,
      dryRun: false,
      mockClient: new TestFakeMockAnthropic(),
      spawnStrategy: fakeStrategy,
      tasksMdReader: staticReader(fixture),
      pausedSentinelReader: noPaused(),
      budgetGuard: normalBudgetGuard(),
      sleep: noSleep,
      workerConfig: { workerId: 0, workersTotal: 5 },
      locksDir: tmp,
      openPrFetcher: () =>
        Promise.resolve([{ number: 1, files: ["novel/tick-loop/src/daemon.ts"] }]),
    });
    // alpha's Touches=`scripts/*.mjs` doesn't match the PR's daemon.ts file → alpha proceeds.
    expect(seenTasks).toEqual(["alpha"]);
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe("tick-loop / daemon / pickTask", () => {
  it("picks the first unclaimed unblocked P0 task", () => {
    expect(pickTask(FIXTURE_TASKS_MD)).toBe("alpha");
  });

  it("skips claimed tasks", () => {
    expect(pickTask(FIXTURE_WITH_CLAIMED)).toBe("second");
  });

  it("skips blocked tasks", () => {
    expect(pickTask(FIXTURE_WITH_BLOCKED)).toBe("second");
  });

  it("skips tasks with non-empty `**Blocked**:` field (external-constraint blocker)", () => {
    // Regression for `tick-loop-picktask-honors-blocked-field`: the
    // `**Blocked**:` field is the safety surface for blocked-by-default
    // actions (e.g., needs-user-approval) — pickTask must skip these in
    // addition to the dependency-style `**Blocked by**:` skip.
    expect(pickTask(FIXTURE_WITH_BLOCKED_FIELD)).toBe("ready");
  });

  it("ignores P2 tasks", () => {
    const onlyP2 = "# Tasks\n\n## P0\n\n## P2\n\n- [ ] only\n  - **ID**: only\n";
    expect(pickTask(onlyP2)).toBeUndefined();
  });

  it("returns undefined when nothing is pickable", () => {
    expect(pickTask("# Tasks\n\n## P0\n\n")).toBeUndefined();
  });
});

describe("extractTaskBlock", () => {
  const sample = `# Tasks

## P0

- [ ] \`task-a\` — first
  - **ID**: task-a
  - **Hypothesis**: H

- [ ] \`task-b\` — second
  - **ID**: task-b
  - **Hypothesis**: H

## P1

- [ ] \`task-c\` — third
  - **ID**: task-c
`;

  it("extracts a P0 task block bounded by the next heading", () => {
    const block = extractTaskBlock(sample, "task-a");
    expect(block).toContain("`task-a`");
    expect(block).toContain("**Hypothesis**: H");
    expect(block).not.toContain("`task-b`");
  });

  it("extracts the last P0 task bounded by the section heading", () => {
    const block = extractTaskBlock(sample, "task-b");
    expect(block).toContain("`task-b`");
    expect(block).not.toContain("## P1");
    expect(block).not.toContain("`task-c`");
  });

  it("extracts a P1 task block bounded by EOF", () => {
    const block = extractTaskBlock(sample, "task-c");
    expect(block).toContain("`task-c`");
  });

  it("returns undefined for an unknown id", () => {
    expect(extractTaskBlock(sample, "task-missing")).toBeUndefined();
  });

  it("does not match a similarly-named id (exact-match only)", () => {
    expect(extractTaskBlock(sample, "task-")).toBeUndefined();
  });
});

describe("buildDaemonBrief", () => {
  const sample = `# Tasks

## P0

- [ ] \`real-task\` — load-bearing
  - **ID**: real-task
  - **Tags**: p0, supervisor
  - **Hypothesis**: ship something
  - **Acceptance**: green CI on PR
`;

  it("includes the task block content when found", () => {
    const brief = buildDaemonBrief({ taskId: "real-task", tasksMdContent: sample });
    expect(brief).toContain("`real-task`");
    expect(brief).toContain("**Acceptance**: green CI on PR");
  });

  it("includes the iteration directive section", () => {
    const brief = buildDaemonBrief({ taskId: "real-task", tasksMdContent: sample });
    expect(brief).toContain("## Iteration directive");
    expect(brief).toContain("Ship the smallest meaningful next iteration");
  });

  it("includes the anti-noop guard against brief-refresh-only PRs", () => {
    const brief = buildDaemonBrief({ taskId: "real-task", tasksMdContent: sample });
    expect(brief).toContain("FORBIDDEN — anti-noop guard");
    expect(brief).toContain("brief refresh");
    expect(brief).toContain("noop, exiting");
  });

  it("falls back to a graceful message when the task block isn't found", () => {
    const brief = buildDaemonBrief({ taskId: "missing-id", tasksMdContent: sample });
    expect(brief).toContain("(task block not found in TASKS.md");
  });

  it("includes the priority-discipline gate listing open p0-tagged tasks", () => {
    const brief = buildDaemonBrief({ taskId: "real-task", tasksMdContent: sample });
    expect(brief).toContain("## Priority-discipline gate");
    expect(brief).toContain("Open P0 tasks");
    expect(brief).toContain("`real-task`");
  });

  it("emits PROCEED when the picked task is in the open P0 set", () => {
    const brief = buildDaemonBrief({ taskId: "real-task", tasksMdContent: sample });
    expect(brief).toContain("IS in the open P0 set");
    expect(brief).not.toContain("**STOP.**");
  });

  it("emits STOP + noop directive when the picked task is a P1 in the P0 section", () => {
    const mixedSample = `# Tasks

## P0

- [ ] \`fake-p0\` — physically positioned in P0 but tagged p1 (the bug)
  - **ID**: fake-p0
  - **Tags**: p1, observability
  - **Hypothesis**: H

- [ ] \`real-p0\` — actually p0
  - **ID**: real-p0
  - **Tags**: p0, security
  - **Hypothesis**: H
`;
    const brief = buildDaemonBrief({ taskId: "fake-p0", tasksMdContent: mixedSample });
    expect(brief).toContain("**STOP.**");
    expect(brief).toContain("priority discipline");
    expect(brief).toContain("'fake-p0' is not the highest-priority unclaimed P0");
    expect(brief).toContain("should pick 'real-p0' instead");
  });

  it("notes the operator override when picked task carries Pick-next: yes", () => {
    const overrideSample = `# Tasks

## P0

- [ ] \`real-p0\` — genuine p0 with no Pick-next
  - **ID**: real-p0
  - **Tags**: p0
  - **Hypothesis**: H

## P1

- [ ] \`override-task\` — operator-promoted p1
  - **ID**: override-task
  - **Tags**: p1
  - **Pick-next**: yes
  - **Hypothesis**: H
`;
    const brief = buildDaemonBrief({ taskId: "override-task", tasksMdContent: overrideSample });
    expect(brief).toContain("**STOP.**");
    expect(brief).toContain("Pick-next");
    expect(brief).toContain("operator has explicitly overridden");
  });

  it("emits PROCEED when there are no open P0 tasks at all", () => {
    const noP0Sample = `# Tasks

## P0

## P1

- [ ] \`only-p1\` — load-bearing
  - **ID**: only-p1
  - **Tags**: p1
  - **Hypothesis**: H
`;
    const brief = buildDaemonBrief({ taskId: "only-p1", tasksMdContent: noP0Sample });
    expect(brief).toContain("No open P0 tasks");
    expect(brief).not.toContain("**STOP.**");
  });

  it("includes the pre-PR lint-stack gate that mandates `pnpm pre-pr-lint` before gh pr create", () => {
    const brief = buildDaemonBrief({ taskId: "real-task", tasksMdContent: sample });
    expect(brief).toContain("## Pre-PR lint-stack gate");
    expect(brief).toContain("pnpm pre-pr-lint");
    expect(brief).toContain("scripts/run-pre-pr-lint-stack.mjs");
    expect(brief).toContain("up to 3 attempts");
    expect(brief).toContain("noop, exiting — pre-pr-lint-failures");
    // Pre-registered metric (TASKS.md `daemon-pre-pr-lint-gate`) — pin the
    // 80% threshold so a brief edit can't silently weaken the hypothesis.
    expect(brief).toContain("≥80%");
  });

  it("gate section names the body-only CI checks routed through the `--body=` flag (slices 29→30/N)", () => {
    // Drift protection (TASKS.md `daemon-pre-pr-lint-gate`): `pnpm pre-pr-lint`
    // covers the branch-code lints but cannot evaluate the two PR-body CI
    // checks (`pr-security-review`, `pr-self-grade`) — both are in
    // `CI_ENV_DEPENDENT_JOBS` precisely because they need PR-body context.
    // Slice 29/N (PR #328) added a brief sentence telling the inner Claude
    // to invoke both checkers as separate `node scripts/check-*.mjs` calls;
    // slice 30/N consolidated that into one `--body=<path>` flag on the
    // canonical lint-stack runner so the same retry budget governs them.
    // The slice-30 brief therefore names the two checks by their step IDs
    // (`pr-self-grade`, `pr-security-review`) rather than the bare
    // `.mjs` paths. Pin the body-only framing + the two step IDs so a
    // future brief trim can't silently drop the directive.
    const brief = buildDaemonBrief({ taskId: "real-task", tasksMdContent: sample });
    const gateSection = extractGateSection(brief);
    expect(gateSection).toContain("pr-security-review");
    expect(gateSection).toContain("pr-self-grade");
    // The two body-only CI jobs are precisely the env-dependent ones that
    // can't run inside `pnpm pre-pr-lint` — pin the framing so the directive
    // doesn't drift to "run extra lints" without the operator-facing reason.
    expect(gateSection).toMatch(/body-only|body file/i);
  });

  it("brief's fast-stage step names match the canonical manifest at scripts/run-pre-pr-lint-stack.mjs (bidirectional)", () => {
    // Drift protection (TASKS.md `daemon-pre-pr-lint-gate`): the brief no longer
    // enumerates step names in the "Red →" bullet — the stderr tail already names
    // the failing step at runtime, so pre-listing them was pure duplication
    // (−224 bytes/iter). The manifest must still have fast-stage steps (sanity),
    // and the brief must still instruct the daemon that "the stderr tail names
    // the failing step" rather than enumerate them — that is the new invariant.
    const here = dirname(fileURLToPath(import.meta.url));
    const manifestPath = resolve(here, "../../../scripts/run-pre-pr-lint-stack.mjs");
    const src = readFileSync(manifestPath, "utf8");
    const fastStageNames = extractManifestFastStageNames(src);
    expect(fastStageNames.size).toBeGreaterThan(0);

    const brief = buildDaemonBrief({ taskId: "real-task", tasksMdContent: sample });

    // New invariant: brief does NOT enumerate step names (regression guard).
    const briefNames = extractBriefRedBulletNames(brief);
    expect(briefNames.size).toBe(0);

    // New invariant: brief tells the daemon that stderr names the step.
    expect(brief).toContain("stderr tail names the failing step");
  });

  it("noop-exit token prefix is identical across brief, invariant suggestedFix, and operator docs (slice 24/N)", () => {
    // Drift protection (TASKS.md `daemon-pre-pr-lint-gate`): the brief tells
    // the daemon to emit `noop, exiting — pre-pr-lint-failures: <step name>`
    // to stdout when the gate stays red after 3 retries. Both
    // `docs/daemon-pre-pr-gate.md` § "When the invariant fires" and the
    // `daemonPrLintPassRateInvariant`'s `suggestedFix` (in
    // `scripts/self-diagnose.mjs`) instruct operators to grep
    // `.minsky/tick-loop.out.log` for that same `pre-pr-lint-failures: <step>`
    // token. If a refactor renames the token in the brief without updating
    // the grep instructions (or vice versa), operators grep and find nothing,
    // conclude the brief skip isn't happening, when in fact it is — exactly
    // the silent-divergence drift hazard slices 13/16/17/18/22/23 close on
    // their respective surfaces. Slice 24/N closes the same drift on the
    // noop-exit token prefix: extract the prefix from the brief itself
    // (single source of truth — the daemon's emission is what operators will
    // actually find in the log), then assert the docs and the invariant
    // source both contain that exact prefix verbatim.
    //
    // Mutation testing — three directions of drift surfaced:
    // - rename token in brief (`pre-pr-lint-failures` → `lint-gate-failed`)
    //   → extracted prefix becomes `lint-gate-failed:`; docs + invariant
    //   still hold the old name → both `expect.toContain` calls fail.
    // - rename token in docs only → extracted prefix unchanged
    //   (`pre-pr-lint-failures:`); docs no longer contains it → docs
    //   `toContain` fails, invariant passes.
    // - rename token in invariant `suggestedFix` only → invariant
    //   `toContain` fails, docs passes.
    const here = dirname(fileURLToPath(import.meta.url));
    const brief = buildDaemonBrief({ taskId: "real-task", tasksMdContent: sample });
    const tokenPrefix = extractBriefNoopExitTokenPrefix(brief);
    // Sanity: the extractor must produce a non-empty token-with-colon — if it
    // ever returns just `:` the parity test would silently pass on every
    // surface. Pin the load-bearing structure here too.
    expect(tokenPrefix).toMatch(/^[a-z][a-z0-9-]+:$/);

    const docs = readFileSync(resolve(here, "../../../docs/daemon-pre-pr-gate.md"), "utf8");
    const invariantSrc = readFileSync(resolve(here, "../../../scripts/self-diagnose.mjs"), "utf8");
    expect(docs).toContain(tokenPrefix);
    expect(invariantSrc).toContain(tokenPrefix);
  });

  it("includes the optimization-discipline gate with concrete eligible-optimization list", () => {
    const brief = buildDaemonBrief({ taskId: "real-task", tasksMdContent: sample });
    expect(brief).toContain("## Optimization-discipline gate");
    expect(brief).toContain("brief-shrinking");
    expect(brief).toContain("cached-prompt extension");
    expect(brief).toContain("skip-earlier gate");
    expect(brief).toContain("optimization: none-this-iteration");
  });

  it("emits the operator-directive anchor 2026-05-05 + measurable-only guard in the optimization gate", () => {
    const brief = buildDaemonBrief({ taskId: "real-task", tasksMdContent: sample });
    expect(brief).toContain("Operator directive 2026-05-05");
    expect(brief).toContain("≥10-byte savings minimum");
    expect(brief).toContain("Anti-vanity:");
  });

  it("excludes claimed and blocked tasks from the open P0 list", () => {
    const sampleWithSkips = `# Tasks

## P0

- [ ] \`claimed-p0\` (@minsky-tick-loop) — already in flight
  - **ID**: claimed-p0
  - **Tags**: p0
  - **Hypothesis**: H

- [ ] \`blocked-p0\` — externally blocked
  - **ID**: blocked-p0
  - **Tags**: p0
  - **Blocked**: needs operator approval
  - **Hypothesis**: H

- [ ] \`actionable-p0\` — clean
  - **ID**: actionable-p0
  - **Tags**: p0
  - **Hypothesis**: H
`;
    const brief = buildDaemonBrief({ taskId: "actionable-p0", tasksMdContent: sampleWithSkips });
    expect(brief).toContain("`actionable-p0`");
    expect(brief).not.toMatch(/Open P0 tasks[^\n]*claimed-p0/);
    expect(brief).not.toMatch(/Open P0 tasks[^\n]*blocked-p0/);
  });

  it("orders stable sections before volatile sections so Anthropic's prompt cache hits across iterations", () => {
    const sample = [
      "# Tasks",
      "",
      "## P0",
      "",
      "- [ ] `real-task` — clean",
      "  - **ID**: real-task",
      "  - **Tags**: p0",
      "  - **Hypothesis**: H",
      "",
    ].join("\n");
    const brief = buildDaemonBrief({ taskId: "real-task", tasksMdContent: sample });
    const idx = (heading: string) => brief.indexOf(heading);
    const stable = [
      "## Iteration directive",
      "## Pre-PR lint-stack gate",
      "## Optimization-discipline gate",
      "## PR security-review template",
    ];
    const volatile = ["## Priority-discipline gate", "## Task block (current TASKS.md)"];
    for (const s of stable) {
      for (const v of volatile) {
        expect(idx(s), `${s} must precede ${v} for cache-prefix stability`).toBeLessThan(idx(v));
      }
    }
  });

  it("includes the PR security-review copy-paste template with both option-A heading and option-B opt-out", () => {
    const sample = [
      "# Tasks",
      "",
      "## P0",
      "",
      "- [ ] `t` — clean",
      "  - **ID**: t",
      "  - **Tags**: p0",
      "  - **Hypothesis**: H",
      "",
    ].join("\n");
    const brief = buildDaemonBrief({ taskId: "t", tasksMdContent: sample });
    expect(brief).toContain("## PR security-review template");
    expect(brief).toContain("## Security & privacy");
    expect(brief).toContain("<!-- security: not-applicable —");
    expect(brief).toContain("scripts/check-pr-security-review.mjs");
    expect(brief).toContain("vision.md § 13");
  });

  it("includes the PR self-grade copy-paste template with the lint-passing format", () => {
    const sample = [
      "# Tasks",
      "",
      "## P0",
      "",
      "- [ ] `t` — clean",
      "  - **ID**: t",
      "  - **Tags**: p0",
      "  - **Hypothesis**: H",
      "",
    ].join("\n");
    const brief = buildDaemonBrief({ taskId: "t", tasksMdContent: sample });
    expect(brief).toContain("## PR self-grade template");
    expect(brief).toContain("- **Predicted**:");
    expect(brief).toContain("- **Observed**:");
    expect(brief).toContain("- **Match**: yes | no | partial");
    expect(brief).toContain("- **Lesson**:");
    expect(brief).toContain("DO NOT REWRITE THIS FORMAT");
    expect(brief).toMatch(/colon INSIDE bold[^\n]*\*\*Predicted:\*\*[^\n]*\*\*Match:\*\*/);
    expect(brief).toMatch(/values lowercase/);
  });

  it("directs the inner Claude at the auto-discovered body flow so the two body-only checks ride the same retry budget (slice 30/N + slice 35/N)", () => {
    // Pre-slice-30, the body-only checks (`pr-self-grade`,
    // `pr-security-review`) needed three separate commands and three
    // independent retry decisions. Slice 30 added `--body=<path>` to the
    // canonical `run-pre-pr-lint-stack.mjs`; slice 35 lifted auto-discovery
    // into the script so a `pr-body.md` adjacent to the run is picked up
    // without the flag — one less thing for the inner Claude to remember.
    // The brief now points at the consolidated, flagless invocation.
    const sample = [
      "# Tasks",
      "",
      "## P0",
      "",
      "- [ ] `t` — clean",
      "  - **ID**: t",
      "  - **Tags**: p0",
      "  - **Hypothesis**: H",
      "",
    ].join("\n");
    const brief = buildDaemonBrief({ taskId: "t", tasksMdContent: sample });
    expect(brief).toContain("pr-body.md");
    expect(brief).toContain("pnpm pre-pr-lint");
    expect(brief).toContain("pr-self-grade");
    expect(brief).toContain("pr-security-review");
  });
});

describe("extractOpenP0TaskIds", () => {
  it("returns only tasks tagged p0 inside the P0 section", () => {
    const sample = `# Tasks

## P0

- [ ] \`p0-real\` — true p0
  - **ID**: p0-real
  - **Tags**: p0, security

- [ ] \`mistagged\` — p1 mistakenly placed in P0 section
  - **ID**: mistagged
  - **Tags**: p1, observability

## P1

- [ ] \`p1-elsewhere\` — actual p1
  - **ID**: p1-elsewhere
  - **Tags**: p1
`;
    const ids = extractOpenP0TaskIds(sample);
    expect(ids).toEqual(["p0-real"]);
  });

  it("returns empty when no P0 section exists", () => {
    const sample = `# Tasks

## P1

- [ ] \`p1-only\` — only p1
  - **ID**: p1-only
  - **Tags**: p1
`;
    expect(extractOpenP0TaskIds(sample)).toEqual([]);
  });

  it("preserves file order so the first id is the highest-priority pick suggestion", () => {
    const sample = `# Tasks

## P0

- [ ] \`first\` — alpha
  - **ID**: first
  - **Tags**: p0

- [ ] \`second\` — beta
  - **ID**: second
  - **Tags**: p0

- [ ] \`third\` — gamma
  - **ID**: third
  - **Tags**: p0
`;
    expect(extractOpenP0TaskIds(sample)).toEqual(["first", "second", "third"]);
  });
});
