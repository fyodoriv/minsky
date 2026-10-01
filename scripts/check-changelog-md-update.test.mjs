// @ts-check
import { describe, expect, it } from "vitest";
import { checkChangelogMdUpdate } from "./check-changelog-md-update.mjs";

describe("checkChangelogMdUpdate", () => {
  it("passes when no code files changed", () => {
    const result = checkChangelogMdUpdate({
      changedFiles: ["docs/foo.md", "TASKS.md"],
      prBody: "",
      commitMessages: [],
    });
    expect(result.ok).toBe(true);
  });

  it("passes when code changed AND CHANGELOG.md updated", () => {
    const result = checkChangelogMdUpdate({
      changedFiles: ["novel/foo/src/bar.ts", "CHANGELOG.md"],
      prBody: "",
      commitMessages: ["raw commit msg with no conventional prefix"],
    });
    expect(result.ok).toBe(true);
  });

  it("passes when code changed AND a feat: commit subject exists", () => {
    const result = checkChangelogMdUpdate({
      changedFiles: ["novel/foo/src/bar.ts"],
      prBody: "",
      commitMessages: ["feat(foo): add bar"],
    });
    expect(result.ok).toBe(true);
  });

  it("passes when code changed AND a fix: commit subject exists", () => {
    const result = checkChangelogMdUpdate({
      changedFiles: ["novel/foo/src/bar.ts"],
      prBody: "",
      commitMessages: ["fix(foo): bar was broken"],
    });
    expect(result.ok).toBe(true);
  });

  it("passes when code changed AND a chore: commit subject exists", () => {
    const result = checkChangelogMdUpdate({
      changedFiles: ["novel/foo/src/bar.ts"],
      prBody: "",
      commitMessages: ["chore(foo): refactor bar"],
    });
    expect(result.ok).toBe(true);
  });

  it("passes when code changed AND a BREAKING CHANGE footer is present", () => {
    const result = checkChangelogMdUpdate({
      changedFiles: ["novel/foo/src/bar.ts"],
      prBody: "",
      commitMessages: ["update X\n\nBREAKING CHANGE: removed Y"],
    });
    expect(result.ok).toBe(true);
  });

  it("fails when code changed but no conventional-commit + no CHANGELOG", () => {
    const result = checkChangelogMdUpdate({
      changedFiles: ["novel/foo/src/bar.ts"],
      prBody: "",
      commitMessages: ["update stuff", "more stuff"],
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/code file/);
  });

  it("respects no-changelog opt-out in PR body", () => {
    const result = checkChangelogMdUpdate({
      changedFiles: ["novel/foo/src/bar.ts"],
      prBody: "<!-- no-changelog: docs-only refactor of comments -->",
      commitMessages: [],
    });
    expect(result.ok).toBe(true);
  });

  it("excludes .test.ts files from code-change set", () => {
    const result = checkChangelogMdUpdate({
      changedFiles: ["novel/foo/src/bar.test.ts"],
      prBody: "",
      commitMessages: [],
    });
    expect(result.ok).toBe(true);
  });

  it("excludes dist/ files", () => {
    const result = checkChangelogMdUpdate({
      changedFiles: ["novel/foo/dist/index.js"],
      prBody: "",
      commitMessages: [],
    });
    expect(result.ok).toBe(true);
  });

  it("treats scripts/ as code", () => {
    const result = checkChangelogMdUpdate({
      changedFiles: ["scripts/check-foo.mjs"],
      prBody: "",
      commitMessages: ["update stuff"],
    });
    expect(result.ok).toBe(false);
  });

  it("treats bin/ as code", () => {
    const result = checkChangelogMdUpdate({
      changedFiles: ["bin/minsky"],
      prBody: "",
      commitMessages: ["update"],
    });
    expect(result.ok).toBe(false);
  });

  it("treats distribution/*.sh as code", () => {
    const result = checkChangelogMdUpdate({
      changedFiles: ["distribution/systemd/run-daemon.sh"],
      prBody: "",
      commitMessages: ["update"],
    });
    expect(result.ok).toBe(false);
  });

  it("treats CI workflows as code", () => {
    const result = checkChangelogMdUpdate({
      changedFiles: [".github/workflows/ci.yml"],
      prBody: "",
      commitMessages: ["update"],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects empty/short opt-out", () => {
    const result = checkChangelogMdUpdate({
      changedFiles: ["novel/foo/src/bar.ts"],
      prBody: "<!-- no-changelog:  -->",
      commitMessages: [],
    });
    expect(result.ok).toBe(false);
  });
});
