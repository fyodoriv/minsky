import { describe, expect, it } from "vitest";
import {
  countDuplicates,
  countNamespaceCollisions,
  DEFAULT_BASE_PORT,
  DEFAULT_PORT_SPAN,
  deriveClaimKey,
  deriveRunId,
  deriveRunNamespace,
  fnv1a32,
  normalizeRepoPath,
  repoHash,
} from "./worker-config.js";

describe("fnv1a32", () => {
  it("is deterministic and unsigned 32-bit", () => {
    const h = fnv1a32("abc");
    expect(h).toBe(fnv1a32("abc"));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it("distinguishes different inputs", () => {
    expect(fnv1a32("a")).not.toBe(fnv1a32("b"));
  });
});

describe("normalizeRepoPath", () => {
  it("strips trailing slash and collapses repeats", () => {
    expect(normalizeRepoPath("/a/b/")).toBe("/a/b");
    expect(normalizeRepoPath("/a//b")).toBe("/a/b");
  });

  it("keeps root slash", () => {
    expect(normalizeRepoPath("/")).toBe("/");
  });

  it("hashes the same repo identically regardless of trailing slash", () => {
    expect(repoHash("/repo/x")).toBe(repoHash("/repo/x/"));
  });
});

describe("repoHash", () => {
  it("is an 8-char lowercase hex string", () => {
    expect(repoHash("/a/b")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("differs across repos", () => {
    expect(repoHash("/a")).not.toBe(repoHash("/b"));
  });
});

describe("deriveRunId", () => {
  it("is `<repo-hash>-<pid>-<rand>` shape", () => {
    const id = deriveRunId({ repoPath: "/r", pid: 1234, rand: "deadbeef" });
    expect(id).toMatch(/^[0-9a-f]{8}-1234-deadbeef$/);
  });

  it("sanitizes the random token to filename-safe chars", () => {
    const id = deriveRunId({ repoPath: "/r", pid: 1, rand: "AB_c/9!" });
    expect(id.endsWith("-abc9")).toBe(true);
  });

  it("clamps a bad pid to 0", () => {
    expect(deriveRunId({ repoPath: "/r", pid: -5, rand: "x" })).toContain("-0-x");
    expect(deriveRunId({ repoPath: "/r", pid: Number.NaN, rand: "x" })).toContain("-0-x");
  });

  it("rejects an empty random token", () => {
    expect(() => deriveRunId({ repoPath: "/r", pid: 1, rand: "" })).toThrow();
    expect(() => deriveRunId({ repoPath: "/r", pid: 1, rand: "!!!" })).toThrow();
  });

  it("differs across pid and rand", () => {
    const a = deriveRunId({ repoPath: "/r", pid: 1, rand: "x" });
    const b = deriveRunId({ repoPath: "/r", pid: 2, rand: "x" });
    const c = deriveRunId({ repoPath: "/r", pid: 1, rand: "y" });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("deriveRunNamespace", () => {
  const ns = deriveRunNamespace({ repoPath: "/repo", pid: 99, rand: "abcd" });

  it("keys every mutable namespace by the run-id", () => {
    expect(ns.worktreeDir).toContain(ns.runId);
    expect(ns.lockPath).toContain(ns.runId);
    expect(ns.branchName).toContain(ns.runId);
    expect(ns.launchdLabel).toContain(ns.runId);
    expect(ns.ledgerPath).toContain(ns.runId);
  });

  it("derives a port within the configured span", () => {
    expect(ns.port).toBeGreaterThanOrEqual(DEFAULT_BASE_PORT);
    expect(ns.port).toBeLessThan(DEFAULT_BASE_PORT + DEFAULT_PORT_SPAN);
  });

  it("honors a custom base port and span", () => {
    const custom = deriveRunNamespace({
      repoPath: "/repo",
      pid: 1,
      rand: "z",
      basePort: 5000,
      portSpan: 10,
    });
    expect(custom.port).toBeGreaterThanOrEqual(5000);
    expect(custom.port).toBeLessThan(5010);
  });

  it("produces a frozen, well-formed branch and label", () => {
    expect(Object.isFrozen(ns)).toBe(true);
    expect(ns.branchName).toMatch(/^minsky\/run-[0-9a-f]{8}-99-abcd$/);
    expect(ns.launchdLabel).toMatch(/^com\.minsky\.run\.[0-9a-f]{8}-99-abcd$/);
  });
});

describe("deriveClaimKey (repo+task scoped)", () => {
  it("same repo + same task → same key (only one O_EXCL winner)", () => {
    expect(deriveClaimKey("/r", "t1")).toBe(deriveClaimKey("/r", "t1"));
  });

  it("same repo + different task → different key (no cross-block)", () => {
    expect(deriveClaimKey("/r", "t1")).not.toBe(deriveClaimKey("/r", "t2"));
  });

  it("different repo + same task → different key (no cross-repo block)", () => {
    expect(deriveClaimKey("/a", "t")).not.toBe(deriveClaimKey("/b", "t"));
  });

  it("rejects an empty task id", () => {
    expect(() => deriveClaimKey("/r", "")).toThrow();
  });
});

describe("countDuplicates", () => {
  it("counts a 3-way clash as 2", () => {
    expect(countDuplicates(["a", "a", "a", "b"])).toBe(2);
  });

  it("returns 0 for disjoint values", () => {
    expect(countDuplicates(["a", "b", "c"])).toBe(0);
  });
});

describe("countNamespaceCollisions", () => {
  it("reports zero collisions on every string dimension for N distinct runs on the same repo", () => {
    const namespaces = Array.from({ length: 50 }, (_, i) =>
      deriveRunNamespace({ repoPath: "/same-repo", pid: 1000 + i, rand: `r${i}` }),
    );
    const c = countNamespaceCollisions(namespaces);
    expect(c.runId).toBe(0);
    expect(c.worktreeDir).toBe(0);
    expect(c.lockPath).toBe(0);
    expect(c.branchName).toBe(0);
    expect(c.launchdLabel).toBe(0);
    expect(c.ledgerPath).toBe(0);
    // `port` is a finite hint — the birthday paradox can produce a hash clash
    // at high N; the OS bind loop arbitrates it, so it's NOT a hard collision.
    expect(c.port).toBeGreaterThanOrEqual(0);
  });

  it("detects an injected duplicate run-id", () => {
    const a = deriveRunNamespace({ repoPath: "/r", pid: 1, rand: "x" });
    const c = countNamespaceCollisions([a, a]);
    expect(c.runId).toBe(1);
    expect(c.worktreeDir).toBe(1);
    expect(c.branchName).toBe(1);
  });
});
