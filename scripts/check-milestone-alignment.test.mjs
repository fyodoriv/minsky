// Tests for check-milestone-alignment.mjs. Slice (a) of the
// `milestone-alignment-gate-enforcement` P0. Paired positive/negative
// fixtures (Meszaros 2007) — one fixture milestone with one fully-aligned
// criterion and one criterion missing each surface.

import { describe, expect, test } from "vitest";

import {
  checkCriterion,
  extractCriterionKeywords,
  extractTestFilePath,
  findUserStoriesForCriterion,
  parseMetricsMd,
  parseMilestonesMd,
  reportAlignment,
  statusFromEmoji,
} from "./check-milestone-alignment.mjs";

/**
 * @template T
 * @param {T[]} arr
 * @param {number} i
 * @returns {T}
 */
function require_(arr, i) {
  const v = arr[i];
  if (v === undefined) {
    throw new Error(`expected element at index ${i}, got undefined`);
  }
  return v;
}

// ---------- parseMilestonesMd ----------

describe("parseMilestonesMd", () => {
  test("parses one milestone with one criterion row", () => {
    const md = [
      "## M1 — Stable",
      "",
      "| # | Criterion | Status | How to verify |",
      "|---|---|---|---|",
      "| M1.1 | **stability** — 90% over 10h | ✅ done | `node scripts/stability-report.mjs` |",
      "",
      "## M2 — Fast",
    ].join("\n");
    const result = parseMilestonesMd(md);
    expect(result).toHaveLength(2);
    const m1 = require_(result, 0);
    expect(m1.id).toBe("M1");
    expect(m1.criteria).toHaveLength(1);
    const c1 = require_(m1.criteria, 0);
    expect(c1.id).toBe("M1.1");
    expect(c1.status).toBe("done");
    expect(c1.description).toContain("stability");
  });

  test("parses multiple criteria with mixed statuses", () => {
    const md = [
      "## M1 — Stable",
      "| # | Criterion | Status | How to verify |",
      "|---|---|---|---|",
      "| M1.1 | A | ✅ done | x |",
      "| M1.2 | B | 🟡 partial | y |",
      "| M1.3 | C | ❌ blocked | z |",
      "| M1.4 | D | 🔵 not started | w |",
    ].join("\n");
    const result = parseMilestonesMd(md);
    expect(require_(result, 0).criteria.map((c) => c.status)).toEqual([
      "done",
      "partial",
      "blocked",
      "not-started",
    ]);
  });

  test("handles M2+ tables with only 3 columns (no Status)", () => {
    const md = [
      "## M2 — Fast",
      "| # | Criterion | How to verify |",
      "|---|---|---|",
      "| M2.1 | first task | run x |",
    ].join("\n");
    const result = parseMilestonesMd(md);
    const c = require_(require_(result, 0).criteria, 0);
    expect(c.id).toBe("M2.1");
    expect(c.status).toBe("unknown");
    expect(c.verify).toBe("run x");
  });

  test("ignores rows that don't look like criterion IDs", () => {
    const md = [
      "## M1 — Stable",
      "| # | Criterion | Status | How to verify |",
      "|---|---|---|---|",
      "| not-an-id | text | ✅ done | x |",
      "| M1.1 | real | ✅ done | y |",
    ].join("\n");
    const result = parseMilestonesMd(md);
    const m1 = require_(result, 0);
    expect(m1.criteria).toHaveLength(1);
    expect(require_(m1.criteria, 0).id).toBe("M1.1");
  });

  test("returns empty array on empty input", () => {
    expect(parseMilestonesMd("")).toEqual([]);
  });
});

// ---------- statusFromEmoji ----------

describe("statusFromEmoji", () => {
  test("maps emojis to canonical tokens", () => {
    expect(statusFromEmoji("✅ done")).toBe("done");
    expect(statusFromEmoji("🟡 partial")).toBe("partial");
    expect(statusFromEmoji("❌ blocked")).toBe("blocked");
    expect(statusFromEmoji("🔵 not started")).toBe("not-started");
    expect(statusFromEmoji("???")).toBe("unknown");
    expect(statusFromEmoji("")).toBe("unknown");
  });
});

// ---------- parseMetricsMd ----------

describe("parseMetricsMd", () => {
  test("parses one metric with milestone + stub", () => {
    const md = [
      "# METRICS.md",
      "preamble",
      "## mttr-self-heal — MTTR for catalogued heals",
      "",
      "_Budget: 7d · Milestone: M1.13_",
      "",
      "**Value:** (stub) — no events yet",
    ].join("\n");
    const result = parseMetricsMd(md);
    expect(result).toHaveLength(1);
    const m = require_(result, 0);
    expect(m.id).toBe("mttr-self-heal");
    expect(m.milestone).toBe("M1.13");
    expect(m.valueIsStub).toBe(true);
  });

  test("parses metric with real value (not stub)", () => {
    const md = ["## loop-uptime — Loop uptime", "_Milestone: M1.1_", "**Value:** 97.3%"].join("\n");
    const m = require_(parseMetricsMd(md), 0);
    expect(m.milestone).toBe("M1.1");
    expect(m.valueIsStub).toBe(false);
    expect(m.rawValue).toBe("97.3%");
  });

  test("handles metric without milestone tag", () => {
    const md = ["## orphan-metric — no milestone", "**Value:** 42"].join("\n");
    const m = require_(parseMetricsMd(md), 0);
    expect(m.milestone).toBe(null);
  });
});

