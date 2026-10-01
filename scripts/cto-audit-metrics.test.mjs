// Tests for cto-audit-metrics.mjs. Pattern: paired positive/negative
// fixtures over pure transforms (Meszaros 2007); the I/O seam (`runGh`) is
// stubbed so the orchestrator runs end-to-end without touching `gh`.

import { describe, expect, test } from "vitest";

import {
  CTO_AUDIT_PR_LABEL,
  daysAgoUtc,
  formatDateUtcYmd,
  formatReport,
  parseGhCount,
  ROLLING_7D_MIN_CREATED,
  ROLLING_28D_MIN_SHIP_RATIO,
  runCtoAuditMetrics,
} from "./cto-audit-metrics.mjs";

describe("pre-registered constants", () => {
  test("ROLLING_7D_MIN_CREATED matches the TASKS.md threshold (1/week)", () => {
    expect(ROLLING_7D_MIN_CREATED).toBe(1);
  });

  test("ROLLING_28D_MIN_SHIP_RATIO matches the TASKS.md threshold (0.30)", () => {
    expect(ROLLING_28D_MIN_SHIP_RATIO).toBeCloseTo(0.3, 5);
  });

  test("CTO_AUDIT_PR_LABEL is the canonical audit label string", () => {
    // Drift on this constant silently zeroes the metric — pinned on both
    // sides (here + check-cto-audit-pr-conventions.mjs CTO_AUDIT_LABEL).
    expect(CTO_AUDIT_PR_LABEL).toBe("minsky:cto-audit");
  });
});

describe("formatDateUtcYmd", () => {
  test("formats a known UTC instant as YYYY-MM-DD", () => {
    expect(formatDateUtcYmd(new Date("2026-05-06T18:30:00Z"))).toBe("2026-05-06");
  });

  test("rolls over the date boundary at UTC midnight, not local midnight", () => {
    // 2026-05-06T23:59:59Z is still 2026-05-06 in UTC regardless of operator tz.
    expect(formatDateUtcYmd(new Date("2026-05-06T23:59:59Z"))).toBe("2026-05-06");
    expect(formatDateUtcYmd(new Date("2026-05-07T00:00:01Z"))).toBe("2026-05-07");
  });
});

