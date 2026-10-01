// Pre-registered behaviour suites (rule #9 / scripts/check-machine-budget.mjs
// sub-check 3): ramp-up, knee detection, gridlock backoff. The gate pins these
// three suite names — deleting one lets the controller drift unobserved.

import { describe, expect, test } from "vitest";

import {
  type AutoscalerState,
  boundWorkerCeiling,
  computeWorkerTarget,
  GRIDLOCK_LOAD_MULTIPLE,
  MACHINE_BUDGET_POLICY,
  maxWorkersForBudget,
  resolveMachineBudgetPct,
} from "./machine-budget-autoscaler.js";

/**
 * @param overrides partial state fields to merge over a 10-core baseline
 */
function state(overrides: Partial<AutoscalerState> = {}): AutoscalerState {
  return {
    budgetPct: 70,
    cores: 10,
    recentActiveSubprocs: 0,
    recentPrRate: 0,
    loadAvg: 0,
    lastTargets: [],
    ...overrides,
  };
}

describe("resolveMachineBudgetPct", () => {
  test("default is the pinned policy default 70", () => {
    expect(resolveMachineBudgetPct()).toBe(70);
    expect(MACHINE_BUDGET_POLICY.defaultBudgetPct).toBe(70);
  });

  test("env override beats config", () => {
    expect(resolveMachineBudgetPct({ envPct: "55", configPct: 40 })).toBe(55);
  });

  test("config used when env absent", () => {
    expect(resolveMachineBudgetPct({ configPct: 40 })).toBe(40);
  });

  test("garbage env falls through to config then default", () => {
    expect(resolveMachineBudgetPct({ envPct: "not-a-number", configPct: 42 })).toBe(42);
    expect(resolveMachineBudgetPct({ envPct: "999" })).toBe(70);
  });

  test("swarm mode caps the budget at the 80 ceiling", () => {
    expect(resolveMachineBudgetPct({ envPct: 95, swarmMode: true })).toBe(80);
    expect(MACHINE_BUDGET_POLICY.swarmMaxBudgetPct).toBe(80);
  });

  test("swarm mode honours a value below the ceiling", () => {
    expect(resolveMachineBudgetPct({ envPct: 75, swarmMode: true })).toBe(75);
  });

  test("clamps to the floor, never 0", () => {
    expect(resolveMachineBudgetPct({ envPct: 0 })).toBe(MACHINE_BUDGET_POLICY.floorBudgetPct);
  });
});

describe("maxWorkersForBudget", () => {
  test("70% of 10 cores is 7", () => {
    expect(maxWorkersForBudget(10, 70)).toBe(7);
  });

  test("never below 1", () => {
    expect(maxWorkersForBudget(2, 10)).toBe(1);
  });
});

describe("computeWorkerTarget — ramp-up", () => {
  test("cold start ramps from 1", () => {
    const d = computeWorkerTarget(state({ loadAvg: 1, lastTargets: [] }));
    expect(d.reason).toBe("ramp-up");
    expect(d.target).toBe(2);
  });

  test("below budget with rising throughput ramps by exactly 1", () => {
    const d = computeWorkerTarget(
      state({ loadAvg: 3, lastTargets: [3], recentActiveSubprocs: 3, recentPrRate: 1 }),
    );
    expect(d.reason).toBe("ramp-up");
    expect(d.target).toBe(4);
  });

  test("ramp never exceeds the budget ceiling", () => {
    const d = computeWorkerTarget(
      state({ loadAvg: 1, lastTargets: [7], recentActiveSubprocs: 7, recentPrRate: 2 }),
    );
    expect(d.target).toBe(maxWorkersForBudget(10, 70));
  });
});

describe("computeWorkerTarget — knee detection", () => {
  test("ramp that stopped raising throughput holds (knee)", () => {
    const d = computeWorkerTarget(
      state({ loadAvg: 4, lastTargets: [6], recentActiveSubprocs: 2, recentPrRate: 0 }),
    );
    expect(d.reason).toBe("knee-hold");
    expect(d.target).toBe(6);
  });

  test("at the budget ceiling holds without ramping", () => {
    const d = computeWorkerTarget(
      state({ loadAvg: 7, lastTargets: [7], recentActiveSubprocs: 7, recentPrRate: 3 }),
    );
    expect(d.reason).toBe("at-budget");
    expect(d.target).toBe(7);
  });

  test("utilisation at/above budget holds", () => {
    const d = computeWorkerTarget(
      state({ loadAvg: 8, lastTargets: [5], recentActiveSubprocs: 5, recentPrRate: 2 }),
    );
    expect(d.reason).toBe("at-budget");
    expect(d.target).toBe(5);
  });
});

