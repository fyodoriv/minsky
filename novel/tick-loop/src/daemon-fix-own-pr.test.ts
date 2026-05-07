import { describe, expect, it } from "vitest";
import {
  FIX_CI_BRIEF_MAX_CHARS,
  type PrFailingVerdict,
  buildFixCiBrief,
} from "./daemon-fix-own-pr.js";
import { decideDaemonPrState } from "./daemon-pr-state.js";

const TASK_ID = "daemon-fix-own-pr-on-ci-failure";

function makeVerdict(args: {
  readonly prNumber?: number;
  readonly failedChecks?: readonly string[];
  readonly attemptNumber?: number;
}): PrFailingVerdict {
  return {
    kind: "pr-failing",
    prNumber: args.prNumber ?? 360,
    failedChecks: args.failedChecks ?? ["typecheck"],
    attemptNumber: args.attemptNumber ?? 1,
  };
}

describe("buildFixCiBrief — header", () => {
  it("names the PR number and the task ID in the title", () => {
    const brief = buildFixCiBrief({
      taskId: TASK_ID,
      verdict: makeVerdict({ prNumber: 360 }),
    });
    expect(brief).toContain("PR #360");
    expect(brief).toContain(`\`${TASK_ID}\``);
  });

  it("surfaces the attempt number and max attempts so the model sees the retry budget", () => {
    const brief = buildFixCiBrief({
      taskId: TASK_ID,
      verdict: makeVerdict({ attemptNumber: 2 }),
      maxAttempts: 3,
    });
    expect(brief).toContain("Attempt 2 of 3");
  });

  it("respects a custom maxAttempts (pivot from rule #9: cap=1)", () => {
    const brief = buildFixCiBrief({
      taskId: TASK_ID,
      verdict: makeVerdict({ attemptNumber: 1 }),
      maxAttempts: 1,
    });
    expect(brief).toContain("Attempt 1 of 1");
  });

  it("defaults maxAttempts to 3 when omitted", () => {
    const brief = buildFixCiBrief({ taskId: TASK_ID, verdict: makeVerdict({ attemptNumber: 1 }) });
    expect(brief).toContain("Attempt 1 of 3");
  });
});

describe("buildFixCiBrief — failing checks list", () => {
  it("lists every failing check name verbatim", () => {
    const brief = buildFixCiBrief({
      taskId: TASK_ID,
      verdict: makeVerdict({ failedChecks: ["typecheck", "biome", "rule-6-let-it-crash"] }),
    });
    expect(brief).toContain("`typecheck`");
    expect(brief).toContain("`biome`");
    expect(brief).toContain("`rule-6-let-it-crash`");
  });

  it("surfaces the failed-check count up front", () => {
    const brief = buildFixCiBrief({
      taskId: TASK_ID,
      verdict: makeVerdict({ failedChecks: ["a", "b"] }),
    });
    expect(brief).toContain("2 failing CI check(s)");
  });
});

describe("buildFixCiBrief — anti-noop directive", () => {
  it("instructs the model to push to THE EXISTING branch, not open a second PR", () => {
    const brief = buildFixCiBrief({ taskId: TASK_ID, verdict: makeVerdict({}) });
    expect(brief).toMatch(/this branch/i);
    expect(brief).toMatch(/do not open a second pr/i);
  });

  it("forbids redoing the task or appending to TASKS.md", () => {
    const brief = buildFixCiBrief({ taskId: TASK_ID, verdict: makeVerdict({}) });
    expect(brief).toMatch(/do not redo the task/i);
    expect(brief).toMatch(/do not append to tasks\.md/i);
  });
});

describe("buildFixCiBrief — anti-suppression directive (rule #6)", () => {
  it("forbids suppressing the lint or bypassing the hook", () => {
    const brief = buildFixCiBrief({ taskId: TASK_ID, verdict: makeVerdict({}) });
    expect(brief.toLowerCase()).toContain("--no-verify");
    expect(brief).toMatch(/suppress|skip|bypass/i);
  });

  it("anchors the anti-suppression directive in rule #6", () => {
    const brief = buildFixCiBrief({ taskId: TASK_ID, verdict: makeVerdict({}) });
    expect(brief).toContain("rule #6");
  });
});

describe("buildFixCiBrief — investigation hint", () => {
  it("surfaces gh pr checks and gh run view --log-failed", () => {
    const brief = buildFixCiBrief({
      taskId: TASK_ID,
      verdict: makeVerdict({ prNumber: 167 }),
    });
    expect(brief).toContain("gh pr checks 167");
    expect(brief).toContain("gh run view --log-failed");
  });

  it("instructs running pnpm pre-pr-lint locally before pushing", () => {
    const brief = buildFixCiBrief({ taskId: TASK_ID, verdict: makeVerdict({}) });
    expect(brief).toContain("pnpm pre-pr-lint");
  });
});

describe("buildFixCiBrief — escalation surface", () => {
  it("names the Blocked: daemon-stuck label as the operator escape hatch", () => {
    const brief = buildFixCiBrief({ taskId: TASK_ID, verdict: makeVerdict({}) });
    expect(brief).toContain("Blocked: daemon-stuck");
  });
});

describe("buildFixCiBrief — brief-shrinking budget (slice-4 optimization gate)", () => {
  it("stays within FIX_CI_BRIEF_MAX_CHARS so the prompt budget cannot drift", () => {
    const brief = buildFixCiBrief({
      taskId: TASK_ID,
      verdict: makeVerdict({
        failedChecks: ["typecheck", "biome", "rule-6-let-it-crash", "tasks-lint", "markdownlint"],
        attemptNumber: 2,
      }),
    });
    expect(brief.length).toBeLessThanOrEqual(FIX_CI_BRIEF_MAX_CHARS);
  });

  it("is meaningfully smaller than buildDaemonBrief's standard preamble (≤1500 vs ~3500 chars)", () => {
    // Anti-vanity: the cap is the bound; this test asserts the bound is set
    // tight enough that the brief can't silently grow into preamble bloat.
    expect(FIX_CI_BRIEF_MAX_CHARS).toBeLessThan(2000);
  });
});

describe("buildFixCiBrief — composition with decideDaemonPrState", () => {
  it("consumes the verdict shape produced by decideDaemonPrState end-to-end", () => {
    const verdict = decideDaemonPrState({
      taskId: TASK_ID,
      prs: [
        {
          number: 360,
          title: `feat(${TASK_ID}): slice 3/N`,
          state: "OPEN",
          checks: [
            { name: "biome", conclusion: "SUCCESS" },
            { name: "typecheck", conclusion: "FAILURE" },
          ],
        },
      ],
    });
    expect(verdict.kind).toBe("pr-failing");
    if (verdict.kind !== "pr-failing") return;
    const brief = buildFixCiBrief({ taskId: TASK_ID, verdict });
    expect(brief).toContain("PR #360");
    expect(brief).toContain("`typecheck`");
    expect(brief).toContain("Attempt 1 of 3");
  });
});