// ---------- findUserStoriesForCriterion ----------

describe("findUserStoriesForCriterion", () => {
  /** @type {Record<string, string>} */
  const storyBodies = {
    "001-a.md": "Story about M1.1 only.",
    "007-self-heal.md": "Closes M1.13 phase 1.",
    "013-other.md": "Mentions M1.1 in passing.",
  };
  const surfaces = {
    userStoryFiles: Object.keys(storyBodies),
    /** @param {string} file */
    readUserStory: (file) => storyBodies[file] ?? "",
  };

  test("returns all stories that mention the criterion id", () => {
    expect(findUserStoriesForCriterion("M1.1", surfaces)).toEqual(["001-a.md", "013-other.md"]);
  });

  test("returns one story for M1.13", () => {
    expect(findUserStoriesForCriterion("M1.13", surfaces)).toEqual(["007-self-heal.md"]);
  });

  test("word-boundary match: M1.1 does NOT match M1.13", () => {
    const inner = {
      userStoryFiles: ["x.md"],
      readUserStory: () => "Closes M1.13 phase 1.",
    };
    expect(findUserStoriesForCriterion("M1.1", inner)).toEqual([]);
  });

  test("returns empty array when no story matches", () => {
    expect(findUserStoriesForCriterion("M1.999", surfaces)).toEqual([]);
  });
});

// ---------- extractTestFilePath ----------

describe("extractTestFilePath", () => {
  test("extracts **File**: `<path>` form", () => {
    const md = [
      "## Story",
      "stuff",
      "## Integration test",
      "",
      "- **File**: `path/to/test.test.ts`",
      "",
      "## Other",
    ].join("\n");
    expect(extractTestFilePath(md)).toBe("path/to/test.test.ts");
  });

  test("extracts bare backticked .test.* path when no **File** field", () => {
    const md = [
      "## Integration test",
      "Run `novel/heals/test/chaos/heal.test.ts` to verify.",
      "## Next",
    ].join("\n");
    expect(extractTestFilePath(md)).toBe("novel/heals/test/chaos/heal.test.ts");
  });

  test("returns null when no Integration test section", () => {
    expect(extractTestFilePath("## Story\ntext")).toBe(null);
  });

  test("returns null when section is empty", () => {
    expect(extractTestFilePath("## Integration test\n\n## Next")).toBe(null);
  });
});

// ---------- extractCriterionKeywords ----------

describe("extractCriterionKeywords", () => {
  test("extracts bold phrases as keywords", () => {
    const kws = extractCriterionKeywords("**90% stability over 10h unattended runs** — etc.");
    expect(kws).toContain("90% stability over 10h unattended runs");
    expect(kws).toContain("stability");
    expect(kws).toContain("unattended");
  });

  test("returns empty when no bold phrases", () => {
    expect(extractCriterionKeywords("plain text")).toEqual([]);
  });

  test("filters out common short words", () => {
    const kws = extractCriterionKeywords("**every minsky every default**");
    expect(kws).not.toContain("every");
    expect(kws).not.toContain("minsky");
  });
});

// ---------- checkCriterion ----------

describe("checkCriterion — all-aligned positive case", () => {
  const criterion = {
    id: "M1.13",
    description: "**self-heal** — agents fix failures",
  };
  const surfaces = {
    userStoryFiles: ["007-self-heal.md"],
    readUserStory: () =>
      [
        "Closes M1.13.",
        "",
        "## Metric",
        "stuff",
        "",
        "## Integration test",
        "",
        "- **File**: `novel/observer/test/chaos/heal.test.ts`",
      ].join("\n"),
    fileExists: () => true,
    readmeContent: "minsky promises self-heal on common failures",
  };
  const parsedSurfaces = {
    metrics: [
      {
        id: "mttr-self-heal",
        milestone: "M1.13",
        valueIsStub: false,
        rawValue: "180s",
      },
    ],
  };

  test("returns allAligned=true with all 5 ok", () => {
    const r = checkCriterion(criterion, parsedSurfaces, surfaces);
    expect(r.allAligned).toBe(true);
    expect(r.userStory.ok).toBe(true);
    expect(r.sections.ok).toBe(true);
    expect(r.testFile.ok).toBe(true);
    expect(r.metric.ok).toBe(true);
    expect(r.readme.ok).toBe(true);
  });
});

