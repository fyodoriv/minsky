import { describe, expect, it } from "vitest";
import { accumulate24h, latestRunEndMs, longestRun } from "./runs-aggregate.mjs";

const H = 3600;

/**
 * Non-null narrow for @ts-check: a reducer returning `T | null` plus an
 * assertion the caller already verified. Keeps the tests strict-typed.
 * @template T
 * @param {T | null} v
 * @returns {T}
 */
function nn(v) {
  if (v === null) throw new Error("expected non-null");
  return v;
}

/** @type {import("./runs-aggregate.mjs").RunSummary} */
const runA = {
  runId: "A",
  startedAt: "2026-06-10T00:00:00Z",
  endedAt: "2026-06-10T06:00:00Z",
  totalUptimeSec: 6 * H,
  longestUninterruptedSec: 2 * H,
  restartCount: 3,
  tasksMerged: 1,
  host: "mac-1",
  minskyVersion: "v1.145.4",
};
/** @type {import("./runs-aggregate.mjs").RunSummary} */
const runB = {
  runId: "B",
  startedAt: "2026-06-15T00:00:00Z",
  endedAt: "2026-06-15T11:00:00Z",
  totalUptimeSec: 11 * H,
  longestUninterruptedSec: 5 * H,
  restartCount: 2,
  tasksMerged: 4,
  host: "mac-1",
  minskyVersion: "v1.145.4",
};
/** @type {import("./runs-aggregate.mjs").RunSummary} */
const runC = {
  runId: "C",
  startedAt: "2026-06-19T00:00:00Z",
  endedAt: "2026-06-19T09:00:00Z",
  totalUptimeSec: 9 * H,
  longestUninterruptedSec: 7 * H,
  restartCount: 0,
  tasksMerged: 2,
  host: "mac-2",
  minskyVersion: "v1.146.0",
};
// Deliberately not in chronological order — the reducers must sort.
const RUNS = [runA, runB, runC];

describe("accumulate24h", () => {
  it("fills the 24h window newest→oldest, counting the last run partially", () => {
    const r = nn(accumulate24h(RUNS));
    // C(9h) + B(11h) = 20h, then 4h of A's 6h → 24h.
    expect(r.accumulatedUptimeSec).toBe(24 * H);
    expect(r.complete).toBe(true);
    expect(r.runIds).toEqual(["C", "B", "A"]);
    expect(r.runCount).toBe(3);
    expect(r.restarts).toBe(0 + 2 + 3);
    expect(r.tasksMerged).toBe(2 + 4 + 1);
    expect(r.longestUninterruptedSec).toBe(7 * H);
    expect(r.windowEnd).toBe("2026-06-19T09:00:00Z");
  });

  it("reports complete=false when total runtime is under 24h", () => {
    const r = nn(accumulate24h([runC])); // only C (9h)
    expect(r.accumulatedUptimeSec).toBe(9 * H);
    expect(r.complete).toBe(false);
    expect(r.runCount).toBe(1);
  });

  it("filters by host and version", () => {
    const r = nn(accumulate24h(RUNS, { host: "mac-1", minskyVersion: "v1.145.4" }));
    expect(r.runIds).toEqual(["B", "A"]); // C excluded (different host/version)
    expect(r.complete).toBe(false); // B(11h)+A(6h)=17h < 24h
    expect(r.accumulatedUptimeSec).toBe(17 * H);
  });

  it("returns null when there are no runs", () => {
    expect(accumulate24h([])).toBeNull();
    expect(accumulate24h(RUNS, { host: "nope" })).toBeNull();
  });
});

describe("longestRun", () => {
  it("returns the run with the max uninterrupted span", () => {
    const r = nn(longestRun(RUNS));
    expect(r.longestUninterruptedSec).toBe(7 * H);
    expect(r.runId).toBe("C");
    expect(r.host).toBe("mac-2");
  });

  it("respects the host filter", () => {
    const r = nn(longestRun(RUNS, { host: "mac-1" }));
    expect(r.runId).toBe("B"); // 5h is the max on mac-1
    expect(r.longestUninterruptedSec).toBe(5 * H);
  });

  it("returns null when no run has a finite span", () => {
    expect(longestRun([{ runId: "x" }])).toBeNull();
  });
});

describe("latestRunEndMs", () => {
  it("returns the newest run's end as ms", () => {
    expect(latestRunEndMs(RUNS)).toBe(Date.parse("2026-06-19T09:00:00Z"));
  });
  it("returns null with no runs", () => {
    expect(latestRunEndMs([])).toBeNull();
  });
});
