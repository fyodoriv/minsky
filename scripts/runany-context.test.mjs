// Tests for runany-context.mjs. Pure decision core (rule #10 — no I/O in the
// decision); these pin the 5 folder-type fixtures from the
// `runany-zero-arg-entrypoint` Success criterion (git repo, nested-repos
// tree, plain dir, monorepo, detached worktree) plus the `--host` /
// `--hosts-dir` argv mapping and the rule-6 degraded-default of the I/O edges.
// No @ts-check (matches sibling scripts/*.test.mjs convention).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultIsGitRepo,
  defaultListEntries,
  resolveRunanyContext,
  selectLaunchArgs,
} from "./runany-context.mjs";

/**
 * Build injected seams from a flat map of `{ dirPath: { isRepo, children } }`.
 * Keeps each fixture declarative — the test reads as a table of folder shapes.
 *
 * @param {Record<string, { isRepo?: boolean, children?: string[] }>} spec
 * @returns {{ listEntries: (dir: string) => string[], isGitRepo: (dir: string) => boolean }}
 */
function seams(spec) {
  return {
    listEntries: (/** @type {string} */ dir) => spec[dir]?.children ?? [],
    isGitRepo: (/** @type {string} */ dir) => spec[dir]?.isRepo === true,
  };
}

describe("resolveRunanyContext — 5 folder types (Success criterion)", () => {
  it("git repo cwd => single-host, scope to itself", () => {
    const ctx = resolveRunanyContext({
      cwd: "/work/myrepo",
      ...seams({ "/work/myrepo": { isRepo: true } }),
    });
    expect(ctx.kind).toBe("git-repo");
    expect(ctx.scope).toBe("single-host");
    expect(ctx.repos).toEqual(["/work/myrepo"]);
    expect(ctx.contextRoot).toBe("/work/myrepo");
  });

  it("nested-repos tree => multi-host, scope to the whole tree", () => {
    const ctx = resolveRunanyContext({
      cwd: "/work/projects",
      ...seams({
        "/work/projects": { isRepo: false, children: ["a", "b", "notes"] },
        "/work/projects/a": { isRepo: true },
        "/work/projects/b": { isRepo: true },
        "/work/projects/notes": { isRepo: false },
      }),
    });
    expect(ctx.kind).toBe("nested-repos");
    expect(ctx.scope).toBe("multi-host");
    expect(ctx.repos).toEqual(["/work/projects/a", "/work/projects/b"]);
  });

  it("plain dir (no repo, no nested repos) => single-host degenerate", () => {
    const ctx = resolveRunanyContext({
      cwd: "/work/empty",
      ...seams({
        "/work/empty": { isRepo: false, children: ["docs"] },
        "/work/empty/docs": { isRepo: false },
      }),
    });
    expect(ctx.kind).toBe("plain-dir");
    expect(ctx.scope).toBe("single-host");
    expect(ctx.repos).toEqual([]);
  });

  it("monorepo (cwd is a repo that also contains nested repos) => single-host, NOT multi (Pivot: scope to cwd repo only)", () => {
    const ctx = resolveRunanyContext({
      cwd: "/work/mono",
      ...seams({
        "/work/mono": { isRepo: true, children: ["packages"] },
        "/work/mono/packages": { isRepo: true },
      }),
    });
    expect(ctx.kind).toBe("git-repo");
    expect(ctx.scope).toBe("single-host");
    expect(ctx.repos).toEqual(["/work/mono"]);
  });

  it("detached worktree (cwd has a .git *file*, isGitRepo true) => single-host", () => {
    // The worktree-folder type: defaultIsGitRepo treats a .git file as a repo,
    // so the injected seam returns isRepo:true here too.
    const ctx = resolveRunanyContext({
      cwd: "/work/wt/feature",
      ...seams({ "/work/wt/feature": { isRepo: true } }),
    });
    expect(ctx.kind).toBe("git-repo");
    expect(ctx.scope).toBe("single-host");
    expect(ctx.repos).toEqual(["/work/wt/feature"]);
  });
});

