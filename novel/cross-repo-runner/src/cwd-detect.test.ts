// Paired tests for `cwd-detect.ts`.
//
// Source: TASKS.md `minsky-run-autonomous-defaults-and-multi-host`; rule #3.

import { describe, expect, test } from "vitest";

import type { CwdFsProbe } from "./cwd-detect.js";

import {
  detectAnyCwd,
  detectConductorRoot,
  detectCwd,
  findBootstrappedSubdirs,
  findGitRootSubdirs,
  resolveConductorRoot,
} from "./cwd-detect.js";

function fakeFs(
  entries: { [path: string]: "exists" | "missing" },
  children: { [path: string]: readonly string[] } = {},
): CwdFsProbe {
  return {
    exists: (path) => entries[path] === "exists",
    listDir: (path) => children[path] ?? [],
  };
}

describe("detectCwd — single-host signal", () => {
  test("returns single-host when cwd has .minsky/repo.yaml", () => {
    const result = detectCwd({
      cwd: "/tmp/host",
      fs: fakeFs({ "/tmp/host/.minsky/repo.yaml": "exists" }),
    });
    expect(result.kind).toBe("single-host");
    if (result.kind === "single-host") expect(result.host).toBe("/tmp/host");
  });

  test("single-host wins when cwd is BOTH bootstrapped AND has bootstrapped subdirs", () => {
    const result = detectCwd({
      cwd: "/tmp/parent",
      fs: fakeFs(
        {
          "/tmp/parent/.minsky/repo.yaml": "exists",
          "/tmp/parent/child-a/.minsky/repo.yaml": "exists",
          "/tmp/parent/child-b/.minsky/repo.yaml": "exists",
        },
        { "/tmp/parent": ["child-a", "child-b"] },
      ),
    });
    expect(result.kind).toBe("single-host");
  });
});

describe("detectCwd — multi-host signal", () => {
  test("returns multi-host when cwd has bootstrapped subdirs", () => {
    const result = detectCwd({
      cwd: "/tmp/parent",
      fs: fakeFs(
        {
          "/tmp/parent/child-a/.minsky/repo.yaml": "exists",
          "/tmp/parent/child-b/.minsky/repo.yaml": "exists",
        },
        { "/tmp/parent": ["child-a", "child-b", "child-c-unbootstrapped"] },
      ),
    });
    expect(result.kind).toBe("multi-host");
    if (result.kind === "multi-host") {
      expect(result.hostsDir).toBe("/tmp/parent");
      expect(result.hostCount).toBe(2);
    }
  });

  test("ignores subdirs without .minsky/repo.yaml in the multi-host count", () => {
    const result = detectCwd({
      cwd: "/tmp/parent",
      fs: fakeFs(
        { "/tmp/parent/only-bootstrapped/.minsky/repo.yaml": "exists" },
        { "/tmp/parent": ["only-bootstrapped", "unboostrapped-a", "unbootstrapped-b"] },
      ),
    });
    expect(result.kind).toBe("multi-host");
    if (result.kind === "multi-host") expect(result.hostCount).toBe(1);
  });
});

describe("detectCwd — error signal", () => {
  test("returns error when cwd is bare AND has no bootstrapped subdirs", () => {
    const result = detectCwd({
      cwd: "/tmp/bare",
      fs: fakeFs({}, { "/tmp/bare": ["random-file.txt"] }),
    });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.hint).toContain("minsky-bootstrap");
      expect(result.hint).toContain("--host");
      expect(result.hint).toContain("--hosts-dir");
    }
  });

  test("error hint mentions the actual cwd path", () => {
    const result = detectCwd({
      cwd: "/path/with/cwd-name",
      fs: fakeFs({}),
    });
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.hint).toContain("/path/with/cwd-name");
  });
});

describe("findBootstrappedSubdirs", () => {
  test("returns sorted list of subdir absolute paths", () => {
    const subdirs = findBootstrappedSubdirs({
      cwd: "/tmp/parent",
      fs: fakeFs(
        {
          "/tmp/parent/host-a/.minsky/repo.yaml": "exists",
          "/tmp/parent/host-b/.minsky/repo.yaml": "exists",
        },
        { "/tmp/parent": ["host-a", "host-b"] },
      ),
    });
    expect(subdirs).toEqual(["/tmp/parent/host-a", "/tmp/parent/host-b"]);
  });

  test("returns empty list when no subdir is bootstrapped", () => {
    const subdirs = findBootstrappedSubdirs({
      cwd: "/tmp/parent",
      fs: fakeFs({}, { "/tmp/parent": ["unbootstrapped-a", "unbootstrapped-b"] }),
    });
    expect(subdirs).toEqual([]);
  });

  test("handles trailing-slash cwd correctly", () => {
    const subdirs = findBootstrappedSubdirs({
      cwd: "/tmp/parent/",
      fs: fakeFs(
        { "/tmp/parent/child/.minsky/repo.yaml": "exists" },
        { "/tmp/parent/": ["child"] },
      ),
    });
    expect(subdirs).toEqual(["/tmp/parent/child"]);
  });
});

