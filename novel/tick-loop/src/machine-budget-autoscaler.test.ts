import { describe, expect, it } from "vitest";
import {
  MACHINE_BUDGET_POLICY,
  MACHINE_BUDGET_RULES,
  type MachineBudgetState,
  computeWorkerTarget,
  resolveMachineBudgetPct,
} from "./machine-budget-autoscaler.js";

// 10-core box mirrors the live empirical evidence in the task block
// (4≈ok, 10 saturates usefully at load ~37, 14 stalls, 20 gridlocks
// to zero at load ~61).
const base: MachineBudgetState = {
  budgetPct: 70,
  cores: 10,
  recentActiveSubprocs: 7,
  recentPrRate: 2,
  loadAvg: 5,
  lastTargets: [7],
};

describe("resolveMachineBudgetPct", () => {
  it("defaults to 70 when the env is unset (no clamp flag — nothing to correct)", () => {
    const r = resolveMachineBudgetPct({});
    expect(r.pct).toBe(MACHINE_BUDGET_POLICY.defaultBudgetPct);
    expect(r.swarm).toBe(false);
    expect(r.clamped).toBe(false);
  });

  it("reads an in-range integer budget verbatim", () => {
    const r = resolveMachineBudgetPct({ MINSKY_MACHINE_BUDGET_PCT: "55" });
    expect(r.pct).toBe(55);
    expect(r.clamped).toBe(false);
  });

  it("clamps a request above the default down to 70 without the swarm switch", () => {
    const r = resolveMachineBudgetPct({ MINSKY_MACHINE_BUDGET_PCT: "80" });
    expect(r.pct).toBe(70);
    expect(r.swarm).toBe(false);
    expect(r.clamped).toBe(true);
  });

  it("allows up to 80 under the weekly-gated swarm switch", () => {
    const r = resolveMachineBudgetPct({
      MINSKY_MACHINE_BUDGET_PCT: "80",
      MINSKY_SWARM_MODE: "1",
    });
    expect(r.pct).toBe(80);
    expect(r.swarm).toBe(true);
    expect(r.clamped).toBe(false);
  });

  it("clamps a swarm request above 80 back to the swarm max", () => {
    const r = resolveMachineBudgetPct({
      MINSKY_MACHINE_BUDGET_PCT: "95",
      MINSKY_SWARM_MODE: "true",
    });
    expect(r.pct).toBe(MACHINE_BUDGET_POLICY.swarmMaxBudgetPct);
    expect(r.clamped).toBe(true);
  });

  it("fails safe to the default on garbage input and flags it clamped", () => {
    const r = resolveMachineBudgetPct({ MINSKY_MACHINE_BUDGET_PCT: "not-a-number" });
    expect(r.pct).toBe(70);
    expect(r.clamped).toBe(true);
  });

  it("fails safe to the default on an out-of-range (>100) value", () => {
    const r = resolveMachineBudgetPct({ MINSKY_MACHINE_BUDGET_PCT: "250" });
    expect(r.pct).toBe(70);
    expect(r.clamped).toBe(true);
  });
});

describe("computeWorkerTarget — cold start", () => {
  it("starts at the naive proportional target when there is no history", () => {
    const d = computeWorkerTarget({ ...base, lastTargets: [] });
    // round(0.70 * 10) = 7
    expect(d.target).toBe(7);
    expect(d.reason).toContain("cold-start");
  });

  it("ignores a history of only non-finite/invalid entries (treated as cold)", () => {
    const d = computeWorkerTarget({
      ...base,
      lastTargets: [Number.NaN, 0, -3],
    });
    expect(d.target).toBe(7);
    expect(d.reason).toContain("cold-start");
  });

  it("a higher budget yields a higher cold-start target", () => {
    const d = computeWorkerTarget({ ...base, budgetPct: 80, lastTargets: [] });
    // round(0.80 * 10) = 8
    expect(d.target).toBe(8);
  });
});

