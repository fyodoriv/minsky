import { describe, expect, it } from "vitest";

import {
  type MachineFacts,
  OS_THROTTLE_POLICY,
  TRIVIAL_BUDGET_PCT,
  detectOsThrottles,
  requiredFdFloor,
} from "./os-throttle-detect.js";

// A clean 10-core box at the operator default budget — no throttle on
// any observed fact. Tests override one fact at a time.
const cleanFacts: MachineFacts = Object.freeze({
  budgetPct: 70,
  cores: 10,
  launchdProcessType: "Standard",
  niceValue: 0,
  ulimitNofile: 1_000_000,
  env: Object.freeze({}),
});

describe("detectOsThrottles — clean host", () => {
  it("declares the budget reachable when no fact contradicts it", () => {
    const r = detectOsThrottles(cleanFacts);
    expect(r.budgetReachable).toBe(true);
    expect(r.throttles).toEqual([]);
    expect(r.corrections).toEqual([]);
  });

  it("treats every absent (undefined) fact as not-a-throttle (fail-safe)", () => {
    const r = detectOsThrottles({ budgetPct: 70, cores: 10 });
    expect(r.budgetReachable).toBe(true);
    expect(r.throttles).toEqual([]);
  });
});

describe("detectOsThrottles — pre-registered throttle: launchd ProcessType=Background", () => {
  it("flags ProcessType=Background at a non-trivial budget", () => {
    const r = detectOsThrottles({ ...cleanFacts, launchdProcessType: "Background" });
    expect(r.budgetReachable).toBe(false);
    expect(r.throttles).toHaveLength(1);
    expect(r.throttles[0]?.kind).toBe("launchd-process-type-background");
    expect(r.throttles[0]?.observed).toBe("ProcessType=Background");
    expect(r.corrections[0]).toMatch(/ProcessType=Standard/);
    expect(r.corrections[0]).toMatch(/~\/apps\/dotfiles/);
  });

  it("matches case-insensitively (launchctl echoes the value verbatim)", () => {
    const r = detectOsThrottles({ ...cleanFacts, launchdProcessType: " background " });
    expect(r.throttles[0]?.kind).toBe("launchd-process-type-background");
  });

  it("does not flag a non-throttling ProcessType", () => {
    for (const pt of ["Standard", "Interactive", "Adaptive", null]) {
      const r = detectOsThrottles({ ...cleanFacts, launchdProcessType: pt });
      expect(r.budgetReachable).toBe(true);
    }
  });
});

describe("detectOsThrottles — pre-registered throttle: positive nice", () => {
  it("flags a positive nice value", () => {
    const r = detectOsThrottles({ ...cleanFacts, niceValue: 10 });
    expect(r.throttles[0]?.kind).toBe("process-nice");
    expect(r.throttles[0]?.observed).toBe("nice=10");
    expect(r.budgetReachable).toBe(false);
  });

  it("does not flag nice=0 (normal) or a negative nice (elevated)", () => {
    expect(detectOsThrottles({ ...cleanFacts, niceValue: 0 }).budgetReachable).toBe(true);
    expect(detectOsThrottles({ ...cleanFacts, niceValue: -5 }).budgetReachable).toBe(true);
  });

  it("ignores a non-integer nice (fail-safe — treat as absent)", () => {
    expect(detectOsThrottles({ ...cleanFacts, niceValue: Number.NaN }).budgetReachable).toBe(true);
    expect(detectOsThrottles({ ...cleanFacts, niceValue: 2.5 }).budgetReachable).toBe(true);
  });
});

