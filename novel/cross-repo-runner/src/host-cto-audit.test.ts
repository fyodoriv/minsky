// Paired tests for `host-cto-audit.ts`.
//
// Source: TASKS.md `cross-repo-cto-audit-host-mode`; rule #3 (test-first).

import { describe, expect, test } from "vitest";

import {
  HOST_CTO_AUDIT_PR_LABEL,
  HOST_CTO_PROMPT_HEADER,
  buildHostCtoBrief,
  runHostCtoAudit,
  shouldRunHostCtoAudit,
} from "./host-cto-audit.js";
import type { HostCtoSignals } from "./host-cto-audit.js";

function baseSignals(overrides: Partial<HostCtoSignals> = {}): HostCtoSignals {
  return {
    hostRepo: "test-org/test-host",
    hostRoot: "/tmp/fake-host",
    tasksMdPath: "TASKS.md",
    reason: "post-iteration",
    completedTaskId: "proj-840-slash-command-labels",
    prUrl: "https://github.com/test-org/test-host/pull/42",
    filesChanged: ["src/foo.ts", "src/foo.test.ts"],
    utcDate: "2026-05-11",
    ...overrides,
  };
}

describe("HOST_CTO_PROMPT_HEADER", () => {
  test("includes the rule-#9 substrate requirements verbatim", () => {
    for (const field of ["Hypothesis", "Success", "Pivot", "Measurement", "Anchor"]) {
      expect(HOST_CTO_PROMPT_HEADER).toContain(field);
    }
  });

  test("includes the anti-vanity-metric guard (Ries 2011)", () => {
    expect(HOST_CTO_PROMPT_HEADER).toContain("vanity");
    expect(HOST_CTO_PROMPT_HEADER).toContain("Ries 2011");
  });

  test("includes the PR-label convention so the metric can count audit PRs", () => {
    expect(HOST_CTO_PROMPT_HEADER).toContain(HOST_CTO_AUDIT_PR_LABEL);
  });

  test("explicitly refuses fabrication of work", () => {
    expect(HOST_CTO_PROMPT_HEADER).toContain("DO NOT");
    expect(HOST_CTO_PROMPT_HEADER).toContain("fabricate");
  });
});

describe("buildHostCtoBrief", () => {
  test("renders the post-iteration shape with the completed task ID + PR URL", () => {
    const brief = buildHostCtoBrief(baseSignals());
    expect(brief).toContain("test-org/test-host");
    expect(brief).toContain("proj-840-slash-command-labels");
    expect(brief).toContain("https://github.com/test-org/test-host/pull/42");
    expect(brief).toContain("Just-completed iteration");
    expect(brief).toContain("audit/2026-05-11-proj-840-slash-command-labels");
  });

  test("renders the queue-empty shape with the seed-audit branch name", () => {
    const brief = buildHostCtoBrief(
      baseSignals({
        reason: "queue-empty",
        completedTaskId: null,
        prUrl: null,
        filesChanged: [],
      }),
    );
    expect(brief).toContain("Queue-empty seed audit");
    expect(brief).toContain("audit/2026-05-11-cross-repo-seed");
    expect(brief).toContain("Seed it with 1-3 rule-#9-compliant task blocks");
  });

  test("renders 'no files changed' message when filesChanged is empty", () => {
    const brief = buildHostCtoBrief(baseSignals({ filesChanged: [] }));
    expect(brief).toContain("Files changed: (none");
  });

  test("renders the list of changed files when present", () => {
    const brief = buildHostCtoBrief(baseSignals({ filesChanged: ["a.ts", "b.ts", "c.ts"] }));
    expect(brief).toContain("Files changed (3)");
    expect(brief).toContain("a.ts");
    expect(brief).toContain("b.ts");
    expect(brief).toContain("c.ts");
  });

  test("includes the audit's exit-without-PR escape hatch", () => {
    const brief = buildHostCtoBrief(baseSignals());
    expect(brief).toContain("no high-leverage task");
  });

  test("renders 'no PR opened' when prUrl is null", () => {
    const brief = buildHostCtoBrief(baseSignals({ prUrl: null }));
    expect(brief).toContain("PR: (no PR opened)");
  });
});

