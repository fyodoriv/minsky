import { describe, expect, it } from "vitest";

import {
  CTO_AUDIT_PR_LABEL,
  CTO_PROMPT_HEADER,
  type CompletedIterationSignals,
  type CtoAuditLock,
  type CtoAuditSpawn,
  buildCtoBrief,
  runCtoAudit,
  shouldRunCtoAudit,
} from "./post-task-cto-audit.js";

function signals(overrides: Partial<CompletedIterationSignals> = {}): CompletedIterationSignals {
  return {
    completedTaskId: "test-task",
    prUrl: "https://github.com/fyodoriv/minsky/pull/999",
    filesChanged: ["src/foo.ts", "test/foo.test.ts"],
    recentMainCommits: ["feat: ship foo", "fix: foo edge case", "chore: bump foo deps"],
    openWorkItems: 3,
    lintScores: { rule3: 0.95, rule12: 0.8 },
    ...overrides,
  };
}

describe("buildCtoBrief", () => {
  it("includes the fixed CTO_PROMPT_HEADER unmodified", () => {
    const brief = buildCtoBrief(signals());
    expect(brief.startsWith(CTO_PROMPT_HEADER)).toBe(true);
  });

  it("includes the completed task id and PR URL", () => {
    const brief = buildCtoBrief(signals({ completedTaskId: "specific-id" }));
    expect(brief).toContain("`specific-id`");
    expect(brief).toContain("https://github.com/fyodoriv/minsky/pull/999");
  });

  it("renders '(no PR opened)' when prUrl is null", () => {
    const brief = buildCtoBrief(signals({ prUrl: null }));
    expect(brief).toContain("(no PR opened)");
  });

  it("renders all changed files in a bullet list", () => {
    const brief = buildCtoBrief(signals({ filesChanged: ["a.ts", "b.test.ts", "README.md"] }));
    expect(brief).toContain("Files changed (3)");
    expect(brief).toContain("  - a.ts");
    expect(brief).toContain("  - b.test.ts");
    expect(brief).toContain("  - README.md");
  });

  it("renders the no-op fallback when no files changed", () => {
    const brief = buildCtoBrief(signals({ filesChanged: [] }));
    expect(brief).toContain("(none — iteration may have been a no-op brief refresh)");
  });

  it("renders recent commits in oldest-first order", () => {
    const brief = buildCtoBrief(signals({ recentMainCommits: ["older", "middle", "newer"] }));
    const olderIdx = brief.indexOf("- older");
    const newerIdx = brief.indexOf("- newer");
    expect(olderIdx).toBeGreaterThan(0);
    expect(newerIdx).toBeGreaterThan(olderIdx);
  });

  it("renders lint pass-rates as percentages", () => {
    const brief = buildCtoBrief(signals({ lintScores: { rule3: 0.95, rule12: 0.8 } }));
    expect(brief).toContain("rule3: 95%");
    expect(brief).toContain("rule12: 80%");
  });

  it("renders a no-signal-yet fallback when lintScores is empty", () => {
    const brief = buildCtoBrief(signals({ lintScores: {} }));
    expect(brief).toContain("(no signal yet)");
  });

  it("includes the open-work-items count", () => {
    const brief = buildCtoBrief(signals({ openWorkItems: 42 }));
    expect(brief).toContain("Open work items (issues + PRs): 42");
  });

  it("ends with the 'Your task now' framing", () => {
    const brief = buildCtoBrief(signals());
    expect(brief).toContain("## Your task now");
    expect(brief).toContain("highest-leverage next task");
  });
});

describe("CTO_AUDIT_PR_LABEL — measurement contract", () => {
  it("matches the exact label the pre-registered measurement command queries", () => {
    // The TASKS.md `Measurement` line for `post-task-cto-audit` runs:
    //   gh pr list --label minsky:cto-audit --state all ...
    // If this constant drifts, the metric silently returns 0 forever.
    expect(CTO_AUDIT_PR_LABEL).toBe("minsky:cto-audit");
  });

  it("is referenced in the prompt header so the spawned audit applies it", () => {
    expect(CTO_PROMPT_HEADER).toContain(CTO_AUDIT_PR_LABEL);
  });
});

