// Tests for chaos-multitenant.mjs. Pins the task's `**Measurement**` steady
// state: collisions / corruptWorktrees / doubleClaims all 0 for N concurrent
// same-repo runs (deterministic, no process spawn).
import { describe, expect, it } from "vitest";
import {
  allClear,
  countCollisions,
  countCorruptWorktrees,
  countDoubleClaims,
  parseArgs,
  simulateMultitenant,
} from "./chaos-multitenant.mjs";

describe("chaos-multitenant simulation", () => {
  it("steady state holds — 0 collisions / 0 corrupt / 0 double-claims (N=10, 30 min)", () => {
    const r = simulateMultitenant({ runs: 10, minutes: 30 });
    expect(r).toEqual({ collisions: 0, corruptWorktrees: 0, doubleClaims: 0 });
    expect(allClear(r)).toBe(true);
  });

  it("holds at higher concurrency (N=50)", () => {
    expect(simulateMultitenant({ runs: 50, minutes: 30 })).toEqual({
      collisions: 0,
      corruptWorktrees: 0,
      doubleClaims: 0,
    });
  });

  it("is deterministic — same result every run", () => {
    expect(simulateMultitenant()).toEqual(simulateMultitenant());
  });

  it("allClear rejects any non-zero observable", () => {
    expect(allClear({ collisions: 1, corruptWorktrees: 0, doubleClaims: 0 })).toBe(false);
    expect(allClear({ collisions: 0, corruptWorktrees: 1, doubleClaims: 0 })).toBe(false);
    expect(allClear({ collisions: 0, corruptWorktrees: 0, doubleClaims: 1 })).toBe(false);
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
  it("parses runs / minutes / json with default fallback", () => {
    expect(parseArgs(["--runs=5", "--minutes=12", "--json"])).toEqual({
      runs: 5,
      minutes: 12,
      jsonOnly: true,
    });
    expect(parseArgs([])).toEqual({ runs: 10, minutes: 30, jsonOnly: false });
  });
});
