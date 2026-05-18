import { describe, expect, test } from "vitest";

import {
  computeDynamicSettings,
  parseTimingsFromJsonl,
  type IterationTiming,
} from "./dynamic-timeouts.js";

describe("computeDynamicSettings", () => {
  test("returns defaults when history is empty", () => {
    const s = computeDynamicSettings([]);
    expect(s.source).toBe("default");
    expect(s.spawnTimeoutMs).toBe(20 * 60 * 1000);
    expect(s.tickIntervalMs).toBe(5 * 60 * 1000);
    expect(s.p95Ms).toBeNull();
  });

  test("returns defaults when < 5 successful data points", () => {
    const history: IterationTiming[] = [
      { durationMs: 100_000, verdict: "validated" },
      { durationMs: 200_000, verdict: "validated" },
    ];
    const s = computeDynamicSettings(history);
    expect(s.source).toBe("default");
    expect(s.sampleSize).toBe(2);
  });

  test("computes from history with enough data", () => {
    // 10 iterations from 60s to 300s
    const history: IterationTiming[] = Array.from({ length: 10 }, (_, i) => ({
      durationMs: (i + 1) * 30_000, // 30s, 60s, 90s, ... 300s
      verdict: "validated" as const,
    }));
    const s = computeDynamicSettings(history);
    expect(s.source).toBe("history");
    expect(s.sampleSize).toBe(10);
    expect(s.p95Ms).toBeGreaterThan(0);
    // p95 of 30k..300k ≈ 285k, × 1.5 = 427k ≈ 7min
    expect(s.spawnTimeoutMs).toBeGreaterThan(2 * 60 * 1000); // > min
    expect(s.spawnTimeoutMs).toBeLessThan(45 * 60 * 1000); // < max
  });

  test("excludes spawn-failed and sub-10s durations", () => {
    const history: IterationTiming[] = [
      { durationMs: 4000, verdict: "spawn-failed" }, // excluded: spawn-failed
      { durationMs: 5000, verdict: "validated" }, // excluded: <10s
      { durationMs: 900_000, verdict: "spawn-failed" }, // excluded: watchdog kill
      ...Array.from({ length: 8 }, () => ({
        durationMs: 180_000,
        verdict: "validated" as const,
      })),
    ];
    const s = computeDynamicSettings(history);
    expect(s.source).toBe("history");
    expect(s.sampleSize).toBe(8); // only the 180s validated ones
  });

  test("includes scope-leak as successful timing data", () => {
    const history: IterationTiming[] = Array.from({ length: 6 }, () => ({
      durationMs: 200_000,
      verdict: "scope-leak" as const,
    }));
    const s = computeDynamicSettings(history);
    expect(s.source).toBe("history");
    expect(s.sampleSize).toBe(6);
  });

  test("clamps watchdog to minimum 2min", () => {
    // All very fast iterations
    const history: IterationTiming[] = Array.from({ length: 10 }, () => ({
      durationMs: 15_000, // 15s
      verdict: "validated" as const,
    }));
    const s = computeDynamicSettings(history);
    expect(s.spawnTimeoutMs).toBe(2 * 60 * 1000);
  });

  test("clamps watchdog to maximum 45min", () => {
    // All very slow iterations
    const history: IterationTiming[] = Array.from({ length: 10 }, () => ({
      durationMs: 40 * 60 * 1000, // 40min
      verdict: "validated" as const,
    }));
    const s = computeDynamicSettings(history);
    expect(s.spawnTimeoutMs).toBe(45 * 60 * 1000);
  });

  test("real-world data: produces reasonable settings", () => {
    // Based on actual 2026-05-18 minsky session data
    const history: IterationTiming[] = [
      { durationMs: 72_000, verdict: "validated" },
      { durationMs: 113_000, verdict: "validated" },
      { durationMs: 175_000, verdict: "validated" },
      { durationMs: 200_000, verdict: "validated" },
      { durationMs: 256_000, verdict: "validated" },
      { durationMs: 336_000, verdict: "validated" },
      { durationMs: 383_000, verdict: "validated" },
      { durationMs: 667_000, verdict: "validated" },
      { durationMs: 696_000, verdict: "validated" },
      { durationMs: 900_000, verdict: "spawn-failed" }, // watchdog kill — excluded
    ];
    const s = computeDynamicSettings(history);
    expect(s.source).toBe("history");
    expect(s.sampleSize).toBe(9);
    // p95 ≈ 696s, × 1.5 ≈ 1044s ≈ 17min → reasonable watchdog
    expect(s.spawnTimeoutMs).toBeGreaterThan(10 * 60 * 1000);
    expect(s.spawnTimeoutMs).toBeLessThan(25 * 60 * 1000);
  });
});

describe("parseTimingsFromJsonl", () => {
  test("parses valid jsonl", () => {
    const jsonl = [
      '{"verdict":"validated","notes":"loop iteration=0; 180000ms; live"}',
      '{"verdict":"spawn-failed","notes":"loop iteration=0; 4000ms; live"}',
      "",
    ].join("\n");
    const timings = parseTimingsFromJsonl(jsonl);
    expect(timings).toHaveLength(2);
    expect(timings[0]).toEqual({ durationMs: 180_000, verdict: "validated" });
    expect(timings[1]).toEqual({ durationMs: 4000, verdict: "spawn-failed" });
  });

  test("skips malformed lines", () => {
    const jsonl = "not json\n{}\n";
    const timings = parseTimingsFromJsonl(jsonl);
    expect(timings).toHaveLength(0);
  });
});
