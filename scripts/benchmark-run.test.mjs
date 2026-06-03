// @ts-check
// Tests for the competitive self-column reducer (task
// obs-live-competitive-self-column). Pure functions over a fixture run summary
// + the real competitor corpus.
import { describe, expect, it } from "vitest";
import { buildScorecard, minskyReadings } from "./benchmark-run.mjs";

/** An enriched run summary with enough signal to populate all 5 metrics. */
const richSummary = {
  runId: "R1",
  totalUptimeSec: 8 * 3600,
  longestUninterruptedSec: 6 * 3600,
  tasksAttempted: 12,
  tasksMerged: 8,
  meanMergeLatencySec: 3600,
  meanCostPerMergedPr: 1.25,
};

describe("minskyReadings", () => {
  it("derives all 5 ledger metrics when the run has enough signal", () => {
    const r = minskyReadings(richSummary);
    expect(typeof r["deploy-frequency"]).toBe("number");
    expect(r["daemon-stability-pct"]).toBe(0.75); // 6h / 8h
    expect(r["autonomous-merge-rate"]).toBeCloseTo(8 / 12, 3);
    expect(r["mean-autonomous-merge-latency"]).toBe(3600);
    expect(r["cost-per-merged-pr"]).toBe(1.25);
    const nonNull = Object.values(r).filter((v) => typeof v === "number").length;
    expect(nonNull).toBeGreaterThanOrEqual(5);
  });

  it("suppresses count-sensitive metrics under the small-n guard", () => {
    const r = minskyReadings({ ...richSummary, tasksMerged: 3 });
    expect(r["mean-autonomous-merge-latency"]).toBeNull();
    expect(r["cost-per-merged-pr"]).toBeNull();
    // stability + merge-rate are ratios, not count-sensitive → still present
    expect(r["daemon-stability-pct"]).not.toBeNull();
  });

  it("returns all-null on an empty summary (never throws)", () => {
    const r = minskyReadings({});
    expect(Object.values(r).every((v) => v === null)).toBe(true);
  });
});

describe("buildScorecard", () => {
  it("emits a minsky column and direction-aware deltas vs the real corpus", () => {
    const sc = buildScorecard(minskyReadings(richSummary));
    expect(sc.minsky.nonNullMetrics).toBeGreaterThanOrEqual(5);
    // every emitted delta references a metric the competitor actually publishes
    for (const c of sc.competitors) {
      expect(c.deltas.length).toBeGreaterThan(0);
      for (const d of c.deltas) expect(typeof d.competitor).toBe("number");
    }
  });

  it("computes a higher-is-better delta correctly against a synthetic competitor", () => {
    const fake = [
      {
        id: "fake",
        label: "Fake",
        resultSource: { kind: "published", values: { "deploy-frequency": 10 } },
      },
    ];
    const r = minskyReadings(richSummary); // deploy-frequency = 8 merges / (8h/24h) = 24/day
    const sc = buildScorecard(r, { competitors: fake });
    const d = sc.competitors[0]?.deltas.find((x) => x.metricId === "deploy-frequency");
    // minsky 24/day vs competitor 10/day, higher-is-better → positive delta
    expect(d?.delta).toBeGreaterThan(0);
  });
});
