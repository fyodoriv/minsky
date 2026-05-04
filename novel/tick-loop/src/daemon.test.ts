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

import { BudgetGuard } from "@minsky/budget-guard";
import { StubTokenMonitor } from "@minsky/token-monitor";
import { describe, expect, it } from "vitest";

import { fromRealBudgetGuard } from "./budget-guard-facade.js";
import { type BudgetDecisionLike, type BudgetGuardLike, pickTask, runDaemon } from "./daemon.js";
import { SpanRecorder, TestFakeMockAnthropic, type TickSpan } from "./index.js";
import { DryRunSpawnStrategy, ProcessSpawnStrategy } from "./spawn-strategy.js";

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
