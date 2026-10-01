// @ts-check
import { describe, expect, it } from "vitest";
import { CARDINAL_CASING, checkFilenameCasing } from "./check-filename-casing.mjs";

/**
 * @param {{ root?: string[], docs?: string[] }} files
 */
function fakeFs(files) {
  return {
    repoRoot: "/repo",
    readDir: (/** @type {string} */ p) => {
      if (p === "/repo") return files.root ?? [];
      if (p === "/repo/docs") return files.docs ?? [];
      return [];
    },
  };
}

describe("checkFilenameCasing", () => {
  it("passes on the canonical set", () => {
    const result = checkFilenameCasing(
      fakeFs({
        root: Object.values(CARDINAL_CASING).concat([
          "docs",
          "src",
          "package.json",
          "node_modules",
        ]),
        docs: ["installer-design.md", "auto-merge.md"],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("flags Vision.md (cardinal wrong-case)", () => {
    const result = checkFilenameCasing(fakeFs({ root: ["Vision.md"] }));
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/Vision\.md.*expected "vision\.md"/);
  });

  it("flags tasks.md (should be TASKS.md)", () => {
    const result = checkFilenameCasing(fakeFs({ root: ["tasks.md"] }));
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/tasks\.md.*expected "TASKS\.md"/);
  });

  it("flags Agents.md (should be AGENTS.md)", () => {
    const result = checkFilenameCasing(fakeFs({ root: ["Agents.md"] }));
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/expected "AGENTS\.md"/);
  });

  it("flags Research.md (should be research.md — lowercase)", () => {
    const result = checkFilenameCasing(fakeFs({ root: ["Research.md"] }));
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/expected "research\.md"/);
  });

  it("flags non-cardinal root *.md with uppercase letters", () => {
    const result = checkFilenameCasing(fakeFs({ root: ["MyDoc.md"] }));
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/kebab-case-lowercase/);
  });

  it("flags non-cardinal root *.md with underscores", () => {
    const result = checkFilenameCasing(fakeFs({ root: ["my_doc.md"] }));
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/kebab-case-lowercase/);
  });

  it("passes kebab-case non-cardinal *.md", () => {
    const result = checkFilenameCasing(fakeFs({ root: ["error-budgets.md", "claim-protocol.md"] }));
    expect(result.ok).toBe(true);
  });

  it("ignores non-md files at root", () => {
    const result = checkFilenameCasing(
      fakeFs({ root: ["package.json", "tsconfig.json", "PackageJSON.exe"] }),
    );
    expect(result.ok).toBe(true);
  });

  it("does not enforce kebab-case in docs/ (only at repo root for the catch-all)", () => {
    const result = checkFilenameCasing(fakeFs({ docs: ["NotKebab.md"] }));
    expect(result.ok).toBe(true);
  });

  it("flags multiple violations", () => {
    const result = checkFilenameCasing(fakeFs({ root: ["Vision.md", "tasks.md", "MyDoc.md"] }));
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBe(3);
  });

  it("skips .DS_Store", () => {
    const result = checkFilenameCasing(fakeFs({ root: [".DS_Store"] }));
    expect(result.ok).toBe(true);
  });

  it("real repo passes (smoke)", () => {
    expect(checkFilenameCasing().ok).toBe(true);
  });
});
