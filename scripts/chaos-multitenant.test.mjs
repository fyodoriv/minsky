// Tests for chaos-multitenant.mjs. Pins the task's `**Measurement**` steady
// state: collisions / corruptWorktrees / doubleClaims all 0 for N concurrent
// same-repo runs (deterministic, no process spawn).
import { describe, expect, it } from "vitest";
import {
  allClear,
  countCollisions,
  countCorruptWorktrees,
  countDoubleClaims,
  countFanoutCollisions,
  countStaleClaimMisEvictions,
  parseArgs,
  simulateMultitenant,
} from "./chaos-multitenant.mjs";

const CLEAR = {
  collisions: 0,
  corruptWorktrees: 0,
  doubleClaims: 0,
  fanoutCollisions: 0,
  staleClaimMisEvictions: 0,
};

describe("chaos-multitenant simulation", () => {
  it("steady state holds — every observable 0 (N=10, 30 min, 3-worker fanout)", () => {
    const r = simulateMultitenant({ runs: 10, minutes: 30 });
    expect(r).toEqual(CLEAR);
    expect(allClear(r)).toBe(true);
  });

  it("holds at higher concurrency (N=50, 8-worker fanout)", () => {
    expect(simulateMultitenant({ runs: 50, minutes: 30, workersTotal: 8 })).toEqual(CLEAR);
  });

  it("is deterministic — same result every run", () => {
    expect(simulateMultitenant()).toEqual(simulateMultitenant());
  });

  it("collisions stays 0 so the task Measurement (j.collisions===0) passes", () => {
    expect(simulateMultitenant().collisions).toBe(0);
  });

  it("allClear rejects any non-zero observable", () => {
    expect(allClear({ ...CLEAR, collisions: 1 })).toBe(false);
    expect(allClear({ ...CLEAR, corruptWorktrees: 1 })).toBe(false);
    expect(allClear({ ...CLEAR, doubleClaims: 1 })).toBe(false);
    expect(allClear({ ...CLEAR, fanoutCollisions: 1 })).toBe(false);
    expect(allClear({ ...CLEAR, staleClaimMisEvictions: 1 })).toBe(false);
  });

  it("allClear is back-compat: a result without fanout fields is clear on those dims", () => {
    expect(allClear({ collisions: 0, corruptWorktrees: 0, doubleClaims: 0 })).toBe(true);
  });
});

describe("countFanoutCollisions (N-worker fanout on one repo)", () => {
  it("is 0 for the task's N=3 fanout", () => {
    expect(countFanoutCollisions("/r", 3)).toBe(0);
  });

  it("stays 0 at larger fanout (N=16)", () => {
    expect(countFanoutCollisions("/r", 16)).toBe(0);
  });

  it("a single worker trivially has no collision", () => {
    expect(countFanoutCollisions("/r", 1)).toBe(0);
  });
});

describe("countStaleClaimMisEvictions (crashed-worker lock pruning)", () => {
  it("evicts the crashed worker's orphan and keeps live workers (N=3)", () => {
    expect(countStaleClaimMisEvictions(3)).toBe(0);
  });

  it("stays correct at larger fanout (N=10)", () => {
    expect(countStaleClaimMisEvictions(10)).toBe(0);
  });
});

describe("countCollisions", () => {
  it("detects an injected duplicate on the 6 must-be-disjoint dimensions (port excluded — OS-bind-arbitrated)", () => {
    const ns = {
      runId: "x",
      worktreeDir: "w",
      lockPath: "l",
      branchName: "b",
      launchdLabel: "ld",
      ledgerPath: "lg",
      port: 1,
    };
    expect(countCollisions(/** @type {any} */ ([ns, ns]))).toBe(6);
  });

  it("ignores a port clash between otherwise-disjoint runs", () => {
    const a = {
      runId: "a",
      worktreeDir: "wa",
      lockPath: "la",
      branchName: "ba",
      launchdLabel: "lda",
      ledgerPath: "lga",
      port: 41001,
    };
    const b = {
      runId: "b",
      worktreeDir: "wb",
      lockPath: "lb",
      branchName: "bb",
      launchdLabel: "ldb",
      ledgerPath: "lgb",
      port: 41001,
    };
    expect(countCollisions(/** @type {any} */ ([a, b]))).toBe(0);
  });
});

describe("countDoubleClaims", () => {
  it("is 0 because every run derives the same claim key per (repo, task)", () => {
    expect(countDoubleClaims("/r", 10, 120)).toBe(0);
  });
});

describe("countCorruptWorktrees", () => {
  it("is 0 for distinct namespaces, >0 for a shared worktree dir", () => {
    const a = { worktreeDir: "a" };
    const b = { worktreeDir: "b" };
    expect(countCorruptWorktrees(/** @type {any} */ ([a, b]))).toBe(0);
    expect(countCorruptWorktrees(/** @type {any} */ ([a, a]))).toBe(1);
  });
});

describe("parseArgs", () => {
  it("parses runs / minutes / workers-total / json with default fallback", () => {
    expect(parseArgs(["--runs=5", "--minutes=12", "--workers-total=4", "--json"])).toEqual({
      runs: 5,
      minutes: 12,
      workersTotal: 4,
      jsonOnly: true,
    });
    expect(parseArgs([])).toEqual({ runs: 10, minutes: 30, workersTotal: 3, jsonOnly: false });
  });
});
