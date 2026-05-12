// Paired tests for `host-loop.ts` — the continuous host-mode iteration
// orchestrator. Pure unit tests with in-memory fakes for every seam.
//
// Source: TASKS.md `cross-repo-host-daemon-loop`; rule #3 (test-first).

import { describe, expect, test } from "vitest";

import type { LiveSpawnOutcome } from "./runner.js";
import type { RunnerPlan } from "./spawn-plan.js";
import type { ParsedTask } from "./task-finder.js";

import { runHostLoop } from "./host-loop.js";

const baseTask: ParsedTask = {
  id: "fake-task-1",
  title: "Fake task 1",
  priority: "P0",
  tags: ["bug"],
  details: "details",
  hypothesis: "hypothesis",
  success: "≥0.8",
  pivot: "<0.5",
  measurement: "yarn vitest run",
  anchor: "rule #9",
};

function makePlan(taskId: string): RunnerPlan {
  return {
    workingDirectory: "/tmp/fake-host",
    taskId,
    branchName: `feat/${taskId}`,
    experimentYamlPath: `/tmp/fake-host/.minsky/experiments/${taskId}.yaml`,
    env: { MINSKY_HOST_ROOT: "/tmp/fake-host/.minsky" },
    systemPromptOverlay: "system prompt",
    brief: "task brief",
    preCommitCommand: "yarn lint",
  };
}

function makeOutcome(overrides: Partial<LiveSpawnOutcome> = {}): LiveSpawnOutcome {
  return {
    verdict: "validated",
    stdoutTail: "",
    stderrTail: "",
    exitCode: 0,
    durationMs: 100,
    scopeLeakPaths: [],
    prUrl: null,
    baselineRef: "abc1234",
    ...overrides,
  };
}

function fakeSeams() {
  const spawn = {
    spawn: () => Promise.resolve({ exitCode: 0, durationMs: 0, stdoutTail: "", stderrTail: "" }),
  };
  const git = {
    captureBaseline: () => Promise.resolve("abc1234"),
    changedFiles: () => Promise.resolve([] as readonly string[]),
  };
  const globMatchesPath = (_glob: string, _path: string): boolean => true;
  return { spawn, git, globMatchesPath };
}

