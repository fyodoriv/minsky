// Paired tests for `classifyRepo` + `assertWriteAllowed` (rule #3 —
// test-first). The acceptance grid is home-vs-foreign × push/pr/taskmd
// — every cell of the permission matrix has a test.
//
// Pattern: table-driven + literal-input (pure-function contract; no
//   stubs needed — the seam is data, not I/O).
//   Source: Bentley 1986 (programming pearls, table-driven tests);
//   Saltzer & Schroeder 1975 (fail-safe defaults — the deny cells are
//   the security-critical ones and get the most coverage).
// Coverage target: 100% of the decision matrix + origin/path
//   normalization edge cases (scp form, .git suffix, trailing slash,
//   origin-less repos).

import { describe, expect, it } from "vitest";
import { assertWriteAllowed, classifyRepo } from "./repo-policy.js";

describe("classifyRepo", () => {
  it("identical normalized origins → home (scp vs https forms compare equal)", () => {
    expect(
      classifyRepo({
        candidateOrigin: "git@github.com:fyodoriv/minsky.git",
        homeOrigin: "https://github.com/fyodoriv/minsky",
      }),
    ).toBe("home");
  });

  it("trailing .git and slash do not change identity", () => {
    expect(
      classifyRepo({
        candidateOrigin: "https://github.com/fyodoriv/minsky.git/",
        homeOrigin: "https://github.com/fyodoriv/minsky",
      }),
    ).toBe("home");
  });

  it("different origins → foreign", () => {
    expect(
      classifyRepo({
        candidateOrigin: "git@github.com:fyodoriv/agentbrew.git",
        homeOrigin: "git@github.com:fyodoriv/minsky.git",
      }),
    ).toBe("foreign");
  });

  it("origin-less repos fall back to root-path identity (same path → home)", () => {
    expect(
      classifyRepo({
        candidateOrigin: null,
        homeOrigin: null,
        candidateRoot: "/home/op/apps/tooling/minsky/",
        homeRoot: "/home/op/apps/tooling/minsky",
      }),
    ).toBe("home");
  });

  it("origin-less repos with different roots → foreign", () => {
    expect(
      classifyRepo({
        candidateOrigin: null,
        homeOrigin: null,
        candidateRoot: "/home/op/apps/other",
        homeRoot: "/home/op/apps/tooling/minsky",
      }),
    ).toBe("foreign");
  });

  it("fail-safe default: no usable identity signal → foreign (never home)", () => {
    // Saltzer & Schroeder: "don't know" must never grant code-push.
    expect(classifyRepo({ candidateOrigin: null, homeOrigin: null })).toBe("foreign");
    expect(classifyRepo({ candidateOrigin: "", homeOrigin: "" })).toBe("foreign");
  });

  it("origin signal wins even when root paths differ (worktree of home)", () => {
    expect(
      classifyRepo({
        candidateOrigin: "git@github.com:fyodoriv/minsky.git",
        homeOrigin: "git@github.com:fyodoriv/minsky.git",
        candidateRoot: "/home/op/apps/tooling/minsky/.claude/worktrees/x",
        homeRoot: "/home/op/apps/tooling/minsky",
      }),
    ).toBe("home");
  });
});

describe("assertWriteAllowed — permission matrix", () => {
  it("home + push → allowed (full flow)", () => {
    const d = assertWriteAllowed({ repoClass: "home", writeKind: "push" });
    expect(d.allowed).toBe(true);
    expect(d.logLine).toContain("ALLOW home push");
  });

  it("home + pr → allowed (no diff-shape restriction on home)", () => {
    const d = assertWriteAllowed({
      repoClass: "home",
      writeKind: "pr",
      diffPaths: ["src/foo.ts", "src/bar.ts"],
    });
    expect(d.allowed).toBe(true);
  });

  it("foreign + push → REFUSED (foreign-push-refused)", () => {
    const d = assertWriteAllowed({ repoClass: "foreign", writeKind: "push" });
    expect(d.allowed).toBe(false);
    if (d.allowed) throw new Error("expected refusal");
    expect(d.reason).toBe("foreign-push-refused");
    expect(d.logLine).toContain("REFUSE foreign push");
  });

  it("foreign + pr touching only TASKS.md → allowed", () => {
    const d = assertWriteAllowed({
      repoClass: "foreign",
      writeKind: "pr",
      diffPaths: ["TASKS.md"],
    });
    expect(d.allowed).toBe(true);
    expect(d.logLine).toContain("TASKS.md-only");
  });

  it("foreign + pr touching a nested TASKS.md → allowed (spec permits subtree files)", () => {
    const d = assertWriteAllowed({
      repoClass: "foreign",
      writeKind: "pr",
      diffPaths: ["TASKS.md", "packages/api/TASKS.md"],
    });
    expect(d.allowed).toBe(true);
  });

  it("foreign + pr touching a code file → REFUSED (foreign-pr-non-taskmd)", () => {
    const d = assertWriteAllowed({
      repoClass: "foreign",
      writeKind: "pr",
      diffPaths: ["TASKS.md", "src/index.ts"],
    });
    expect(d.allowed).toBe(false);
    if (d.allowed) throw new Error("expected refusal");
    expect(d.reason).toBe("foreign-pr-non-taskmd");
    expect(d.logLine).toContain("src/index.ts");
  });

  it("foreign + pr with no diff paths → REFUSED (fail-safe, cannot prove shape)", () => {
    const d = assertWriteAllowed({ repoClass: "foreign", writeKind: "pr" });
    expect(d.allowed).toBe(false);
    if (d.allowed) throw new Error("expected refusal");
    expect(d.reason).toBe("foreign-pr-no-diff");
  });

  it("foreign + pr with empty diff array → REFUSED (same fail-safe path)", () => {
    const d = assertWriteAllowed({
      repoClass: "foreign",
      writeKind: "pr",
      diffPaths: [],
    });
    expect(d.allowed).toBe(false);
    if (d.allowed) throw new Error("expected refusal");
    expect(d.reason).toBe("foreign-pr-no-diff");
  });

  it("a file merely named like TASKS.md but not the basename is refused", () => {
    // `TASKS.md.bak`, `notes/TASKS.markdown` etc. must not slip through.
    const d = assertWriteAllowed({
      repoClass: "foreign",
      writeKind: "pr",
      diffPaths: ["TASKS.md.bak"],
    });
    expect(d.allowed).toBe(false);
    if (d.allowed) throw new Error("expected refusal");
    expect(d.reason).toBe("foreign-pr-non-taskmd");
  });
});
