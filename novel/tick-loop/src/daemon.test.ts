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

import { BudgetGuard } from "@minsky/budget-guard";
import { StubTokenMonitor } from "@minsky/token-monitor";
import { describe, expect, it } from "vitest";

import { fromRealBudgetGuard } from "./budget-guard-facade.js";
import { type BudgetDecisionLike, type BudgetGuardLike, pickTask, runDaemon } from "./daemon.js";
import { SpanRecorder, TestFakeMockAnthropic, type TickSpan } from "./index.js";

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

  it("throws on dryRun: false (real-spawn deferred to v1)", async () => {
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

  it("ignores P2 tasks", () => {
    const onlyP2 = "# Tasks\n\n## P0\n\n## P2\n\n- [ ] only\n  - **ID**: only\n";
    expect(pickTask(onlyP2)).toBeUndefined();
  });

  it("returns undefined when nothing is pickable", () => {
    expect(pickTask("# Tasks\n\n## P0\n\n")).toBeUndefined();
  });
});