describe("computeWorkerTarget — gridlock backoff", () => {
  test("load runaway with collapsed work backs off below the prior target", () => {
    const d = computeWorkerTarget(
      state({
        loadAvg: 10 * GRIDLOCK_LOAD_MULTIPLE + 21,
        lastTargets: [20],
        recentActiveSubprocs: 0,
        recentPrRate: 0,
      }),
    );
    expect(d.reason).toBe("gridlock-backoff");
    // floor(20/2)=10, clamped to the 70%-of-10-cores ceiling (7).
    expect(d.target).toBe(maxWorkersForBudget(10, 70));
    expect(d.target).toBeLessThan(20);
  });

  test("halves the target when below the budget ceiling", () => {
    const d = computeWorkerTarget(
      state({
        budgetPct: 100,
        loadAvg: 10 * GRIDLOCK_LOAD_MULTIPLE + 21,
        lastTargets: [8],
        recentActiveSubprocs: 0,
        recentPrRate: 0,
      }),
    );
    expect(d.reason).toBe("gridlock-backoff");
    expect(d.target).toBe(4);
  });

  test("high load WITH high useful throughput is not gridlock", () => {
    const d = computeWorkerTarget(
      state({
        loadAvg: 10 * GRIDLOCK_LOAD_MULTIPLE + 21,
        lastTargets: [7],
        recentActiveSubprocs: 7,
        recentPrRate: 3,
      }),
    );
    expect(d.reason).not.toBe("gridlock-backoff");
  });

  test("backoff never drops below 1 worker", () => {
    const d = computeWorkerTarget(
      state({
        loadAvg: 10 * GRIDLOCK_LOAD_MULTIPLE + 21,
        lastTargets: [1],
        recentActiveSubprocs: 0,
        recentPrRate: 0,
      }),
    );
    expect(d.target).toBe(1);
  });
});

describe("boundWorkerCeiling — local-server concurrency cap", () => {
  test("no cap returns the budget ceiling unchanged", () => {
    expect(boundWorkerCeiling(state({ cores: 10, budgetPct: 70 }))).toBe(7);
  });

  test("cap lowers the ceiling below the budget ceiling", () => {
    expect(
      boundWorkerCeiling(state({ cores: 10, budgetPct: 70, localServerConcurrencyCap: 1 })),
    ).toBe(1);
  });

  test("budget ceiling wins when it is below the cap", () => {
    // 2 cores @ 70% → budget ceiling 1; a cap of 4 cannot raise it.
    expect(
      boundWorkerCeiling(state({ cores: 2, budgetPct: 70, localServerConcurrencyCap: 4 })),
    ).toBe(1);
  });

  test("cap of 0 or negative is floored to 1 (never 'never run')", () => {
    expect(
      boundWorkerCeiling(state({ cores: 10, budgetPct: 70, localServerConcurrencyCap: 0 })),
    ).toBe(1);
    expect(
      boundWorkerCeiling(state({ cores: 10, budgetPct: 70, localServerConcurrencyCap: -3 })),
    ).toBe(1);
  });

  test("non-finite cap is ignored (budget ceiling used)", () => {
    expect(
      boundWorkerCeiling(
        state({ cores: 10, budgetPct: 70, localServerConcurrencyCap: Number.NaN }),
      ),
    ).toBe(7);
  });
});

describe("computeWorkerTarget — localServerConcurrencyCap (all three regimes)", () => {
  test("ramp-up: never ramps past the cap of 1 even with rising throughput", () => {
    const d = computeWorkerTarget(
      state({
        loadAvg: 1,
        lastTargets: [1],
        recentActiveSubprocs: 1,
        recentPrRate: 1,
        localServerConcurrencyCap: 1,
      }),
    );
    // current=1 already at the capped ceiling → hold at 1, no ramp to 2.
    expect(d.target).toBe(1);
    expect(d.target).toBeLessThanOrEqual(1);
  });

  test("ramp-up: cap of 2 lets the ramp reach 2 then holds", () => {
    const d = computeWorkerTarget(
      state({
        loadAvg: 1,
        lastTargets: [1],
        recentActiveSubprocs: 2,
        recentPrRate: 1,
        localServerConcurrencyCap: 2,
      }),
    );
    expect(d.reason).toBe("ramp-up");
    expect(d.target).toBe(2);
    // A subsequent step at the cap holds rather than ramping to 3.
    const next = computeWorkerTarget(
      state({
        loadAvg: 1,
        lastTargets: [2],
        recentActiveSubprocs: 2,
        recentPrRate: 1,
        localServerConcurrencyCap: 2,
      }),
    );
    expect(next.target).toBeLessThanOrEqual(2);
  });

  test("knee-hold: a prior over-cap target is clamped down to the cap", () => {
    // lastTargets[6] is above the cap (an uncapped history); the cap must
    // pull the next target back to 1, not let the stale higher target ride.
    const d = computeWorkerTarget(
      state({
        loadAvg: 4,
        lastTargets: [6],
        recentActiveSubprocs: 2,
        recentPrRate: 0,
        localServerConcurrencyCap: 1,
      }),
    );
    expect(d.target).toBe(1);
  });

  test("at-budget: utilisation at/above budget still respects the cap", () => {
    const d = computeWorkerTarget(
      state({
        loadAvg: 8,
        lastTargets: [5],
        recentActiveSubprocs: 5,
        recentPrRate: 2,
        localServerConcurrencyCap: 1,
      }),
    );
    expect(d.reason).toBe("at-budget");
    expect(d.target).toBe(1);
  });

  test("gridlock-backoff: backoff floor never exceeds the cap", () => {
    const d = computeWorkerTarget(
      state({
        budgetPct: 100,
        loadAvg: 10 * GRIDLOCK_LOAD_MULTIPLE + 21,
        lastTargets: [8],
        recentActiveSubprocs: 0,
        recentPrRate: 0,
        localServerConcurrencyCap: 1,
      }),
    );
    expect(d.reason).toBe("gridlock-backoff");
    // floor(8/2)=4, but the cap clamps it to 1.
    expect(d.target).toBe(1);
  });
});
