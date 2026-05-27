// @ts-check
import { describe, expect, it } from "vitest";
import { checkNoNoVerifyBypass } from "./check-no-no-verify-bypass.mjs";

/**
 * @param {Record<string, string>} fileContents
 */
function fakeFs(fileContents) {
  return {
    repoRoot: "/repo",
    files: Object.keys(fileContents),
    readText: (/** @type {string} */ p) => fileContents[p.slice(6)] ?? "",
  };
}

describe("checkNoNoVerifyBypass", () => {
  it("flags `git commit --no-verify`", () => {
    const result = checkNoNoVerifyBypass(
      fakeFs({ "scripts/foo.mjs": 'execSync("git commit --no-verify -m hi");' }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/--no-verify/);
  });

  it("flags `git commit -n`", () => {
    const result = checkNoNoVerifyBypass(
      fakeFs({ "scripts/foo.mjs": 'execSync("git commit -n -m bypass");' }),
    );
    expect(result.ok).toBe(false);
  });

  it("flags `git push --no-verify`", () => {
    const result = checkNoNoVerifyBypass(
      fakeFs({ "bin/foo.sh": "git push --no-verify origin main" }),
    );
    expect(result.ok).toBe(false);
  });

  it("flags `git -c core.hooksPath=`", () => {
    const result = checkNoNoVerifyBypass(
      fakeFs({ "scripts/foo.mjs": 'execSync("git -c core.hooksPath=/dev/null commit");' }),
    );
    expect(result.ok).toBe(false);
  });

  it("passes normal git commit", () => {
    const result = checkNoNoVerifyBypass(
      fakeFs({ "scripts/foo.mjs": 'execSync("git commit -m foo");' }),
    );
    expect(result.ok).toBe(true);
  });

  it("skips comment lines", () => {
    const result = checkNoNoVerifyBypass(
      fakeFs({
        "scripts/foo.mjs": "// do not use git commit --no-verify\n// (it bypasses lefthook)",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("respects inline allow marker", () => {
    const result = checkNoNoVerifyBypass(
      fakeFs({
        "scripts/foo.mjs":
          'execSync("git commit --no-verify"); // no-verify-ok: emergency hotfix in firefighting drill, reverted same session',
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("ignores allowlisted files (AGENTS.md, vision.md)", () => {
    const result = checkNoNoVerifyBypass(
      fakeFs({
        "AGENTS.md": "Never use `git commit --no-verify` — it bypasses lefthook.",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("real production scan passes (smoke)", () => {
    const result = checkNoNoVerifyBypass();
    expect(result.ok).toBe(true);
  });
});
