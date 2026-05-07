import { describe, expect, it } from "vitest";
import {
  type CheckRunSnapshot,
  type DaemonOwnPrSnapshot,
  decideDaemonPrState,
  isFailingConclusion,
  parseGhPrListForDaemonPrState,
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

describe("parseGhPrListForDaemonPrState — happy path", () => {
  it("parses a single open PR with mixed CheckRun conclusions", () => {
    const raw = JSON.stringify([
      {
        number: 355,
        state: "OPEN",
        title: `feat(${TASK_ID}): pure decideDaemonPrState (slice 1/N)`,
        statusCheckRollup: [
          { __typename: "CheckRun", name: "biome", conclusion: "SUCCESS" },
          { __typename: "CheckRun", name: "typecheck", conclusion: "FAILURE" },
          { __typename: "CheckRun", name: "build", conclusion: null, status: "IN_PROGRESS" },
        ],
      },
    ]);
    expect(parseGhPrListForDaemonPrState(raw)).toEqual([
      {
        number: 355,
        title: `feat(${TASK_ID}): pure decideDaemonPrState (slice 1/N)`,
        state: "OPEN",
        checks: [
          { name: "biome", conclusion: "SUCCESS" },
          { name: "typecheck", conclusion: "FAILURE" },
          { name: "build", conclusion: null },
        ],
      },
    ]);
  });

  it("composes with decideDaemonPrState end-to-end (parse → decide)", () => {
    const raw = JSON.stringify([
      {
        number: 99,
        state: "OPEN",
        title: `feat(${TASK_ID}): slice 2/N`,
        statusCheckRollup: [
          { __typename: "CheckRun", name: "biome", conclusion: "SUCCESS" },
          { __typename: "CheckRun", name: "typecheck", conclusion: "FAILURE" },
        ],
      },
    ]);
    const prs = parseGhPrListForDaemonPrState(raw);
    const verdict = decideDaemonPrState({ taskId: TASK_ID, prs });
    expect(verdict).toEqual({
      kind: "pr-failing",
      prNumber: 99,
      failedChecks: ["typecheck"],
      attemptNumber: 1,
    });
  });

  it("returns [] for an empty JSON array", () => {
    expect(parseGhPrListForDaemonPrState("[]")).toEqual([]);
  });

  it("preserves order of multiple open PRs", () => {
    const raw = JSON.stringify([
      { number: 1, state: "OPEN", title: "feat(a): x", statusCheckRollup: [] },
      { number: 2, state: "OPEN", title: "feat(b): y", statusCheckRollup: [] },
    ]);
    const result = parseGhPrListForDaemonPrState(raw);
    expect(result.map((p) => p.number)).toEqual([1, 2]);
  });
});

describe("parseGhPrListForDaemonPrState — filtering", () => {
  it("drops PRs whose state is not OPEN", () => {
    const raw = JSON.stringify([
      { number: 1, state: "MERGED", title: "feat(a): x", statusCheckRollup: [] },
      { number: 2, state: "CLOSED", title: "feat(b): y", statusCheckRollup: [] },
      { number: 3, state: "OPEN", title: "feat(c): z", statusCheckRollup: [] },
    ]);
    const result = parseGhPrListForDaemonPrState(raw);
    expect(result.map((p) => p.number)).toEqual([3]);
  });

  it("drops non-CheckRun rollup entries (e.g., StatusContext)", () => {
    const raw = JSON.stringify([
      {
        number: 5,
        state: "OPEN",
        title: "feat(a): x",
        statusCheckRollup: [
          { __typename: "CheckRun", name: "biome", conclusion: "SUCCESS" },
          { __typename: "StatusContext", context: "legacy/bot", state: "FAILURE" },
        ],
      },
    ]);
    const [pr] = parseGhPrListForDaemonPrState(raw);
    expect(pr?.checks).toEqual([{ name: "biome", conclusion: "SUCCESS" }]);
  });

  it("normalises unknown conclusion values to null (treated as in-flight)", () => {
    const raw = JSON.stringify([
      {
        number: 7,
        state: "OPEN",
        title: "feat(a): x",
        statusCheckRollup: [
          { __typename: "CheckRun", name: "weird", conclusion: "STALE" },
          { __typename: "CheckRun", name: "missing-conclusion-field" },
        ],
      },
    ]);
    const [pr] = parseGhPrListForDaemonPrState(raw);
    expect(pr?.checks).toEqual([
      { name: "weird", conclusion: null },
      { name: "missing-conclusion-field", conclusion: null },
    ]);
  });
});

describe("parseGhPrListForDaemonPrState — graceful degrade", () => {
  it("returns [] for malformed JSON (rule #6/#7)", () => {
    expect(parseGhPrListForDaemonPrState("not-json")).toEqual([]);
  });

  it("returns [] when JSON root is not an array", () => {
    expect(parseGhPrListForDaemonPrState('{"unexpected":"shape"}')).toEqual([]);
  });

  it("returns [] for empty input", () => {
    expect(parseGhPrListForDaemonPrState("")).toEqual([]);
  });

  it("skips entries missing required fields rather than throwing", () => {
    const raw = JSON.stringify([
      { state: "OPEN", title: "no-number", statusCheckRollup: [] },
      { number: 2, state: "OPEN", statusCheckRollup: [] },
      { number: 3, state: "OPEN", title: "valid", statusCheckRollup: [] },
      null,
      "string-entry",
    ]);
    const result = parseGhPrListForDaemonPrState(raw);
    expect(result.map((p) => p.number)).toEqual([3]);
  });

  it("treats missing statusCheckRollup as zero checks", () => {
    const raw = JSON.stringify([{ number: 1, state: "OPEN", title: "feat(a): x" }]);
    const [pr] = parseGhPrListForDaemonPrState(raw);
    expect(pr?.checks).toEqual([]);
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
