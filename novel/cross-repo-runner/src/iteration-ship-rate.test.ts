import { describe, expect, it } from "vitest";

import type { IterationRecord } from "./iteration-record.js";
import {
  DEFAULT_WINDOW_DAYS,
  MIN_SAMPLE_SIZE,
  SHIP_RATE_FLOOR,
  SHIP_RATE_TARGET,
  bucketVerdict,
  computeShipRate,
} from "./iteration-ship-rate.js";

// Pinned anchor clock — derived from Date.parse so the constant can't
// silently drift from the ISO string it represents. Every fixture
// timestamp is anchored to this so the windowing math is reproducible
// across local runs and CI.
const NOW_MS = Date.parse("2026-05-24T17:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function tsDaysAgo(days: number): string {
  return new Date(NOW_MS - days * DAY_MS).toISOString();
}

function makeRecord(daysAgo: number, prUrl: string | null): IterationRecord {
  return {
    ts: tsDaysAgo(daysAgo),
    experiment_id: "test",
    host_repo: "fyodoriv/minsky",
    branch: "test/branch",
    verdict: prUrl === null ? "scope-leak" : "validated",
    pr_url: prUrl,
    notes: "",
  };
}

describe("pre-registered threshold constants (rule #9 — pinned in code)", () => {
  it("SHIP_RATE_TARGET is 0.15", () => {
    // A future tune-the-threshold PR MUST update this assertion deliberately;
    // a silent change to the constant becomes a CI break (Munafò 2017).
    expect(SHIP_RATE_TARGET).toBe(0.15);
  });

  it("SHIP_RATE_FLOOR is 0.10", () => {
    expect(SHIP_RATE_FLOOR).toBe(0.1);
  });

  it("MIN_SAMPLE_SIZE is 5", () => {
    expect(MIN_SAMPLE_SIZE).toBe(5);
  });

  it("DEFAULT_WINDOW_DAYS is 30 (matches DORA cadence)", () => {
    expect(DEFAULT_WINDOW_DAYS).toBe(30);
  });

  it("FLOOR is strictly below TARGET (the WARN band has nonzero width)", () => {
    // If a future edit accidentally inverts these, the WARN bucket
    // collapses and every below-target rate becomes BELOW. This test
    // catches that ordering bug.
    expect(SHIP_RATE_FLOOR).toBeLessThan(SHIP_RATE_TARGET);
  });
});

describe("bucketVerdict", () => {
  it("returns INSUFFICIENT-DATA when n < MIN_SAMPLE_SIZE regardless of rate", () => {
    // A 100% rate over 1 sample is still INSUFFICIENT-DATA — n trumps rate.
    expect(bucketVerdict(1.0, 1)).toBe("INSUFFICIENT-DATA");
    expect(bucketVerdict(0.5, 4)).toBe("INSUFFICIENT-DATA");
    expect(bucketVerdict(0.0, 0)).toBe("INSUFFICIENT-DATA");
  });

  it("returns ABOVE when rate >= SHIP_RATE_TARGET and n >= MIN_SAMPLE_SIZE", () => {
    expect(bucketVerdict(0.15, 5)).toBe("ABOVE");
    expect(bucketVerdict(0.5, 10)).toBe("ABOVE");
    expect(bucketVerdict(1.0, 100)).toBe("ABOVE");
  });

  it("returns WARN when SHIP_RATE_FLOOR <= rate < SHIP_RATE_TARGET", () => {
    expect(bucketVerdict(0.1, 5)).toBe("WARN"); // exactly at FLOOR
    expect(bucketVerdict(0.12, 10)).toBe("WARN");
    expect(bucketVerdict(0.149999, 10)).toBe("WARN"); // just below TARGET
  });

  it("returns BELOW when rate < SHIP_RATE_FLOOR and n >= MIN_SAMPLE_SIZE", () => {
    expect(bucketVerdict(0.0, 5)).toBe("BELOW");
    expect(bucketVerdict(0.05, 20)).toBe("BELOW");
    expect(bucketVerdict(0.099, 100)).toBe("BELOW");
  });
});