describe("detectAnyCwd — zero-arg precedence chain", () => {
  test("returns single-host for a git root when not bootstrapped", () => {
    const result = detectAnyCwd({
      cwd: "/tmp/git-repo",
      fs: fakeFs({ "/tmp/git-repo/.git": "exists" }, { "/tmp/git-repo": [] }),
    });
    expect(result.kind).toBe("single-host");
    if (result.kind === "single-host") expect(result.host).toBe("/tmp/git-repo");
  });

  test("bootstrapped wins over git-root when both present", () => {
    const result = detectAnyCwd({
      cwd: "/tmp/host",
      fs: fakeFs({
        "/tmp/host/.minsky/repo.yaml": "exists",
        "/tmp/host/.git": "exists",
      }),
    });
    expect(result.kind).toBe("single-host");
    if (result.kind === "single-host") expect(result.host).toBe("/tmp/host");
  });

  test("returns multi-host when cwd has git-root subdirs but no bootstrap", () => {
    const result = detectAnyCwd({
      cwd: "/tmp/parent",
      fs: fakeFs(
        { "/tmp/parent/repo-a/.git": "exists", "/tmp/parent/repo-b/.git": "exists" },
        { "/tmp/parent": ["repo-a", "repo-b", "not-a-repo"] },
      ),
    });
    expect(result.kind).toBe("multi-host");
    if (result.kind === "multi-host") {
      expect(result.hostsDir).toBe("/tmp/parent");
      expect(result.hostCount).toBe(2);
    }
  });

  test("returns single-host for a plain dir (no git, no bootstrap) — run-anywhere fallback", () => {
    const result = detectAnyCwd({
      cwd: "/tmp/plain",
      fs: fakeFs({}, { "/tmp/plain": ["some-file.txt"] }),
    });
    expect(result.kind).toBe("single-host");
    if (result.kind === "single-host") expect(result.host).toBe("/tmp/plain");
  });

  test("worktree: .git file (not dir) is detected as git root", () => {
    // In a detached worktree, .git is a file not a directory.
    // The `exists` probe returns true for both files and dirs.
    const result = detectAnyCwd({
      cwd: "/tmp/worktree",
      fs: fakeFs({ "/tmp/worktree/.git": "exists" }, { "/tmp/worktree": [".git"] }),
    });
    expect(result.kind).toBe("single-host");
    if (result.kind === "single-host") expect(result.host).toBe("/tmp/worktree");
  });
});

describe("findGitRootSubdirs", () => {
  test("returns subdirs that have .git", () => {
    const subdirs = findGitRootSubdirs({
      cwd: "/tmp/parent",
      fs: fakeFs(
        { "/tmp/parent/repo-a/.git": "exists", "/tmp/parent/repo-b/.git": "exists" },
        { "/tmp/parent": ["repo-a", "repo-b", "not-a-repo"] },
      ),
    });
    expect(subdirs).toEqual(["/tmp/parent/repo-a", "/tmp/parent/repo-b"]);
  });

  test("returns empty list when no subdir has .git", () => {
    const subdirs = findGitRootSubdirs({
      cwd: "/tmp/parent",
      fs: fakeFs({}, { "/tmp/parent": ["files", "docs"] }),
    });
    expect(subdirs).toEqual([]);
  });
});

describe("resolveConductorRoot — collapse detect result to one root", () => {
  test("single-host → the host path", () => {
    expect(resolveConductorRoot({ kind: "single-host", host: "/repo" }, "/fallback")).toBe("/repo");
  });

  test("multi-host → the parent hostsDir (conductor sweeps the tree)", () => {
    expect(
      resolveConductorRoot({ kind: "multi-host", hostsDir: "/parent", hostCount: 3 }, "/fallback"),
    ).toBe("/parent");
  });

  test("error arm → the supplied fallback cwd (degenerate, unreachable via detectAnyCwd)", () => {
    expect(resolveConductorRoot({ kind: "error", hint: "nope" }, "/fallback")).toBe("/fallback");
  });
});

describe("detectConductorRoot — single source of truth for zero-arg root", () => {
  test("bootstrapped cwd → cwd (bootstrapped wins over git-root)", () => {
    expect(
      detectConductorRoot({
        cwd: "/repo",
        fs: fakeFs({ "/repo/.minsky/repo.yaml": "exists", "/repo/.git": "exists" }),
      }),
    ).toBe("/repo");
  });

  test("git repo (no bootstrap) → cwd", () => {
    expect(
      detectConductorRoot({
        cwd: "/gitrepo",
        fs: fakeFs({ "/gitrepo/.git": "exists" }),
      }),
    ).toBe("/gitrepo");
  });

  test("nested-repos tree → the parent dir (multi-host root)", () => {
    expect(
      detectConductorRoot({
        cwd: "/tree",
        fs: fakeFs({ "/tree/a/.git": "exists", "/tree/b/.git": "exists" }, { "/tree": ["a", "b"] }),
      }),
    ).toBe("/tree");
  });

  test("plain dir (no git, no bootstrap) → cwd itself", () => {
    expect(detectConductorRoot({ cwd: "/plain", fs: fakeFs({}, { "/plain": ["docs"] }) })).toBe(
      "/plain",
    );
  });

  test("detached worktree (.git is a file) → cwd", () => {
    expect(
      detectConductorRoot({
        cwd: "/wt",
        fs: fakeFs({ "/wt/.git": "exists" }),
      }),
    ).toBe("/wt");
  });
});
