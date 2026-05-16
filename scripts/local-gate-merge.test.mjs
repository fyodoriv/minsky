// Tests for local-gate-merge.mjs — pure decision functions + injected-seam
// sweep. No @ts-check (matches sibling scripts/*.test.mjs convention).
import { describe, expect, it } from "vitest";
import {
  decideMerge,
  parseGateVerdict,
  pickGateCandidates,
  runGateSweep,
} from "./local-gate-merge.mjs";

/** @param {Partial<import("./local-gate-merge.mjs").PrSnapshot> & {number:number}} p */
const pr = (p) => ({
  number: p.number,
  isDraft: p.isDraft ?? false,
  mergeable: p.mergeable ?? "MERGEABLE",
  baseRefName: p.baseRefName ?? "main",
  headRefName: p.headRefName ?? `feat/${p.number}`,
  title: p.title ?? `PR ${p.number}`,
});

describe("pickGateCandidates", () => {
  it("keeps non-draft, non-CONFLICTING, base=main PRs", () => {
    const got = pickGateCandidates([
      pr({ number: 1 }),
      pr({ number: 2, isDraft: true }),
      pr({ number: 3, mergeable: "CONFLICTING" }),
      pr({ number: 4, baseRefName: "docs/x" }),
      pr({ number: 5, mergeable: "UNKNOWN" }),
    ]);
    expect(got.map((p) => p.number)).toEqual([1, 5]);
  });
});

describe("parseGateVerdict", () => {
  it("green when summary allPass=true and no failed steps", () => {
    const out = [
      JSON.stringify({ name: "biome", verdict: "pass" }),
      JSON.stringify({ name: "typecheck", verdict: "pass" }),
      JSON.stringify({ summary: true, stage: "full", allPass: true, stepCount: 2 }),
    ].join("\n");
    expect(parseGateVerdict(out)).toEqual({ green: true, failedSteps: [], sawSummary: true });
  });

  it("red + names the failed step when a step verdict=fail", () => {
    const out = [
      JSON.stringify({ name: "biome", verdict: "fail" }),
      JSON.stringify({ name: "vitest", verdict: "pass" }),
      JSON.stringify({ summary: true, allPass: false, stepCount: 2 }),
    ].join("\n");
    expect(parseGateVerdict(out)).toEqual({
      green: false,
      failedSteps: ["biome"],
      sawSummary: true,
    });
  });

  it("not green when summary is missing (vet did not complete)", () => {
    const out = JSON.stringify({ name: "biome", verdict: "pass" });
    expect(parseGateVerdict(out)).toEqual({ green: false, failedSteps: [], sawSummary: false });
  });

  it("ignores non-JSON and garbage lines", () => {
    const out = ["noise", "  ", "{bad json", JSON.stringify({ summary: true, allPass: true })].join(
      "\n",
    );
    expect(parseGateVerdict(out).green).toBe(true);
  });
});

describe("decideMerge", () => {
  const okVerdict = { green: true, failedSteps: [], sawSummary: true };
  it("merges on green", () => {
    expect(decideMerge({ pr: pr({ number: 1 }), verdict: okVerdict }).action).toBe("merge");
  });
  it("skips on vetError", () => {
    const d = decideMerge({
      pr: pr({ number: 1 }),
      verdict: { green: false, failedSteps: [], sawSummary: false },
      vetError: "merge-onto-main-conflict",
    });
    expect(d.action).toBe("skip");
    expect(d.reason).toContain("merge-onto-main-conflict");
  });
  it("skips on red with the failed steps in the reason", () => {
    const d = decideMerge({
      pr: pr({ number: 1 }),
      verdict: { green: false, failedSteps: ["vitest"], sawSummary: true },
    });
    expect(d.action).toBe("skip");
    expect(d.reason).toContain("vitest");
  });
  it("skips when the gate produced no summary", () => {
    expect(
      decideMerge({
        pr: pr({ number: 1 }),
        verdict: { green: false, failedSteps: [], sawSummary: false },
      }).action,
    ).toBe("skip");
  });
});

describe("runGateSweep (injected seam)", () => {
  const greenStdout = JSON.stringify({ summary: true, allPass: true, stepCount: 1 });
  const redStdout = [
    JSON.stringify({ name: "typecheck", verdict: "fail" }),
    JSON.stringify({ summary: true, allPass: false, stepCount: 1 }),
  ].join("\n");

  it("merges only the gate-green PR; skips the red one; never merges in dry-run", () => {
    const merged = /** @type {number[]} */ ([]);
    const base = {
      snapshotFn: () => [pr({ number: 10 }), pr({ number: 11 })],
      vetFn: (/** @type {import("./local-gate-merge.mjs").PrSnapshot} */ p) => ({
        stdout: p.number === 10 ? greenStdout : redStdout,
      }),
      mergeFn: (/** @type {import("./local-gate-merge.mjs").PrSnapshot} */ p) =>
        merged.push(p.number),
      log: () => {},
    };
    const real = runGateSweep(base);
    expect(merged).toEqual([10]);
    expect(real.merged.map((m) => m.number)).toEqual([10]);
    expect(real.skipped.map((s) => s.number)).toEqual([11]);

    merged.length = 0;
    const dry = runGateSweep({ ...base, dryRun: true });
    expect(merged).toEqual([]); // mergeFn never called in dry-run
    expect(dry.merged.map((m) => m.number)).toEqual([10]);
  });

  it("skips a vetError PR without calling mergeFn", () => {
    let mergeCalls = 0;
    const res = runGateSweep({
      snapshotFn: () => [pr({ number: 20 })],
      vetFn: () => ({ vetError: "merge-onto-main-conflict" }),
      mergeFn: () => {
        mergeCalls += 1;
      },
      log: () => {},
    });
    expect(mergeCalls).toBe(0);
    expect(res.skipped[0]?.reason).toContain("merge-onto-main-conflict");
  });

  it("records a merge-call failure as skipped, not merged", () => {
    const res = runGateSweep({
      snapshotFn: () => [pr({ number: 30 })],
      vetFn: () => ({ stdout: greenStdout }),
      mergeFn: () => {
        throw new Error("gh exploded");
      },
      log: () => {},
    });
    expect(res.merged).toEqual([]);
    expect(res.skipped[0]?.reason).toContain("merge-failed");
  });

  it("respects --pr (onlyPr) and limit", () => {
    const seen = /** @type {number[]} */ ([]);
    runGateSweep({
      snapshotFn: () => [pr({ number: 1 }), pr({ number: 2 }), pr({ number: 3 })],
      onlyPr: 2,
      vetFn: (/** @type {import("./local-gate-merge.mjs").PrSnapshot} */ p) => {
        seen.push(p.number);
        return { stdout: greenStdout };
      },
      mergeFn: () => {},
      log: () => {},
    });
    expect(seen).toEqual([2]);
  });
});
