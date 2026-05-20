// Unit tests for minsky-benchmark — pure helpers only. The runner-spawning
// CLI wrapper is exercised by the integration tests in
// test/integration/m1-red-green.test.ts.

import { describe, expect, test } from "vitest";
import {
  PASS_VERDICTS,
  aggregateBenchmark,
  classifyVerdict,
  formatBenchmarkSummary,
  parseRunnerOutput,
} from "./minsky-benchmark.mjs";

describe("PASS_VERDICTS", () => {
  test("includes the four canonical pass states", () => {
    expect(PASS_VERDICTS.has("pr-open")).toBe(true);
    expect(PASS_VERDICTS.has("no-change")).toBe(true);
    expect(PASS_VERDICTS.has("empty-queue")).toBe(true);
    expect(PASS_VERDICTS.has("validated")).toBe(true);
  });
  test("excludes the two canonical fail states", () => {
    expect(PASS_VERDICTS.has("spawn-failed")).toBe(false);
    expect(PASS_VERDICTS.has("scope-leak")).toBe(false);
  });
  test("is frozen (no accidental mutation)", () => {
    expect(Object.isFrozen(PASS_VERDICTS)).toBe(true);
  });
});

describe("classifyVerdict", () => {
  test("pass-set verdicts return 'pass'", () => {
    expect(classifyVerdict("pr-open")).toBe("pass");
    expect(classifyVerdict("validated")).toBe("pass");
  });
  test("fail-set verdicts return 'fail'", () => {
    expect(classifyVerdict("spawn-failed")).toBe("fail");
    expect(classifyVerdict("scope-leak")).toBe("fail");
  });
  test("undefined / null / empty return 'unknown'", () => {
    expect(classifyVerdict(undefined)).toBe("unknown");
    expect(classifyVerdict(null)).toBe("unknown");
    expect(classifyVerdict("")).toBe("unknown");
  });
  test("novel verdicts default to 'fail' (conservative)", () => {
    // If the runner emits a new verdict we haven't catalogued, it
    // should NOT silently inflate the pass rate.
    expect(classifyVerdict("totally-new-thing")).toBe("fail");
  });
});

describe("parseRunnerOutput", () => {
  test("extracts verdict= line", () => {
    const out = "⏱ iteration #0: task=foo agent=devin verdict=validated duration=0s pr=—";
    expect(parseRunnerOutput(out)).toBe("validated");
  });
  test("falls back to stopReason when no verdict= present", () => {
    const out = "=== host-daemon loop summary ===\nstopReason: empty-queue\niterations: 0";
    expect(parseRunnerOutput(out)).toBe("empty-queue");
  });
  test("returns undefined on no-match output", () => {
    expect(parseRunnerOutput("hello world")).toBe(undefined);
  });
  test("verdict= takes precedence over stopReason if both present", () => {
    const out = "verdict=pr-open\nstopReason: scope-leak";
    expect(parseRunnerOutput(out)).toBe("pr-open");
  });
});

describe("aggregateBenchmark", () => {
  test("empty outcomes returns zeroed report", () => {
    const r = aggregateBenchmark([]);
    expect(r.iterations).toBe(0);
    expect(r.pass_rate).toBe(0);
    expect(r.mean_duration_ms).toBe(0);
    expect(r.verdict_counts).toEqual({});
  });

  test("all-pass run shows 100%", () => {
    const r = aggregateBenchmark([
      { verdict: "validated", durationMs: 100, exitCode: 0 },
      { verdict: "validated", durationMs: 200, exitCode: 0 },
    ]);
    expect(r.iterations).toBe(2);
    expect(r.pass_rate).toBe(100);
    expect(r.mean_duration_ms).toBe(150);
    expect(r.verdict_counts).toEqual({ validated: 2 });
  });

  test("all-fail run shows 0%", () => {
    const r = aggregateBenchmark([
      { verdict: "spawn-failed", durationMs: 50, exitCode: -1 },
      { verdict: "scope-leak", durationMs: 30, exitCode: 0 },
    ]);
    expect(r.iterations).toBe(2);
    expect(r.pass_rate).toBe(0);
    expect(r.verdict_counts).toEqual({ "spawn-failed": 1, "scope-leak": 1 });
  });

  test("mixed run computes correct fractional rate", () => {
    const r = aggregateBenchmark([
      { verdict: "validated", durationMs: 100 },
      { verdict: "spawn-failed", durationMs: 100 },
      { verdict: "validated", durationMs: 100 },
      { verdict: "spawn-failed", durationMs: 100 },
    ]);
    expect(r.iterations).toBe(4);
    expect(r.pass_rate).toBe(50);
  });

  test("undefined verdict counts as 'unknown' and is fail", () => {
    const r = aggregateBenchmark([{ verdict: undefined, durationMs: 0 }]);
    expect(r.verdict_counts["unknown"]).toBe(1);
    expect(r.pass_rate).toBe(0);
  });
});

describe("formatBenchmarkSummary", () => {
  test("includes iterations, pass-rate, mean duration, and verdict breakdown", () => {
    const out = formatBenchmarkSummary({
      iterations: 3,
      verdict_counts: { validated: 2, "spawn-failed": 1 },
      pass_rate: 67,
      mean_duration_ms: 250,
    });
    expect(out).toContain("iterations:        3");
    expect(out).toContain("pass-rate:         67%");
    expect(out).toContain("mean duration:     250ms");
    expect(out).toContain("validated");
    expect(out).toContain("spawn-failed");
  });

  test("verdict list is sorted alphabetically (deterministic output)", () => {
    const out = formatBenchmarkSummary({
      iterations: 3,
      verdict_counts: { "z-last": 1, "a-first": 1, "m-mid": 1 },
      pass_rate: 0,
      mean_duration_ms: 0,
    });
    const aIdx = out.indexOf("a-first");
    const mIdx = out.indexOf("m-mid");
    const zIdx = out.indexOf("z-last");
    expect(aIdx).toBeLessThan(mIdx);
    expect(mIdx).toBeLessThan(zIdx);
  });
});
