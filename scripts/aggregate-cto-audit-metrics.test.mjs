// @ts-check
// Paired tests for `aggregate-cto-audit-metrics.mjs`. Pure-function tests
// over the parser + join + merge-rate logic, plus an I/O-injected `main`
// run with synthetic git+gh fixtures (no filesystem, no `gh`).
//
// Pattern: pure-function-with-I/O-at-edge (Martin 2017) — the I/O
// (`readCommits`, `readPrs`, `writeLine`) is injected so the test never
// shells out to git or gh.

import { describe, expect, it } from "vitest";

import {
  aggregate,
  computeMergeRate,
  extractAuditFiledTasks,
  joinMergedPrs,
  MERGE_WINDOW_MS,
  main,
  parseArgs,
  parseGitLogPatches,
  parseWindowDate,
  titleMentionsId,
} from "./aggregate-cto-audit-metrics.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const FILED_MS = Date.parse("2026-05-10T00:00:00Z");

/**
 * @param {number} ms
 * @param {string} added
 * @returns {{ tsMs: number; addedText: string }}
 */
function commit(ms, added) {
  return { tsMs: ms, addedText: added };
}

/**
 * A well-formed audit-filed task block (the `+`-stripped added text).
 * @param {string} id
 * @returns {string}
 */
function auditBlock(id) {
  return [
    `- [ ] \`${id}\` — some observed issue`,
    `  - **ID**: ${id}`,
    "  - **Tags**: p1, milestone-m1",
    `  - **Surfaced-by**: daemon CTO audit 2026-05-10 — flaky test in foo.test.ts`,
    "  - **Details**: fix it",
  ].join("\n");
}

describe("parseWindowDate", () => {
  it("snaps a bare --since date to UTC start-of-day", () => {
    expect(parseWindowDate("2026-05-01", "since")).toBe(Date.parse("2026-05-01T00:00:00.000Z"));
  });

  it("snaps a bare --until date to UTC end-of-day (end-inclusive)", () => {
    expect(parseWindowDate("2026-05-31", "until")).toBe(Date.parse("2026-05-31T23:59:59.999Z"));
  });

  it("accepts a full ISO-8601 timestamp verbatim", () => {
    expect(parseWindowDate("2026-05-15T12:00:00Z", "since")).toBe(
      Date.parse("2026-05-15T12:00:00Z"),
    );
  });

  it("throws on a non-date value", () => {
    expect(() => parseWindowDate("not-a-date", "since")).toThrow(/must be ISO-8601/);
  });
});

describe("parseArgs", () => {
  it("defaults to an unbounded window and no repo", () => {
    const args = parseArgs([]);
    expect(args.sinceMs).toBe(Number.NEGATIVE_INFINITY);
    expect(args.untilMs).toBe(Number.POSITIVE_INFINITY);
    expect(args.repo).toBeUndefined();
    expect(args.nowMs).toBeUndefined();
  });

  it("parses --since / --until / --repo", () => {
    const args = parseArgs(["--since=2026-05-01", "--until=2026-05-31", "--repo=fyodoriv/minsky"]);
    expect(args.sinceMs).toBe(Date.parse("2026-05-01T00:00:00.000Z"));
    expect(args.untilMs).toBe(Date.parse("2026-05-31T23:59:59.999Z"));
    expect(args.repo).toBe("fyodoriv/minsky");
  });

  it("parses --now as ISO or epoch ms", () => {
    expect(parseArgs(["--now=2026-06-01T00:00:00Z"]).nowMs).toBe(
      Date.parse("2026-06-01T00:00:00Z"),
    );
    expect(parseArgs(["--now=1700000000000"]).nowMs).toBe(1700000000000);
  });

  it("throws on an unknown flag", () => {
    expect(() => parseArgs(["--bogus=1"])).toThrow(/unknown flag/);
  });
});

describe("titleMentionsId", () => {
  it("matches the ID as a whole token", () => {
    expect(titleMentionsId("feat: add foo-bar metric (foo-bar)", "foo-bar")).toBe(true);
    expect(titleMentionsId("FOO-BAR upper-cased", "foo-bar")).toBe(true);
  });

  it("does not match a longer superstring", () => {
    expect(titleMentionsId("feat: foo-barbaz aggregator", "foo-bar")).toBe(false);
  });

  it("returns false when the ID is absent", () => {
    expect(titleMentionsId("feat: unrelated change", "foo-bar")).toBe(false);
  });
});

