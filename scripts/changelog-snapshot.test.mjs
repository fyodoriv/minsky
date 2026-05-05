// Tests for changelog-snapshot.mjs. Pattern: paired positive/negative
// fixtures over pure transforms (Meszaros 2007); the I/O seams (`runGh`,
// `save`) are stubbed so the orchestrator runs end-to-end without
// touching `gh` or disk.

import { describe, expect, test } from "vitest";

import { composeSnapshot, parseGhCount, runChangelogSnapshot } from "./changelog-snapshot.mjs";

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

describe("composeSnapshot", () => {
  test("happy-path inputs produce both metric entries with higherIsBetter=false", () => {
    const snap = composeSnapshot({ openPRs: 4, openIssues: 11 });
    expect(snap).toEqual({
      open_prs: { value: 4, higherIsBetter: false },
      open_issues: { value: 11, higherIsBetter: false },
    });
  });

  test("zero is a valid value (fresh repo or fully-closed backlog)", () => {
    const snap = composeSnapshot({ openPRs: 0, openIssues: 0 });
    expect(snap["open_prs"]?.value).toBe(0);
    expect(snap["open_issues"]?.value).toBe(0);
  });

  test("negative openPRs throws", () => {
    expect(() => composeSnapshot({ openPRs: -1, openIssues: 0 })).toThrow(/openPRs/);
  });

  test("non-finite openIssues throws", () => {
    expect(() => composeSnapshot({ openPRs: 0, openIssues: Number.POSITIVE_INFINITY })).toThrow(
      /openIssues/,
    );
  });
});

describe("runChangelogSnapshot", () => {
  test("composes runGh + save and persists the snapshot via the seam", async () => {
    /** @type {string[][]} */
    const ghCalls = [];
    const runGh = async (/** @type {ReadonlyArray<string>} */ args) => {
      ghCalls.push([...args]);
      // First call (pr list) → 5 PRs; second call (issue list) → 12 issues.
      if (args.includes("pr"))
        return JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ number: i })));
      return JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ number: i })));
    };
    /** @type {Array<{ date: string, snapshot: import("./metric-snapshot-store.mjs").MetricSnapshot }>} */
    const saveCalls = [];
    /** @type {import("./changelog-snapshot.mjs").SaveSeam} */
    const save = async ({ date, snapshot }) => {
      saveCalls.push({ date, snapshot });
      return `/tmp/repo/.minsky/metric-snapshots/${date}.json`;
    };

    const path = await runChangelogSnapshot({ date: "2026-05-05", runGh, save });

    expect(path).toBe("/tmp/repo/.minsky/metric-snapshots/2026-05-05.json");
    expect(ghCalls).toHaveLength(2);
    expect(ghCalls[0]?.[0]).toBe("pr");
    expect(ghCalls[1]?.[0]).toBe("issue");
    expect(ghCalls[0]).toContain("--state");
    expect(ghCalls[0]).toContain("open");
    expect(saveCalls).toEqual([
      {
        date: "2026-05-05",
        snapshot: {
          open_prs: { value: 5, higherIsBetter: false },
          open_issues: { value: 12, higherIsBetter: false },
        },
      },
    ]);
  });

  test("propagates runGh rejections (let-it-crash, rule #6)", async () => {
    const runGh = async () => {
      throw new Error("gh not authenticated");
    };
    const save = async () => "/unused";
    await expect(runChangelogSnapshot({ date: "2026-05-05", runGh, save })).rejects.toThrow(
      /gh not authenticated/,
    );
  });

  test("propagates save rejections (disk full, EACCES, etc.)", async () => {
    const runGh = async () => "[]";
    const save = async () => {
      throw new Error("EACCES: permission denied");
    };
    await expect(runChangelogSnapshot({ date: "2026-05-05", runGh, save })).rejects.toThrow(
      /EACCES/,
    );
  });

  test("zero open PRs + zero open issues writes the snapshot anyway (sentinel for fully-cleared days)", async () => {
    const runGh = async () => "[]";
    /** @type {Array<{ date: string, snapshot: import("./metric-snapshot-store.mjs").MetricSnapshot }>} */
    const saveCalls = [];
    const save = async (
      /** @type {{ date: string, snapshot: import("./metric-snapshot-store.mjs").MetricSnapshot }} */ args,
    ) => {
      saveCalls.push(args);
      return `/tmp/.minsky/metric-snapshots/${args.date}.json`;
    };
    const path = await runChangelogSnapshot({ date: "2026-05-05", runGh, save });
    expect(path).toMatch(/2026-05-05\.json$/);
    expect(saveCalls[0]?.snapshot).toEqual({
      open_prs: { value: 0, higherIsBetter: false },
      open_issues: { value: 0, higherIsBetter: false },
    });
  });

  test("malformed gh response surfaces a JSON parse error (no silent zero)", async () => {
    const runGh = async () => "not json";
    const save = async () => "/unused";
    await expect(runChangelogSnapshot({ date: "2026-05-05", runGh, save })).rejects.toThrow();
  });

  test("runs the two gh queries in parallel (Promise.all, not sequential)", async () => {
    /** @type {string[]} */
    const startOrder = [];
    /** @type {string[]} */
    const completeOrder = [];
    const runGh = async (/** @type {ReadonlyArray<string>} */ args) => {
      const tag = args[0] ?? "?";
      startOrder.push(tag);
      // The pr list call resolves AFTER the issue list call. If the
      // orchestrator awaited sequentially, completeOrder would mirror
      // startOrder. Promise.all lets the issue call complete first.
      const delay = tag === "pr" ? 20 : 1;
      await new Promise((r) => setTimeout(r, delay));
      completeOrder.push(tag);
      return "[]";
    };
    const save = async () => "/unused";
    await runChangelogSnapshot({ date: "2026-05-05", runGh, save });
    expect(startOrder).toEqual(["pr", "issue"]);
    expect(completeOrder).toEqual(["issue", "pr"]);
  });
});
