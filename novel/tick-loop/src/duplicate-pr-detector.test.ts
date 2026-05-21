import { describe, expect, it } from "vitest";
import {
  type PrSnapshot,
  decideDuplicate,
  parseGhPrListForDuplicateDetection,
  prTitleNamesTask,
} from "./duplicate-pr-detector.js";

const NOW = Date.parse("2026-05-07T12:00:00Z");

describe("prTitleNamesTask", () => {
  it("matches feat(task-id): … shape", () => {
    expect(prTitleNamesTask("feat(daemon-pre-pr-lint-gate): foo", "daemon-pre-pr-lint-gate")).toBe(
      true,
    );
  });

  it("matches loose 'task-id' mentions in the title", () => {
    expect(
      prTitleNamesTask("feat: daemon-pre-pr-lint-gate slice 4", "daemon-pre-pr-lint-gate"),
    ).toBe(true);
  });

  it("does NOT match a different task id (suffix collision)", () => {
    expect(
      prTitleNamesTask("feat(daemon-pre-pr-lint-gate-extension): foo", "daemon-pre-pr-lint-gate"),
    ).toBe(false);
    expect(
      prTitleNamesTask("feat(daemon-pre-pr-lint-gate-fix): foo", "daemon-pre-pr-lint-gate"),
    ).toBe(false);
  });

  it("does NOT match a different task id (prefix collision)", () => {
    expect(
      prTitleNamesTask("feat(other-daemon-pre-pr-lint-gate): foo", "daemon-pre-pr-lint-gate"),
    ).toBe(false);
  });

  it("escapes regex metacharacters in the task id", () => {
    expect(prTitleNamesTask("feat(rule-#13.4-slice-1): foo", "rule-#13.4-slice-1")).toBe(true);
  });
});

describe("decideDuplicate", () => {
  it("returns kind: 'none' when no PRs match the task ID", () => {
    const prs: PrSnapshot[] = [
      { number: 1, title: "feat(other-task): foo", state: "OPEN" },
      {
        number: 2,
        title: "feat(unrelated): bar",
        state: "MERGED",
        closedAt: "2026-05-06T12:00:00Z",
      },
    ];
    expect(decideDuplicate({ taskId: "my-task", prs, now: NOW })).toEqual({ kind: "none" });
  });

  it("returns kind: 'open' when an open PR matches — daemon should fix-iterate, not duplicate", () => {
    const prs: PrSnapshot[] = [{ number: 5, title: "feat(my-task): slice 1", state: "OPEN" }];
    expect(decideDuplicate({ taskId: "my-task", prs, now: NOW })).toEqual({
      kind: "open",
      prNumber: 5,
    });
  });

  it("prefers OPEN over MERGED when both exist", () => {
    const prs: PrSnapshot[] = [
      {
        number: 5,
        title: "feat(my-task): slice 1",
        state: "MERGED",
        closedAt: "2026-05-06T12:00:00Z",
      },
      { number: 9, title: "feat(my-task): slice 2", state: "OPEN" },
    ];
    expect(decideDuplicate({ taskId: "my-task", prs, now: NOW })).toEqual({
      kind: "open",
      prNumber: 9,
    });
  });

  it("returns kind: 'merged-recent' when the most recent merged PR is within 7 days", () => {
    const prs: PrSnapshot[] = [
      {
        number: 5,
        title: "feat(my-task): slice 1",
        state: "MERGED",
        closedAt: "2026-05-06T12:00:00Z",
      },
    ];
    const decision = decideDuplicate({ taskId: "my-task", prs, now: NOW });
    expect(decision.kind).toBe("merged-recent");
    if (decision.kind !== "merged-recent") throw new Error("unreachable");
    expect(decision.prNumber).toBe(5);
    expect(decision.daysAgo).toBeCloseTo(1, 1);
  });

  it("returns kind: 'none' when the merged PR is older than the window", () => {
    const prs: PrSnapshot[] = [
      {
        number: 5,
        title: "feat(my-task): old slice",
        state: "MERGED",
        closedAt: "2026-04-20T12:00:00Z",
      },
    ];
    expect(decideDuplicate({ taskId: "my-task", prs, now: NOW })).toEqual({ kind: "none" });
  });

  it("respects custom recentMergedWindowDays", () => {
    const prs: PrSnapshot[] = [
      {
        number: 5,
        title: "feat(my-task): slice 1",
        state: "MERGED",
        closedAt: "2026-05-04T12:00:00Z",
      },
    ];
    expect(
      decideDuplicate({ taskId: "my-task", prs, now: NOW, recentMergedWindowDays: 1 }),
    ).toEqual({ kind: "none" });
    const decision2 = decideDuplicate({
      taskId: "my-task",
      prs,
      now: NOW,
      recentMergedWindowDays: 7,
    });
    expect(decision2.kind).toBe("merged-recent");
  });

  it("picks the most-recent merged PR when multiple match", () => {
    const prs: PrSnapshot[] = [
      {
        number: 5,
        title: "feat(my-task): slice 1",
        state: "MERGED",
        closedAt: "2026-05-04T12:00:00Z",
      },
      {
        number: 9,
        title: "feat(my-task): slice 2",
        state: "MERGED",
        closedAt: "2026-05-06T12:00:00Z",
      },
      {
        number: 11,
        title: "feat(my-task): slice 3",
        state: "MERGED",
        closedAt: "2026-05-05T12:00:00Z",
      },
    ];
    const decision = decideDuplicate({ taskId: "my-task", prs, now: NOW });
    expect(decision.kind).toBe("merged-recent");
    if (decision.kind !== "merged-recent") throw new Error("unreachable");
    expect(decision.prNumber).toBe(9);
  });

  it("ignores CLOSED-not-merged PRs", () => {
    const prs: PrSnapshot[] = [
      {
        number: 5,
        title: "feat(my-task): superseded",
        state: "CLOSED",
        closedAt: "2026-05-06T12:00:00Z",
      },
    ];
    expect(decideDuplicate({ taskId: "my-task", prs, now: NOW })).toEqual({ kind: "none" });
  });
});

