import { describe, expect, it, vi } from "vitest";

import {
  DAEMON_STUCK_LABEL,
  type ExecFileLike,
  planDaemonFixIteration,
  resolveDaemonPrStateFromGh,
} from "./daemon-fix-own-pr.js";
import type { DaemonPrStateVerdict } from "./daemon-pr-state.js";

const TASK_ID = "daemon-fix-own-pr-on-ci-failure";
const BRANCH = "feat/daemon-fix-own-pr-on-ci-failure";

function ghJson(args: {
  readonly number: number;
  readonly title?: string;
  readonly checks: readonly { name: string; conclusion: string | null }[];
}): string {
  return JSON.stringify([
    {
      number: args.number,
      state: "OPEN",
      title: args.title ?? `feat(${TASK_ID}): slice 3`,
      statusCheckRollup: args.checks.map((c) => ({
        __typename: "CheckRun",
        name: c.name,
        conclusion: c.conclusion,
      })),
    },
  ]);
}

describe("resolveDaemonPrStateFromGh — gh wiring", () => {
  it("passes --head <branch> --state open and the four json fields to gh", async () => {
    const execFile: ExecFileLike = vi.fn(async () => "[]");
    await resolveDaemonPrStateFromGh({ execFile, taskId: TASK_ID, branch: BRANCH });
    expect(execFile).toHaveBeenCalledWith("gh", [
      "pr",
      "list",
      "--head",
      BRANCH,
      "--state",
      "open",
      "--json",
      "number,title,state,statusCheckRollup",
    ]);
  });

  it("resolves 'pr-failing' end-to-end (gh json → parser → decision)", async () => {
    const execFile: ExecFileLike = vi.fn(async () =>
      ghJson({
        number: 167,
        checks: [
          { name: "biome", conclusion: "SUCCESS" },
          { name: "typecheck", conclusion: "FAILURE" },
        ],
      }),
    );
    const verdict = await resolveDaemonPrStateFromGh({
      execFile,
      taskId: TASK_ID,
      branch: BRANCH,
    });
    expect(verdict).toEqual({
      kind: "pr-failing",
      prNumber: 167,
      failedChecks: ["typecheck"],
      attemptNumber: 1,
    });
  });

  it("threads attemptsSoFar/maxAttempts into the decision (escalation path)", async () => {
    const execFile: ExecFileLike = vi.fn(async () =>
      ghJson({ number: 9, checks: [{ name: "test", conclusion: "FAILURE" }] }),
    );
    const verdict = await resolveDaemonPrStateFromGh({
      execFile,
      taskId: TASK_ID,
      branch: BRANCH,
      attemptsSoFar: 3,
      maxAttempts: 3,
    });
    expect(verdict).toEqual({
      kind: "pr-retries-exhausted",
      prNumber: 9,
      failedChecks: ["test"],
      attemptsSoFar: 3,
    });
  });

  it("graceful-degrades to 'no-pr' when gh rejects (rule #6/#7)", async () => {
    const execFile: ExecFileLike = vi.fn(async () => {
      throw new Error("gh: command not found");
    });
    const verdict = await resolveDaemonPrStateFromGh({
      execFile,
      taskId: TASK_ID,
      branch: BRANCH,
    });
    expect(verdict).toEqual({ kind: "no-pr" });
  });

  it("graceful-degrades to 'no-pr' when gh emits non-array JSON", async () => {
    const execFile: ExecFileLike = vi.fn(async () => '{"unexpected":"shape"}');
    const verdict = await resolveDaemonPrStateFromGh({
      execFile,
      taskId: TASK_ID,
      branch: BRANCH,
    });
    expect(verdict).toEqual({ kind: "no-pr" });
  });
});

describe("resolveDaemonPrStateFromGh — skip-earlier gate (round-trip elimination)", () => {
  it("returns 'no-pr' WITHOUT spawning gh when branch is empty", async () => {
    const execFile: ExecFileLike = vi.fn(async () => "[]");
    const verdict = await resolveDaemonPrStateFromGh({ execFile, taskId: TASK_ID, branch: "" });
    expect(verdict).toEqual({ kind: "no-pr" });
    expect(execFile).not.toHaveBeenCalled();
  });

  it("returns 'no-pr' WITHOUT spawning gh when branch is whitespace", async () => {
    const execFile: ExecFileLike = vi.fn(async () => "[]");
    const verdict = await resolveDaemonPrStateFromGh({
      execFile,
      taskId: TASK_ID,
      branch: "   ",
    });
    expect(verdict).toEqual({ kind: "no-pr" });
    expect(execFile).not.toHaveBeenCalled();
  });
});

