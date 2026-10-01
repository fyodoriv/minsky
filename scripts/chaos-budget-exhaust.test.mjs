// @ts-check
// Tests for `scripts/chaos-budget-exhaust.mjs` — slice 6 of
// `local-llm-fallback-on-budget-pause`.

import { describe, expect, it } from "vitest";

import { assertSteadyState, parseArgs } from "./chaos-budget-exhaust.mjs";

describe("chaos-budget-exhaust / parseArgs", () => {
  it("returns defaults", () => {
    const a = parseArgs([]);
    expect(a.maxIterations).toBe(3);
    expect(a.probeUrl).toBe("http://127.0.0.1:8080/v1/models");
    expect(a.reportPath).toBeUndefined();
  });

  it("--max-iterations= overrides default when positive integer", () => {
    expect(parseArgs(["--max-iterations=10"]).maxIterations).toBe(10);
  });

  it("--max-iterations=0 falls back to default", () => {
    expect(parseArgs(["--max-iterations=0"]).maxIterations).toBe(3);
  });

  it("--probe-url= overrides default", () => {
    expect(parseArgs(["--probe-url=http://elsewhere/v1/models"]).probeUrl).toBe(
      "http://elsewhere/v1/models",
    );
  });

  it("--report= captures report path", () => {
    expect(parseArgs(["--report=/tmp/chaos.json"]).reportPath).toBe("/tmp/chaos.json");
  });
});

describe("chaos-budget-exhaust / assertSteadyState", () => {
  it("PASS when ≥1 local iteration is observed", () => {
    const stdout = [
      '[span] tick-loop.iteration {"iteration.index":0,"iteration.status":"completed","iteration.provider":"claude"}',
      '[span] tick-loop.iteration {"iteration.index":1,"iteration.status":"completed","iteration.provider":"local"}',
      '[span] tick-loop.iteration {"iteration.index":2,"iteration.status":"completed","iteration.provider":"local"}',
    ].join("\n");
    const v = assertSteadyState(stdout);
    expect(v.verdict).toBe("pass");
    expect(v.localIterations).toBe(2);
    expect(v.claudeIterations).toBe(1);
    expect(v.totalIterations).toBe(3);
  });

  it("FAIL when no local iteration is observed", () => {
    const stdout = [
      '[span] tick-loop.iteration {"iteration.index":0,"iteration.status":"completed","iteration.provider":"claude"}',
      '[span] tick-loop.iteration {"iteration.index":1,"iteration.status":"completed","iteration.provider":"claude"}',
    ].join("\n");
    const v = assertSteadyState(stdout);
    expect(v.verdict).toBe("fail");
    expect(v.localIterations).toBe(0);
    expect(v.claudeIterations).toBe(2);
    expect(v.reason).toContain("expected ≥1 local iteration");
  });

  it("FAIL when only hold iterations observed (both providers unavailable)", () => {
    const stdout = [
      '[span] tick-loop.iteration {"iteration.index":0,"iteration.status":"failed","iteration.provider":"hold"}',
    ].join("\n");
    const v = assertSteadyState(stdout);
    expect(v.verdict).toBe("fail");
    expect(v.holdIterations).toBe(1);
  });

  it("PASS when local mixed with hold (at least one local)", () => {
    const stdout = [
      '[span] tick-loop.iteration {"iteration.index":0,"iteration.status":"failed","iteration.provider":"hold"}',
      '[span] tick-loop.iteration {"iteration.index":1,"iteration.status":"completed","iteration.provider":"local"}',
    ].join("\n");
    const v = assertSteadyState(stdout);
    expect(v.verdict).toBe("pass");
    expect(v.localIterations).toBe(1);
    expect(v.holdIterations).toBe(1);
  });

  it("FAIL on empty stdout (no iterations ran)", () => {
    expect(assertSteadyState("").verdict).toBe("fail");
  });

  it("ignores non-iteration lines", () => {
    const stdout = [
      "[tick-loop] notifier wired",
      '[span] tick-loop.iteration {"iteration.index":0,"iteration.status":"completed","iteration.provider":"local"}',
      "random log line",
    ].join("\n");
    const v = assertSteadyState(stdout);
    expect(v.verdict).toBe("pass");
    expect(v.totalIterations).toBe(1);
  });

  it("tolerates malformed JSON in iteration spans (graceful-degrade)", () => {
    const stdout = [
      "[span] tick-loop.iteration {malformed",
      '[span] tick-loop.iteration {"iteration.index":0,"iteration.status":"completed","iteration.provider":"local"}',
    ].join("\n");
    const v = assertSteadyState(stdout);
    expect(v.verdict).toBe("pass");
    expect(v.localIterations).toBe(1);
    // Total counts the malformed line too — every span-prefixed line is
    // an iteration attempt, even if the JSON didn't parse.
    expect(v.totalIterations).toBe(2);
  });

  it("counts iterations with no provider field as untagged (not local/claude/hold)", () => {
    const stdout = [
      '[span] tick-loop.iteration {"iteration.index":0,"iteration.status":"completed"}',
    ].join("\n");
    const v = assertSteadyState(stdout);
    expect(v.verdict).toBe("fail"); // no local
    expect(v.localIterations).toBe(0);
    expect(v.claudeIterations).toBe(0);
    expect(v.holdIterations).toBe(0);
    expect(v.totalIterations).toBe(1);
  });
});