describe("computeWorkerTarget — ramp-up", () => {
  it("ramps by one when concurrency is absorbed, load is sane, and there is headroom", () => {
    const d = computeWorkerTarget({
      ...base,
      lastTargets: [6],
      recentActiveSubprocs: 6, // ≥ 6 × 0.6 → absorbed
      loadAvg: 5, // ≤ 10 × 5 → sane
    });
    expect(d.target).toBe(7);
    expect(d.reason).toContain("ramp-up");
  });

  it("does not ramp past the budget-derived hard ceiling", () => {
    // budget 70, cores 10 → ceiling = floor(0.7*10*1.4) = 9
    const d = computeWorkerTarget({
      ...base,
      lastTargets: [9],
      recentActiveSubprocs: 9,
    });
    expect(d.target).toBe(9);
    expect(d.reason).toContain("knee-hold");
  });
});

describe("computeWorkerTarget — knee detection", () => {
  it("steps back when the last ramp was not absorbed", () => {
    // history shows a ramp 7→8, but only 3 active subprocs (< 8 × 0.6)
    const d = computeWorkerTarget({
      ...base,
      lastTargets: [7, 8],
      recentActiveSubprocs: 3,
      loadAvg: 8,
    });
    expect(d.target).toBe(7);
    expect(d.reason).toContain("knee-step-back");
  });

  it("holds at the budget ceiling once reached (the budget defines the knee)", () => {
    const d = computeWorkerTarget({
      ...base,
      lastTargets: [8, 9],
      recentActiveSubprocs: 9,
    });
    expect(d.target).toBe(9);
    expect(d.reason).toContain("knee-hold");
  });

  it("holds (no ramp, no backoff) when absorption is mid-band and load is sane-but-high", () => {
    const d = computeWorkerTarget({
      ...base,
      lastTargets: [7],
      recentActiveSubprocs: 3, // < 7 × 0.6 → not absorbed, not collapsed-with-runaway
      loadAvg: 5,
    });
    expect(d.target).toBe(7);
    expect(d.reason).toContain("hold:");
  });
});

describe("computeWorkerTarget — gridlock backoff", () => {
  it("halves the target on the gridlock signature (load runaway + active collapse)", () => {
    // The empirical 20→0 disaster: 20 nominal workers, ~0 active model
    // subprocs, load ~61 on a 10-core box.
    const d = computeWorkerTarget({
      ...base,
      lastTargets: [20],
      recentActiveSubprocs: 1, // < 20 × 0.25
      loadAvg: 61, // > 10 × 5
      recentPrRate: 0,
    });
    expect(d.target).toBe(10); // floor(20 × 0.5)
    expect(d.reason).toContain("gridlock-backoff");
  });

  it("does NOT back off on high load alone when subprocs are still active", () => {
    // load high but workers are productive (the useful load ~37 regime)
    const d = computeWorkerTarget({
      ...base,
      lastTargets: [9],
      recentActiveSubprocs: 9,
      loadAvg: 37,
    });
    expect(d.reason).not.toContain("gridlock-backoff");
  });

  it("never returns a target below 1 even from an extreme backoff", () => {
    const d = computeWorkerTarget({
      ...base,
      lastTargets: [1],
      recentActiveSubprocs: 0,
      loadAvg: 99,
    });
    expect(d.target).toBeGreaterThanOrEqual(1);
  });
});

describe("computeWorkerTarget — fail-safe", () => {
  it("holds at the last valid target on invalid state", () => {
    const d = computeWorkerTarget({
      ...base,
      budgetPct: Number.NaN,
      lastTargets: [4],
    });
    expect(d.target).toBe(4);
    expect(d.reason).toContain("invalid-state-hold");
  });

  it("holds at 1 on invalid state with no usable history", () => {
    const d = computeWorkerTarget({
      ...base,
      cores: -1,
      lastTargets: [],
    });
    expect(d.target).toBe(1);
    expect(d.reason).toContain("invalid-state-hold");
  });
});

describe("MACHINE_BUDGET_RULES", () => {
  it("is frozen (pre-registered constants — the constant is the spec)", () => {
    expect(Object.isFrozen(MACHINE_BUDGET_RULES)).toBe(true);
    expect(Object.isFrozen(MACHINE_BUDGET_POLICY)).toBe(true);
  });
});
