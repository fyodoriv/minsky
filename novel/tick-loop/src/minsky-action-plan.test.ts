/**
 * Paired tests for `minsky-action-plan.ts` — slice 2 of
 * `minsky-cli-context-aware-ux`.
 *
 * One test per scenario; each uses a synthetic `MinskyContext` fixture
 * that satisfies the scenario's detection condition.
 */

import { describe, expect, it } from "vitest";
import { type MinskyActionPlan, type Scenario, planMinskyAction } from "./minsky-action-plan.js";
import type { MinskyContext } from "./minsky-context.js";

// ---- Fixtures ---------------------------------------------------------------

const BASE: MinskyContext = {
  workerState: { alive: false },
  lastIterationAgeMs: undefined,
  claudeState: "unknown",
  localLlmState: "not-running",
  gitState: "clean",
  prStats: { open: 0, conflicting: 0 },
  queueState: "has-tasks",
};

function ctx(overrides: Partial<MinskyContext> = {}): MinskyContext {
  return { ...BASE, ...overrides };
}

// ---- Scenario: worker-already-running ----------------------------------------

describe("planMinskyAction — worker-already-running", () => {
  it("recommends attach-worker when worker PID is alive", () => {
    const plan: MinskyActionPlan = planMinskyAction(ctx({ workerState: { alive: true, pid: 99 } }));
    expect(plan.scenario).toBe<Scenario>("worker-already-running");
    expect(plan.recommendedAction.id).toBe("attach-worker");
    expect(plan.contextSummary).toContain("99");
  });

  it("includes stop-worker and run-doctor as alternatives", () => {
    const plan = planMinskyAction(ctx({ workerState: { alive: true, pid: 1 } }));
    const ids = plan.alternatives.map((a) => a.id);
    expect(ids).toContain("stop-worker");
    expect(ids).toContain("run-doctor");
  });
});

// ---- Scenario: claude-exhausted-with-local-stack ----------------------------

describe("planMinskyAction — claude-exhausted-with-local-stack", () => {
  it("recommends start-worker-local-llm when claude exhausted + local-LLM running", () => {
    const plan = planMinskyAction(ctx({ claudeState: "exhausted", localLlmState: "running" }));
    expect(plan.scenario).toBe<Scenario>("claude-exhausted-with-local-stack");
    expect(plan.recommendedAction.id).toBe("start-worker-local-llm");
  });
});

// ---- Scenario: claude-exhausted-no-stack ------------------------------------

describe("planMinskyAction — claude-exhausted-no-stack", () => {
  it("recommends bootstrap-local-llm when claude exhausted + local-LLM not running", () => {
    const plan = planMinskyAction(ctx({ claudeState: "exhausted", localLlmState: "not-running" }));
    expect(plan.scenario).toBe<Scenario>("claude-exhausted-no-stack");
    expect(plan.recommendedAction.id).toBe("bootstrap-local-llm");
  });
});

// ---- Scenario: git-dirty-cant-iterate ----------------------------------------

describe("planMinskyAction — git-dirty-cant-iterate", () => {
  it("detects dirty git state when claude is healthy", () => {
    const plan = planMinskyAction(ctx({ gitState: "dirty" }));
    expect(plan.scenario).toBe<Scenario>("git-dirty-cant-iterate");
    expect(plan.recommendedAction.id).toBe("start-worker");
  });

  it("mentions open PRs in summary when present", () => {
    const plan = planMinskyAction(ctx({ gitState: "dirty", prStats: { open: 3, conflicting: 0 } }));
    expect(plan.contextSummary).toContain("3 open PR");
  });
});

// ---- Scenario: wip-needs-cleanup --------------------------------------------