describe("resolveRunanyContext — determinism + edge cases", () => {
  it("nested repos are sorted (stable operator-visible ordering)", () => {
    const ctx = resolveRunanyContext({
      cwd: "/t",
      ...seams({
        "/t": { isRepo: false, children: ["zeta", "alpha", "mid"] },
        "/t/zeta": { isRepo: true },
        "/t/alpha": { isRepo: true },
        "/t/mid": { isRepo: true },
      }),
    });
    expect(ctx.repos).toEqual(["/t/alpha", "/t/mid", "/t/zeta"]);
  });

  it("relative cwd is resolved to absolute", () => {
    const ctx = resolveRunanyContext({
      cwd: ".",
      listEntries: () => [],
      isGitRepo: () => false,
    });
    expect(ctx.contextRoot.startsWith("/")).toBe(true);
  });

  it("same input => same output (pure)", () => {
    const opts = { cwd: "/x", ...seams({ "/x": { isRepo: true } }) };
    expect(resolveRunanyContext(opts)).toEqual(resolveRunanyContext(opts));
  });
});

describe("selectLaunchArgs — argv mapping", () => {
  it("single-host => --host <root>", () => {
    expect(
      selectLaunchArgs({
        contextRoot: "/a",
        kind: "git-repo",
        repos: ["/a"],
        scope: "single-host",
      }),
    ).toEqual(["--host", "/a"]);
  });
  it("multi-host => --hosts-dir <root>", () => {
    expect(
      selectLaunchArgs({
        contextRoot: "/a",
        kind: "nested-repos",
        repos: ["/a/x"],
        scope: "multi-host",
      }),
    ).toEqual(["--hosts-dir", "/a"]);
  });
  it("plain-dir => --host (degenerate single host)", () => {
    expect(
      selectLaunchArgs({ contextRoot: "/a", kind: "plain-dir", repos: [], scope: "single-host" }),
    ).toEqual(["--host", "/a"]);
  });
});

describe("I/O edges (real filesystem, rule-6 degraded defaults)", () => {
  /** @type {string} */
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "runany-ctx-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaultIsGitRepo: true for a .git directory", () => {
    mkdirSync(join(dir, ".git"));
    expect(defaultIsGitRepo(dir)).toBe(true);
  });

  it("defaultIsGitRepo: true for a .git file (worktree checkout)", () => {
    writeFileSync(join(dir, ".git"), "gitdir: /elsewhere\n");
    expect(defaultIsGitRepo(dir)).toBe(true);
  });

  it("defaultIsGitRepo: false for a plain dir", () => {
    expect(defaultIsGitRepo(dir)).toBe(false);
  });

  it("defaultIsGitRepo: false (not a crash) for a missing dir", () => {
    expect(defaultIsGitRepo(join(dir, "does-not-exist"))).toBe(false);
  });

  it("defaultListEntries: lists child dirs, hides dotfiles", () => {
    mkdirSync(join(dir, "a"));
    mkdirSync(join(dir, "b"));
    mkdirSync(join(dir, ".hidden"));
    writeFileSync(join(dir, "file.txt"), "x");
    expect([...defaultListEntries(dir)].sort()).toEqual(["a", "b"]);
  });

  it("defaultListEntries: [] (not a crash) for a missing dir", () => {
    expect(defaultListEntries(join(dir, "nope"))).toEqual([]);
  });

  it("end-to-end against a real nested-repos tree => multi-host", () => {
    mkdirSync(join(dir, "repo1", ".git"), { recursive: true });
    mkdirSync(join(dir, "repo2", ".git"), { recursive: true });
    mkdirSync(join(dir, "plain"));
    const ctx = resolveRunanyContext({ cwd: dir });
    expect(ctx.kind).toBe("nested-repos");
    expect(ctx.scope).toBe("multi-host");
    expect(ctx.repos).toEqual([join(dir, "repo1"), join(dir, "repo2")]);
  });
});