describe("CTO_PROMPT_HEADER — branch + PR conventions", () => {
  it("instructs the spawned audit to use the audit/<date>-<task-id> branch convention", () => {
    expect(CTO_PROMPT_HEADER).toContain("audit/<UTC-date>-<completed-task-id>");
  });

  it("instructs the spawned audit to label its PR with the canonical label", () => {
    expect(CTO_PROMPT_HEADER).toContain(`Label the PR \`${CTO_AUDIT_PR_LABEL}\``);
  });

  it("includes the bootstrap snippet that creates the label if missing", () => {
    expect(CTO_PROMPT_HEADER).toContain("gh label create minsky:cto-audit");
  });

  it("instructs the audit to apply the label at PR-create time (not retroactively)", () => {
    expect(CTO_PROMPT_HEADER).toContain("gh pr create --label");
  });
});

describe("shouldRunCtoAudit", () => {
  const baseArgs = {
    status: "completed" as const,
    filesChanged: ["src/foo.ts"],
    prUrl: null,
    env: {},
  };

  it("runs on a completed iteration with files changed", () => {
    expect(shouldRunCtoAudit(baseArgs)).toBe(true);
  });

  it("runs on a completed iteration that opened a PR (even with no files locally)", () => {
    expect(
      shouldRunCtoAudit({
        ...baseArgs,
        filesChanged: [],
        prUrl: "https://github.com/fyodoriv/minsky/pull/123",
      }),
    ).toBe(true);
  });

  it("skips a no-op completed iteration (no files + no PR)", () => {
    expect(shouldRunCtoAudit({ ...baseArgs, filesChanged: [], prUrl: null })).toBe(false);
  });

  it("skips budget-paused iterations", () => {
    expect(shouldRunCtoAudit({ ...baseArgs, status: "budget-paused" })).toBe(false);
  });

  it("skips failed iterations", () => {
    expect(shouldRunCtoAudit({ ...baseArgs, status: "failed" })).toBe(false);
  });

  it("respects MINSKY_CTO_AUDIT=off env override", () => {
    expect(shouldRunCtoAudit({ ...baseArgs, env: { MINSKY_CTO_AUDIT: "off" } })).toBe(false);
  });

  it("ignores MINSKY_CTO_AUDIT values other than 'off'", () => {
    expect(shouldRunCtoAudit({ ...baseArgs, env: { MINSKY_CTO_AUDIT: "on" } })).toBe(true);
    expect(shouldRunCtoAudit({ ...baseArgs, env: { MINSKY_CTO_AUDIT: "" } })).toBe(true);
  });
});