describe("daysAgoUtc", () => {
  test("subtracts whole-day windows correctly across month boundaries", () => {
    const now = new Date("2026-05-06T12:00:00Z");
    expect(formatDateUtcYmd(daysAgoUtc(now, 7))).toBe("2026-04-29");
    expect(formatDateUtcYmd(daysAgoUtc(now, 28))).toBe("2026-04-08");
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

describe("parseGhCount", () => {
  test("empty array → 0", () => {
    expect(parseGhCount("[]")).toBe(0);
  });

  test("multi-record array returns its length", () => {
    expect(parseGhCount(JSON.stringify([{ number: 1 }, { number: 2 }, { number: 3 }]))).toBe(3);
  });

  test("malformed JSON throws", () => {
    expect(() => parseGhCount("{not json")).toThrow();
  });

  test("non-array JSON throws with explanatory message", () => {
    expect(() => parseGhCount(JSON.stringify({ number: 1 }))).toThrow(/array/);
  });
});

describe("formatReport", () => {
  const baseInputs = {
    dateNow: "2026-05-06",
    date7dAgo: "2026-04-29",
    date28dAgo: "2026-04-08",
    created7d: 0,
    merged28d: 0,
    created28d: 0,
  };

  test("zero-data case prints BELOW for the 7d window and INSUFFICIENT-DATA for the 28d ratio", () => {
    const report = formatReport(baseInputs);
    expect(report).toMatch(/Rolling 7d/);
    expect(report).toMatch(/Verdict: +BELOW/);
    expect(report).toMatch(/INSUFFICIENT-DATA/);
    expect(report).not.toMatch(/NaN/);
  });

  test("happy-path inputs print OK on both verdicts", () => {
    const report = formatReport({
      ...baseInputs,
      created7d: 2,
      merged28d: 3,
      created28d: 5, // 0.6 ≥ 0.30
    });
    const verdicts = report.match(/Verdict: +(OK|BELOW|INSUFFICIENT-DATA)/g);
    expect(verdicts).toEqual(["Verdict:   OK", "Verdict:   OK"]);
  });

  test("ratio just below the 0.30 floor prints BELOW (boundary is strict ≥)", () => {
    const report = formatReport({
      ...baseInputs,
      created7d: 1,
      merged28d: 2,
      created28d: 7, // ≈ 0.286 < 0.30
    });
    expect(report).toMatch(/2\/7 \(0\.29\)/);
    // 7d verdict is OK (created7d=1 ≥ 1); ratio verdict is BELOW.
    const verdicts = report.match(/Verdict: +(OK|BELOW|INSUFFICIENT-DATA)/g);
    expect(verdicts).toEqual(["Verdict:   OK", "Verdict:   BELOW"]);
  });

  test("includes the canonical label in the header so the report is self-describing", () => {
    const report = formatReport(baseInputs);
    expect(report).toContain("`minsky:cto-audit`");
  });

  test("includes both UTC date windows so an operator can audit the query without re-running it", () => {
    const report = formatReport(baseInputs);
    expect(report).toContain("> 2026-04-29");
    expect(report).toContain("> 2026-04-08");
  });
});

describe("runCtoAuditMetrics", () => {
  test("fires three gh calls with the canonical label and the derived date windows", async () => {
    /** @type {string[][]} */
    const ghCalls = [];
    const runGh = async (/** @type {ReadonlyArray<string>} */ args) => {
      ghCalls.push([...args]);
      return "[]";
    };
    await runCtoAuditMetrics({
      clock: () => new Date("2026-05-06T12:00:00Z"),
      runGh,
    });
    expect(ghCalls).toHaveLength(3);
    for (const call of ghCalls) {
      expect(call).toContain("--label");
      expect(call).toContain("minsky:cto-audit");
      expect(call).toContain("--json");
      expect(call).toContain("number");
    }
    // first call: created in 7d window
    expect(ghCalls[0]).toContain("created:>2026-04-29");
    expect(ghCalls[0]).toContain("all");
    // second call: merged in 28d window
    expect(ghCalls[1]).toContain("merged:>2026-04-08");
    expect(ghCalls[1]).toContain("merged");
    // third call: created in 28d window (denominator for the ratio)
    expect(ghCalls[2]).toContain("created:>2026-04-08");
    expect(ghCalls[2]).toContain("all");
  });

  test("threads parsed counts back into the result + report", async () => {
    /** @type {string[][]} */
    const ghCalls = [];
    const runGh = async (/** @type {ReadonlyArray<string>} */ args) => {
      ghCalls.push([...args]);
      // Distinguish by which `--search` value the call carries so we don't
      // depend on ordering of Promise.all resolution.
      const search = args[args.indexOf("--search") + 1] ?? "";
      const state = args[args.indexOf("--state") + 1] ?? "";
      if (state === "merged") return JSON.stringify([{ number: 1 }]);
      if (search.startsWith("created:>2026-04-29")) {
        return JSON.stringify([{ number: 1 }, { number: 2 }]);
      }
      // 28d created window → 4 PRs
      return JSON.stringify([{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }]);
    };
    const result = await runCtoAuditMetrics({
      clock: () => new Date("2026-05-06T12:00:00Z"),
      runGh,
    });
    expect(result.created7d).toBe(2);
    expect(result.merged28d).toBe(1);
    expect(result.created28d).toBe(4);
    expect(result.report).toMatch(/Rolling 7d/);
    expect(result.report).toMatch(/1\/4/);
  });

  test("propagates a runGh rejection (no graceful-degrade — operator must see the gh outage)", async () => {
    const runGh = async () => {
      throw new Error("gh: not authenticated");
    };
    await expect(
      runCtoAuditMetrics({
        clock: () => new Date("2026-05-06T12:00:00Z"),
        runGh,
      }),
    ).rejects.toThrow(/not authenticated/);
  });
});
