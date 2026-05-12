// Paired tests for `cwd-detect.ts`.
//
// Source: TASKS.md `minsky-run-autonomous-defaults-and-multi-host`; rule #3.

import { describe, expect, test } from "vitest";

import type { CwdFsProbe } from "./cwd-detect.js";

import { detectCwd, findBootstrappedSubdirs } from "./cwd-detect.js";

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
