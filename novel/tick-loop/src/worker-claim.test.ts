import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireTaskClaim, decideClaim, parseLockBody } from "./worker-claim.js";

describe("decideClaim (pure)", () => {
  it("acquires when no existing lock", () => {
    expect(decideClaim({ existingLock: null, now: 1000 })).toEqual({ verdict: "acquire" });
  });

  it("defers when an existing lock has not expired", () => {
    const lock = { taskId: "t1", workerId: "w-2", claimedAt: 500, expiresAt: 2000 };
    expect(decideClaim({ existingLock: lock, now: 1000 })).toEqual({
      verdict: "held",
      heldBy: "w-2",
      expiresAt: 2000,
    });
  });

  it("recovers when an existing lock has expired", () => {
    const lock = { taskId: "t1", workerId: "w-2", claimedAt: 500, expiresAt: 800 };
    expect(decideClaim({ existingLock: lock, now: 1000 })).toEqual({
      verdict: "stale-recoverable",
      heldBy: "w-2",
      expiredAt: 800,
    });
  });

  it("treats expiresAt === now as expired (boundary)", () => {
    const lock = { taskId: "t1", workerId: "w-2", claimedAt: 500, expiresAt: 1000 };
    const decision = decideClaim({ existingLock: lock, now: 1000 });
    expect(decision.verdict).toBe("stale-recoverable");
  });
});

describe("parseLockBody", () => {
  it("parses well-formed JSON", () => {
    const text = JSON.stringify({ taskId: "t", workerId: "w", claimedAt: 1, expiresAt: 2 });
    expect(parseLockBody(text)).toEqual({ taskId: "t", workerId: "w", claimedAt: 1, expiresAt: 2 });
  });

  it("returns null for malformed JSON", () => {
    expect(parseLockBody("not json")).toBeNull();
  });

  it("returns null when fields are missing", () => {
    expect(parseLockBody(JSON.stringify({ taskId: "t" }))).toBeNull();
  });

  it("returns null when types are wrong (numeric instead of string)", () => {
    const text = JSON.stringify({ taskId: 1, workerId: "w", claimedAt: 1, expiresAt: 2 });
    expect(parseLockBody(text)).toBeNull();
  });
});

describe("acquireTaskClaim (I/O)", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "minsky-claim-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("happy path: acquires when no lock exists, lock body persisted with TTL", () => {
    const result = acquireTaskClaim({
      taskId: "task-1",
      workerId: "worker-A",
      ttlMs: 60_000,
      locksDir: dir,
      now: () => 1000,
    });
    expect(result.acquired).toBe(true);
    if (!result.acquired) throw new Error("unreachable");
    expect(result.expiresAt).toBe(61_000);
    const path = join(dir, "task-task-1.lock");
    expect(existsSync(path)).toBe(true);
    const body = parseLockBody(readFileSync(path, "utf8"));
    expect(body).toMatchObject({ taskId: "task-1", workerId: "worker-A", expiresAt: 61_000 });
    result.release();
    expect(existsSync(path)).toBe(false);
  });

  it("collision: second acquire fails when lock is live", () => {
    const a = acquireTaskClaim({
      taskId: "task-1",
      workerId: "worker-A",
      ttlMs: 60_000,
      locksDir: dir,
      now: () => 1000,
    });
    expect(a.acquired).toBe(true);
    const b = acquireTaskClaim({
      taskId: "task-1",
      workerId: "worker-B",
      ttlMs: 60_000,
      locksDir: dir,
      now: () => 2000,
    });
    expect(b.acquired).toBe(false);
    if (b.acquired) throw new Error("unreachable");
    expect(b.heldBy).toBe("worker-A");
    expect(b.expiresAt).toBe(61_000);
  });

  it("stale recovery: expired lock is reclaimed by next worker", () => {
    const path = join(dir, "task-stale.lock");
    writeFileSync(
      path,
      JSON.stringify({ taskId: "stale", workerId: "dead-worker", claimedAt: 0, expiresAt: 500 }),
    );
    const result = acquireTaskClaim({
      taskId: "stale",
      workerId: "fresh-worker",
      ttlMs: 60_000,
      locksDir: dir,
      now: () => 1000,
    });
    expect(result.acquired).toBe(true);
    if (!result.acquired) throw new Error("unreachable");
    const body = parseLockBody(readFileSync(path, "utf8"));
    expect(body?.workerId).toBe("fresh-worker");
  });

  it("malformed lock body is treated as stale-recoverable", () => {
    const path = join(dir, "task-malformed.lock");
    writeFileSync(path, "{not json");
    const result = acquireTaskClaim({
      taskId: "malformed",
      workerId: "fresh",
      ttlMs: 60_000,
      locksDir: dir,
      now: () => 1000,
    });
    expect(result.acquired).toBe(true);
  });

  it("two workers race, only one wins (proves serialization)", () => {
    const a = acquireTaskClaim({
      taskId: "race",
      workerId: "A",
      ttlMs: 60_000,
      locksDir: dir,
      now: () => 1000,
    });
    const b = acquireTaskClaim({
      taskId: "race",
      workerId: "B",
      ttlMs: 60_000,
      locksDir: dir,
      now: () => 1001,
    });
    const winners = [a.acquired, b.acquired].filter(Boolean);
    expect(winners).toHaveLength(1);
  });

  it("release allows a subsequent worker to acquire", () => {
    const a = acquireTaskClaim({
      taskId: "passable",
      workerId: "A",
      ttlMs: 60_000,
      locksDir: dir,
      now: () => 1000,
    });
    expect(a.acquired).toBe(true);
    if (!a.acquired) throw new Error("unreachable");
    a.release();
    const b = acquireTaskClaim({
      taskId: "passable",
      workerId: "B",
      ttlMs: 60_000,
      locksDir: dir,
      now: () => 2000,
    });
    expect(b.acquired).toBe(true);
  });

  it("creates the locks directory if it does not exist", () => {
    const nested = join(dir, "deeply", "nested", "locks");
    const result = acquireTaskClaim({
      taskId: "t",
      workerId: "w",
      ttlMs: 60_000,
      locksDir: nested,
      now: () => 1000,
    });
    expect(result.acquired).toBe(true);
    expect(existsSync(join(nested, "task-t.lock"))).toBe(true);
  });

  it("100 sequential acquires of the same task: each released, all succeed (no leak)", () => {
    for (let i = 0; i < 100; i++) {
      const r = acquireTaskClaim({
        taskId: "loop",
        workerId: `w-${i}`,
        ttlMs: 60_000,
        locksDir: dir,
        now: () => 1000 + i,
      });
      expect(r.acquired).toBe(true);
      if (!r.acquired) throw new Error("unreachable");
      r.release();
    }
  });
});
