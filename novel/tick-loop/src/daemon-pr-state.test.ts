import { describe, expect, it } from "vitest";
import {
  type CheckRunSnapshot,
  type DaemonOwnPrSnapshot,
  decideDaemonPrState,
  isFailingConclusion,
} from "./daemon-pr-state.js";

const TASK_ID = "daemon-fix-own-pr-on-ci-failure";

const passing: CheckRunSnapshot = { name: "biome", conclusion: "SUCCESS" };
const failing: CheckRunSnapshot = { name: "typecheck", conclusion: "FAILURE" };
const inFlight: CheckRunSnapshot = { name: "build", conclusion: null };

function makePr(args: {
  readonly number: number;
  readonly title?: string;
  readonly checks?: readonly CheckRunSnapshot[];
}): DaemonOwnPrSnapshot {
  return {
    number: args.number,
    title: args.title ?? `feat(${TASK_ID}): slice 1`,
    state: "OPEN",
    checks: args.checks ?? [],
  };
}

describe("decideDaemonPrState — no-pr", () => {
  it("returns 'no-pr' when the prs list is empty", () => {
    expect(decideDaemonPrState({ taskId: TASK_ID, prs: [] })).toEqual({ kind: "no-pr" });
  });

  it("returns 'no-pr' when no PR title matches the task ID", () => {
    const prs: DaemonOwnPrSnapshot[] = [
      makePr({ number: 1, title: "feat(other-task): foo", checks: [failing] }),
    ];
    expect(decideDaemonPrState({ taskId: TASK_ID, prs })).toEqual({ kind: "no-pr" });
  });

  it("ignores prefix-collision titles (no false match)", () => {
    const prs: DaemonOwnPrSnapshot[] = [
      makePr({ number: 1, title: `feat(other-${TASK_ID}-extension): bar`, checks: [failing] }),
    ];
    expect(decideDaemonPrState({ taskId: TASK_ID, prs })).toEqual({ kind: "no-pr" });
  });
});

describe("decideDaemonPrState — pr-clean", () => {
  it("returns 'pr-clean' when the matching PR has all checks passing", () => {
    const prs: DaemonOwnPrSnapshot[] = [makePr({ number: 42, checks: [passing, passing] })];
    expect(decideDaemonPrState({ taskId: TASK_ID, prs })).toEqual({
      kind: "pr-clean",
      prNumber: 42,
    });
  });

  it("returns 'pr-clean' when the matching PR has only in-flight (null) checks", () => {
    const prs: DaemonOwnPrSnapshot[] = [makePr({ number: 7, checks: [inFlight, passing] })];
    expect(decideDaemonPrState({ taskId: TASK_ID, prs })).toEqual({
      kind: "pr-clean",
      prNumber: 7,
    });
  });

  it("returns 'pr-clean' when the matching PR has zero checks (CI not yet started)", () => {
    const prs: DaemonOwnPrSnapshot[] = [makePr({ number: 99, checks: [] })];
    expect(decideDaemonPrState({ taskId: TASK_ID, prs })).toEqual({
      kind: "pr-clean",
      prNumber: 99,
    });
  });

  it("treats SKIPPED and NEUTRAL conclusions as non-failing", () => {
    const prs: DaemonOwnPrSnapshot[] = [
      makePr({
        number: 5,
        checks: [
          { name: "skipped-job", conclusion: "SKIPPED" },
          { name: "neutral-job", conclusion: "NEUTRAL" },
        ],
      }),
    ];
    expect(decideDaemonPrState({ taskId: TASK_ID, prs })).toEqual({
      kind: "pr-clean",
      prNumber: 5,
    });
  });
});

