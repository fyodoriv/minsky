// Tests for user-test-results.mjs. Pattern: paired positive/negative fixtures
// over pure transforms (Meszaros 2007); the I/O seam (`readReports`) is stubbed
// so the orchestrator runs end-to-end without touching disk.

import { describe, expect, test } from "vitest";

import {
  aggregateResults,
  median,
  parseArgs,
  parseReport,
  renderHuman,
  runUserTestResults,
  withinWindow,
} from "./user-test-results.mjs";

const SUCCESS_REPORT = [
  "# User test — AB",
  "",
  "- **Developer**: AB",
  "- **Date**: 2026-06-15",
  "- **Time to first iteration (minutes)**: 4",
  "- **Outcome**: success",
  "- **Needed operator help**: no",
  "",
  "## Friction points",
  "- None.",
].join("\n");

describe("parseReport", () => {
  test("parses a well-formed success report", () => {
    const r = parseReport(SUCCESS_REPORT, "docs/user-tests/2026-06-15-ab.md");
    expect(r).toEqual({
      initials: "AB",
      date: "2026-06-15",
      timeMinutes: 4,
      outcome: "success",
      neededHelp: false,
      sourceFile: "docs/user-tests/2026-06-15-ab.md",
    });
  });

  test("parses the parenthesised time field literally (no regex-special leak)", () => {
    const r = parseReport(SUCCESS_REPORT, "x.md");
    expect(r.timeMinutes).toBe(4);
  });

  test("missing required field throws naming the field", () => {
    const noOutcome = SUCCESS_REPORT.replace("- **Outcome**: success\n", "");
    expect(() => parseReport(noOutcome, "x.md")).toThrow(/Outcome/);
  });

  test("non-ISO date throws", () => {
    const badDate = SUCCESS_REPORT.replace("2026-06-15", "June 15");
    expect(() => parseReport(badDate, "x.md")).toThrow(/ISO/);
  });

  test("non-numeric time throws", () => {
    const badTime = SUCCESS_REPORT.replace(
      "**Time to first iteration (minutes)**: 4",
      "**Time to first iteration (minutes)**: quick",
    );
    expect(() => parseReport(badTime, "x.md")).toThrow(/non-negative number/);
  });

  test("invalid outcome enum throws listing the allowed values", () => {
    const badOutcome = SUCCESS_REPORT.replace("**Outcome**: success", "**Outcome**: maybe");
    expect(() => parseReport(badOutcome, "x.md")).toThrow(/success\|fail\|blocked/);
  });

  test("yes/no help field is parsed case-insensitively", () => {
    const helped = SUCCESS_REPORT.replace(
      "**Needed operator help**: no",
      "**Needed operator help**: YES",
    );
    expect(parseReport(helped, "x.md").neededHelp).toBe(true);
  });
});

