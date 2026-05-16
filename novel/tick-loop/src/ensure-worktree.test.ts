import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type EnsureWorktreeDeps, ensureWorktree } from "./ensure-worktree.js";

const MINSKY_HOME = "/repo/minsky";

function fakeDeps(overrides: Partial<EnsureWorktreeDeps> = {}): {
  deps: EnsureWorktreeDeps;
  calls: string[][];
} {
  const calls: string[][] = [];
  const deps: EnsureWorktreeDeps = {
    exists: () => false,
    git: (args) => {
      calls.push([...args]);
    },
    ...overrides,
  };
  return { deps, calls };
}

describe("ensureWorktree", () => {
  it("returns the <minskyHome>/.claude/worktrees/daemon-<id>-<task> path", () => {
    const { deps } = fakeDeps();
    const dir = ensureWorktree({ minskyHome: MINSKY_HOME, workerId: 0, taskId: "fix-thing" }, deps);
    expect(dir).toBe(join(MINSKY_HOME, ".claude", "worktrees", "daemon-0-fix-thing"));
  });

  it("is idempotent — when the worktree .git already exists it makes no git calls", () => {
    const wt = join(MINSKY_HOME, ".claude", "worktrees", "daemon-1-t");
    const { deps, calls } = fakeDeps({
      exists: (p) => p === join(wt, ".git"),
    });
    const dir = ensureWorktree({ minskyHome: MINSKY_HOME, workerId: 1, taskId: "t" }, deps);
    expect(dir).toBe(wt);
    expect(calls).toEqual([]);
  });

  it("creates the worktree against minskyHome so the .git gitdir resolves correctly (the regression)", () => {
    const { deps, calls } = fakeDeps();
    ensureWorktree({ minskyHome: MINSKY_HOME, workerId: 0, taskId: "abc" }, deps);
    // every git invocation must be -C <minskyHome> so the worktree's .git
    // file points at <minskyHome>/.git/worktrees/... (not a stale root).
    for (const c of calls) {
      expect(c.slice(0, 2)).toEqual(["-C", MINSKY_HOME]);
    }
    const add = calls.find((c) => c.includes("add"));
    expect(add).toEqual([
      "-C",
      MINSKY_HOME,
      "worktree",
      "add",
      "--force",
      "-B",
      "daemon/0/abc",
      join(MINSKY_HOME, ".claude", "worktrees", "daemon-0-abc"),
      "origin/main",
    ]);
  });

  it("prunes dead worktree admin entries before adding", () => {
    const { deps, calls } = fakeDeps();
    ensureWorktree({ minskyHome: MINSKY_HOME, workerId: 0, taskId: "abc" }, deps);
    expect(calls[0]).toEqual(["-C", MINSKY_HOME, "worktree", "prune"]);
    expect(calls.findIndex((c) => c.includes("prune"))).toBeLessThan(
      calls.findIndex((c) => c.includes("add")),
    );
  });

  it("honors a custom baseRef", () => {
    const { deps, calls } = fakeDeps();
    ensureWorktree({ minskyHome: MINSKY_HOME, workerId: 2, taskId: "x", baseRef: "main" }, deps);
    const add = calls.find((c) => c.includes("add"));
    expect(add?.at(-1)).toBe("main");
  });

  it("fails loud — a git failure propagates (Armstrong 2007, workspace-boundary crash)", () => {
    const boom = vi.fn(() => {
      throw new Error("fatal: worktree add failed");
    });
    const { deps } = fakeDeps({ git: boom });
    expect(() =>
      ensureWorktree({ minskyHome: MINSKY_HOME, workerId: 0, taskId: "z" }, deps),
    ).toThrow(/worktree add failed/);
  });
});
