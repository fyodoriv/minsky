// Tests for check-metrics-freshness.mjs
// Pattern: paired positive/negative fixtures over pure functions
// (Meszaros 2007 xUnit Patterns; rule #10 — same input, same output).

import { describe, expect, test } from "vitest";
import { findStaleRows, parsePrimaryMetrics, STALE_DAYS } from "./check-metrics-freshness.mjs";

const TODAY = "2026-06-20";

/** @param {number} n */
function daysAgo(n) {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** @param {{ name: string, value: string, date: string }[]} rows */
function md(rows = []) {
  const header = "## Primary metrics\n\n";
  const body =
    rows.length === 0
      ? ""
      : `${rows.map((r) => `| ${r.name} | ${r.value} | ${r.date} |`).join("\n")}\n`;
  return `# METRICS.md\n\n${header}${body}\n`;
}

describe("parsePrimaryMetrics", () => {
  test("returns [] when no ## Primary metrics section exists", () => {
    const text = "# METRICS.md\n\n## loop-uptime — Loop uptime\n\nsome content\n";
    expect(parsePrimaryMetrics(text)).toEqual([]);
  });

  test("returns [] when section exists but contains no table rows", () => {
    expect(parsePrimaryMetrics(md())).toEqual([]);
  });

  test("parses a single row", () => {
    const text = md([{ name: "loop-uptime", value: "0.85", date: "2026-06-13" }]);
    expect(parsePrimaryMetrics(text)).toEqual([
      { name: "loop-uptime", value: "0.85", date: "2026-06-13" },
    ]);
  });

  test("parses multiple rows", () => {
    const text = md([
      { name: "loop-uptime", value: "0.85", date: "2026-06-13" },
      { name: "cross-repo-pr-rate", value: "0.15", date: "2026-06-14" },
    ]);
    const rows = parsePrimaryMetrics(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.name).toBe("loop-uptime");
    expect(rows[1]?.name).toBe("cross-repo-pr-rate");
  });

  test("stops at the next ## section", () => {
    const text = [
      "## Primary metrics",
      "",
      "| metric-a | 1 | 2026-06-13 |",
      "",
      "## Another section",
      "",
      "| metric-b | 2 | 2020-01-01 |",
    ].join("\n");
    const rows = parsePrimaryMetrics(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("metric-a");
  });

  test("skips markdown table separator rows", () => {
    const text = [
      "## Primary metrics",
      "",
      "| Name | Value | Date |",
      "| --- | --- | --- |",
      "| loop-uptime | 0.85 | 2026-06-13 |",
    ].join("\n");
    const rows = parsePrimaryMetrics(text);
    expect(rows.find((r) => /^-+$/.test(r.name))).toBeUndefined();
    expect(rows.find((r) => r.name === "loop-uptime")).toBeDefined();
  });

  test("trims whitespace from row fields", () => {
    const text = "## Primary metrics\n\n|  my-metric  |  0.5  |  2026-06-13  |\n";
    const [row] = parsePrimaryMetrics(text);
    expect(row?.name).toBe("my-metric");
    expect(row?.value).toBe("0.5");
    expect(row?.date).toBe("2026-06-13");
  });
});

describe("findStaleRows", () => {
  test("returns [] when all rows are within the budget", () => {
    const rows = [{ name: "m", value: "1", date: daysAgo(STALE_DAYS) }];
    expect(findStaleRows(rows, TODAY)).toEqual([]);
  });

  test("returns [] for a row exactly STALE_DAYS old (boundary — not stale)", () => {
    const rows = [{ name: "m", value: "1", date: daysAgo(STALE_DAYS) }];
    expect(findStaleRows(rows, TODAY)).toEqual([]);
  });

  test("returns the row when it is STALE_DAYS + 1 old", () => {
    const date = daysAgo(STALE_DAYS + 1);
    const rows = [{ name: "loop-uptime", value: "0.85", date }];
    const stale = findStaleRows(rows, TODAY);
    expect(stale).toHaveLength(1);
    expect(stale[0]?.metric).toBe("loop-uptime");
    expect(stale[0]?.daysAgo).toBe(STALE_DAYS + 1);
  });

  test("returns only stale rows from a mixed set", () => {
    const rows = [
      { name: "fresh", value: "1", date: daysAgo(3) },
      { name: "stale", value: "2", date: daysAgo(30) },
    ];
    const stale = findStaleRows(rows, TODAY);
    expect(stale).toHaveLength(1);
    expect(stale[0]?.metric).toBe("stale");
  });

  test("returns all rows when all are stale", () => {
    const rows = [
      { name: "a", value: "1", date: "2020-01-01" },
      { name: "b", value: "2", date: "2020-06-01" },
    ];
    expect(findStaleRows(rows, TODAY)).toHaveLength(2);
  });

  test("returns [] for an empty rows array", () => {
    expect(findStaleRows([], TODAY)).toEqual([]);
  });
});