describe("computeShipRate", () => {
  it("returns zero rate + INSUFFICIENT-DATA for an empty record list", () => {
    const result = computeShipRate([], { nowMs: NOW_MS });
    expect(result).toEqual({ rate: 0, n: 0, withPr: 0, verdict: "INSUFFICIENT-DATA" });
  });

  it("counts only records inside the rolling window", () => {
    const records: IterationRecord[] = [
      makeRecord(1, "https://github.com/fyodoriv/minsky/pull/1"), // in window
      makeRecord(31, "https://github.com/fyodoriv/minsky/pull/2"), // 1 day past 30d window
      makeRecord(15, null), // in window, no PR
    ];
    const result = computeShipRate(records, { windowDays: 30, nowMs: NOW_MS });
    expect(result.n).toBe(2);
    expect(result.withPr).toBe(1);
  });

  it("supports a custom window via the option", () => {
    const records: IterationRecord[] = [
      makeRecord(1, "https://example.com/pr/1"),
      makeRecord(8, "https://example.com/pr/2"), // outside 7d, inside 30d
    ];
    const seven = computeShipRate(records, { windowDays: 7, nowMs: NOW_MS });
    expect(seven.n).toBe(1);
    const thirty = computeShipRate(records, { windowDays: 30, nowMs: NOW_MS });
    expect(thirty.n).toBe(2);
  });

  it("treats undefined / empty-string pr_url as no-PR (defensive against record-shape drift)", () => {
    const records: IterationRecord[] = [
      { ...makeRecord(1, null), pr_url: undefined as unknown as null }, // hand-rolled drift
      { ...makeRecord(1, null), pr_url: "" }, // hand-rolled drift
      makeRecord(2, "https://example.com/pr/3"),
    ];
    const result = computeShipRate(records, { nowMs: NOW_MS });
    expect(result.withPr).toBe(1);
    expect(result.n).toBe(3);
  });

  it("skips records with un-parseable timestamps", () => {
    const records: IterationRecord[] = [
      { ...makeRecord(1, "https://example.com/pr/1"), ts: "not-a-date" },
      makeRecord(1, "https://example.com/pr/2"),
    ];
    const result = computeShipRate(records, { nowMs: NOW_MS });
    expect(result.n).toBe(1);
    expect(result.withPr).toBe(1);
  });

  it("ABOVE verdict — 3/5 PRs is 0.60 (well above the 0.15 target)", () => {
    const records: IterationRecord[] = [
      makeRecord(1, "https://example.com/pr/1"),
      makeRecord(2, "https://example.com/pr/2"),
      makeRecord(3, "https://example.com/pr/3"),
      makeRecord(4, null),
      makeRecord(5, null),
    ];
    const result = computeShipRate(records, { nowMs: NOW_MS });
    expect(result.rate).toBe(0.6);
    expect(result.verdict).toBe("ABOVE");
  });

  it("WARN verdict — 1/8 PRs is 0.125 (between FLOOR and TARGET)", () => {
    const records: IterationRecord[] = [
      makeRecord(1, "https://example.com/pr/1"),
      ...Array.from({ length: 7 }, (_, i) => makeRecord(i + 2, null)),
    ];
    const result = computeShipRate(records, { nowMs: NOW_MS });
    expect(result.rate).toBeCloseTo(0.125, 3);
    expect(result.verdict).toBe("WARN");
  });

  it("BELOW verdict — 1/18 PRs is 0.056 (the live baseline on this host 2026-05-19)", () => {
    // This case matches the task's pre-registered current measurement exactly:
    // `{"rate":0.056,"n":18,"withPr":1,"verdict":"BELOW"}` (TASKS.md
    // `cross-repo-iteration-ship-rate-ci-gate` § Surfaced-by).
    const records: IterationRecord[] = [
      makeRecord(1, "https://example.com/pr/1"),
      ...Array.from({ length: 17 }, (_, i) => makeRecord(i + 2, null)),
    ];
    const result = computeShipRate(records, { nowMs: NOW_MS });
    expect(result.rate).toBeCloseTo(0.0555, 3);
    expect(result.n).toBe(18);
    expect(result.withPr).toBe(1);
    expect(result.verdict).toBe("BELOW");
  });

  it("INSUFFICIENT-DATA verdict — 4 records is below MIN_SAMPLE_SIZE", () => {
    const records: IterationRecord[] = Array.from({ length: 4 }, (_, i) =>
      makeRecord(i + 1, `https://example.com/pr/${i}`),
    );
    const result = computeShipRate(records, { nowMs: NOW_MS });
    expect(result.n).toBe(4);
    expect(result.verdict).toBe("INSUFFICIENT-DATA");
  });

  it("uses the default 30d window when windowDays is omitted", () => {
    const records: IterationRecord[] = [
      makeRecord(29, "https://example.com/pr/1"), // inside default 30d
      makeRecord(31, "https://example.com/pr/2"), // outside default 30d
    ];
    const result = computeShipRate(records, { nowMs: NOW_MS });
    expect(result.n).toBe(1);
  });
});