describe("decideDaemonPrState — pr-failing", () => {
  it("returns 'pr-failing' with failed-check names when a check is FAILURE", () => {
    const prs: DaemonOwnPrSnapshot[] = [makePr({ number: 12, checks: [passing, failing] })];
    expect(decideDaemonPrState({ taskId: TASK_ID, prs })).toEqual({
      kind: "pr-failing",
      prNumber: 12,
      failedChecks: ["typecheck"],
      attemptNumber: 1,
    });
  });

  it("collects ALL failing check names (not just first)", () => {
    const prs: DaemonOwnPrSnapshot[] = [
      makePr({
        number: 13,
        checks: [
          { name: "lint", conclusion: "FAILURE" },
          { name: "test", conclusion: "TIMED_OUT" },
          passing,
          { name: "deploy", conclusion: "ACTION_REQUIRED" },
        ],
      }),
    ];
    const verdict = decideDaemonPrState({ taskId: TASK_ID, prs });
    expect(verdict.kind).toBe("pr-failing");
    if (verdict.kind === "pr-failing") {
      expect(verdict.failedChecks).toEqual(["lint", "test", "deploy"]);
    }
  });

  it("treats CANCELLED and STARTUP_FAILURE as failing conclusions", () => {
    const prs: DaemonOwnPrSnapshot[] = [
      makePr({
        number: 14,
        checks: [
          { name: "cancelled-job", conclusion: "CANCELLED" },
          { name: "startup-fail", conclusion: "STARTUP_FAILURE" },
        ],
      }),
    ];
    const verdict = decideDaemonPrState({ taskId: TASK_ID, prs });
    expect(verdict.kind).toBe("pr-failing");
    if (verdict.kind === "pr-failing") {
      expect(verdict.failedChecks).toEqual(["cancelled-job", "startup-fail"]);
    }
  });

  it("increments attemptNumber from attemptsSoFar (1-indexed)", () => {
    const prs: DaemonOwnPrSnapshot[] = [makePr({ number: 21, checks: [failing] })];
    const verdict = decideDaemonPrState({ taskId: TASK_ID, prs, attemptsSoFar: 1 });
    expect(verdict).toEqual({
      kind: "pr-failing",
      prNumber: 21,
      failedChecks: ["typecheck"],
      attemptNumber: 2,
    });
  });
});

describe("decideDaemonPrState — pr-retries-exhausted", () => {
  it("returns 'pr-retries-exhausted' once attemptsSoFar reaches the default cap (3)", () => {
    const prs: DaemonOwnPrSnapshot[] = [makePr({ number: 31, checks: [failing] })];
    expect(decideDaemonPrState({ taskId: TASK_ID, prs, attemptsSoFar: 3 })).toEqual({
      kind: "pr-retries-exhausted",
      prNumber: 31,
      failedChecks: ["typecheck"],
      attemptsSoFar: 3,
    });
  });

  it("respects a custom maxAttempts cap (pivot from rule #9: cap=1)", () => {
    const prs: DaemonOwnPrSnapshot[] = [makePr({ number: 32, checks: [failing] })];
    expect(decideDaemonPrState({ taskId: TASK_ID, prs, attemptsSoFar: 1, maxAttempts: 1 })).toEqual(
      {
        kind: "pr-retries-exhausted",
        prNumber: 32,
        failedChecks: ["typecheck"],
        attemptsSoFar: 1,
      },
    );
  });

  it("does NOT escalate when attemptsSoFar is just below the cap", () => {
    const prs: DaemonOwnPrSnapshot[] = [makePr({ number: 33, checks: [failing] })];
    const verdict = decideDaemonPrState({ taskId: TASK_ID, prs, attemptsSoFar: 2 });
    expect(verdict.kind).toBe("pr-failing");
  });
});

describe("isFailingConclusion", () => {
  const failing: readonly CheckRunSnapshot["conclusion"][] = [
    "FAILURE",
    "CANCELLED",
    "TIMED_OUT",
    "ACTION_REQUIRED",
    "STARTUP_FAILURE",
  ];
  const nonFailing: readonly CheckRunSnapshot["conclusion"][] = [
    "SUCCESS",
    "SKIPPED",
    "NEUTRAL",
    null,
  ];

  it.each(failing)("treats %s as failing", (c) => {
    expect(isFailingConclusion(c)).toBe(true);
  });

  it.each(nonFailing)("treats %s as non-failing", (c) => {
    expect(isFailingConclusion(c)).toBe(false);
  });
});
