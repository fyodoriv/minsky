// Paired tests for `host-walker.ts`.
//
// Source: TASKS.md `minsky-run-autonomous-defaults-and-multi-host`; rule #3.

import { describe, expect, test } from "vitest";

import type { LoopResult, LoopStopReason } from "./host-loop.js";

import { walkHostsDir } from "./host-walker.js";

function loopResult(stopReason: LoopStopReason, iterationCount = 0): LoopResult {
  const iterations = Array.from({ length: iterationCount }, (_, i) => ({
    iteration: i,
    taskId: `task-${i}`,
    verdict: "validated" as const,
    durationMs: 0,
    scopeLeakPaths: [] as readonly string[],
    prUrl: null,
    stderrTail: "",
    exitCode: 0,
  }));
  return { iterations, stopReason };
}

describe("walkHostsDir — happy paths", () => {
  test("all-hosts-drained when every host returns empty-queue", async () => {
    const result = await walkHostsDir({
      hosts: ["/tmp/host-a", "/tmp/host-b", "/tmp/host-c"],
      runOneHost: () => Promise.resolve(loopResult("empty-queue", 0)),
    });
    expect(result.stopReason).toBe("all-hosts-drained");
    expect(result.visits).toHaveLength(3);
    expect(result.totalIterations).toBe(0);
  });

  test("drain-then-advance: walker visits each host in order", async () => {
    const visited: string[] = [];
    const result = await walkHostsDir({
      hosts: ["/tmp/a", "/tmp/b", "/tmp/c"],
      runOneHost: (host) => {
        visited.push(host);
        return Promise.resolve(loopResult("empty-queue", 0));
      },
    });
    expect(visited).toEqual(["/tmp/a", "/tmp/b", "/tmp/c"]);
    expect(result.stopReason).toBe("all-hosts-drained");
  });

  test("accumulates totalIterations across hosts", async () => {
    const counts = [3, 5, 2];
    let i = 0;
    const result = await walkHostsDir({
      hosts: ["/tmp/a", "/tmp/b", "/tmp/c"],
      runOneHost: () => Promise.resolve(loopResult("empty-queue", counts[i++] ?? 0)),
    });
    expect(result.totalIterations).toBe(10);
  });

  test("advances on inner max-iterations (host hit its inner cap, not the walker's)", async () => {
    let n = 0;
    const result = await walkHostsDir({
      hosts: ["/tmp/a", "/tmp/b"],
      runOneHost: () => {
        const r = loopResult(n === 0 ? "max-iterations" : "empty-queue", 4);
        n++;
        return Promise.resolve(r);
      },
    });
    expect(result.stopReason).toBe("all-hosts-drained");
    expect(result.visits).toHaveLength(2);
  });
});

describe("walkHostsDir — halt-on-failure semantics", () => {
  test("scope-leak in any host halts the walker", async () => {
    let n = 0;
    const result = await walkHostsDir({
      hosts: ["/tmp/a", "/tmp/b", "/tmp/c"],
      runOneHost: () => {
        const reason: LoopStopReason = n === 1 ? "scope-leak" : "empty-queue";
        n++;
        return Promise.resolve(loopResult(reason, 0));
      },
    });
    expect(result.stopReason).toBe("scope-leak");
    expect(result.visits).toHaveLength(2);
    expect(result.visits[1]?.hostRoot).toBe("/tmp/b");
  });

  test("spawn-failed in one host skips to next host (does not halt walker)", async () => {
    let callCount = 0;
    const result = await walkHostsDir({
      hosts: ["/tmp/a", "/tmp/b"],
      runOneHost: (host) => {
        callCount++;
        if (host === "/tmp/a") return Promise.resolve(loopResult("spawn-failed", 0));
        return Promise.resolve(loopResult("empty-queue", 2));
      },
    });
    expect(callCount).toBe(2);
    expect(result.stopReason).toBe("all-hosts-drained");
    expect(result.visits).toHaveLength(2);
    expect(result.visits[0]?.loopResult.stopReason).toBe("spawn-failed");
    expect(result.visits[1]?.loopResult.stopReason).toBe("empty-queue");
    expect(result.totalIterations).toBe(2);
  });

  test("inner-aborted halts the walker (signal already fired)", async () => {
    const result = await walkHostsDir({
      hosts: ["/tmp/a", "/tmp/b"],
      runOneHost: () => Promise.resolve(loopResult("aborted", 0)),
    });
    expect(result.stopReason).toBe("aborted");
    expect(result.visits).toHaveLength(1);
  });
});

