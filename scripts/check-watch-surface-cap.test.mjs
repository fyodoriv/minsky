// Tests for check-watch-surface-cap.mjs. Pattern: deterministic gate over the
// calm-tech 3-value Watch display-arity invariant (user-story 005, vision.md
// success #6). Paired positive/negative fixtures (Meszaros, *xUnit Test
// Patterns*, 2007).

import { describe, expect, test } from "vitest";

import {
  checkWatchSurfaceCap,
  countTopLevelKeys,
  extractWatchMetricLiteralBody,
} from "./check-watch-surface-cap.mjs";

const MAX = 3;

/**
 * Helper: build a `watch.ts`-shaped buffer whose `WATCH_METRIC_IDS` literal
 * has `n` keys. Mirrors the `as const` object-literal shape the live
 * `novel/dashboard-web/src/watch.ts` uses.
 *
 * @param {number} n
 * @returns {string}
 */
function buildContractWithKeys(n) {
  const entries = [];
  for (let i = 1; i <= n; i += 1) {
    entries.push(`  "reading-${i}": "metric-${i}",`);
  }
  return [
    "export const WATCH_METRIC_IDS = {",
    ...entries,
    "} as const;",
    "",
    "export type WatchKey = keyof typeof WATCH_METRIC_IDS;",
  ].join("\n");
}

describe("checkWatchSurfaceCap", () => {
  test("3 keys → pass (at cap, the real shape)", () => {
    const result = checkWatchSurfaceCap({
      contractContent: buildContractWithKeys(3),
      maxValues: MAX,
    });
    expect(result.valueCount).toBe(3);
    expect(result.violation).toBeNull();
  });

  test("2 keys → pass (under cap)", () => {
    const result = checkWatchSurfaceCap({
      contractContent: buildContractWithKeys(2),
      maxValues: MAX,
    });
    expect(result.valueCount).toBe(2);
    expect(result.violation).toBeNull();
  });

  test("4 keys → fail (over cap, violation names the count + cap)", () => {
    const result = checkWatchSurfaceCap({
      contractContent: buildContractWithKeys(4),
      maxValues: MAX,
    });
    expect(result.valueCount).toBe(4);
    expect(result.violation).not.toBeNull();
    expect(result.violation).toContain("4");
    expect(result.violation).toContain("3");
    expect(result.violation).toMatch(/Watch surface/);
  });

  test("5 keys → fail (well over cap)", () => {
    const result = checkWatchSurfaceCap({
      contractContent: buildContractWithKeys(5),
      maxValues: MAX,
    });
    expect(result.valueCount).toBe(5);
    expect(result.violation).not.toBeNull();
    expect(result.violation).toContain("5");
  });

  test("missing declaration → pass (retired/renamed contract, rule-#9 Pivot terminal state)", () => {
    const result = checkWatchSurfaceCap({
      contractContent: "export const SOMETHING_ELSE = { a: 1 } as const;\n",
      maxValues: MAX,
    });
    expect(result.valueCount).toBe(0);
    expect(result.violation).toBeNull();
  });

  test("missing file (null content) → pass (retired contract)", () => {
    const result = checkWatchSurfaceCap({ contractContent: null, maxValues: MAX });
    expect(result.valueCount).toBe(0);
    expect(result.violation).toBeNull();
  });

  test("empty string → pass (treated identically to missing file)", () => {
    const result = checkWatchSurfaceCap({ contractContent: "", maxValues: MAX });
    expect(result.valueCount).toBe(0);
    expect(result.violation).toBeNull();
  });

  test("a nested object value does not inflate the key count (only top-level keys count)", () => {
    const contractContent = [
      "export const WATCH_METRIC_IDS = {",
      '  "tokens-remaining": "token-budget-honoring",',
      '  "last-task-status": "task-throughput",',
      '  "constraint-of-the-week": { "nested": "x", "more": "y" },',
      "} as const;",
    ].join("\n");
    const result = checkWatchSurfaceCap({ contractContent, maxValues: MAX });
    expect(result.valueCount).toBe(3);
    expect(result.violation).toBeNull();
  });

  test("the live novel/dashboard-web/src/watch.ts has ≤3 Watch readings and passes the gate", async () => {
    // The real contract is the source of the 3-value invariant. If a future
    // edit grows WATCH_METRIC_IDS to a 4th key, this test (and the CLI) flips
    // red in the same PR — the entire point of the gate.
    const { readFile, access } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, resolve } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const path = resolve(here, "..", "novel", "dashboard-web", "src", "watch.ts");
    try {
      await access(path);
    } catch {
      // File doesn't exist — retired-contract terminal state per the gate's
      // own contract (the CLI returns 0 for a missing file). Mirror that here.
      return;
    }
    const contractContent = await readFile(path, "utf8");
    const result = checkWatchSurfaceCap({ contractContent, maxValues: MAX });
    expect(result.valueCount).toBeLessThanOrEqual(MAX);
    expect(result.valueCount).toBeGreaterThan(0);
    expect(result.violation).toBeNull();
  });
});

describe("extractWatchMetricLiteralBody", () => {
  test("isolates the literal body between the matched braces", () => {
    const body = extractWatchMetricLiteralBody(buildContractWithKeys(2));
    expect(body).not.toBeNull();
    expect(body).toContain('"reading-1"');
    expect(body).toContain('"reading-2"');
    // The trailing `as const;` and the WatchKey type alias are outside the
    // braces, so they must not leak into the body.
    expect(body).not.toContain("as const");
    expect(body).not.toContain("WatchKey");
  });

  test("returns null when the declaration is absent", () => {
    expect(extractWatchMetricLiteralBody("const OTHER = { a: 1 };")).toBeNull();
  });
});

describe("countTopLevelKeys", () => {
  test("counts double-quoted keys", () => {
    expect(countTopLevelKeys('"a": 1,\n"b": 2,')).toBe(2);
  });

  test("ignores keys nested inside an object value", () => {
    expect(countTopLevelKeys('"a": { "nested": 1, "deep": 2 },\n"b": 3,')).toBe(2);
  });
});
