// @ts-check
import { describe, expect, it } from "vitest";
import { checkResearchMdUpdate } from "./check-research-md-update.mjs";

const BASE_PKG = JSON.stringify({
  name: "x",
  dependencies: { foo: "^1.0.0" },
});

describe("checkResearchMdUpdate", () => {
  it("passes when no package.json changes", () => {
    const result = checkResearchMdUpdate({
      changedFiles: ["src/foo.ts"],
      readCurrent: () => "",
      readAtRef: () => "",
      prBody: "",
    });
    expect(result.ok).toBe(true);
  });

  it("passes on version bumps (key set unchanged)", () => {
    const result = checkResearchMdUpdate({
      changedFiles: ["package.json"],
      readCurrent: () => JSON.stringify({ dependencies: { foo: "^1.5.0" } }),
      readAtRef: () => JSON.stringify({ dependencies: { foo: "^1.0.0" } }),
      prBody: "",
    });
    expect(result.ok).toBe(true);
  });

  it("fails when a new dependency is added without research.md update", () => {
    const result = checkResearchMdUpdate({
      changedFiles: ["package.json"],
      readCurrent: () => JSON.stringify({ dependencies: { foo: "^1.0.0", bar: "^2.0.0" } }),
      readAtRef: () => BASE_PKG,
      prBody: "",
    });
    expect(result.ok).toBe(false);
    expect(result.depsChanged).toContain("package.json: +bar");
  });

  it("fails when a dependency is removed without research.md update", () => {
    const result = checkResearchMdUpdate({
      changedFiles: ["package.json"],
      readCurrent: () => JSON.stringify({ dependencies: {} }),
      readAtRef: () => BASE_PKG,
      prBody: "",
    });
    expect(result.ok).toBe(false);
    expect(result.depsChanged).toContain("package.json: -foo");
  });

  it("passes when new dep AND research.md updated", () => {
    const result = checkResearchMdUpdate({
      changedFiles: ["package.json", "research.md"],
      readCurrent: () => JSON.stringify({ dependencies: { foo: "^1.0.0", bar: "^2.0.0" } }),
      readAtRef: () => BASE_PKG,
      prBody: "",
    });
    expect(result.ok).toBe(true);
  });

  it("passes when new dep AND docs/research-log.md updated (the canonical research log)", () => {
    const result = checkResearchMdUpdate({
      changedFiles: ["package.json", "docs/research-log.md"],
      readCurrent: () => JSON.stringify({ dependencies: { foo: "^1.0.0", bar: "^2.0.0" } }),
      readAtRef: () => BASE_PKG,
      prBody: "",
    });
    expect(result.ok).toBe(true);
  });

  it("passes when new dep AND ad-hoc docs/research-<topic>.md updated", () => {
    const result = checkResearchMdUpdate({
      changedFiles: ["package.json", "docs/research-hooks-vs-rules-2026-05-27.md"],
      readCurrent: () => JSON.stringify({ dependencies: { foo: "^1.0.0", bar: "^2.0.0" } }),
      readAtRef: () => BASE_PKG,
      prBody: "",
    });
    expect(result.ok).toBe(true);
  });

  it("respects no-research-update opt-out", () => {
    const result = checkResearchMdUpdate({
      changedFiles: ["package.json"],
      readCurrent: () => JSON.stringify({ dependencies: { foo: "^1.0.0", bar: "^2.0.0" } }),
      readAtRef: () => BASE_PKG,
      prBody: "<!-- no-research-update: security patch for CVE-2025-XXX -->",
    });
    expect(result.ok).toBe(true);
  });

  it("scans devDependencies too", () => {
    const result = checkResearchMdUpdate({
      changedFiles: ["package.json"],
      readCurrent: () => JSON.stringify({ devDependencies: { vitest: "^1.0.0" } }),
      readAtRef: () => JSON.stringify({}),
      prBody: "",
    });
    expect(result.ok).toBe(false);
    expect(result.depsChanged).toContain("package.json: +vitest");
  });

  it("ignores malformed package.json (graceful)", () => {
    const result = checkResearchMdUpdate({
      changedFiles: ["package.json"],
      readCurrent: () => "{ broken json",
      readAtRef: () => BASE_PKG,
      prBody: "",
    });
    // Malformed parses to {} for the broken side, so all base deps "disappear"
    expect(result.ok).toBe(false); // detects baseline removal
  });
});
