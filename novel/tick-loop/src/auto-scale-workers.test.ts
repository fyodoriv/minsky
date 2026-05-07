import { describe, expect, it } from "vitest";
import { AUTO_SCALE_RULES, type AutoScaleState, decideAutoScale } from "./auto-scale-workers.js";

const baseState: AutoScaleState = {
  currentWorkers: 1,
  maxWorkers: 5,
  eligibleTaskCount: 10,
  recentFailedIterations: 0,
  budgetState: "normal",
  recentClaimCollisions: 0,
};

describe("decideAutoScale", () => {
  it("spawns when conditions are favourable", () => {
    const decision = decideAutoScale(baseState);
    expect(decision.verdict).toBe("spawn");
    expect(decision.reason).toContain("conditions-favourable");
  });

  it("holds when current workers reach the ceiling (= maxWorkers)", () => {
    const decision = decideAutoScale({ ...baseState, currentWorkers: 5, maxWorkers: 5 });
    expect(decision.verdict).toBe("hold");
    expect(decision.reason).toContain("ceiling-reached");
  });

  it("holds when current workers EXCEED the ceiling (defensive)", () => {
    const decision = decideAutoScale({ ...baseState, currentWorkers: 7, maxWorkers: 5 });
    expect(decision.verdict).toBe("hold");
    expect(decision.reason).toContain("ceiling-reached");
  });

  it("holds when budgetState is weekly-cap-paused (don't spawn into a paused regime)", () => {
    const decision = decideAutoScale({ ...baseState, budgetState: "weekly-cap-paused" });
    expect(decision.verdict).toBe("hold");
    expect(decision.reason).toContain("budget-blocked");
  });

  it("holds when budgetState is circuit-break", () => {
    const decision = decideAutoScale({ ...baseState, budgetState: "circuit-break" });
    expect(decision.verdict).toBe("hold");
    expect(decision.reason).toContain("budget-blocked");
  });

  it("spawns when budgetState is weekly-cap-warn (advisory tier — daemon still running)", () => {
    const decision = decideAutoScale({ ...baseState, budgetState: "weekly-cap-warn" });
    expect(decision.verdict).toBe("spawn");
    expect(decision.reason).toContain("budget=weekly-cap-warn");
  });

  it("holds when there aren't enough eligible tasks for an additional worker", () => {
    // 2 eligible, 2 current workers → adding another wouldn't help.
    const decision = decideAutoScale({
      ...baseState,
      currentWorkers: 2,
      eligibleTaskCount: 2,
    });
    expect(decision.verdict).toBe("hold");
    expect(decision.reason).toContain("no-spare-tasks");
  });

  it("holds when eligibleTaskCount equals currentWorkers (no spare task)", () => {
    const decision = decideAutoScale({
      ...baseState,
      currentWorkers: 3,
      eligibleTaskCount: 3,
    });
    expect(decision.verdict).toBe("hold");
    expect(decision.reason).toContain("no-spare-tasks");
  });

  it("spawns when eligibleTaskCount > currentWorkers by 1 (one spare)", () => {
    const decision = decideAutoScale({
      ...baseState,
      currentWorkers: 2,
      eligibleTaskCount: 3,
    });
    expect(decision.verdict).toBe("spawn");
  });

  it(`holds when recentFailedIterations >= ${AUTO_SCALE_RULES.failedIterationCeiling} (system unstable)`, () => {
    const decision = decideAutoScale({
      ...baseState,
      recentFailedIterations: AUTO_SCALE_RULES.failedIterationCeiling,
    });
    expect(decision.verdict).toBe("hold");
    expect(decision.reason).toContain("system-unstable");
  });

  it("spawns when recentFailedIterations is just below the ceiling", () => {
    const decision = decideAutoScale({
      ...baseState,
      recentFailedIterations: AUTO_SCALE_RULES.failedIterationCeiling - 1,
    });
    expect(decision.verdict).toBe("spawn");
  });

  it(`holds when recentClaimCollisions >= ${AUTO_SCALE_RULES.claimCollisionCeiling} (contention high)`, () => {
    const decision = decideAutoScale({
      ...baseState,
      recentClaimCollisions: AUTO_SCALE_RULES.claimCollisionCeiling,
    });
    expect(decision.verdict).toBe("hold");
    expect(decision.reason).toContain("contention-high");
  });

  it("spawns when claim collisions are just below the ceiling", () => {
    const decision = decideAutoScale({
      ...baseState,
      recentClaimCollisions: AUTO_SCALE_RULES.claimCollisionCeiling - 1,
    });
    expect(decision.verdict).toBe("spawn");
  });

  it("rule order: ceiling-reached wins over budget-blocked", () => {
    // Worker count at ceiling AND budget paused — ceiling rule fires first.
    const decision = decideAutoScale({
      ...baseState,
      currentWorkers: 5,
      maxWorkers: 5,
      budgetState: "weekly-cap-paused",
    });
    expect(decision.reason).toContain("ceiling-reached");
  });

  it("rule order: budget-blocked wins over no-spare-tasks", () => {
    const decision = decideAutoScale({
      ...baseState,
      budgetState: "circuit-break",
      eligibleTaskCount: 0,
    });
    expect(decision.reason).toContain("budget-blocked");
  });

  it("rule order: no-spare-tasks wins over system-unstable", () => {
    const decision = decideAutoScale({
      ...baseState,
      currentWorkers: 5,
      maxWorkers: 99,
      eligibleTaskCount: 5,
      recentFailedIterations: 99,
    });
    expect(decision.reason).toContain("no-spare-tasks");
  });

  it("rule order: system-unstable wins over contention-high", () => {
    const decision = decideAutoScale({
      ...baseState,
      recentFailedIterations: AUTO_SCALE_RULES.failedIterationCeiling + 1,
      recentClaimCollisions: AUTO_SCALE_RULES.claimCollisionCeiling + 1,
    });
    expect(decision.reason).toContain("system-unstable");
  });

  it("holds for invalid state: NaN currentWorkers", () => {
    const decision = decideAutoScale({ ...baseState, currentWorkers: Number.NaN });
    expect(decision.verdict).toBe("hold");
    expect(decision.reason).toContain("invalid-state");
  });

  it("holds for invalid state: negative eligibleTaskCount", () => {
    const decision = decideAutoScale({ ...baseState, eligibleTaskCount: -1 });
    expect(decision.verdict).toBe("hold");
    expect(decision.reason).toContain("invalid-state");
  });

  it("holds for invalid state: maxWorkers=0", () => {
    const decision = decideAutoScale({ ...baseState, maxWorkers: 0 });
    expect(decision.verdict).toBe("hold");
    expect(decision.reason).toContain("invalid-state");
  });

  it("holds for invalid state: currentWorkers < 1", () => {
    const decision = decideAutoScale({ ...baseState, currentWorkers: 0 });
    expect(decision.verdict).toBe("hold");
    expect(decision.reason).toContain("invalid-state");
  });

  it("decision reason is human-readable and includes the input numbers", () => {
    const decision = decideAutoScale({
      ...baseState,
      currentWorkers: 3,
      maxWorkers: 5,
      eligibleTaskCount: 12,
      recentFailedIterations: 1,
      recentClaimCollisions: 2,
    });
    expect(decision.verdict).toBe("spawn");
    expect(decision.reason).toContain("12 eligible");
    expect(decision.reason).toContain("3/5 workers");
    expect(decision.reason).toContain("normal");
  });
});

describe("AUTO_SCALE_RULES", () => {
  it("is frozen so production wiring can't accidentally mutate the thresholds", () => {
    expect(Object.isFrozen(AUTO_SCALE_RULES)).toBe(true);
  });

  it("declares the documented thresholds", () => {
    expect(AUTO_SCALE_RULES.failedIterationCeiling).toBe(3);
    expect(AUTO_SCALE_RULES.claimCollisionCeiling).toBe(5);
  });
});
