import { describe, expect, test } from "vitest";

import { COMPETITORS } from "./competitors.js";
import { METRICS } from "./metrics.js";
import { buildScorecard } from "./scorecard.js";

const NOW = "2026-05-22T07:00:00.000Z";

describe("buildScorecard", () => {
  test("(a) generates one cell per (metric × competitor); grid is fixed-shape", () => {
    const sc = buildScorecard({ minskyValues: {}, now: NOW });
    expect(sc.cellCount).toBe(METRICS.length * COMPETITORS.length);
    expect(sc.cells.length).toBe(sc.cellCount);
  });

  test("(b) generatedAt and metrics/competitors stamps are preserved", () => {
    const sc = buildScorecard({ minskyValues: {}, now: NOW });
    expect(sc.generatedAt).toBe(NOW);
    expect(sc.metrics).toHaveLength(METRICS.length);
    expect(sc.competitors).toHaveLength(COMPETITORS.length);
    expect(sc.metrics[0]).toMatchObject({ id: expect.any(String), label: expect.any(String) });
  });

  test("(c) empty-Minsky scorecard has 0 live deltas and shape gap on metrics axis", () => {
    const sc = buildScorecard({ minskyValues: {}, now: NOW });
    // Today the corpus carries SWE-bench Verified across ≥4 competitors,
    // but only ONE shared metric — the metrics axis fails the shape gate.
    expect(sc.acceptance.liveDeltaCount).toBe(0);
    expect(sc.acceptance.meetsM110).toBe(false);
    expect(sc.acceptance.gap).toMatch(/M1.10 shape gap/);
    expect(sc.acceptance.gap).toMatch(/metric\(s\) with published values/);
  });

  test("(d) Minsky reading without a competitor counterpart in the corpus → no live delta", () => {
    // autonomous-merge-rate has 0 competitor values in the published corpus today
    const sc = buildScorecard({
      minskyValues: { "autonomous-merge-rate": 0.85 },
      now: NOW,
    });
    expect(sc.acceptance.liveDeltaCount).toBe(0);
  });

  test("(e) Minsky reading WITH a competitor counterpart produces a live delta", () => {
    // swe-bench-verified-resolve-rate has 5 competitor values in the corpus
    const sc = buildScorecard({
      minskyValues: { "swe-bench-verified-resolve-rate": 0.65 },
      now: NOW,
    });
    expect(sc.acceptance.liveDeltaCount).toBeGreaterThanOrEqual(1);
    // The live deltas equal the number of competitors that report
    // swe-bench-verified-resolve-rate (5 in the current corpus).
    const sweBenchCells = sc.cells.filter(
      (c) => c.metricId === "swe-bench-verified-resolve-rate" && c.delta !== undefined,
    );
    expect(sweBenchCells.length).toBe(sc.acceptance.liveDeltaCount);
  });

  test("(f) delta sign reflects direction-aware comparison (higher-is-better)", () => {
    const sc = buildScorecard({
      minskyValues: { "swe-bench-verified-resolve-rate": 0.99 },
      now: NOW,
    });
    // Minsky scoring 0.99 should be ahead of every competitor on a
    // higher-is-better metric → all deltas positive.
    const cells = sc.cells.filter(
      (c) => c.metricId === "swe-bench-verified-resolve-rate" && c.delta !== undefined,
    );
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.delta).toBeGreaterThan(0);
    }
  });

  test("(g) competitors with a published metric value appear in competitorsWithData", () => {
    const sc = buildScorecard({ minskyValues: {}, now: NOW });
    // The corpus carries SWE-bench Verified for 5 published competitors.
    expect(sc.acceptance.competitorsWithData).toBeGreaterThanOrEqual(4);
  });

  test("(h) NaN Minsky value does not produce a delta cell even with a competitor value", () => {
    const sc = buildScorecard({
      minskyValues: { "swe-bench-verified-resolve-rate": Number.NaN },
      now: NOW,
    });
    expect(sc.acceptance.liveDeltaCount).toBe(0);
  });

  test("(i) all-published competitor corpus produces stable comparisonCount", () => {
    const sc1 = buildScorecard({
      minskyValues: { "swe-bench-verified-resolve-rate": 0.5 },
      now: NOW,
    });
    const sc2 = buildScorecard({
      minskyValues: { "swe-bench-verified-resolve-rate": 0.5 },
      now: NOW,
    });
    expect(sc1.comparisonCount).toBe(sc2.comparisonCount);
    expect(sc1.acceptance.liveDeltaCount).toBe(sc2.acceptance.liveDeltaCount);
  });

  test("(j) cells without competitor data still emit a row (fixed-shape grid)", () => {
    const sc = buildScorecard({ minskyValues: {}, now: NOW });
    // Every (metric × competitor) appears exactly once
    const seen = new Set<string>();
    for (const cell of sc.cells) {
      const key = `${cell.metricId}::${cell.competitorId}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(sc.cellCount);
  });
});
