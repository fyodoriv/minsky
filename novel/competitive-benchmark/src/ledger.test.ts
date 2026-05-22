import { describe, expect, test } from "vitest";

import { type IterationRecord, computeMinskyReadings, readingsToMetricValues } from "./ledger.js";

describe("computeMinskyReadings", () => {
  test("(a) empty ledger → every rate is NaN; sample counts are zero", () => {
    const r = computeMinskyReadings([]);
    expect(Number.isNaN(r.autonomousMergeRate)).toBe(true);
    expect(Number.isNaN(r.meanAutonomousMergeLatencySeconds)).toBe(true);
    expect(Number.isNaN(r.costPerMergedPrUsd)).toBe(true);
    expect(Number.isNaN(r.gatePassRate)).toBe(true);
    expect(Number.isNaN(r.humanInterventionRate)).toBe(true);
    expect(r.samples.totalIterations).toBe(0);
    expect(r.samples.mergedPrs).toBe(0);
    expect(r.samples.openedPrs).toBe(0);
  });

  test("(b) all-success ledger → autonomousMergeRate=1, humanInterventionRate=0", () => {
    const records: IterationRecord[] = [
      {
        verdict: "pr-open",
        pr: "https://example.com/pr/1",
        prState: "merged",
        humanEdits: false,
        ciFirstPushGreen: true,
        durationSec: 3600,
        costUsd: 0.5,
      },
      {
        verdict: "pr-open",
        pr: "https://example.com/pr/2",
        prState: "merged",
        humanEdits: false,
        ciFirstPushGreen: true,
        durationSec: 1800,
        costUsd: 0.3,
      },
    ];
    const r = computeMinskyReadings(records);
    expect(r.autonomousMergeRate).toBe(1);
    expect(r.gatePassRate).toBe(1);
    expect(r.humanInterventionRate).toBe(0);
    expect(r.meanAutonomousMergeLatencySeconds).toBe(2700);
    expect(r.costPerMergedPrUsd).toBeCloseTo(0.4);
    expect(r.samples.mergedPrs).toBe(2);
    expect(r.samples.openedPrs).toBe(2);
  });

  test("(c) mixed verdicts → humanInterventionRate counts failures+edits over all iterations", () => {
    const records: IterationRecord[] = [
      {
        verdict: "pr-open",
        pr: "https://example.com/pr/1",
        prState: "merged",
        humanEdits: false,
        ciFirstPushGreen: true,
      },
      // human-edited PR — counts as intervention
      {
        verdict: "pr-open",
        pr: "https://example.com/pr/2",
        prState: "merged",
        humanEdits: true,
        ciFirstPushGreen: false,
      },
      // spawn-failed — counts as intervention
      { verdict: "spawn-failed" },
      // no-change — doesn't count
      { verdict: "no-change" },
    ];
    const r = computeMinskyReadings(records);
    expect(r.samples.totalIterations).toBe(4);
    expect(r.samples.openedPrs).toBe(2);
    expect(r.samples.mergedPrs).toBe(2);
    expect(r.autonomousMergeRate).toBe(1); // 2 merged / 2 opened
    expect(r.gatePassRate).toBe(0.5); // 1 green CI / 2 opened
    // 1 humanEdits + 1 spawn-failed = 2 interventions / 4 iterations
    expect(r.humanInterventionRate).toBe(0.5);
  });

  test("(d) opened-but-not-merged PRs don't contribute to merge-rate denominator on merged side", () => {
    const records: IterationRecord[] = [
      {
        verdict: "pr-open",
        pr: "https://example.com/pr/1",
        prState: "merged",
        ciFirstPushGreen: true,
      },
      {
        verdict: "pr-open",
        pr: "https://example.com/pr/2",
        prState: "open",
        ciFirstPushGreen: true,
      },
      {
        verdict: "pr-open",
        pr: "https://example.com/pr/3",
        prState: "closed",
        ciFirstPushGreen: false,
      },
    ];
    const r = computeMinskyReadings(records);
    expect(r.samples.openedPrs).toBe(3);
    expect(r.samples.mergedPrs).toBe(1);
    expect(r.autonomousMergeRate).toBeCloseTo(1 / 3);
    expect(r.gatePassRate).toBeCloseTo(2 / 3);
  });

  test("(e) ignores malformed records (missing verdict / missing pr URL)", () => {
    const records: IterationRecord[] = [
      // no `verdict` → ignored
      {},
      // `pr-open` but missing PR URL → not counted as opened
      { verdict: "pr-open" },
      // valid
      {
        verdict: "pr-open",
        pr: "https://example.com/pr/1",
        prState: "merged",
      },
    ];
    const r = computeMinskyReadings(records);
    expect(r.samples.openedPrs).toBe(1);
    expect(r.samples.mergedPrs).toBe(1);
    expect(r.autonomousMergeRate).toBe(1);
  });

  test("(f) returns the same shape on re-invocation (referential transparency check)", () => {
    const records: IterationRecord[] = [{ verdict: "pr-open", pr: "x", prState: "merged" }];
    const r1 = computeMinskyReadings(records);
    const r2 = computeMinskyReadings(records);
    expect(r1).toStrictEqual(r2);
  });
});

describe("readingsToMetricValues", () => {
  test("(g) keys match canonical MetricDefinition ids in metrics.ts", () => {
    const r = computeMinskyReadings([{ verdict: "pr-open", pr: "x", prState: "merged" }]);
    const v = readingsToMetricValues(r);
    expect(Object.keys(v).sort()).toEqual([
      "autonomous-merge-rate",
      "cost-per-merged-pr",
      "gate-pass-rate",
      "human-intervention-rate",
      "mean-autonomous-merge-latency",
    ]);
  });

  test("(h) NaN readings propagate to the values object (visible-not-silent)", () => {
    const v = readingsToMetricValues(computeMinskyReadings([]));
    for (const value of Object.values(v)) {
      expect(Number.isNaN(value)).toBe(true);
    }
  });
});
