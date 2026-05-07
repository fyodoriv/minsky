import { describe, expect, it } from "vitest";
import { type SweeperIo, runParallelSweeper } from "./parallel-sweeper-runner.js";

/**
 * Build a synthetic `SweeperIo` from in-memory state. Files are a map
 * of path → { exists?, mtimeMs?, content? }; unlinks remove the entry.
 */
function makeIo(state: {
  files: Record<string, { mtimeMs?: number; content?: string }>;
  dirs: Record<string, readonly string[]>;
  now: number;
  unlinkFails?: readonly string[];
}): { io: SweeperIo; unlinks: string[] } {
  const unlinks: string[] = [];
  const files = { ...state.files };
  const io: SweeperIo = {
    now: () => state.now,
    exists: (p) => p in files || p in state.dirs,
    mtimeMs: (p) => files[p]?.mtimeMs,
    readText: (p) => files[p]?.content,
    listDir: (d) => state.dirs[d] ?? [],
    unlink: (p) => {
      if (state.unlinkFails?.includes(p)) return false;
      unlinks.push(p);
      delete files[p];
      return true;
    },
  };
  return { io, unlinks };
}

describe("runParallelSweeper — index-lock sweep", () => {
  it("removes a stale .git/index.lock at the repo root", () => {
    const now = 1_000_000;
    const { io, unlinks } = makeIo({
      now,
      files: {
        "/repo/.git/index.lock": { mtimeMs: now - 10 * 60_000 }, // 10 min old → stale
      },
      dirs: {},
    });
    const result = runParallelSweeper({ minskyHome: "/repo", io });
    expect(result.indexLocksSwept).toBe(1);
    expect(unlinks).toEqual(["/repo/.git/index.lock"]);
  });

  it("keeps a fresh .git/index.lock (live writer)", () => {
    const now = 1_000_000;
    const { io, unlinks } = makeIo({
      now,
      files: {
        "/repo/.git/index.lock": { mtimeMs: now - 10_000 }, // 10s old → live
      },
      dirs: {},
    });
    const result = runParallelSweeper({ minskyHome: "/repo", io });
    expect(result.indexLocksSwept).toBe(0);
    expect(unlinks).toEqual([]);
  });

  it("walks .git/worktrees/<name>/index.lock too (per-worker isolation)", () => {
    const now = 1_000_000;
    const { io, unlinks } = makeIo({
      now,
      files: {
        "/repo/.git/index.lock": { mtimeMs: now - 10_000 }, // fresh — keep
        "/repo/.git/worktrees/daemon-1-foo/index.lock": { mtimeMs: now - 600_000 }, // stale
        "/repo/.git/worktrees/daemon-2-bar/index.lock": { mtimeMs: now - 700_000 }, // stale
      },
      dirs: {
        "/repo/.git/worktrees": ["daemon-1-foo", "daemon-2-bar"],
      },
    });
    const result = runParallelSweeper({ minskyHome: "/repo", io });
    expect(result.indexLocksSwept).toBe(2);
    expect(unlinks).toEqual([
      "/repo/.git/worktrees/daemon-1-foo/index.lock",
      "/repo/.git/worktrees/daemon-2-bar/index.lock",
    ]);
  });

  it("respects custom indexLockStaleAfterMs (operator override)", () => {
    const now = 1_000_000;
    const { io, unlinks } = makeIo({
      now,
      files: {
        "/repo/.git/index.lock": { mtimeMs: now - 60_000 }, // 1 min old
      },
      dirs: {},
    });
    // Threshold = 30s → 1 min old IS stale. Default 5 min would have kept.
    const result = runParallelSweeper({
      minskyHome: "/repo",
      io,
      indexLockStaleAfterMs: 30_000,
    });
    expect(result.indexLocksSwept).toBe(1);
    expect(unlinks).toHaveLength(1);
  });

  it("flags hadRecoverableErrors when mtime probe fails for a file", () => {
    const now = 1_000_000;
    const { io } = makeIo({
      now,
      files: {
        "/repo/.git/index.lock": {
          /* no mtimeMs */
        },
      },
      dirs: {},
    });
    const result = runParallelSweeper({ minskyHome: "/repo", io });
    expect(result.indexLocksSwept).toBe(0);
    expect(result.hadRecoverableErrors).toBe(true);
  });
});

