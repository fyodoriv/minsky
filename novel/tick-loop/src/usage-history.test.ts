/**
 * Tests for `@minsky/tick-loop/usage-history` — slice 6 of
 * `claude-usage-aware-strategic-model-router`.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_HISTORY_CAP,
  type UsageHistoryEntry,
  appendUsageHistory,
  predictExhaustionMs,
  recentHistory,
} from "./usage-history.js";

function mkEntry(overrides: Partial<UsageHistoryEntry> = {}): UsageHistoryEntry {
  return {
    observedAt: "2026-05-10T12:00:00Z",
    fivehour: 0.5,
    weekly: 0.5,
    monthly: 0.5,
    pickedModel: "claude-opus-4-7",
    ...overrides,
  };
}

describe("appendUsageHistory — ring buffer", () => {
  it("appends the entry to an empty history", () => {
    const next = appendUsageHistory({ history: [], entry: mkEntry() });
    expect(next).toHaveLength(1);
  });

  it("appends within capacity (no eviction)", () => {
    const start: UsageHistoryEntry[] = [mkEntry({ observedAt: "2026-05-10T12:00:00Z" })];
    const next = appendUsageHistory({
      history: start,
      entry: mkEntry({ observedAt: "2026-05-10T12:00:30Z" }),
      capN: 5,
    });
    expect(next).toHaveLength(2);
    expect(next[1]?.observedAt).toBe("2026-05-10T12:00:30Z");
  });

  it("evicts oldest entry FIFO when at capacity (chaos row 5)", () => {
    const start: UsageHistoryEntry[] = [
      mkEntry({ observedAt: "2026-05-10T12:00:00Z" }),
      mkEntry({ observedAt: "2026-05-10T12:00:30Z" }),
      mkEntry({ observedAt: "2026-05-10T12:01:00Z" }),
    ];
    const next = appendUsageHistory({
      history: start,
      entry: mkEntry({ observedAt: "2026-05-10T12:01:30Z" }),
      capN: 3,
    });
    expect(next).toHaveLength(3);
    expect(next[0]?.observedAt).toBe("2026-05-10T12:00:30Z");
    expect(next[2]?.observedAt).toBe("2026-05-10T12:01:30Z");
  });

  it("uses DEFAULT_HISTORY_CAP=100 when capN is omitted", () => {
    expect(DEFAULT_HISTORY_CAP).toBe(100);
    let h: readonly UsageHistoryEntry[] = [];
    for (let i = 0; i < 150; i++) {
      h = appendUsageHistory({
        history: h,
        entry: mkEntry({ observedAt: `2026-05-10T12:${String(i).padStart(2, "0")}:00Z` }),
      });
    }
    expect(h.length).toBe(100);
  });

  it("clamps NaN to 0 (chaos row 4)", () => {
    const next = appendUsageHistory({
      history: [],
      entry: mkEntry({ fivehour: Number.NaN, weekly: 0.5, monthly: 0.5 }),
    });
    expect(next[0]?.fivehour).toBe(0);
  });

  it("clamps Infinity to 0", () => {
    const next = appendUsageHistory({
      history: [],
      entry: mkEntry({ fivehour: Number.POSITIVE_INFINITY }),
    });
    expect(next[0]?.fivehour).toBe(0);
  });

  it("clamps fractions above 1 to 1", () => {
    const next = appendUsageHistory({
      history: [],
      entry: mkEntry({ fivehour: 1.5 }),
    });
    expect(next[0]?.fivehour).toBe(1);
  });

  it("returns a frozen array (callers can't mutate)", () => {
    const next = appendUsageHistory({ history: [], entry: mkEntry() });
    expect(Object.isFrozen(next)).toBe(true);
  });

  it("does not mutate the input history", () => {
    const start: UsageHistoryEntry[] = [mkEntry()];
    const before = JSON.stringify(start);
    appendUsageHistory({ history: start, entry: mkEntry() });
    expect(JSON.stringify(start)).toBe(before);
  });
});

describe("predictExhaustionMs — linear-regression predictor", () => {
  it("returns all-undefined on empty history (chaos row 1)", () => {
    const r = predictExhaustionMs([]);
    expect(r.fivehour).toBeUndefined();
    expect(r.weekly).toBeUndefined();
    expect(r.monthly).toBeUndefined();
  });

  it("returns all-undefined with a single entry (chaos row 2)", () => {
    const r = predictExhaustionMs([mkEntry()]);
    expect(r.fivehour).toBeUndefined();
    expect(r.weekly).toBeUndefined();
    expect(r.monthly).toBeUndefined();
  });

  it("predicts 5h exhaustion when remaining is monotone decreasing", () => {
    // Two snapshots 60s apart; fivehour drops from 0.5 → 0.4 → 0.3 → 0.2.
    // Slope = -0.1 per minute = -0.1/60_000 per ms.
    // Current y = 0.2 → time to 0 = 0.2 / 0.1 minute = 2 minutes = 120_000 ms.
    const history: UsageHistoryEntry[] = [
      mkEntry({ observedAt: "2026-05-10T12:00:00Z", fivehour: 0.5 }),
      mkEntry({ observedAt: "2026-05-10T12:01:00Z", fivehour: 0.4 }),
      mkEntry({ observedAt: "2026-05-10T12:02:00Z", fivehour: 0.3 }),
      mkEntry({ observedAt: "2026-05-10T12:03:00Z", fivehour: 0.2 }),
    ];
    const r = predictExhaustionMs(history);
    expect(r.fivehour).toBeDefined();
    if (r.fivehour === undefined) throw new Error("unreachable");
    // Allow ±5% slack for floating-point + regression averaging.
    expect(r.fivehour).toBeGreaterThan(110_000);
    expect(r.fivehour).toBeLessThan(130_000);
  });

  it("returns undefined when remaining is flat (slope = 0)", () => {
    const history: UsageHistoryEntry[] = [
      mkEntry({ observedAt: "2026-05-10T12:00:00Z", fivehour: 0.5 }),
      mkEntry({ observedAt: "2026-05-10T12:01:00Z", fivehour: 0.5 }),
      mkEntry({ observedAt: "2026-05-10T12:02:00Z", fivehour: 0.5 }),
    ];
    const r = predictExhaustionMs(history);
    expect(r.fivehour).toBeUndefined();
  });

  it("returns undefined when remaining is rising (window reset, chaos row 3)", () => {
    const history: UsageHistoryEntry[] = [
      mkEntry({ observedAt: "2026-05-10T12:00:00Z", fivehour: 0.2 }),
      mkEntry({ observedAt: "2026-05-10T12:05:00Z", fivehour: 0.3 }),
      mkEntry({ observedAt: "2026-05-10T12:10:00Z", fivehour: 0.5 }),
      mkEntry({ observedAt: "2026-05-10T12:15:00Z", fivehour: 0.9 }),
    ];
    const r = predictExhaustionMs(history);
    expect(r.fivehour).toBeUndefined();
  });

  it("returns 0 when remaining is already 0", () => {
    const history: UsageHistoryEntry[] = [
      mkEntry({ observedAt: "2026-05-10T12:00:00Z", fivehour: 0.1 }),
      mkEntry({ observedAt: "2026-05-10T12:01:00Z", fivehour: 0 }),
    ];
    const r = predictExhaustionMs(history);
    expect(r.fivehour).toBe(0);
  });

  it("predicts each window independently", () => {
    // Same time series but different slopes per window.
    // 5h: 0.5 → 0.3 (drop 0.2 in 60s) → predict 90s to zero (linear extrapolation)
    // weekly: 0.7 → 0.65 (drop 0.05 in 60s) → predict 13 minutes
    // monthly: 0.9 → 0.85 (drop 0.05 in 60s) → predict 17 minutes
    const history: UsageHistoryEntry[] = [
      mkEntry({
        observedAt: "2026-05-10T12:00:00Z",
        fivehour: 0.5,
        weekly: 0.7,
        monthly: 0.9,
      }),
      mkEntry({
        observedAt: "2026-05-10T12:01:00Z",
        fivehour: 0.3,
        weekly: 0.65,
        monthly: 0.85,
      }),
    ];
    const r = predictExhaustionMs(history);
    if (r.fivehour === undefined || r.weekly === undefined || r.monthly === undefined) {
      throw new Error("unreachable");
    }
    expect(r.fivehour).toBeLessThan(r.weekly);
    expect(r.weekly).toBeLessThan(r.monthly);
  });
});

describe("recentHistory — windowed filter", () => {
  it("keeps only entries within windowMs of now", () => {
    const history: UsageHistoryEntry[] = [
      mkEntry({ observedAt: "2026-05-10T12:00:00Z" }),
      mkEntry({ observedAt: "2026-05-10T12:05:00Z" }),
      mkEntry({ observedAt: "2026-05-10T12:09:00Z" }),
    ];
    const nowMs = Date.parse("2026-05-10T12:10:00Z");
    const windowMs = 5 * 60 * 1000; // 5 minutes
    const r = recentHistory(history, nowMs, windowMs);
    expect(r).toHaveLength(2); // Only 12:05 and 12:09 are within 5min of 12:10
  });

  it("returns empty when no entries are recent", () => {
    const history: UsageHistoryEntry[] = [mkEntry({ observedAt: "2026-05-10T11:00:00Z" })];
    const nowMs = Date.parse("2026-05-10T12:00:00Z");
    const r = recentHistory(history, nowMs, 5 * 60 * 1000);
    expect(r).toHaveLength(0);
  });

  it("skips entries with malformed observedAt", () => {
    const history: UsageHistoryEntry[] = [
      mkEntry({ observedAt: "not-a-date" }),
      mkEntry({ observedAt: "2026-05-10T12:09:00Z" }),
    ];
    const nowMs = Date.parse("2026-05-10T12:10:00Z");
    const r = recentHistory(history, nowMs, 5 * 60 * 1000);
    expect(r).toHaveLength(1);
  });
});

describe("usage-history — referential transparency", () => {
  it("appendUsageHistory: same input → same output", () => {
    const input = { history: [mkEntry()], entry: mkEntry({ observedAt: "2026-05-10T12:00:30Z" }) };
    const a = appendUsageHistory(input);
    const b = appendUsageHistory(input);
    expect(a).toEqual(b);
  });

  it("predictExhaustionMs: same input → same output", () => {
    const history: UsageHistoryEntry[] = [
      mkEntry({ observedAt: "2026-05-10T12:00:00Z", fivehour: 0.5 }),
      mkEntry({ observedAt: "2026-05-10T12:01:00Z", fivehour: 0.4 }),
    ];
    expect(predictExhaustionMs(history)).toEqual(predictExhaustionMs(history));
  });
});
