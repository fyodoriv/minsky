import { describe, expect, it } from "vitest";

import {
  CTO_PROMPT_HEADER,
  type CompletedIterationSignals,
  buildCtoBrief,
  shouldRunCtoAudit,
} from "./post-task-cto-audit.js";

function signals(overrides: Partial<CompletedIterationSignals> = {}): CompletedIterationSignals {
  return {
    completedTaskId: "test-task",
    prUrl: "https://github.com/fyodoriv/minsky/pull/999",
    filesChanged: ["src/foo.ts", "test/foo.test.ts"],
    recentMainCommits: ["feat: ship foo", "fix: foo edge case", "chore: bump foo deps"],
    openWorkItems: 3,
    lintScores: { rule3: 0.95, rule12: 0.8 },
    ...overrides,
  };
}

describe("buildCtoBrief", () => {
  it("includes the fixed CTO_PROMPT_HEADER unmodified", () => {
    const brief = buildCtoBrief(signals());
    expect(brief.startsWith(CTO_PROMPT_HEADER)).toBe(true);
  });

  it("includes the completed task id and PR URL", () => {
    const brief = buildCtoBrief(signals({ completedTaskId: "specific-id" }));
    expect(brief).toContain("`specific-id`");
    expect(brief).toContain("https://github.com/fyodoriv/minsky/pull/999");
  });

  it("renders '(no PR opened)' when prUrl is null", () => {
    const brief = buildCtoBrief(signals({ prUrl: null }));
    expect(brief).toContain("(no PR opened)");
  });

  it("renders all changed files in a bullet list", () => {
    const brief = buildCtoBrief(signals({ filesChanged: ["a.ts", "b.test.ts", "README.md"] }));
    expect(brief).toContain("Files changed (3)");
    expect(brief).toContain("  - a.ts");
    expect(brief).toContain("  - b.test.ts");
    expect(brief).toContain("  - README.md");
  });

  it("renders the no-op fallback when no files changed", () => {
    const brief = buildCtoBrief(signals({ filesChanged: [] }));
    expect(brief).toContain("(none — iteration may have been a no-op brief refresh)");
  });

  it("renders recent commits in oldest-first order", () => {
    const brief = buildCtoBrief(signals({ recentMainCommits: ["older", "middle", "newer"] }));
    const olderIdx = brief.indexOf("- older");
    const newerIdx = brief.indexOf("- newer");
    expect(olderIdx).toBeGreaterThan(0);
    expect(newerIdx).toBeGreaterThan(olderIdx);
  });

  it("renders lint pass-rates as percentages", () => {
    const brief = buildCtoBrief(signals({ lintScores: { rule3: 0.95, rule12: 0.8 } }));
    expect(brief).toContain("rule3: 95%");
    expect(brief).toContain("rule12: 80%");
  });

  it("renders a no-signal-yet fallback when lintScores is empty", () => {
    const brief = buildCtoBrief(signals({ lintScores: {} }));
    expect(brief).toContain("(no signal yet)");
  });

  it("includes the open-work-items count", () => {
    const brief = buildCtoBrief(signals({ openWorkItems: 42 }));
    expect(brief).toContain("Open work items (issues + PRs): 42");
  });

  it("ends with the 'Your task now' framing", () => {
    const brief = buildCtoBrief(signals());
    expect(brief).toContain("## Your task now");
    expect(brief).toContain("highest-leverage next task");
  });
});

describe("shouldRunCtoAudit", () => {
  const baseArgs = {
    status: "completed" as const,
    filesChanged: ["src/foo.ts"],
    prUrl: null,
    env: {},
  };

  it("runs on a completed iteration with files changed", () => {
    expect(shouldRunCtoAudit(baseArgs)).toBe(true);
  });

  it("runs on a completed iteration that opened a PR (even with no files locally)", () => {
    expect(
      shouldRunCtoAudit({
        ...baseArgs,
        filesChanged: [],
        prUrl: "https://github.com/fyodoriv/minsky/pull/123",
      }),
    ).toBe(true);
  });

  it("skips a no-op completed iteration (no files + no PR)", () => {
    expect(shouldRunCtoAudit({ ...baseArgs, filesChanged: [], prUrl: null })).toBe(false);
  });

  it("skips budget-paused iterations", () => {
    expect(shouldRunCtoAudit({ ...baseArgs, status: "budget-paused" })).toBe(false);
  });

  it("skips failed iterations", () => {
    expect(shouldRunCtoAudit({ ...baseArgs, status: "failed" })).toBe(false);
  });

  it("respects MINSKY_CTO_AUDIT=off env override", () => {
    expect(shouldRunCtoAudit({ ...baseArgs, env: { MINSKY_CTO_AUDIT: "off" } })).toBe(false);
  });

  it("ignores MINSKY_CTO_AUDIT values other than 'off'", () => {
    expect(shouldRunCtoAudit({ ...baseArgs, env: { MINSKY_CTO_AUDIT: "on" } })).toBe(true);
    expect(shouldRunCtoAudit({ ...baseArgs, env: { MINSKY_CTO_AUDIT: "" } })).toBe(true);
  });
});