describe("runHostLoop — stop conditions", () => {
  test("empty-queue when pickTask returns null on the first iteration", async () => {
    const { spawn, git, globMatchesPath } = fakeSeams();
    const result = await runHostLoop({
      pickTask: () => null,
      buildPlan: (t) => makePlan(t.id),
      resolveAllowedPaths: () => [],
      runLive: () => Promise.resolve(makeOutcome()),
      spawn,
      git,
      globMatchesPath,
      maxIterations: 10,
      tickIntervalMs: 0,
    });
    expect(result.stopReason).toBe("empty-queue");
    expect(result.iterations).toEqual([]);
  });

  test("max-iterations when the queue has more tasks than the cap", async () => {
    const { spawn, git, globMatchesPath } = fakeSeams();
    let n = 0;
    const result = await runHostLoop({
      pickTask: () => ({ ...baseTask, id: `task-${n++}` }),
      buildPlan: (t) => makePlan(t.id),
      resolveAllowedPaths: () => [],
      runLive: () => Promise.resolve(makeOutcome()),
      spawn,
      git,
      globMatchesPath,
      maxIterations: 3,
      tickIntervalMs: 0,
    });
    expect(result.stopReason).toBe("max-iterations");
    expect(result.iterations).toHaveLength(3);
    expect(result.iterations.map((i) => i.taskId)).toEqual(["task-0", "task-1", "task-2"]);
  });

  test("scope-leak halts on the first leaked iteration", async () => {
    const { spawn, git, globMatchesPath } = fakeSeams();
    let n = 0;
    const result = await runHostLoop({
      pickTask: () => ({ ...baseTask, id: `task-${n++}` }),
      buildPlan: (t) => makePlan(t.id),
      resolveAllowedPaths: () => ["src/**"],
      runLive: (inputs) => {
        if (inputs.plan.taskId === "task-2") {
          return Promise.resolve(
            makeOutcome({ verdict: "scope-leak", scopeLeakPaths: ["package.json"] }),
          );
        }
        return Promise.resolve(makeOutcome());
      },
      spawn,
      git,
      globMatchesPath,
      maxIterations: 10,
      tickIntervalMs: 0,
    });
    expect(result.stopReason).toBe("scope-leak");
    expect(result.iterations).toHaveLength(3);
    expect(result.iterations[2]?.scopeLeakPaths).toEqual(["package.json"]);
  });

  test("spawn-failed halts on the first non-zero spawn exit", async () => {
    const { spawn, git, globMatchesPath } = fakeSeams();
    let n = 0;
    const result = await runHostLoop({
      pickTask: () => ({ ...baseTask, id: `task-${n++}` }),
      buildPlan: (t) => makePlan(t.id),
      resolveAllowedPaths: () => [],
      runLive: () => Promise.resolve(makeOutcome({ verdict: "spawn-failed", exitCode: 137 })),
      spawn,
      git,
      globMatchesPath,
      maxIterations: 10,
      tickIntervalMs: 0,
    });
    expect(result.stopReason).toBe("spawn-failed");
    expect(result.iterations).toHaveLength(1);
    expect(result.iterations[0]?.verdict).toBe("spawn-failed");
  });

  test("aborted when AbortSignal fires BEFORE the first iteration", async () => {
    const { spawn, git, globMatchesPath } = fakeSeams();
    const controller = new AbortController();
    controller.abort();
    const result = await runHostLoop({
      pickTask: () => baseTask,
      buildPlan: (t) => makePlan(t.id),
      resolveAllowedPaths: () => [],
      runLive: () => Promise.resolve(makeOutcome()),
      spawn,
      git,
      globMatchesPath,
      maxIterations: 10,
      tickIntervalMs: 0,
      signal: controller.signal,
    });
    expect(result.stopReason).toBe("aborted");
    expect(result.iterations).toEqual([]);
  });

  test("aborted when AbortSignal fires during the inter-iteration sleep", async () => {
    const { spawn, git, globMatchesPath } = fakeSeams();
    const controller = new AbortController();
    let iterations = 0;
    const result = await runHostLoop({
      pickTask: () => ({ ...baseTask, id: `task-${iterations++}` }),
      buildPlan: (t) => makePlan(t.id),
      resolveAllowedPaths: () => [],
      runLive: () => {
        if (iterations === 1) controller.abort();
        return Promise.resolve(makeOutcome());
      },
      spawn,
      git,
      globMatchesPath,
      maxIterations: 10,
      tickIntervalMs: 1000,
      signal: controller.signal,
    });
    expect(result.stopReason).toBe("aborted");
    expect(result.iterations).toHaveLength(1);
  });
});

describe("runHostLoop — happy path", () => {
  test("emits recordIteration per loop with the correct verdict", async () => {
    const { spawn, git, globMatchesPath } = fakeSeams();
    let n = 0;
    const records: { iteration: number; taskId: string; verdict: string }[] = [];
    await runHostLoop({
      pickTask: () => ({ ...baseTask, id: `task-${n++}` }),
      buildPlan: (t) => makePlan(t.id),
      resolveAllowedPaths: () => [],
      runLive: () => Promise.resolve(makeOutcome()),
      spawn,
      git,
      globMatchesPath,
      maxIterations: 2,
      tickIntervalMs: 0,
      recordIteration: (rec) =>
        records.push({ iteration: rec.iteration, taskId: rec.taskId, verdict: rec.verdict }),
    });
    expect(records).toEqual([
      { iteration: 0, taskId: "task-0", verdict: "validated" },
      { iteration: 1, taskId: "task-1", verdict: "validated" },
    ]);
  });

  test("threads PR URL from runLive through the iteration record", async () => {
    const { spawn, git, globMatchesPath } = fakeSeams();
    const records: { prUrl: string | null }[] = [];
    await runHostLoop({
      pickTask: () => baseTask,
      buildPlan: (t) => makePlan(t.id),
      resolveAllowedPaths: () => [],
      runLive: () =>
        Promise.resolve(makeOutcome({ prUrl: "https://github.com/test/repo/pull/42" })),
      spawn,
      git,
      globMatchesPath,
      maxIterations: 1,
      tickIntervalMs: 0,
      recordIteration: (rec) => records.push({ prUrl: rec.prUrl }),
    });
    expect(records).toEqual([{ prUrl: "https://github.com/test/repo/pull/42" }]);
  });

  test("calls sleep between iterations (NOT after the final one)", async () => {
    const { spawn, git, globMatchesPath } = fakeSeams();
    let n = 0;
    const sleepCalls: number[] = [];
    await runHostLoop({
      pickTask: () => ({ ...baseTask, id: `task-${n++}` }),
      buildPlan: (t) => makePlan(t.id),
      resolveAllowedPaths: () => [],
      runLive: () => Promise.resolve(makeOutcome()),
      spawn,
      git,
      globMatchesPath,
      maxIterations: 3,
      tickIntervalMs: 1234,
      sleep: (ms) => {
        sleepCalls.push(ms);
        return Promise.resolve();
      },
    });
    // 3 iterations → 2 inter-iteration sleeps.
    expect(sleepCalls).toEqual([1234, 1234]);
  });
});