describe("median", () => {
  test("empty list → null (no runs, not a fake zero)", () => {
    expect(median([])).toBeNull();
  });

  test("odd-length returns the middle element", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  test("even-length averages the two middle elements", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("withinWindow", () => {
  const now = new Date("2026-06-20T00:00:00Z");
  /** @type {import("./user-test-results.mjs").UserTestReport} */
  const base = {
    initials: "X",
    date: "2026-06-15",
    timeMinutes: 4,
    outcome: "success",
    neededHelp: false,
    sourceFile: "x.md",
  };

  test("keeps reports inside the window", () => {
    expect(withinWindow([base], 30, now)).toHaveLength(1);
  });

  test("drops reports older than the window", () => {
    const old = { ...base, date: "2026-01-01" };
    expect(withinWindow([old], 30, now)).toHaveLength(0);
  });

  test("Infinity window keeps everything", () => {
    const old = { ...base, date: "2020-01-01" };
    expect(withinWindow([old], Number.POSITIVE_INFINITY, now)).toHaveLength(1);
  });
});

describe("aggregateResults", () => {
  /** @param {Partial<import("./user-test-results.mjs").UserTestReport>} o */
  const mk = (o) => ({
    initials: "X",
    date: "2026-06-15",
    timeMinutes: 4,
    outcome: /** @type {const} */ ("success"),
    neededHelp: false,
    sourceFile: "x.md",
    ...o,
  });

  test("3 success runs with median ≤5 min → M1.11 pass", () => {
    const agg = aggregateResults(
      [mk({ timeMinutes: 3 }), mk({ timeMinutes: 4 }), mk({ timeMinutes: 5 })],
      "30d",
    );
    expect(agg.successful_runs).toBe(3);
    expect(agg.median_time_minutes).toBe(4);
    expect(agg.m1_11_pass).toBe(true);
  });

  test("median over 5 min → M1.11 fail even with 3 success runs", () => {
    const agg = aggregateResults(
      [mk({ timeMinutes: 6 }), mk({ timeMinutes: 7 }), mk({ timeMinutes: 8 })],
      "30d",
    );
    expect(agg.m1_11_pass).toBe(false);
  });

  test("fewer than 3 success runs → M1.11 fail", () => {
    const agg = aggregateResults([mk({ timeMinutes: 2 }), mk({ timeMinutes: 2 })], "30d");
    expect(agg.successful_runs).toBe(2);
    expect(agg.m1_11_pass).toBe(false);
  });

  test("a developer who needed help is NOT counted as a success run", () => {
    const agg = aggregateResults(
      [mk({ timeMinutes: 2 }), mk({ timeMinutes: 2 }), mk({ neededHelp: true, timeMinutes: 2 })],
      "30d",
    );
    expect(agg.successful_runs).toBe(2);
    expect(agg.blocked_runs).toBe(1);
    expect(agg.m1_11_pass).toBe(false);
  });

  test("median is computed over success runs only, ignoring failures", () => {
    const agg = aggregateResults(
      [
        mk({ timeMinutes: 3 }),
        mk({ timeMinutes: 3 }),
        mk({ timeMinutes: 3 }),
        mk({ outcome: "fail", timeMinutes: 99 }),
      ],
      "30d",
    );
    expect(agg.median_time_minutes).toBe(3);
    expect(agg.failed_runs).toBe(1);
    expect(agg.m1_11_pass).toBe(true);
  });

  test("zero reports → honest null median, not a fake-pass", () => {
    const agg = aggregateResults([], "30d");
    expect(agg.total_runs).toBe(0);
    expect(agg.median_time_minutes).toBeNull();
    expect(agg.m1_11_pass).toBe(false);
  });
});

describe("runUserTestResults", () => {
  test("composes read → parse → window → aggregate via the injected seam", () => {
    const readReports = () => [
      { contents: SUCCESS_REPORT, sourceFile: "docs/user-tests/2026-06-15-ab.md" },
      {
        contents: SUCCESS_REPORT.replace("AB", "CD").replace("4", "5"),
        sourceFile: "docs/user-tests/2026-06-15-cd.md",
      },
      {
        contents: SUCCESS_REPORT.replace("AB", "EF").replace(": 4", ": 3"),
        sourceFile: "docs/user-tests/2026-06-15-ef.md",
      },
    ];
    const { aggregate, warnings } = runUserTestResults({
      dir: "/ignored",
      windowDays: 30,
      windowLabel: "30d",
      readReports,
      now: new Date("2026-06-20T00:00:00Z"),
    });
    expect(warnings).toHaveLength(0);
    expect(aggregate.successful_runs).toBe(3);
    expect(aggregate.m1_11_pass).toBe(true);
  });

  test("a malformed report is skipped with a warning, good reports still aggregate", () => {
    const readReports = () => [
      { contents: SUCCESS_REPORT, sourceFile: "good.md" },
      { contents: "# broken — no fields", sourceFile: "bad.md" },
    ];
    const { aggregate, warnings } = runUserTestResults({
      dir: "/ignored",
      windowDays: 30,
      windowLabel: "30d",
      readReports,
      now: new Date("2026-06-20T00:00:00Z"),
    });
    expect(aggregate.total_runs).toBe(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/bad\.md/);
  });
});

describe("parseArgs", () => {
  test("defaults to 30d, human output", () => {
    expect(parseArgs([])).toEqual({ windowDays: 30, windowLabel: "30d", json: false });
  });

  test("--window=30d --json", () => {
    expect(parseArgs(["--window=30d", "--json"])).toEqual({
      windowDays: 30,
      windowLabel: "30d",
      json: true,
    });
  });

  test("--window=all → Infinity", () => {
    const a = parseArgs(["--window=all"]);
    expect(a.windowDays).toBe(Number.POSITIVE_INFINITY);
    expect(a.windowLabel).toBe("all");
  });

  test("--window=7 (no trailing d) is accepted", () => {
    expect(parseArgs(["--window=7"]).windowDays).toBe(7);
  });
});

describe("renderHuman", () => {
  test("renders the M1.11 verdict and per-run lines", () => {
    const agg = aggregateResults(
      [
        {
          initials: "AB",
          date: "2026-06-15",
          timeMinutes: 4,
          outcome: "success",
          neededHelp: false,
          sourceFile: "x.md",
        },
      ],
      "30d",
    );
    const out = renderHuman(agg, []);
    expect(out).toContain("M1.11 pass:");
    expect(out).toContain("2026-06-15 AB: success");
  });

  test("null median renders honestly as n/a", () => {
    const out = renderHuman(aggregateResults([], "30d"), []);
    expect(out).toContain("n/a (no success runs)");
  });
});
