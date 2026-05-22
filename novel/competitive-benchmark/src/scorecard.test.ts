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

  test("(c) empty-Minsky scorecard hits 0 live deltas; the shape gate is MET (post-corpus-expansion)", () => {
    const sc = buildScorecard({ minskyValues: {}, now: NOW });
    // After the 2026-05-22 corpus expansion, the corpus carries 5
    // distinct metrics across ≥4 published competitors — the M1.10
    // shape gate MEETS the ≥4 × ≥5 target regardless of Minsky-side
    // measurement. `liveDeltaCount` stays 0 until Minsky has measured
    // at least one shared metric (cold-start expected behavior).
    expect(sc.acceptance.meetsM110).toBe(true);
    expect(sc.acceptance.gap).toBe("");
    expect(sc.acceptance.competitorsWithData).toBeGreaterThanOrEqual(4);
    expect(sc.acceptance.metricsWithComparison).toBeGreaterThanOrEqual(5);
    expect(sc.acceptance.liveDeltaCount).toBe(0);
  });

  test("(d) Minsky reading on autonomous-merge-rate now produces ≥1 live delta", () => {
    // Post-corpus-expansion the corpus carries autonomous-merge-rate for
    // Devin (0.67), Claude Code (0.726), Cursor (0.804) — so a Minsky
    // measurement on that metric joins to ≥3 competitor cells.
    const sc = buildScorecard({
      minskyValues: { "autonomous-merge-rate": 0.85 },
      now: NOW,
    });
    expect(sc.acceptance.liveDeltaCount).toBeGreaterThanOrEqual(3);
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