describe("walkHostsDir — outer abort signal", () => {
  test("aborted when AbortSignal fires BEFORE the first host", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await walkHostsDir({
      hosts: ["/tmp/a", "/tmp/b"],
      runOneHost: () => Promise.reject(new Error("should not be called")),
      signal: controller.signal,
    });
    expect(result.stopReason).toBe("aborted");
    expect(result.visits).toEqual([]);
  });

  test("aborted at host boundary mid-walk", async () => {
    const controller = new AbortController();
    let n = 0;
    const result = await walkHostsDir({
      hosts: ["/tmp/a", "/tmp/b", "/tmp/c"],
      runOneHost: () => {
        if (n === 1) controller.abort();
        n++;
        return Promise.resolve(loopResult("empty-queue", 0));
      },
      signal: controller.signal,
    });
    expect(result.stopReason).toBe("aborted");
    expect(result.visits.length).toBeGreaterThanOrEqual(1);
    expect(result.visits.length).toBeLessThan(3);
  });
});

describe("walkHostsDir — outer max-iterations cap", () => {
  test("max-iterations stops the walker before all hosts are visited", async () => {
    const result = await walkHostsDir({
      hosts: ["/tmp/a", "/tmp/b", "/tmp/c"],
      runOneHost: () => Promise.resolve(loopResult("empty-queue", 5)),
      maxTotalIterations: 7,
    });
    // After host A: 5 iterations. After host B: 10 iterations. Walker checks
    // the cap BEFORE running host C (10 >= 7), so the walker stops with
    // max-iterations and only 2 hosts visited.
    expect(result.stopReason).toBe("max-iterations");
    expect(result.visits.length).toBeLessThan(3);
    expect(result.totalIterations).toBeGreaterThanOrEqual(7);
  });

  test("no cap means all-hosts-drained even with many iterations", async () => {
    const result = await walkHostsDir({
      hosts: ["/tmp/a", "/tmp/b"],
      runOneHost: () => Promise.resolve(loopResult("empty-queue", 100)),
    });
    expect(result.stopReason).toBe("all-hosts-drained");
    expect(result.totalIterations).toBe(200);
  });
});

describe("walkHostsDir — empty hosts list", () => {
  test("returns all-hosts-drained immediately on empty input", async () => {
    const result = await walkHostsDir({
      hosts: [],
      runOneHost: () => Promise.reject(new Error("should not be called")),
    });
    expect(result.stopReason).toBe("all-hosts-drained");
    expect(result.visits).toEqual([]);
    expect(result.totalIterations).toBe(0);
  });
});

describe("walkHostsDir — let-it-crash", () => {
  test("rethrows runOneHost errors per rule #6 (no catch)", async () => {
    await expect(
      walkHostsDir({
        hosts: ["/tmp/a"],
        runOneHost: () => Promise.reject(new Error("host exploded")),
      }),
    ).rejects.toThrow("host exploded");
  });
});