describe("checkCriterion — negative cases (each surface failing)", () => {
  const baseCriterion = {
    id: "M1.13",
    description: "**self-heal** — agents fix failures",
  };
  const goodStory = [
    "Closes M1.13.",
    "## Metric",
    "x",
    "## Integration test",
    "- **File**: `novel/observer/test/chaos/heal.test.ts`",
  ].join("\n");

  test("no user-story → userStory.ok=false", () => {
    const surfaces = {
      userStoryFiles: [],
      readUserStory: () => "",
      fileExists: () => true,
      readmeContent: "self-heal",
    };
    const r = checkCriterion(baseCriterion, { metrics: [] }, surfaces);
    expect(r.userStory.ok).toBe(false);
    expect(r.allAligned).toBe(false);
  });

  test("user-story missing ## Metric → sections.ok=false", () => {
    const surfaces = {
      userStoryFiles: ["s.md"],
      readUserStory: () =>
        ["Closes M1.13.", "## Integration test", "- **File**: `x.test.ts`"].join("\n"),
      fileExists: () => true,
      readmeContent: "self-heal",
    };
    const r = checkCriterion(baseCriterion, { metrics: [] }, surfaces);
    expect(r.userStory.ok).toBe(true);
    expect(r.sections.ok).toBe(false);
    expect(r.sections.missing.some((m) => m.includes("## Metric"))).toBe(true);
  });

  test("test file doesn't exist → testFile.ok=false", () => {
    const surfaces = {
      userStoryFiles: ["s.md"],
      readUserStory: () => goodStory,
      fileExists: () => false,
      readmeContent: "self-heal",
    };
    const r = checkCriterion(baseCriterion, { metrics: [] }, surfaces);
    expect(r.testFile.exists).toBe(false);
    expect(r.testFile.ok).toBe(false);
  });

  test("metric is stub → metric.ok=false", () => {
    const surfaces = {
      userStoryFiles: ["s.md"],
      readUserStory: () => goodStory,
      fileExists: () => true,
      readmeContent: "self-heal",
    };
    const parsedSurfaces = {
      metrics: [
        {
          id: "mttr-self-heal",
          milestone: "M1.13",
          valueIsStub: true,
          rawValue: "(stub) — ...",
        },
      ],
    };
    const r = checkCriterion(baseCriterion, parsedSurfaces, surfaces);
    expect(r.metric.metricIds).toContain("mttr-self-heal");
    expect(r.metric.hasStub).toBe(true);
    expect(r.metric.ok).toBe(false);
  });

  test("no metric for milestone → metric.ok=false", () => {
    const surfaces = {
      userStoryFiles: ["s.md"],
      readUserStory: () => goodStory,
      fileExists: () => true,
      readmeContent: "self-heal",
    };
    const r = checkCriterion(baseCriterion, { metrics: [] }, surfaces);
    expect(r.metric.metricIds).toEqual([]);
    expect(r.metric.ok).toBe(false);
  });

  test("README doesn't mention keyword → readme.ok=false", () => {
    const surfaces = {
      userStoryFiles: ["s.md"],
      readUserStory: () => goodStory,
      fileExists: () => true,
      readmeContent: "totally unrelated content",
    };
    const r = checkCriterion(baseCriterion, { metrics: [] }, surfaces);
    expect(r.readme.ok).toBe(false);
    expect(r.readme.matchedKeywords).toEqual([]);
  });
});

// ---------- reportAlignment ----------

describe("reportAlignment", () => {
  test("aggregates aligned + gaps across criteria", () => {
    const milestone = {
      id: "M1",
      title: "Stable",
      criteria: [
        {
          id: "M1.1",
          description: "**foo** — bar",
          status: "done",
          statusText: "✅ done",
          verify: "x",
        },
        {
          id: "M1.2",
          description: "**baz** — qux",
          status: "partial",
          statusText: "🟡 partial",
          verify: "y",
        },
      ],
    };
    /** @type {Record<string, string>} */
    const bodies = {
      "a.md": "Closes M1.1.\n## Metric\nx\n## Integration test\n- **File**: `x.test.ts`",
      "b.md": "no match",
    };
    const surfaces = {
      userStoryFiles: ["a.md", "b.md"],
      /** @param {string} file */
      readUserStory: (file) => bodies[file] ?? "",
      fileExists: () => true,
      readmeContent: "foo and baz",
    };
    const parsedSurfaces = {
      metrics: [{ id: "m1", milestone: "M1.1", valueIsStub: false, rawValue: "1" }],
    };
    const r = reportAlignment(milestone, parsedSurfaces, surfaces);
    expect(r.milestone).toBe("M1");
    expect(r.total).toBe(2);
    expect(r.aligned_count).toBe(1);
    expect(r.gaps["M1.2"]).toBeDefined();
    expect(r.gaps["M1.2"]?.missing).toContain("user-story");
    expect(r.gaps["M1.1"]).toBeUndefined();
  });
});