describe("planMinskyAction — wip-needs-cleanup", () => {
  it("detects conflicting PRs and recommends start-worker", () => {
    const plan = planMinskyAction(ctx({ prStats: { open: 4, conflicting: 2 } }));
    expect(plan.scenario).toBe<Scenario>("wip-needs-cleanup");
    expect(plan.recommendedAction.id).toBe("start-worker");
    expect(plan.contextSummary).toContain("2 conflicting");
  });

  it("does NOT trigger when conflicting = 0 even with many open PRs", () => {
    const plan = planMinskyAction(ctx({ prStats: { open: 10, conflicting: 0 } }));
    expect(plan.scenario).not.toBe<Scenario>("wip-needs-cleanup");
  });
});

// ---- Scenario: queue-empty --------------------------------------------------

describe("planMinskyAction — queue-empty", () => {
  it("recommends run-doctor when queue is empty", () => {
    const plan = planMinskyAction(ctx({ queueState: "empty" }));
    expect(plan.scenario).toBe<Scenario>("queue-empty");
    expect(plan.recommendedAction.id).toBe("run-doctor");
  });

  it("includes start-worker as an alternative", () => {
    const plan = planMinskyAction(ctx({ queueState: "empty" }));
    expect(plan.alternatives.map((a) => a.id)).toContain("start-worker");
  });
});

// ---- Scenario: daemon-mid-iteration -----------------------------------------

describe("planMinskyAction — daemon-mid-iteration", () => {
  it("detects recent iteration (30m ago) and recommends start-worker", () => {
    const plan = planMinskyAction(ctx({ lastIterationAgeMs: 30 * 60_000 }));
    expect(plan.scenario).toBe<Scenario>("daemon-mid-iteration");
    expect(plan.recommendedAction.id).toBe("start-worker");
    expect(plan.contextSummary).toContain("30m ago");
  });

  it("does NOT trigger for stale iteration (>2 h ago)", () => {
    const plan = planMinskyAction(ctx({ lastIterationAgeMs: 3 * 60 * 60_000 }));
    expect(plan.scenario).not.toBe<Scenario>("daemon-mid-iteration");
  });

  it("includes run-logs as an alternative", () => {
    const plan = planMinskyAction(ctx({ lastIterationAgeMs: 10 * 60_000 }));
    expect(plan.alternatives.map((a) => a.id)).toContain("run-logs");
  });
});

// ---- Scenario: clean-fresh-checkout -----------------------------------------

describe("planMinskyAction — clean-fresh-checkout", () => {
  it("falls through to clean-fresh-checkout when no other condition matches", () => {
    const plan = planMinskyAction(BASE);
    expect(plan.scenario).toBe<Scenario>("clean-fresh-checkout");
    expect(plan.recommendedAction.id).toBe("start-worker");
  });

  it("includes bootstrap-local-llm as an alternative", () => {
    const plan = planMinskyAction(BASE);
    expect(plan.alternatives.map((a) => a.id)).toContain("bootstrap-local-llm");
  });
});

// ---- Priority ordering -------------------------------------------------------

describe("planMinskyAction — priority ordering", () => {
  it("worker-already-running takes priority over claude-exhausted", () => {
    const plan = planMinskyAction(
      ctx({ workerState: { alive: true, pid: 1 }, claudeState: "exhausted" }),
    );
    expect(plan.scenario).toBe<Scenario>("worker-already-running");
  });

  it("claude-exhausted takes priority over git-dirty", () => {
    const plan = planMinskyAction(ctx({ claudeState: "exhausted", gitState: "dirty" }));
    expect(plan.scenario).toBe<Scenario>("claude-exhausted-no-stack");
  });

  it("git-dirty takes priority over wip-needs-cleanup", () => {
    const plan = planMinskyAction(ctx({ gitState: "dirty", prStats: { open: 3, conflicting: 2 } }));
    expect(plan.scenario).toBe<Scenario>("git-dirty-cant-iterate");
  });

  it("wip-needs-cleanup takes priority over queue-empty", () => {
    const plan = planMinskyAction(
      ctx({ queueState: "empty", prStats: { open: 2, conflicting: 1 } }),
    );
    expect(plan.scenario).toBe<Scenario>("wip-needs-cleanup");
  });
});