describe("detectOsThrottles — pre-registered throttle: low ulimit -n", () => {
  it("flags a soft FD limit below the budget-scaled floor", () => {
    // 10 cores · 70 % → 7 workers · 512 FDs = 3584 floor; 256 (macOS
    // default) is far below.
    const r = detectOsThrottles({ ...cleanFacts, ulimitNofile: 256 });
    expect(r.throttles[0]?.kind).toBe("low-ulimit-nofile");
    expect(r.throttles[0]?.observed).toContain("256");
    expect(r.budgetReachable).toBe(false);
  });

  it("does not flag an FD limit at or above the floor", () => {
    const floor = requiredFdFloor(10, 70);
    expect(detectOsThrottles({ ...cleanFacts, ulimitNofile: floor }).budgetReachable).toBe(true);
  });

  it("requiredFdFloor sizes by budget-targeted workers, floored at one worker", () => {
    expect(requiredFdFloor(10, 70)).toBe(7 * OS_THROTTLE_POLICY.fdsPerWorker);
    expect(requiredFdFloor(1, 70)).toBe(OS_THROTTLE_POLICY.fdsPerWorker); // floor at 1 worker
    expect(requiredFdFloor(Number.NaN, 70)).toBe(OS_THROTTLE_POLICY.fdsPerWorker); // fail-safe
  });
});

describe("detectOsThrottles — pre-registered throttle: stale MINSKY_* cap", () => {
  it("flags a concurrency env var that resolves below the budget target", () => {
    // 10 cores · 70 % → target 7 workers; a stale cap of 4 defeats it.
    const r = detectOsThrottles({ ...cleanFacts, env: { MINSKY_MAX_WORKERS: "4" } });
    expect(r.throttles[0]?.kind).toBe("stale-minsky-cap");
    expect(r.throttles[0]?.observed).toContain("MINSKY_MAX_WORKERS=4");
    expect(r.budgetReachable).toBe(false);
  });

  it("does not flag a cap at or above the budget target", () => {
    const r = detectOsThrottles({ ...cleanFacts, env: { MINSKY_MAX_WORKERS: "20" } });
    expect(r.budgetReachable).toBe(true);
  });

  it("ignores a non-numeric or absent cap (fail-safe)", () => {
    expect(
      detectOsThrottles({ ...cleanFacts, env: { MINSKY_MAX_WORKERS: "" } }).budgetReachable,
    ).toBe(true);
    expect(
      detectOsThrottles({ ...cleanFacts, env: { MINSKY_MAX_WORKERS: "abc" } }).budgetReachable,
    ).toBe(true);
    expect(detectOsThrottles({ ...cleanFacts, env: {} }).budgetReachable).toBe(true);
  });
});

describe("detectOsThrottles — trivial budget tolerates throttles", () => {
  it("never flags a throttle when the budget is at/below TRIVIAL_BUDGET_PCT", () => {
    const r = detectOsThrottles({
      budgetPct: TRIVIAL_BUDGET_PCT,
      cores: 10,
      launchdProcessType: "Background",
      niceValue: 19,
      ulimitNofile: 64,
      env: { MINSKY_MAX_WORKERS: "1" },
    });
    expect(r.budgetReachable).toBe(true);
    expect(r.throttles).toEqual([]);
  });
});

describe("detectOsThrottles — fail-safe on a garbage budget", () => {
  it("falls back to the non-trivial default (70) — never declares reachable on unreadable budget", () => {
    const r = detectOsThrottles({
      budgetPct: Number.NaN,
      cores: 10,
      launchdProcessType: "Background",
    });
    expect(r.budgetReachable).toBe(false);
    expect(r.throttles[0]?.kind).toBe("launchd-process-type-background");
  });
});

describe("detectOsThrottles — multiple throttles", () => {
  it("reports every throttle in policy order and de-duplicates corrections", () => {
    const r = detectOsThrottles({
      budgetPct: 80,
      cores: 10,
      launchdProcessType: "Background",
      niceValue: 5,
      ulimitNofile: 128,
      env: { MINSKY_MAX_WORKERS: "2", MINSKY_WORKER_CONCURRENCY: "1" },
    });
    expect(r.budgetReachable).toBe(false);
    expect(r.throttles.map((t) => t.kind)).toEqual([
      "launchd-process-type-background",
      "process-nice",
      "low-ulimit-nofile",
      "stale-minsky-cap",
      "stale-minsky-cap",
    ]);
    // Five throttles but distinct corrections (the two stale-cap
    // corrections differ — one per env var name).
    expect(new Set(r.corrections).size).toBe(r.corrections.length);
    expect(r.corrections.length).toBe(5);
  });
});
