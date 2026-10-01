// @ts-check
import { describe, expect, it } from "vitest";
import {
  checkDeprecatedMdRespect,
  parseDeprecatedIdentifiers,
} from "./check-deprecated-md-respect.mjs";

describe("parseDeprecatedIdentifiers", () => {
  it("extracts inline-code identifiers from H3 headings", () => {
    const md = [
      "# Deprecated",
      "## Top",
      "### 1. `MINSKY_SCOPE_LEAK_MODE=hard` (something)",
      "### 2. `scripts/observer-watch.sh` + plist",
      "### 3. `pnpm dogfood` / `pnpm dogfood:ui`",
      "## Other",
    ].join("\n");
    const ids = parseDeprecatedIdentifiers(md);
    expect(ids).toContain("MINSKY_SCOPE_LEAK_MODE=hard");
    expect(ids).toContain("scripts/observer-watch.sh");
    expect(ids).toContain("pnpm dogfood");
    expect(ids).toContain("pnpm dogfood:ui");
  });

  it("returns empty on empty input", () => {
    expect(parseDeprecatedIdentifiers("")).toEqual([]);
  });

  it("ignores inline code inside non-H3 sections", () => {
    const md = [
      "# Title",
      "Use `bin/minsky` not the old way.",
      "## Body",
      "Some content with `inline-code` here.",
    ].join("\n");
    expect(parseDeprecatedIdentifiers(md)).toEqual([]);
  });
});

describe("checkDeprecatedMdRespect", () => {
  it("passes when no file in diff adds a new reference", () => {
    const result = checkDeprecatedMdRespect({
      repoRoot: "/repo",
      diffBase: "origin/main",
      deprecatedMdContent: "### 1. `OLD_VAR` deprecated",
      changedFiles: ["src/foo.ts"],
      readCurrent: () => "no references here",
      readAtRef: () => "no references here",
    });
    expect(result.ok).toBe(true);
  });

  it("flags a file that gained a NEW reference to a deprecated id", () => {
    const result = checkDeprecatedMdRespect({
      repoRoot: "/repo",
      diffBase: "origin/main",
      deprecatedMdContent: "### 1. `OLD_VAR` deprecated",
      changedFiles: ["src/foo.ts"],
      readCurrent: () => "uses OLD_VAR here",
      readAtRef: () => "",
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/OLD_VAR/);
    expect(result.violations[0]).toMatch(/current 1 > baseline 0/);
  });

  it("passes when reference count is unchanged (existing usage)", () => {
    const result = checkDeprecatedMdRespect({
      repoRoot: "/repo",
      diffBase: "origin/main",
      deprecatedMdContent: "### 1. `OLD_VAR` deprecated",
      changedFiles: ["src/foo.ts"],
      readCurrent: () => "uses OLD_VAR — needed for compatibility",
      readAtRef: () => "uses OLD_VAR — needed for compatibility",
    });
    expect(result.ok).toBe(true);
  });

  it("flags when reference count INCREASES (e.g. 1 -> 2)", () => {
    const result = checkDeprecatedMdRespect({
      repoRoot: "/repo",
      diffBase: "origin/main",
      deprecatedMdContent: "### 1. `OLD_VAR` deprecated",
      changedFiles: ["src/foo.ts"],
      readCurrent: () => "uses OLD_VAR — uses OLD_VAR again",
      readAtRef: () => "uses OLD_VAR — needed for compatibility",
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/current 2 > baseline 1/);
  });

  it("passes when reference count DECREASES (removing usage)", () => {
    const result = checkDeprecatedMdRespect({
      repoRoot: "/repo",
      diffBase: "origin/main",
      deprecatedMdContent: "### 1. `OLD_VAR` deprecated",
      changedFiles: ["src/foo.ts"],
      readCurrent: () => "compatibility",
      readAtRef: () => "uses OLD_VAR",
    });
    expect(result.ok).toBe(true);
  });

  it("ignores allowlisted files (DEPRECATED.md, AGENTS.md, ...)", () => {
    const result = checkDeprecatedMdRespect({
      repoRoot: "/repo",
      diffBase: "origin/main",
      deprecatedMdContent: "### 1. `OLD_VAR` deprecated",
      changedFiles: ["docs/DEPRECATED.md", "AGENTS.md", "CHANGELOG.md"],
      readCurrent: () => "uses OLD_VAR many many many times OLD_VAR OLD_VAR",
      readAtRef: () => "",
    });
    expect(result.ok).toBe(true);
  });

  it("reports a violation per file (multi-file diff)", () => {
    const result = checkDeprecatedMdRespect({
      repoRoot: "/repo",
      diffBase: "origin/main",
      deprecatedMdContent: "### 1. `OLD_VAR` deprecated",
      changedFiles: ["src/a.ts", "src/b.ts"],
      readCurrent: () => "uses OLD_VAR",
      readAtRef: () => "",
    });
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBe(2);
  });

  it("real production scan (smoke — current branch should be clean)", () => {
    const result = checkDeprecatedMdRespect();
    expect(result.ok).toBe(true);
  });
});
