import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { repoFromArgv } from "./repo-arg.mjs";

describe("repoFromArgv", () => {
  test("returns the fallback when the flag is absent", () => {
    expect(repoFromArgv(["--input", "x"], "/fallback")).toBe("/fallback");
  });

  test("reads --repo=<path>", () => {
    expect(repoFromArgv(["--repo=/a/b"], "/fallback")).toBe("/a/b");
  });

  test("reads --repo <path>", () => {
    expect(repoFromArgv(["--repo", "/a/b"], "/fallback")).toBe("/a/b");
  });

  test("resolves a relative path against the cwd", () => {
    expect(repoFromArgv(["--repo=sub"], "/fallback")).toBe(resolve("sub"));
  });

  test("ignores a trailing --repo with no value", () => {
    expect(repoFromArgv(["--repo"], "/fallback")).toBe("/fallback");
  });
});