describe("parseGitLogPatches", () => {
  it("extracts per-commit added text and committer timestamps", () => {
    const tsA = Math.floor(FILED_MS / 1000);
    const stream = [
      `\x1e${tsA}\x1f`,
      "diff --git a/TASKS.md b/TASKS.md",
      "+++ b/TASKS.md",
      "@@ -1,0 +1,2 @@",
      "+added line one",
      "+added line two",
      "-removed line",
      " context line",
    ].join("\n");
    const commits = parseGitLogPatches(stream);
    expect(commits).toHaveLength(1);
    expect(commits[0]?.tsMs).toBe(FILED_MS);
    expect(commits[0]?.addedText).toBe("added line one\nadded line two");
    // The +++ file header is excluded from added text.
    expect(commits[0]?.addedText).not.toContain("b/TASKS.md");
  });

  it("ignores empty records", () => {
    expect(parseGitLogPatches("")).toEqual([]);
    expect(parseGitLogPatches("\x1e\x1e")).toEqual([]);
  });
});

describe("extractAuditFiledTasks", () => {
  it("captures the ID of a block carrying the CTO-audit marker", () => {
    const filed = extractAuditFiledTasks([commit(FILED_MS, auditBlock("flaky-foo-test"))]);
    expect([...filed.keys()]).toEqual(["flaky-foo-test"]);
    expect(filed.get("flaky-foo-test")?.filedAtMs).toBe(FILED_MS);
  });

  it("skips a block with an ID but no CTO-audit marker", () => {
    const plain = [
      "- [ ] `manual-task` — operator filed this",
      "  - **ID**: manual-task",
      "  - **Surfaced-by**: operator 2026-05-10",
    ].join("\n");
    expect(extractAuditFiledTasks([commit(FILED_MS, plain)]).size).toBe(0);
  });

  it("records the EARLIEST filed-at when an ID re-appears in later commits", () => {
    const later = FILED_MS + 5 * DAY_MS;
    const filed = extractAuditFiledTasks([
      commit(FILED_MS, auditBlock("dup-id")),
      commit(later, auditBlock("dup-id")),
    ]);
    expect(filed.get("dup-id")?.filedAtMs).toBe(FILED_MS);
  });

  it("does not mis-attribute an ID from a different block near the marker", () => {
    // Two blocks separated by a blank line: only the audit one counts.
    const text = `${auditBlock("audit-id")}\n\n${[
      "- [ ] `unrelated` — manual",
      "  - **ID**: unrelated",
      "  - **Surfaced-by**: operator 2026-05-10",
    ].join("\n")}`;
    const filed = extractAuditFiledTasks([commit(FILED_MS, text)]);
    expect([...filed.keys()]).toEqual(["audit-id"]);
  });
});

describe("joinMergedPrs", () => {
  /** @type {Map<string, { id: string; filedAtMs: number }>} */
  const filed = new Map([["foo-bar", { id: "foo-bar", filedAtMs: FILED_MS }]]);

  it("marks a task merged when a titled PR merged within 30d after filing", () => {
    const prs = [
      {
        number: 1,
        title: "feat: fix foo-bar (foo-bar)",
        state: "MERGED",
        mergedAt: new Date(FILED_MS + 10 * DAY_MS).toISOString(),
      },
    ];
    expect(joinMergedPrs(filed, prs).get("foo-bar")).toBe(true);
  });

  it("does NOT count a PR merged before the task was filed", () => {
    const prs = [
      {
        number: 2,
        title: "feat: foo-bar",
        state: "MERGED",
        mergedAt: new Date(FILED_MS - DAY_MS).toISOString(),
      },
    ];
    expect(joinMergedPrs(filed, prs).get("foo-bar")).toBe(false);
  });

  it("does NOT count a PR merged after the 30d window", () => {
    const prs = [
      {
        number: 3,
        title: "feat: foo-bar",
        state: "MERGED",
        mergedAt: new Date(FILED_MS + MERGE_WINDOW_MS + DAY_MS).toISOString(),
      },
    ];
    expect(joinMergedPrs(filed, prs).get("foo-bar")).toBe(false);
  });

  it("ignores never-merged PRs (mergedAt null)", () => {
    const prs = [{ number: 4, title: "feat: foo-bar", state: "OPEN", mergedAt: null }];
    expect(joinMergedPrs(filed, prs).get("foo-bar")).toBe(false);
  });
});

