// Tests for daemon-pr-lint-metrics.mjs. Pattern: paired positive/negative
// fixtures over pure transforms (Meszaros 2007); the I/O seam (`runGh`) is
// stubbed so the orchestrator runs end-to-end without touching `gh`.

import { describe, expect, test } from "vitest";

import {
  ROLLING_30D_MIN_N,
  ROLLING_30D_MIN_PASS_RATE,
  ROLLING_WINDOW_DAYS,
  computeStats,
  daysAgoUtc,
  formatDateUtcYmd,
  formatReport,
  parsePrList,
  runDaemonPrLintMetrics,
} from "./daemon-pr-lint-metrics.mjs";

describe("pre-registered constants", () => {
  test("ROLLING_30D_MIN_PASS_RATE matches the TASKS.md threshold (0.80)", () => {
    expect(ROLLING_30D_MIN_PASS_RATE).toBeCloseTo(0.8, 5);
  });

  test("ROLLING_30D_MIN_N matches the self-diagnose windowMinPrs default (10)", () => {
    // Drift on this constant silently lets the verdict flip OK below
    // statistical significance — pinned on both sides (here +
    // scripts/self-diagnose.mjs daemonPrLintPassRateInvariant default).
    expect(ROLLING_30D_MIN_N).toBe(10);
  });

  test("ROLLING_WINDOW_DAYS matches the brief's 30d window", () => {
    expect(ROLLING_WINDOW_DAYS).toBe(30);
  });
});

describe("formatDateUtcYmd", () => {
  test("formats a known UTC instant as YYYY-MM-DD", () => {
    expect(formatDateUtcYmd(new Date("2026-05-06T18:30:00Z"))).toBe("2026-05-06");
  });

  test("rolls over the date boundary at UTC midnight, not local midnight", () => {
    expect(formatDateUtcYmd(new Date("2026-05-06T23:59:59Z"))).toBe("2026-05-06");
    expect(formatDateUtcYmd(new Date("2026-05-07T00:00:01Z"))).toBe("2026-05-07");
  });
});

describe("daysAgoUtc", () => {
  test("subtracts whole-day windows correctly across month boundaries", () => {
    const now = new Date("2026-05-06T12:00:00Z");
    expect(formatDateUtcYmd(daysAgoUtc(now, 30))).toBe("2026-04-06");
  });

  test("days=0 returns the same instant", () => {
    const now = new Date("2026-05-06T12:00:00Z");
    expect(daysAgoUtc(now, 0).getTime()).toBe(now.getTime());
  });

  test("rejects negative or non-integer days", () => {
    const now = new Date("2026-05-06T12:00:00Z");
    expect(() => daysAgoUtc(now, -1)).toThrow(/non-negative integer/);
    expect(() => daysAgoUtc(now, 1.5)).toThrow(/non-negative integer/);
  });
});

describe("parsePrList", () => {
  test("empty array → []", () => {
    expect(parsePrList("[]")).toEqual([]);
  });

  test("PR with no statusCheckRollup → hasFailure false", () => {
    const out = parsePrList(JSON.stringify([{ number: 7 }]));
    expect(out).toEqual([{ number: 7, hasFailure: false }]);
  });

  test("PR with all SUCCESS checks → hasFailure false", () => {
    const out = parsePrList(
      JSON.stringify([
        {
          number: 7,
          statusCheckRollup: [
            { conclusion: "SUCCESS", state: "SUCCESS" },
            { conclusion: "SUCCESS", state: "SUCCESS" },
          ],
        },
      ]),
    );
    expect(out[0]?.hasFailure).toBe(false);
  });

  test("PR with one FAILURE check → hasFailure true (conclusion field)", () => {
    const out = parsePrList(
      JSON.stringify([
        {
          number: 7,
          statusCheckRollup: [
            { conclusion: "SUCCESS" },
            { conclusion: "FAILURE", name: "rule-7-chaos-coverage" },
          ],
        },
      ]),
    );
    expect(out[0]?.hasFailure).toBe(true);
  });

  test("PR with state=FAILURE (older gh schema) is also caught", () => {
    // Mirrors scripts/self-diagnose.mjs's check — both fields are
    // recognised so the metric stays correct across gh CLI upgrades.
    const out = parsePrList(
      JSON.stringify([{ number: 7, statusCheckRollup: [{ state: "FAILURE" }] }]),
    );
    expect(out[0]?.hasFailure).toBe(true);
  });

  test("malformed JSON throws", () => {
    expect(() => parsePrList("{not json")).toThrow();
  });

  test("non-array JSON throws with explanatory message", () => {
    expect(() => parsePrList(JSON.stringify({ number: 1 }))).toThrow(/array/);
  });
});

describe("computeStats", () => {
  test("zero PRs → passRate null", () => {
    expect(computeStats([])).toEqual({ total: 0, clean: 0, dirtyNumbers: [], passRate: null });
  });

  test("all clean → passRate 1.0", () => {
    const stats = computeStats([
      { number: 1, hasFailure: false },
      { number: 2, hasFailure: false },
    ]);
    expect(stats).toEqual({ total: 2, clean: 2, dirtyNumbers: [], passRate: 1 });
  });

  test("all dirty → passRate 0", () => {
    const stats = computeStats([
      { number: 1, hasFailure: true },
      { number: 2, hasFailure: true },
    ]);
    expect(stats.passRate).toBe(0);
    expect(stats.dirtyNumbers).toEqual([1, 2]);
  });

  test("mixed → fraction matches", () => {
    const stats = computeStats([
      { number: 1, hasFailure: false },
      { number: 2, hasFailure: true },
      { number: 3, hasFailure: false },
      { number: 4, hasFailure: false },
    ]);
    expect(stats.total).toBe(4);
    expect(stats.clean).toBe(3);
    expect(stats.dirtyNumbers).toEqual([2]);
    expect(stats.passRate).toBeCloseTo(0.75, 5);
  });
});