describe("runHostLoop — let-it-crash propagation", () => {
  test("rethrows pickTask errors per rule #6 (no catch)", async () => {
    const { spawn, git, globMatchesPath } = fakeSeams();
    await expect(
      runHostLoop({
        pickTask: () => {
          throw new Error("pickTask exploded");
        },
        buildPlan: (t) => makePlan(t.id),
        resolveAllowedPaths: () => [],
        runLive: () => Promise.resolve(makeOutcome()),
        spawn,
        git,
        globMatchesPath,
        maxIterations: 10,
        tickIntervalMs: 0,
      }),
    ).rejects.toThrow("pickTask exploded");
  });

  test("rethrows runLive errors per rule #6 (no catch)", async () => {
    const { spawn, git, globMatchesPath } = fakeSeams();
    await expect(
      runHostLoop({
        pickTask: () => baseTask,
        buildPlan: (t) => makePlan(t.id),
        resolveAllowedPaths: () => [],
        runLive: () => Promise.reject(new Error("runLive exploded")),
        spawn,
        git,
        globMatchesPath,
        maxIterations: 10,
        tickIntervalMs: 0,
      }),
    ).rejects.toThrow("runLive exploded");
  });
});

describe("runHostLoop — CTO audit seam", () => {
  function fakeCtoSignals() {
    return {
      hostRepo: "test/repo",
      hostRoot: "/tmp/fake",
      tasksMdPath: "TASKS.md",
      reason: "post-iteration" as const,
      completedTaskId: "x",
      prUrl: null,
      filesChanged: [],
      utcDate: "2026-05-11",
    };
  }

  test("fires post-iteration audit on validated verdict when seam is wired", async () => {
    const { spawn, git, globMatchesPath } = fakeSeams();
    const auditCalls: { reason: string; completedTaskId: string | null }[] = [];
    let n = 0;
    await runHostLoop({
      pickTask: () => ({ ...baseTask, id: `task-${n++}` }),
      buildPlan: (t) => makePlan(t.id),
      resolveAllowedPaths: () => [],
      runLive: () => Promise.resolve(makeOutcome()),
      spawn,
      git,
      globMatchesPath,
      maxIterations: 2,
      tickIntervalMs: 0,
      ctoAudit: ({ signals }) => {
        auditCalls.push({ reason: signals.reason, completedTaskId: signals.completedTaskId });
        return Promise.resolve({ outcome: "skipped", reason: "test-fake-skipped" });
      },
      buildCtoSignals: (args) => ({
        ...fakeCtoSignals(),
        reason: args.reason,
        completedTaskId: args.completedTaskId,
      }),
    });
    expect(auditCalls).toEqual([
      { reason: "post-iteration", completedTaskId: "task-0" },
      { reason: "post-iteration", completedTaskId: "task-1" },
    ]);
  });

  test("does NOT fire post-iteration audit on scope-leak verdict", async () => {
    const { spawn, git, globMatchesPath } = fakeSeams();
    let auditFired = false;
    await runHostLoop({
      pickTask: () => baseTask,
      buildPlan: (t) => makePlan(t.id),
      resolveAllowedPaths: () => ["src/**"],
      runLive: () =>
        Promise.resolve(makeOutcome({ verdict: "scope-leak", scopeLeakPaths: ["x.ts"] })),
      spawn,
      git,
      globMatchesPath,
      maxIterations: 5,
      tickIntervalMs: 0,
      ctoAudit: () => {
        auditFired = true;
        return Promise.resolve({ outcome: "skipped", reason: "should-not-fire" });
      },
      buildCtoSignals: (args) => ({ ...fakeCtoSignals(), reason: args.reason }),
    });
    expect(auditFired).toBe(false);
  });

  test("seedOnEmpty: empty-queue triggers seed audit + re-pick", async () => {
    const { spawn, git, globMatchesPath } = fakeSeams();
    let pickCount = 0;
    const auditCalls: { reason: string }[] = [];
    const result = await runHostLoop({
      pickTask: () => {
        pickCount++;
        // First call: empty. After audit, return a task. Then empty again to exit.
        if (pickCount === 1) return null;
        if (pickCount === 2) return baseTask;
        return null;
      },
      buildPlan: (t) => makePlan(t.id),
      resolveAllowedPaths: () => [],
      runLive: () => Promise.resolve(makeOutcome()),
      spawn,
      git,
      globMatchesPath,
      maxIterations: 5,
      tickIntervalMs: 0,
      seedOnEmpty: true,
      ctoAudit: ({ signals }) => {
        auditCalls.push({ reason: signals.reason });
        return Promise.resolve({ outcome: "skipped", reason: "test-fake-skipped" });
      },
      buildCtoSignals: (args) => ({ ...fakeCtoSignals(), reason: args.reason }),
    });
    expect(auditCalls.some((c) => c.reason === "queue-empty")).toBe(true);
    expect(result.iterations.length).toBeGreaterThanOrEqual(1);
  });

  test("seedOnEmpty=false: empty-queue exits immediately even with audit wired", async () => {
    const { spawn, git, globMatchesPath } = fakeSeams();
    let auditFired = false;
    const result = await runHostLoop({
      pickTask: () => null,
      buildPlan: (t) => makePlan(t.id),
      resolveAllowedPaths: () => [],
      runLive: () => Promise.resolve(makeOutcome()),
      spawn,
      git,
      globMatchesPath,
      maxIterations: 5,
      tickIntervalMs: 0,
      seedOnEmpty: false,
      ctoAudit: () => {
        auditFired = true;
        return Promise.resolve({ outcome: "skipped", reason: "should-not-fire" });
      },
      buildCtoSignals: (args) => ({ ...fakeCtoSignals(), reason: args.reason }),
    });
    expect(auditFired).toBe(false);
    expect(result.stopReason).toBe("empty-queue");
  });

  test("seed audit fires only ONCE per empty-queue event (bounded re-pick)", async () => {
    const { spawn, git, globMatchesPath } = fakeSeams();
    let auditCount = 0;
    const result = await runHostLoop({
      // Always returns null — audit can't fix it.
      pickTask: () => null,
      buildPlan: (t) => makePlan(t.id),
      resolveAllowedPaths: () => [],
      runLive: () => Promise.resolve(makeOutcome()),
      spawn,
      git,
      globMatchesPath,
      maxIterations: 5,
      tickIntervalMs: 0,
      seedOnEmpty: true,
      ctoAudit: () => {
        auditCount++;
        return Promise.resolve({ outcome: "skipped", reason: "test-fake-skipped" });
      },
      buildCtoSignals: (args) => ({ ...fakeCtoSignals(), reason: args.reason }),
    });
    expect(auditCount).toBe(1);
    expect(result.stopReason).toBe("empty-queue");
  });

  test("audit NOT fired when seam is missing (slice-B-default behaviour preserved)", async () => {
    const { spawn, git, globMatchesPath } = fakeSeams();
    const result = await runHostLoop({
      pickTask: () => baseTask,
      buildPlan: (t) => makePlan(t.id),
      resolveAllowedPaths: () => [],
      runLive: () => Promise.resolve(makeOutcome()),
      spawn,
      git,
      globMatchesPath,
      maxIterations: 1,
      tickIntervalMs: 0,
    });
    // No audit options passed; loop completes normally.
    expect(result.stopReason).toBe("max-iterations");
    expect(result.iterations).toHaveLength(1);
  });
});