describe("shouldRunHostCtoAudit — post-iteration", () => {
  test("fires when verdict is validated + task id present + env allows", () => {
    const gate = shouldRunHostCtoAudit({
      reason: "post-iteration",
      completedVerdict: "validated",
      completedTaskId: "some-task",
      env: {},
    });
    expect(gate.fire).toBe(true);
  });

  test("skips when verdict is scope-leak", () => {
    const gate = shouldRunHostCtoAudit({
      reason: "post-iteration",
      completedVerdict: "scope-leak",
      completedTaskId: "some-task",
      env: {},
    });
    expect(gate.fire).toBe(false);
    expect(gate.reason).toContain("scope-leak");
  });

  test("skips when verdict is spawn-failed", () => {
    const gate = shouldRunHostCtoAudit({
      reason: "post-iteration",
      completedVerdict: "spawn-failed",
      completedTaskId: "some-task",
      env: {},
    });
    expect(gate.fire).toBe(false);
    expect(gate.reason).toContain("spawn-failed");
  });

  test("skips when completedTaskId is null (no-iteration case)", () => {
    const gate = shouldRunHostCtoAudit({
      reason: "post-iteration",
      completedVerdict: "validated",
      completedTaskId: null,
      env: {},
    });
    expect(gate.fire).toBe(false);
    expect(gate.reason).toContain("skip-no-task-id");
  });

  test("recursion guard: cross-repo-cto- task IDs DO NOT trigger another audit", () => {
    const gate = shouldRunHostCtoAudit({
      reason: "post-iteration",
      completedVerdict: "validated",
      completedTaskId: "cross-repo-cto-audit-host-mode",
      env: {},
    });
    expect(gate.fire).toBe(false);
    expect(gate.reason).toContain("no-recurse");
  });

  test("recursion guard: cto-audit- task IDs DO NOT trigger another audit", () => {
    const gate = shouldRunHostCtoAudit({
      reason: "post-iteration",
      completedVerdict: "validated",
      completedTaskId: "cto-audit-something",
      env: {},
    });
    expect(gate.fire).toBe(false);
    expect(gate.reason).toContain("no-recurse");
  });
});

describe("shouldRunHostCtoAudit — queue-empty", () => {
  test("fires when reason is queue-empty (no verdict required)", () => {
    const gate = shouldRunHostCtoAudit({
      reason: "queue-empty",
      completedVerdict: null,
      completedTaskId: null,
      env: {},
    });
    expect(gate.fire).toBe(true);
    expect(gate.reason).toBe("queue-empty");
  });
});

describe("shouldRunHostCtoAudit — env override", () => {
  test("MINSKY_HOST_CTO_AUDIT=off skips both reasons", () => {
    const postIter = shouldRunHostCtoAudit({
      reason: "post-iteration",
      completedVerdict: "validated",
      completedTaskId: "some-task",
      env: { MINSKY_HOST_CTO_AUDIT: "off" },
    });
    const queueEmpty = shouldRunHostCtoAudit({
      reason: "queue-empty",
      completedVerdict: null,
      completedTaskId: null,
      env: { MINSKY_HOST_CTO_AUDIT: "off" },
    });
    expect(postIter.fire).toBe(false);
    expect(postIter.reason).toContain("env-override");
    expect(queueEmpty.fire).toBe(false);
    expect(queueEmpty.reason).toContain("env-override");
  });
});

describe("runHostCtoAudit — orchestrator", () => {
  test("returns skipped when the gate rejects", async () => {
    const outcome = await runHostCtoAudit({
      signals: baseSignals(),
      completedVerdict: "scope-leak",
      env: {},
      spawn: { spawn: () => Promise.reject(new Error("should not be called")) },
    });
    expect(outcome.outcome).toBe("skipped");
  });

  test("calls spawn with the brief on stdin when the gate fires", async () => {
    const calls: { brief: string; taskId: string }[] = [];
    const outcome = await runHostCtoAudit({
      signals: baseSignals(),
      completedVerdict: "validated",
      env: {},
      spawn: {
        spawn(input) {
          calls.push({ brief: input.brief, taskId: input.taskId });
          return Promise.resolve({
            exitCode: 0,
            durationMs: 4321,
            stdoutTail: "PR https://github.com/test-org/test-host/pull/99",
            stderrTail: "",
          });
        },
      },
    });
    expect(outcome.outcome).toBe("ran");
    if (outcome.outcome !== "ran") return;
    expect(outcome.exitCode).toBe(0);
    expect(outcome.durationMs).toBe(4321);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.brief).toContain("proj-840-slash-command-labels");
    expect(calls[0]?.taskId).toBe("host-cto-audit-2026-05-11");
  });

  test("propagates spawn errors per let-it-crash (no catch)", async () => {
    await expect(
      runHostCtoAudit({
        signals: baseSignals(),
        completedVerdict: "validated",
        env: {},
        spawn: { spawn: () => Promise.reject(new Error("spawn exploded")) },
      }),
    ).rejects.toThrow("spawn exploded");
  });

  test("returns the spawn's exit code even when non-zero (operator-visible)", async () => {
    const outcome = await runHostCtoAudit({
      signals: baseSignals({ reason: "queue-empty", completedTaskId: null }),
      completedVerdict: null,
      env: {},
      spawn: {
        spawn: () =>
          Promise.resolve({
            exitCode: 1,
            durationMs: 100,
            stdoutTail: "no high-leverage task",
            stderrTail: "",
          }),
      },
    });
    expect(outcome.outcome).toBe("ran");
    if (outcome.outcome === "ran") expect(outcome.exitCode).toBe(1);
  });
});