describe("formatReport", () => {
  const baseDates = { dateNow: "2026-05-06", date30dAgo: "2026-04-06" };

  test("zero-data → INSUFFICIENT-DATA verdict, no NaN, no /0 in the value cell", () => {
    const report = formatReport({
      ...baseDates,
      stats: { total: 0, clean: 0, dirtyNumbers: [], passRate: null },
    });
    expect(report).toMatch(/Verdict: +INSUFFICIENT-DATA/);
    expect(report).not.toMatch(/NaN/);
    expect(report).toMatch(/no PRs in window/);
    expect(report).toMatch(/Failed: +none/);
  });

  test("below-min-N (n=9, all clean) → INSUFFICIENT-DATA, not OK — pinned threshold ≥10", () => {
    const report = formatReport({
      ...baseDates,
      stats: { total: 9, clean: 9, dirtyNumbers: [], passRate: 1 },
    });
    expect(report).toMatch(/Verdict: +INSUFFICIENT-DATA/);
  });

  test("at-min-N (n=10, all clean) → OK", () => {
    const report = formatReport({
      ...baseDates,
      stats: { total: 10, clean: 10, dirtyNumbers: [], passRate: 1 },
    });
    expect(report).toMatch(/Verdict: +OK/);
  });

  test("at the 0.80 boundary (passRate exactly 0.8) → OK (boundary is ≥)", () => {
    const report = formatReport({
      ...baseDates,
      stats: { total: 10, clean: 8, dirtyNumbers: [101, 102], passRate: 0.8 },
    });
    expect(report).toMatch(/Verdict: +OK/);
    expect(report).toMatch(/#101, #102/);
  });

  test("just below the 0.80 boundary (passRate 0.7) → BELOW", () => {
    const report = formatReport({
      ...baseDates,
      stats: { total: 10, clean: 7, dirtyNumbers: [201, 202, 203], passRate: 0.7 },
    });
    expect(report).toMatch(/Verdict: +BELOW/);
    // And the value cell shows the actual ratio so the operator sees the gap.
    expect(report).toMatch(/7\/10 \(0\.700\)/);
  });

  test("includes the canonical selector + window so the report is self-describing", () => {
    const report = formatReport({
      ...baseDates,
      stats: { total: 10, clean: 10, dirtyNumbers: [], passRate: 1 },
    });
    expect(report).toContain("--author @me");
    expect(report).toContain(">= 2026-04-06");
    expect(report).toContain("docs/daemon-pre-pr-gate.md");
  });
});

describe("runDaemonPrLintMetrics", () => {
  test("fires one gh call with the canonical selector + 30d window", async () => {
    /** @type {string[][]} */
    const ghCalls = [];
    const runGh = async (/** @type {ReadonlyArray<string>} */ args) => {
      ghCalls.push([...args]);
      return "[]";
    };
    await runDaemonPrLintMetrics({
      clock: () => new Date("2026-05-06T12:00:00Z"),
      runGh,
    });
    expect(ghCalls).toHaveLength(1);
    const [call] = ghCalls;
    expect(call).toContain("--author");
    expect(call).toContain("@me");
    expect(call).toContain("--state");
    expect(call).toContain("all");
    expect(call).toContain("--search");
    expect(call).toContain("created:>=2026-04-06");
    expect(call).toContain("--json");
    expect(call).toContain("number,statusCheckRollup");
    expect(call).toContain("--limit");
    expect(call).toContain("100");
  });

  test("threads parsed stats back into the result + report", async () => {
    const runGh = async () =>
      JSON.stringify([
        // 1 dirty (FAILURE)
        { number: 100, statusCheckRollup: [{ conclusion: "FAILURE" }] },
        // 9 clean
        ...Array.from({ length: 9 }, (_, i) => ({
          number: 101 + i,
          statusCheckRollup: [{ conclusion: "SUCCESS" }],
        })),
      ]);
    const result = await runDaemonPrLintMetrics({
      clock: () => new Date("2026-05-06T12:00:00Z"),
      runGh,
    });
    expect(result.stats.total).toBe(10);
    expect(result.stats.clean).toBe(9);
    expect(result.stats.dirtyNumbers).toEqual([100]);
    expect(result.stats.passRate).toBeCloseTo(0.9, 5);
    expect(result.report).toMatch(/Verdict: +OK/);
    expect(result.report).toMatch(/9\/10 \(0\.900\)/);
  });

  test("propagates a runGh rejection (no graceful-degrade — operator must see the gh outage)", async () => {
    const runGh = async () => {
      throw new Error("gh: not authenticated");
    };
    await expect(
      runDaemonPrLintMetrics({
        clock: () => new Date("2026-05-06T12:00:00Z"),
        runGh,
      }),
    ).rejects.toThrow(/not authenticated/);
  });
});
