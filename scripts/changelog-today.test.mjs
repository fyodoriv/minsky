// Tests for changelog-today.mjs. Pattern: paired positive/negative
// fixtures over pure transforms (Meszaros 2007); the I/O seam (`runGh`)
// is stubbed so the orchestrator can be exercised end-to-end without
// shelling out.

import { describe, expect, test } from "vitest";

import {
  fetchTodaysPRs,
  filterByMergeDate,
  parseGhPrList,
  runChangelogToday,
  toMergedPRs,
} from "./changelog-today.mjs";

const sampleRaw = JSON.stringify([
  {
    number: 174,
    title: "fix(tick-loop): real daemon brief",
    additions: 156,
    deletions: 4,
    mergedAt: "2026-05-05T10:00:00Z",
  },
  {
    number: 175,
    title: "feat(tick-loop): runCtoAudit() I/O wrapper",
    additions: 320,
    deletions: 1,
    mergedAt: "2026-05-05T18:30:00Z",
  },
  {
    number: 176,
    title: "feat(tick-loop): post-task CTO audit wire-in",
    additions: 280,
    deletions: 0,
    mergedAt: "2026-05-04T23:59:59Z",
  },
]);

describe("parseGhPrList", () => {
  test("empty array → empty array", () => {
    expect(parseGhPrList("[]")).toEqual([]);
  });

  test("multi-PR fixture parses to typed records", () => {
    const out = parseGhPrList(sampleRaw);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      number: 174,
      title: "fix(tick-loop): real daemon brief",
      additions: 156,
      deletions: 4,
      mergedAt: "2026-05-05T10:00:00Z",
    });
  });

  test("malformed JSON throws", () => {
    expect(() => parseGhPrList("{not json")).toThrow();
  });

  test("non-array JSON throws with explanatory message", () => {
    expect(() => parseGhPrList(JSON.stringify({ number: 1 }))).toThrow(/JSON array/);
  });

  test("missing fields surface the offending index", () => {
    const bad = JSON.stringify([{ number: 1, title: "x" }]);
    expect(() => parseGhPrList(bad)).toThrow(/record 0 missing/);
  });
});

describe("filterByMergeDate", () => {
  test("keeps only PRs merged within UTC day", () => {
    const out = filterByMergeDate(parseGhPrList(sampleRaw), "2026-05-05");
    expect(out.map((p) => p.number)).toEqual([174, 175]);
  });

  test("inclusive at UTC start-of-day", () => {
    const records = parseGhPrList(
      JSON.stringify([
        {
          number: 1,
          title: "t",
          additions: 0,
          deletions: 0,
          mergedAt: "2026-05-05T00:00:00Z",
        },
      ]),
    );
    expect(filterByMergeDate(records, "2026-05-05")).toHaveLength(1);
  });

  test("exclusive at UTC end-of-day (next-day midnight)", () => {
    const records = parseGhPrList(
      JSON.stringify([
        {
          number: 1,
          title: "t",
          additions: 0,
          deletions: 0,
          mergedAt: "2026-05-06T00:00:00Z",
        },
      ]),
    );
    expect(filterByMergeDate(records, "2026-05-05")).toHaveLength(0);
  });

  test("invalid date string throws", () => {
    expect(() => filterByMergeDate([], "not-a-date")).toThrow(/invalid date/);
  });

  test("PR with malformed mergedAt is dropped (not throwing)", () => {
    const records = [
      {
        number: 1,
        title: "t",
        additions: 0,
        deletions: 0,
        mergedAt: "garbage",
      },
    ];
    expect(filterByMergeDate(records, "2026-05-05")).toEqual([]);
  });
});

describe("toMergedPRs", () => {
  test("strips mergedAt, preserves the rest", () => {
    const out = toMergedPRs(parseGhPrList(sampleRaw));
    expect(out[0]).toEqual({
      number: 174,
      title: "fix(tick-loop): real daemon brief",
      additions: 156,
      deletions: 4,
    });
    expect(out[0]).not.toHaveProperty("mergedAt");
  });

  test("empty in, empty out", () => {
    expect(toMergedPRs([])).toEqual([]);
  });
});

