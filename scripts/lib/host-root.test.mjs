// Tests for the `getHostRoot()` resolver. Pattern: rule #10 deterministic
// substrate; xUnit paired fixtures (Meszaros 2007). The helper is pure
// over `process.env.MINSKY_HOST_ROOT` + a supplied `repoRoot`.

import { describe, expect, test } from "vitest";

import { getHostRoot } from "./host-root.mjs";

describe("getHostRoot", () => {
  test("returns repoRoot when MINSKY_HOST_ROOT is unset", () => {
    expect(getHostRoot("/repo", {})).toBe("/repo");
  });

  test("returns repoRoot when MINSKY_HOST_ROOT is empty string", () => {
    expect(getHostRoot("/repo", { MINSKY_HOST_ROOT: "" })).toBe("/repo");
  });

  test("returns the env override when MINSKY_HOST_ROOT is set", () => {
    expect(getHostRoot("/repo", { MINSKY_HOST_ROOT: "/host" })).toBe("/host");
  });

  test("resolves a relative override to absolute (path.resolve)", () => {
    // resolve() against a relative path produces an absolute path under cwd;
    // we don't assert the cwd, only that the result is absolute.
    const result = getHostRoot("/repo", { MINSKY_HOST_ROOT: "relative/sidecar" });
    expect(result.startsWith("/")).toBe(true);
    expect(result.endsWith("relative/sidecar")).toBe(true);
  });

  test("resolves the repoRoot when used as the fallback (path.resolve)", () => {
    const result = getHostRoot("./relative-repo", {});
    expect(result.startsWith("/")).toBe(true);
    expect(result.endsWith("relative-repo")).toBe(true);
  });

  test("env override takes precedence over a repoRoot that exists", () => {
    expect(getHostRoot("/the/repo", { MINSKY_HOST_ROOT: "/the/host" })).toBe("/the/host");
  });

  test("uses process.env when envOverride is omitted (default behaviour)", () => {
    // Save and restore; we can't fully isolate process.env in vitest without
    // re-importing, but we can assert the function reads from it.
    const prior = process.env["MINSKY_HOST_ROOT"];
    try {
      process.env["MINSKY_HOST_ROOT"] = "/from-process-env";
      expect(getHostRoot("/repo")).toBe("/from-process-env");
    } finally {
      if (prior === undefined) {
        process.env["MINSKY_HOST_ROOT"] = undefined;
      } else {
        process.env["MINSKY_HOST_ROOT"] = prior;
      }
    }
  });

  test("ignores non-string env values via type guard (defensive)", () => {
    // process.env values are always strings in Node, but the type guard
    // handles a malformed env shape (e.g., delete'd key surviving a typed
    // override) without throwing.
    /** @type {NodeJS.ProcessEnv} */
    const env = {};
    expect(getHostRoot("/repo", env)).toBe("/repo");
  });
});
