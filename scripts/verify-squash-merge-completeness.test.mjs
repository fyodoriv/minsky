// @ts-check
import { describe, expect, it } from "vitest";
import { DROP_IGNORE_PATTERNS, findDroppedFiles } from "./verify-squash-merge-completeness.mjs";

describe("findDroppedFiles", () => {
  it("returns ok when the squash commit contains every PR file", () => {
    const result = findDroppedFiles({
      prFiles: ["a.ts", "b.ts"],
      squashFiles: ["a.ts", "b.ts"],
    });
    expect(result.ok).toBe(true);
    expect(result.dropped).toEqual([]);
  });

  it("flags a file in the PR diff that is missing from the squash commit", () => {
    // The exact 2026-05-21 PR #704 regression: .releaserc.json dropped.
    const result = findDroppedFiles({
      prFiles: ["src/foo.ts", ".releaserc.json"],
      squashFiles: ["src/foo.ts"],
    });
    expect(result.ok).toBe(false);
    expect(result.dropped).toEqual([".releaserc.json"]);
  });

  it("reports multiple dropped files sorted", () => {
    const result = findDroppedFiles({
      prFiles: ["z.ts", "a.ts", "m.ts"],
      squashFiles: [],
    });
    expect(result.dropped).toEqual(["a.ts", "m.ts", "z.ts"]);
  });

  it("ignores extra files added by the squash commit", () => {
    const result = findDroppedFiles({
      prFiles: ["a.ts"],
      squashFiles: ["a.ts", "merge-resolution.ts"],
    });
    expect(result.ok).toBe(true);
  });

  it("normalises leading ./ on both sides", () => {
    const result = findDroppedFiles({
      prFiles: ["./a.ts"],
      squashFiles: ["a.ts"],
    });
    expect(result.ok).toBe(true);
  });

  it("normalises surrounding whitespace", () => {
    const result = findDroppedFiles({
      prFiles: ["  a.ts  "],
      squashFiles: ["a.ts"],
    });
    expect(result.ok).toBe(true);
  });

  it("ignores empty path entries on both sides", () => {
    const result = findDroppedFiles({
      prFiles: ["a.ts", "", "   "],
      squashFiles: ["a.ts", ""],
    });
    expect(result.ok).toBe(true);
  });

  it("does not flag lockfiles re-resolved at merge time", () => {
    const result = findDroppedFiles({
      prFiles: ["src/foo.ts", "pnpm-lock.yaml"],
      squashFiles: ["src/foo.ts"],
    });
    expect(result.ok).toBe(true);
  });

  it("does not flag CHANGELOG.md (semantic-release owns it post-merge)", () => {
    const result = findDroppedFiles({
      prFiles: ["src/foo.ts", "CHANGELOG.md"],
      squashFiles: ["src/foo.ts"],
    });
    expect(result.ok).toBe(true);
  });

  it("honours a caller-supplied ignore list", () => {
    const result = findDroppedFiles({
      prFiles: ["a.ts", "b.generated.ts"],
      squashFiles: ["a.ts"],
      ignore: [/\.generated\.ts$/],
    });
    expect(result.ok).toBe(true);
  });

  it("de-duplicates repeated PR paths", () => {
    const result = findDroppedFiles({
      prFiles: ["a.ts", "a.ts"],
      squashFiles: [],
    });
    expect(result.dropped).toEqual(["a.ts"]);
  });
});

describe("DROP_IGNORE_PATTERNS", () => {
  it("matches the lockfiles and changelog that regenerate at merge time", () => {
    /** @param {string} p */
    const matches = (p) => DROP_IGNORE_PATTERNS.some((re) => re.test(p));
    expect(matches("pnpm-lock.yaml")).toBe(true);
    expect(matches("package-lock.json")).toBe(true);
    expect(matches("yarn.lock")).toBe(true);
    expect(matches("CHANGELOG.md")).toBe(true);
    expect(matches(".releaserc.json")).toBe(false);
  });
});