describe("runParallelSweeper — claim-lease sweep", () => {
  it("removes an expired claim lease", () => {
    const now = 1_000_000;
    const { io, unlinks } = makeIo({
      now,
      files: {
        "/repo/.minsky/locks/task-foo.lock": {
          content: JSON.stringify({
            taskId: "foo",
            workerId: "1",
            claimedAt: now - 60_000,
            expiresAt: now - 1, // expired 1ms ago
          }),
        },
      },
      dirs: {
        "/repo/.minsky/locks": ["task-foo.lock"],
      },
    });
    const result = runParallelSweeper({ minskyHome: "/repo", io });
    expect(result.expiredClaimsSwept).toBe(1);
    expect(unlinks).toEqual(["/repo/.minsky/locks/task-foo.lock"]);
  });

  it("keeps a non-expired claim lease (live worker holds it)", () => {
    const now = 1_000_000;
    const { io, unlinks } = makeIo({
      now,
      files: {
        "/repo/.minsky/locks/task-foo.lock": {
          content: JSON.stringify({
            taskId: "foo",
            workerId: "1",
            claimedAt: now - 60_000,
            expiresAt: now + 1_800_000, // 30 min in the future
          }),
        },
      },
      dirs: {
        "/repo/.minsky/locks": ["task-foo.lock"],
      },
    });
    const result = runParallelSweeper({ minskyHome: "/repo", io });
    expect(result.expiredClaimsSwept).toBe(0);
    expect(unlinks).toEqual([]);
  });

  it("ignores non-task-*.lock files in the locks dir", () => {
    const now = 1_000_000;
    const { io, unlinks } = makeIo({
      now,
      files: {
        "/repo/.minsky/locks/.DS_Store": { content: "" },
        "/repo/.minsky/locks/something.txt": { content: "" },
      },
      dirs: {
        "/repo/.minsky/locks": [".DS_Store", "something.txt"],
      },
    });
    const result = runParallelSweeper({ minskyHome: "/repo", io });
    expect(result.expiredClaimsSwept).toBe(0);
    expect(unlinks).toEqual([]);
  });

  it("flags hadRecoverableErrors on malformed JSON (and skips the file)", () => {
    const now = 1_000_000;
    const { io, unlinks } = makeIo({
      now,
      files: {
        "/repo/.minsky/locks/task-corrupt.lock": { content: "not-json" },
        "/repo/.minsky/locks/task-good.lock": {
          content: JSON.stringify({
            taskId: "good",
            workerId: "1",
            claimedAt: now - 60_000,
            expiresAt: now - 1,
          }),
        },
      },
      dirs: {
        "/repo/.minsky/locks": ["task-corrupt.lock", "task-good.lock"],
      },
    });
    const result = runParallelSweeper({ minskyHome: "/repo", io });
    expect(result.expiredClaimsSwept).toBe(1);
    expect(result.hadRecoverableErrors).toBe(true);
    expect(unlinks).toEqual(["/repo/.minsky/locks/task-good.lock"]);
  });

  it("returns zero counts when locks dir doesn't exist (single-process mode)", () => {
    const { io, unlinks } = makeIo({
      now: 1_000_000,
      files: {},
      dirs: {},
    });
    const result = runParallelSweeper({ minskyHome: "/repo", io });
    expect(result).toMatchObject({
      indexLocksSwept: 0,
      expiredClaimsSwept: 0,
      hadRecoverableErrors: false,
    });
    expect(unlinks).toEqual([]);
  });
});

describe("runParallelSweeper — combined", () => {
  it("aggregates counters across both sweep classes", () => {
    const now = 1_000_000;
    const { io, unlinks } = makeIo({
      now,
      files: {
        "/repo/.git/index.lock": { mtimeMs: now - 10 * 60_000 }, // stale → sweep
        "/repo/.minsky/locks/task-a.lock": {
          content: JSON.stringify({
            taskId: "a",
            workerId: "1",
            claimedAt: 0,
            expiresAt: now - 1, // expired → sweep
          }),
        },
        "/repo/.minsky/locks/task-b.lock": {
          content: JSON.stringify({
            taskId: "b",
            workerId: "2",
            claimedAt: 0,
            expiresAt: now + 60_000, // live → keep
          }),
        },
      },
      dirs: {
        "/repo/.minsky/locks": ["task-a.lock", "task-b.lock"],
      },
    });
    const result = runParallelSweeper({ minskyHome: "/repo", io });
    expect(result.indexLocksSwept).toBe(1);
    expect(result.expiredClaimsSwept).toBe(1);
    expect(result.hadRecoverableErrors).toBe(false);
    expect(unlinks).toEqual(["/repo/.git/index.lock", "/repo/.minsky/locks/task-a.lock"]);
  });

  it("truncates reasons at 20 entries (bounded span size)", () => {
    const now = 1_000_000;
    const files: Record<string, { content: string }> = {};
    const dir: string[] = [];
    for (let i = 0; i < 30; i++) {
      const name = `task-${i}.lock`;
      dir.push(name);
      files[`/repo/.minsky/locks/${name}`] = {
        content: JSON.stringify({
          taskId: `${i}`,
          workerId: "1",
          claimedAt: 0,
          expiresAt: now - 1,
        }),
      };
    }
    const { io } = makeIo({
      now,
      files,
      dirs: { "/repo/.minsky/locks": dir },
    });
    const result = runParallelSweeper({ minskyHome: "/repo", io });
    expect(result.expiredClaimsSwept).toBe(30);
    expect(result.reasons.length).toBeLessThanOrEqual(20);
  });

  it("flags hadRecoverableErrors when unlink fails", () => {
    const now = 1_000_000;
    const { io } = makeIo({
      now,
      files: {
        "/repo/.git/index.lock": { mtimeMs: now - 10 * 60_000 },
      },
      dirs: {},
      unlinkFails: ["/repo/.git/index.lock"],
    });
    const result = runParallelSweeper({ minskyHome: "/repo", io });
    expect(result.hadRecoverableErrors).toBe(true);
  });
});