describe("computeMergeRate", () => {
  it("returns 0 merge_rate for an empty filed set (no division by zero)", () => {
    const r = computeMergeRate(new Map(), new Map(), Date.parse("2026-06-01T00:00:00Z"));
    expect(r.audit_filed_count).toBe(0);
    expect(r.merged_within_30d_count).toBe(0);
    expect(r.merge_rate).toBe(0);
  });

  it("computes a rounded ratio and an ISO ts", () => {
    const filed = new Map([
      ["a", { id: "a", filedAtMs: FILED_MS }],
      ["b", { id: "b", filedAtMs: FILED_MS }],
      ["c", { id: "c", filedAtMs: FILED_MS }],
    ]);
    const merged = new Map([
      ["a", true],
      ["b", false],
      ["c", true],
    ]);
    const r = computeMergeRate(filed, merged, Date.parse("2026-06-01T00:00:00Z"));
    expect(r.audit_filed_count).toBe(3);
    expect(r.merged_within_30d_count).toBe(2);
    expect(r.merge_rate).toBeCloseTo(0.6667, 4);
    expect(r.ts).toBe("2026-06-01T00:00:00.000Z");
  });
});

describe("aggregate (full pure pipeline)", () => {
  it("filters filed tasks to the window before joining", () => {
    const inWindow = FILED_MS;
    const outOfWindow = Date.parse("2026-04-01T00:00:00Z");
    const commits = [
      commit(outOfWindow, auditBlock("old-task")),
      commit(inWindow, auditBlock("recent-task")),
    ];
    const prs = [
      {
        number: 1,
        title: "feat: recent-task fix (recent-task)",
        state: "MERGED",
        mergedAt: new Date(inWindow + 3 * DAY_MS).toISOString(),
      },
    ];
    const r = aggregate({
      commits,
      prs,
      sinceMs: Date.parse("2026-05-01T00:00:00Z"),
      untilMs: Date.parse("2026-05-31T23:59:59.999Z"),
      nowMs: Date.parse("2026-06-01T00:00:00Z"),
    });
    expect(r.audit_filed_count).toBe(1); // old-task excluded by the window
    expect(r.merged_within_30d_count).toBe(1);
    expect(r.merge_rate).toBe(1);
  });

  it("clears the user-story-007 >=0.4 threshold on a 1/1 fixture", () => {
    const commits = [commit(FILED_MS, auditBlock("flaky-foo-test"))];
    const prs = [
      {
        number: 7,
        title: "fix: stabilize flaky-foo-test (flaky-foo-test)",
        state: "MERGED",
        mergedAt: new Date(FILED_MS + 2 * DAY_MS).toISOString(),
      },
    ];
    const r = aggregate({
      commits,
      prs,
      sinceMs: Date.parse("2026-05-01T00:00:00Z"),
      untilMs: Date.parse("2026-05-31T23:59:59.999Z"),
      nowMs: Date.parse("2026-06-01T00:00:00Z"),
    });
    expect(r.merge_rate).toBeGreaterThanOrEqual(0.4);
  });
});

describe("main (I/O-injected)", () => {
  it("emits one JSON line with the four metric fields", () => {
    /** @type {string[]} */
    const lines = [];
    const code = main(["--since=2026-05-01", "--until=2026-05-31"], {
      readCommits: () => [commit(FILED_MS, auditBlock("flaky-foo-test"))],
      readPrs: () => [
        {
          number: 7,
          title: "fix: stabilize flaky-foo-test (flaky-foo-test)",
          state: "MERGED",
          mergedAt: new Date(FILED_MS + 2 * DAY_MS).toISOString(),
        },
      ],
      writeLine: (l) => lines.push(l),
      nowMs: Date.parse("2026-06-01T00:00:00Z"),
    });
    expect(code).toBe(0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(/** @type {string} */ (lines[0]));
    expect(parsed).toMatchObject({
      audit_filed_count: 1,
      merged_within_30d_count: 1,
      merge_rate: 1,
    });
    expect(typeof parsed.ts).toBe("string");
  });

  it("passes --repo through to the PR reader", () => {
    /** @type {(string | undefined)[]} */
    const seenRepos = [];
    main(["--repo=fyodoriv/minsky"], {
      readCommits: () => [],
      readPrs: (repo) => {
        seenRepos.push(repo);
        return [];
      },
      writeLine: () => undefined,
      nowMs: Date.parse("2026-06-01T00:00:00Z"),
    });
    expect(seenRepos).toEqual(["fyodoriv/minsky"]);
  });
});