describe("runCtoAudit", () => {
  function makeSpawn(): {
    spawn: CtoAuditSpawn;
    calls: Array<{ taskId: string; brief: string }>;
  } {
    const calls: Array<{ taskId: string; brief: string }> = [];
    const spawn: CtoAuditSpawn = {
      spawn: async (input) => {
        calls.push({ taskId: input.taskId, brief: input.brief });
        return { exitCode: 0, durationMs: 12, stdoutTail: "audit ran", stderrTail: "" };
      },
    };
    return { spawn, calls };
  }

  function makeLock(initial: readonly string[] = []): CtoAuditLock & { held: Set<string> } {
    const held = new Set<string>(initial);
    return {
      held,
      lockExists: (taskId) => held.has(taskId),
      acquireLock: (taskId) => {
        held.add(taskId);
      },
    };
  }

  const baseSignals: CompletedIterationSignals = {
    completedTaskId: "shipped-task",
    prUrl: "https://github.com/fyodoriv/minsky/pull/501",
    filesChanged: ["src/foo.ts"],
    recentMainCommits: ["feat: ship foo"],
    openWorkItems: 4,
    lintScores: {},
  };

  it("skips when shouldRunCtoAudit gate rejects (env=off)", async () => {
    const { spawn, calls } = makeSpawn();
    const lock = makeLock();
    const result = await runCtoAudit({
      signals: baseSignals,
      status: "completed",
      env: { MINSKY_CTO_AUDIT: "off" },
      spawn,
      lock,
    });
    expect(result).toEqual({ outcome: "skipped", reason: "gate-rejected" });
    expect(calls).toHaveLength(0);
    expect(lock.held.size).toBe(0);
  });

  it("skips no-op iterations (no files + no PR)", async () => {
    const { spawn, calls } = makeSpawn();
    const lock = makeLock();
    const result = await runCtoAudit({
      signals: { ...baseSignals, filesChanged: [], prUrl: null },
      status: "completed",
      env: {},
      spawn,
      lock,
    });
    expect(result).toEqual({ outcome: "skipped", reason: "gate-rejected" });
    expect(calls).toHaveLength(0);
  });

  it("skips when the just-completed task is the audit itself (no recurse)", async () => {
    const { spawn, calls } = makeSpawn();
    const lock = makeLock();
    const result = await runCtoAudit({
      signals: { ...baseSignals, completedTaskId: "cto-audit" },
      status: "completed",
      env: {},
      spawn,
      lock,
    });
    expect(result).toEqual({ outcome: "skipped", reason: "no-recurse" });
    expect(calls).toHaveLength(0);
    expect(lock.held.size).toBe(0);
  });

  it("skips when a lock is already held for the task (idempotent)", async () => {
    const { spawn, calls } = makeSpawn();
    const lock = makeLock(["shipped-task"]);
    const result = await runCtoAudit({
      signals: baseSignals,
      status: "completed",
      env: {},
      spawn,
      lock,
    });
    expect(result).toEqual({ outcome: "skipped", reason: "lock-held" });
    expect(calls).toHaveLength(0);
  });

  it("acquires the lock and spawns with the CTO brief on the happy path", async () => {
    const { spawn, calls } = makeSpawn();
    const lock = makeLock();
    const result = await runCtoAudit({
      signals: baseSignals,
      status: "completed",
      env: {},
      spawn,
      lock,
    });
    expect(result.outcome).toBe("ran");
    expect(lock.held.has("shipped-task")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.taskId).toBe("cto-audit:shipped-task");
    expect(calls[0]?.brief.startsWith(CTO_PROMPT_HEADER)).toBe(true);
    expect(calls[0]?.brief).toContain("`shipped-task`");
  });

  it("returns the spawn result fields when the audit ran", async () => {
    const spawn: CtoAuditSpawn = {
      spawn: async () => ({
        exitCode: 7,
        durationMs: 999,
        stdoutTail: "out",
        stderrTail: "err",
      }),
    };
    const lock = makeLock();
    const result = await runCtoAudit({
      signals: baseSignals,
      status: "completed",
      env: {},
      spawn,
      lock,
    });
    expect(result).toEqual({
      outcome: "ran",
      exitCode: 7,
      durationMs: 999,
      stdoutTail: "out",
      stderrTail: "err",
    });
  });

  it("acquires the lock BEFORE spawn so a mid-spawn crash does not double-fire on restart", async () => {
    const lock = makeLock();
    let lockHeldAtSpawn = false;
    const spawn: CtoAuditSpawn = {
      spawn: async () => {
        lockHeldAtSpawn = lock.lockExists("shipped-task");
        return { exitCode: 0, durationMs: 0, stdoutTail: "", stderrTail: "" };
      },
    };
    await runCtoAudit({
      signals: baseSignals,
      status: "completed",
      env: {},
      spawn,
      lock,
    });
    expect(lockHeldAtSpawn).toBe(true);
  });
});