// Regression scenario for `walker-drains-one-host-forever` (filed
// 2026-05-18, fix landed in this same PR). The bug shape the walker has
// to survive is:
//
//   1. Walker iterates 7 hosts in alphabetical order.
//   2. Host A's TASKS.md has ONE rule-9-compliant task; the worker
//      that runs it returns `validated` on every iteration but does
//      NOT open a PR and does NOT remove the task block.
//   3. Host A's `runHostLoop` therefore re-picks the same task on
//      every iteration. Pre-fix: with `max-iter=∞`, this is an
//      infinite drain — host B onward never gets touched.
//   4. Post-fix: `runOneHost` has a per-host iteration cap (3 in the
//      CLI binding), and `runHostLoop` rotates past validated task
//      IDs within the same loop session.
//
// The two fixes compose: even WITHOUT the per-host cap, the
// skip-set drains the host's queue after a single validated cycle
// (the walker sees `empty-queue` and advances). And even WITHOUT the
// skip-set, the per-host cap forces an advance after N iterations.
// Both fixes are belt-and-suspenders — the walker stays fair under
// either failure mode.
//
// This test exercises the COMPOSED behaviour with a fake host loop
// that mimics what `runHostLoop` produces in the bug scenario.
describe("walkHostsDir — walker-drains-one-host-forever regression", () => {
  test("a non-completing host does not starve later hosts (drain-then-advance fairness)", async () => {
    // 7 hosts; only the first three carry work. The first host has a
    // "stuck" task that validates 3 times in a row (the per-host cap
    // bounds the inner loop). Hosts B and C have one validated task
    // each. After fix, the walker visits all 7; the success threshold
    // from the task block says ≥3 hosts receive ≥1 iteration.
    const visitedWithIter: string[] = [];
    const hosts = [
      "/tmp/host-a-stuck",
      "/tmp/host-b-fast",
      "/tmp/host-c-fast",
      "/tmp/host-d-empty",
      "/tmp/host-e-empty",
      "/tmp/host-f-empty",
      "/tmp/host-g-empty",
    ];
    const result = await walkHostsDir({
      hosts,
      runOneHost: (host) => {
        // Simulate the inner loop's verdict shape per host. Hosts A/B/C
        // do work; the rest are empty (the operator hasn't filed work
        // for them yet).
        if (host === "/tmp/host-a-stuck") {
          // Pre-fix: 0 / ∞ iterations on this host alone.
          // Post-fix: bounded by the per-host cap (3), then advance.
          visitedWithIter.push(host);
          return Promise.resolve(loopResult("max-iterations", 3));
        }
        if (host === "/tmp/host-b-fast" || host === "/tmp/host-c-fast") {
          visitedWithIter.push(host);
          return Promise.resolve(loopResult("empty-queue", 1));
        }
        return Promise.resolve(loopResult("empty-queue", 0));
      },
    });
    expect(result.stopReason).toBe("all-hosts-drained");
    expect(result.visits).toHaveLength(7);
    // Acceptance — task `walker-drains-one-host-forever`:
    //   in a 7-host walk where 3 hosts have tasks, all 3 hosts
    //   receive ≥1 iteration per walk.
    expect(visitedWithIter).toEqual(["/tmp/host-a-stuck", "/tmp/host-b-fast", "/tmp/host-c-fast"]);
    // Host A is bounded by the inner per-host cap (3) — not by an
    // infinite drain. The walker advances regardless of A's stop
    // reason as long as it isn't scope-leak / aborted.
    expect(result.visits[0]?.loopResult.iterations).toHaveLength(3);
    expect(result.visits[0]?.loopResult.stopReason).toBe("max-iterations");
  });

  test("a stuck host's max-iterations does NOT halt the walker (advance, don't escalate)", async () => {
    // Belt-and-suspenders: even if the inner per-host cap is hit
    // (which is the bounded recovery path for a non-completing task),
    // the walker MUST treat it as a healthy advance, not a halt.
    // `mapInnerStopToWalker` returns `undefined` for `max-iterations`,
    // which means the walker proceeds to the next host. This test
    // pins that contract so a future refactor can't silently
    // re-introduce the bug by mapping `max-iterations` to a halt.
    const result = await walkHostsDir({
      hosts: ["/tmp/a", "/tmp/b"],
      runOneHost: (host) => {
        if (host === "/tmp/a") return Promise.resolve(loopResult("max-iterations", 3));
        return Promise.resolve(loopResult("empty-queue", 0));
      },
    });
    expect(result.stopReason).toBe("all-hosts-drained");
    expect(result.visits).toHaveLength(2);
  });
});
