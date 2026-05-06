import { describe, expect, it } from "vitest";
import {
  type ClaimLockSnapshot,
  type SweepDecision,
  type WorktreeSnapshot,
  decideExpiredClaim,
  decideOrphanedWorktree,
  decideStaleIndexLock,
  summarizeSweepDecisions,
} from "./parallel-sweeper.js";

describe("decideStaleIndexLock", () => {
  it("keeps a fresh index.lock (within 5min default)", () => {
    expect(
      decideStaleIndexLock({ path: ".git/index.lock", mtimeMs: 1000, now: 1000 + 60_000 }),
    ).toEqual({ verdict: "keep" });
  });

  it("sweeps a stale index.lock (>5min default)", () => {
    const decision = decideStaleIndexLock({
      path: ".git/index.lock",
      mtimeMs: 1000,
      now: 1000 + 6 * 60_000,
    });
    expect(decision).toMatchObject({ verdict: "sweep", target: ".git/index.lock" });
    expect(decision).toMatchObject({ reason: expect.stringMatching(/exceeds threshold/) });
  });

  it("respects a custom staleAfterMs threshold", () => {
    const fresh = decideStaleIndexLock({
      path: ".git/index.lock",
      mtimeMs: 0,
      now: 30_000,
      staleAfterMs: 60_000,
    });
    expect(fresh.verdict).toBe("keep");
    const stale = decideStaleIndexLock({
      path: ".git/index.lock",
      mtimeMs: 0,
      now: 30_000,
      staleAfterMs: 10_000,
    });
    expect(stale.verdict).toBe("sweep");
  });

  it("treats exact-threshold age as fresh (< not <=)", () => {
    expect(
      decideStaleIndexLock({
        path: ".git/index.lock",
        mtimeMs: 0,
        now: 5 * 60_000,
        staleAfterMs: 5 * 60_000,
      }),
    ).toEqual({ verdict: "keep" });
  });
});

describe("decideExpiredClaim", () => {
  it("keeps a live claim", () => {
    const snapshot: ClaimLockSnapshot = {
      path: ".minsky/locks/task-foo.lock",
      expiresAt: 2000,
      workerId: "w-0",
    };
    expect(decideExpiredClaim({ snapshot, now: 1000 })).toEqual({ verdict: "keep" });
  });

  it("sweeps an expired claim with the worker id in the reason", () => {
    const snapshot: ClaimLockSnapshot = {
      path: ".minsky/locks/task-foo.lock",
      expiresAt: 500,
      workerId: "w-2",
    };
    const decision = decideExpiredClaim({ snapshot, now: 1000 });
    expect(decision).toMatchObject({
      verdict: "sweep",
      target: ".minsky/locks/task-foo.lock",
      reason: expect.stringMatching(/w-2/),
    });
  });

  it("treats expiresAt === now as expired (boundary, mirrors decideClaim)", () => {
    const snapshot: ClaimLockSnapshot = {
      path: ".minsky/locks/task-foo.lock",
      expiresAt: 1000,
      workerId: "w-0",
    };
    expect(decideExpiredClaim({ snapshot, now: 1000 }).verdict).toBe("sweep");
  });
});

describe("decideOrphanedWorktree", () => {
  const baseNow = 1_000_000_000;

  it("keeps an operator-created worktree (not in daemon namespace)", () => {
    const snapshot: WorktreeSnapshot = {
      name: "op-feature",
      branch: "feat/operator-thing",
      mtimeMs: 0,
    };
    expect(decideOrphanedWorktree({ snapshot, openBranches: [], now: baseNow })).toEqual({
      verdict: "keep",
    });
  });

  it("keeps a daemon worktree whose branch has an open PR", () => {
    const snapshot: WorktreeSnapshot = {
      name: "daemon-0-foo",
      branch: "daemon/0/foo",
      mtimeMs: 0,
    };
    expect(
      decideOrphanedWorktree({
        snapshot,
        openBranches: ["daemon/0/foo"],
        now: baseNow,
      }),
    ).toEqual({ verdict: "keep" });
  });

  it("sweeps a daemon worktree with no open PR and >24h mtime", () => {
    const snapshot: WorktreeSnapshot = {
      name: "daemon-1-stale",
      branch: "daemon/1/stale",
      mtimeMs: 0,
    };
    const decision = decideOrphanedWorktree({
      snapshot,
      openBranches: [],
      now: 25 * 3_600_000,
    });
    expect(decision).toMatchObject({ verdict: "sweep", target: "daemon-1-stale" });
  });

  it("keeps a daemon worktree younger than 24h even when orphaned", () => {
    const snapshot: WorktreeSnapshot = {
      name: "daemon-2-recent",
      branch: "daemon/2/recent",
      mtimeMs: 0,
    };
    expect(decideOrphanedWorktree({ snapshot, openBranches: [], now: 23 * 3_600_000 })).toEqual({
      verdict: "keep",
    });
  });

  it("supports daemon- prefix (worktree name) AND daemon/ prefix (branch)", () => {
    const snapshotDash: WorktreeSnapshot = {
      name: "daemon-3-foo",
      branch: "daemon-3-foo",
      mtimeMs: 0,
    };
    const decision = decideOrphanedWorktree({
      snapshot: snapshotDash,
      openBranches: [],
      now: 25 * 3_600_000,
    });
    expect(decision.verdict).toBe("sweep");
  });

  it("respects custom orphanAfterMs", () => {
    const snapshot: WorktreeSnapshot = {
      name: "daemon-0-x",
      branch: "daemon/0/x",
      mtimeMs: 0,
    };
    const decision = decideOrphanedWorktree({
      snapshot,
      openBranches: [],
      now: 60_000,
      orphanAfterMs: 30_000,
    });
    expect(decision.verdict).toBe("sweep");
  });
});

describe("summarizeSweepDecisions", () => {
  it("counts keep vs sweep and collects reasons", () => {
    const decisions: SweepDecision<string>[] = [
      { verdict: "keep" },
      { verdict: "sweep", reason: "stale lock", target: "/path/a" },
      { verdict: "keep" },
      { verdict: "sweep", reason: "expired claim", target: "/path/b" },
    ];
    expect(summarizeSweepDecisions(decisions)).toEqual({
      kept: 2,
      swept: 2,
      reasons: ["stale lock", "expired claim"],
    });
  });

  it("returns zero-counts for an empty input", () => {
    expect(summarizeSweepDecisions([])).toEqual({ kept: 0, swept: 0, reasons: [] });
  });

  it("only includes reasons for sweep decisions, not keep", () => {
    const decisions: SweepDecision<string>[] = [{ verdict: "keep" }, { verdict: "keep" }];
    expect(summarizeSweepDecisions(decisions).reasons).toEqual([]);
  });
});