describe("fetchTodaysPRs", () => {
  test("composes runGh + parse + filter and returns the day's PRs", async () => {
    /** @type {string[][]} */
    const calls = [];
    const runGh = async (/** @type {ReadonlyArray<string>} */ args) => {
      calls.push([...args]);
      return sampleRaw;
    };
    const out = await fetchTodaysPRs({ date: "2026-05-05", runGh });
    expect(out.map((p) => p.number)).toEqual([174, 175]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("--state");
    expect(calls[0]).toContain("merged");
    expect(calls[0]).toContain("merged:>=2026-05-05");
  });

  test("propagates runGh rejections (let-it-crash, rule #6)", async () => {
    const runGh = async () => {
      throw new Error("gh unavailable");
    };
    await expect(fetchTodaysPRs({ date: "2026-05-05", runGh })).rejects.toThrow(/gh unavailable/);
  });
});

describe("runChangelogToday", () => {
  test("default markdown output contains the date heading and PR bullets", async () => {
    const runGh = async () => sampleRaw;
    const md = await runChangelogToday({ date: "2026-05-05", runGh });
    expect(md).toContain("## 2026-05-05");
    expect(md).toContain("**#174**");
    expect(md).toContain("**#175**");
    expect(md).not.toContain("**#176**"); // 2026-05-04 — filtered out
  });

  test("--json emits the structured shape consumable by `jq`", async () => {
    const runGh = async () => sampleRaw;
    const out = await runChangelogToday({
      date: "2026-05-05",
      runGh,
      json: true,
    });
    const parsed = JSON.parse(out);
    expect(parsed.date).toBe("2026-05-05");
    expect(parsed.mergedPRs).toHaveLength(2);
    expect(parsed.mergedPRs.map((/** @type {{ number: number }} */ p) => p.number)).toEqual([
      174, 175,
    ]);
  });

  test("zero-PR day renders the no-PRs sentinel", async () => {
    const runGh = async () => "[]";
    const md = await runChangelogToday({ date: "2026-05-05", runGh });
    expect(md).toContain("_No PRs merged on this date._");
  });

  test("loadSnapshotForDate seam supplies metrics for today + previous day", async () => {
    const runGh = async () => sampleRaw;
    /** @type {string[]} */
    const requestedDates = [];
    /** @type {import("./changelog-today.mjs").LoadSnapshotForDate} */
    const loadSnapshotForDate = async (d) => {
      requestedDates.push(d);
      if (d === "2026-05-05") return { uptime_h: { value: 10, higherIsBetter: true } };
      if (d === "2026-05-04") return { uptime_h: { value: 7, higherIsBetter: true } };
      return undefined;
    };
    const out = await runChangelogToday({
      date: "2026-05-05",
      runGh,
      json: true,
      loadSnapshotForDate,
    });
    const parsed = JSON.parse(out);
    expect(requestedDates.sort()).toEqual(["2026-05-04", "2026-05-05"]);
    expect(parsed.metrics).toHaveLength(1);
    expect(parsed.metrics[0]).toMatchObject({
      name: "uptime_h",
      value: 10,
      prev: 7,
      delta: 3,
      direction: "improved",
    });
  });

  test("missing previous-day snapshot is rendered without Δ (graceful-degrade)", async () => {
    const runGh = async () => sampleRaw;
    /** @type {import("./changelog-today.mjs").LoadSnapshotForDate} */
    const loadSnapshotForDate = async (d) => {
      if (d === "2026-05-05") return { findings: { value: 0, higherIsBetter: false } };
      return undefined;
    };
    const out = await runChangelogToday({
      date: "2026-05-05",
      runGh,
      json: true,
      loadSnapshotForDate,
    });
    const parsed = JSON.parse(out);
    expect(parsed.metrics[0]).toMatchObject({
      name: "findings",
      value: 0,
      prev: null,
      delta: null,
      direction: null,
    });
  });

  test("no loadSnapshotForDate seam → markdown carries the no-metrics sentinel", async () => {
    const runGh = async () => sampleRaw;
    const md = await runChangelogToday({ date: "2026-05-05", runGh });
    expect(md).toContain("_No metrics recorded for this date._");
  });

  test("loadSnapshotForDate returns undefined for both → falls back to no-metrics sentinel", async () => {
    const runGh = async () => sampleRaw;
    const loadSnapshotForDate = async () => undefined;
    const md = await runChangelogToday({ date: "2026-05-05", runGh, loadSnapshotForDate });
    expect(md).toContain("_No metrics recorded for this date._");
  });
});