describe("parseGhPrListForDuplicateDetection", () => {
  it("parses a well-formed gh pr list JSON array into PrSnapshot[]", () => {
    const raw = JSON.stringify([
      {
        number: 309,
        title: "feat(my-task): slice 1",
        state: "MERGED",
        closedAt: "2026-05-06T12:00:00Z",
      },
      {
        number: 322,
        title: "feat(my-task): slice 2",
        state: "OPEN",
        closedAt: "0001-01-01T00:00:00Z",
      },
    ]);
    expect(parseGhPrListForDuplicateDetection(raw)).toEqual([
      {
        number: 309,
        title: "feat(my-task): slice 1",
        state: "MERGED",
        closedAt: "2026-05-06T12:00:00Z",
      },
      { number: 322, title: "feat(my-task): slice 2", state: "OPEN" },
    ]);
  });

  it("feeds decideDuplicate end-to-end (open PR shadows merged)", () => {
    const raw = JSON.stringify([
      {
        number: 309,
        title: "feat(my-task): merged",
        state: "MERGED",
        closedAt: "2026-05-06T12:00:00Z",
      },
      {
        number: 343,
        title: "feat(my-task): in flight",
        state: "OPEN",
        closedAt: "0001-01-01T00:00:00Z",
      },
    ]);
    const prs = parseGhPrListForDuplicateDetection(raw);
    expect(decideDuplicate({ taskId: "my-task", prs, now: NOW })).toEqual({
      kind: "open",
      prNumber: 343,
    });
  });

  it("drops gh's zero-value closedAt for open PRs so decideDuplicate sees undefined", () => {
    const raw = JSON.stringify([
      { number: 1, title: "feat(x): wip", state: "OPEN", closedAt: "0001-01-01T00:00:00Z" },
    ]);
    expect(parseGhPrListForDuplicateDetection(raw)).toEqual([
      { number: 1, title: "feat(x): wip", state: "OPEN" },
    ]);
  });

  it("returns [] on invalid JSON (graceful-degrade, no throw)", () => {
    expect(parseGhPrListForDuplicateDetection("not json {{{")).toEqual([]);
  });

  it("returns [] on a non-array JSON root", () => {
    expect(parseGhPrListForDuplicateDetection(JSON.stringify({ number: 1 }))).toEqual([]);
    expect(parseGhPrListForDuplicateDetection("null")).toEqual([]);
  });

  it("drops malformed entries (missing number/title, unknown state) but keeps valid ones", () => {
    const raw = JSON.stringify([
      { title: "no number", state: "OPEN" },
      { number: 2, state: "OPEN" },
      { number: 3, title: "bad state", state: "DRAFT" },
      null,
      "string-entry",
      { number: 4, title: "feat(t): ok", state: "MERGED", closedAt: "2026-05-06T12:00:00Z" },
    ]);
    expect(parseGhPrListForDuplicateDetection(raw)).toEqual([
      { number: 4, title: "feat(t): ok", state: "MERGED", closedAt: "2026-05-06T12:00:00Z" },
    ]);
  });

  it("returns [] for an empty array", () => {
    expect(parseGhPrListForDuplicateDetection("[]")).toEqual([]);
  });
});