describe("planDaemonFixIteration — standard-task-brief", () => {
  it("returns standard-task-brief for 'no-pr'", () => {
    expect(planDaemonFixIteration({ kind: "no-pr" })).toEqual({ kind: "standard-task-brief" });
  });

  it("returns standard-task-brief for 'pr-clean'", () => {
    expect(planDaemonFixIteration({ kind: "pr-clean", prNumber: 1 })).toEqual({
      kind: "standard-task-brief",
    });
  });
});

describe("planDaemonFixIteration — fix-brief", () => {
  const failing: DaemonPrStateVerdict = {
    kind: "pr-failing",
    prNumber: 167,
    failedChecks: ["typecheck", "biome"],
    attemptNumber: 2,
  };

  it("forwards prNumber/attemptNumber/failedChecks and builds a brief", () => {
    const plan = planDaemonFixIteration(failing);
    expect(plan.kind).toBe("fix-brief");
    if (plan.kind !== "fix-brief") throw new Error("unreachable");
    expect(plan.prNumber).toBe(167);
    expect(plan.attemptNumber).toBe(2);
    expect(plan.failedChecks).toEqual(["typecheck", "biome"]);
    expect(plan.brief).toContain("PR #167");
    expect(plan.brief).toContain("typecheck, biome");
  });

  it("instructs same-branch commit, no new PR, no task redo", () => {
    const plan = planDaemonFixIteration(failing);
    if (plan.kind !== "fix-brief") throw new Error("unreachable");
    expect(plan.brief).toMatch(/SAME branch/);
    expect(plan.brief).toMatch(/do NOT open a new PR/);
    expect(plan.brief).toMatch(/do NOT redo the task/i);
  });

  it("forbids suppressing the failure (Risk mitigation)", () => {
    const plan = planDaemonFixIteration(failing);
    if (plan.kind !== "fix-brief") throw new Error("unreachable");
    expect(plan.brief).toMatch(/Do NOT suppress/i);
    expect(plan.brief).toMatch(/lint-ignore|skipped test|weakened assertion/);
  });

  it("appends the failure-log excerpt when provided", () => {
    const plan = planDaemonFixIteration(failing, {
      failureLogExcerpt: "  src/x.ts(3,1): error TS2304: Cannot find name 'foo'.  ",
    });
    if (plan.kind !== "fix-brief") throw new Error("unreachable");
    expect(plan.brief).toContain("Failure log excerpt:");
    expect(plan.brief).toContain("error TS2304: Cannot find name 'foo'.");
  });

  it("omits the log section when the excerpt is absent or blank", () => {
    const noOpt = planDaemonFixIteration(failing);
    const blank = planDaemonFixIteration(failing, { failureLogExcerpt: "   " });
    if (noOpt.kind !== "fix-brief" || blank.kind !== "fix-brief") {
      throw new Error("unreachable");
    }
    expect(noOpt.brief).not.toContain("Failure log excerpt:");
    expect(blank.brief).not.toContain("Failure log excerpt:");
  });
});

describe("planDaemonFixIteration — escalate", () => {
  const exhausted: DaemonPrStateVerdict = {
    kind: "pr-retries-exhausted",
    prNumber: 167,
    failedChecks: ["typecheck"],
    attemptsSoFar: 3,
  };

  it("emits the daemon-stuck label and an operator-actionable summary", () => {
    const plan = planDaemonFixIteration(exhausted);
    expect(plan.kind).toBe("escalate");
    if (plan.kind !== "escalate") throw new Error("unreachable");
    expect(plan.label).toBe(DAEMON_STUCK_LABEL);
    expect(plan.prNumber).toBe(167);
    expect(plan.failedChecks).toEqual(["typecheck"]);
    expect(plan.summary).toContain("PR #167");
    expect(plan.summary).toContain("3 CI-fix attempt");
    expect(plan.summary).toMatch(/Operator action required/i);
  });

  it("DAEMON_STUCK_LABEL is the Blocked: short-code (task Detail d)", () => {
    expect(DAEMON_STUCK_LABEL).toBe("Blocked: daemon-stuck");
  });
});
