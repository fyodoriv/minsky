import { describe, expect, it, vi } from "vitest";
import {
  buildMarkdownlintCommand,
  countMarkdownlintViolations,
  fixTasksMdMarkdown,
} from "./tasks-md-lint-fix.js";

// ---- Fixtures: realistic markdownlint-cli2 combined (2>&1) output ----------

const CLEAN_OUTPUT = [
  "markdownlint-cli2 v0.22.1 (markdownlint v0.37.4)",
  "Finding: TASKS.md",
  "Linting: 1 file(s)",
  "Summary: 0 error(s)",
].join("\n");

const MD012_LINE =
  "TASKS.md:42 MD012/no-multiple-blanks Multiple consecutive blank lines [Expected: 1; Actual: 2]";

const MD001_LINE =
  "TASKS.md:10 MD001/heading-increment Heading levels should only increment by one level at a time [Expected: h2; Actual: h4]";

const MD012_OUTPUT = ["Finding: TASKS.md", MD012_LINE, "Summary: 1 error(s)"].join("\n");

const MD012_PLUS_MD001_OUTPUT = [
  "Finding: TASKS.md",
  MD012_LINE,
  MD001_LINE,
  "Summary: 2 error(s)",
].join("\n");

const MD001_ONLY_OUTPUT = ["Finding: TASKS.md", MD001_LINE, "Summary: 1 error(s)"].join("\n");

/**
 * Stub `execSyncFn`: returns queued outputs in call order and records
 * every command string for assertions.
 */
function stubExec(responses: readonly string[]): {
  fn: (command: string) => string;
  calls: string[];
} {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    fn: (command: string) => {
      calls.push(command);
      const out = responses[i] ?? "";
      i += 1;
      return out;
    },
  };
}

describe("buildMarkdownlintCommand", () => {
  it("builds the read-only command with the seam contract suffix", () => {
    expect(buildMarkdownlintCommand("TASKS.md", false)).toBe(
      "npx markdownlint-cli2 'TASKS.md' 2>&1 || true",
    );
  });

  it("builds the --fix command", () => {
    expect(buildMarkdownlintCommand("TASKS.md", true)).toBe(
      "npx markdownlint-cli2 --fix 'TASKS.md' 2>&1 || true",
    );
  });

  it("single-quotes the path and escapes embedded quotes", () => {
    expect(buildMarkdownlintCommand("/a b/it's/TASKS.md", false)).toBe(
      "npx markdownlint-cli2 '/a b/it'\\''s/TASKS.md' 2>&1 || true",
    );
  });
});

describe("countMarkdownlintViolations", () => {
  it("returns 0 for clean output", () => {
    expect(countMarkdownlintViolations(CLEAN_OUTPUT)).toBe(0);
  });

  it("counts one violation line", () => {
    expect(countMarkdownlintViolations(MD012_OUTPUT)).toBe(1);
  });

  it("counts multiple violation lines", () => {
    expect(countMarkdownlintViolations(MD012_PLUS_MD001_OUTPUT)).toBe(2);
  });
});

describe("fixTasksMdMarkdown", () => {
  // (i) clean input → { violations: 0, fixed: 0 }
  it("clean input returns {violations:0,fixed:0} and skips --fix (skip-earlier gate)", () => {
    const { fn, calls } = stubExec([CLEAN_OUTPUT]);

    const result = fixTasksMdMarkdown({ tasksPath: "TASKS.md", execSyncFn: fn });

    expect(result).toEqual({ violations: 0, fixed: 0 });
    // Only the initial read-only run — no --fix, no re-read.
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain("--fix");
  });

  // (ii) MD012 double blank line → { violations: 1, fixed: 1 }
  it("MD012 double blank line is auto-fixed → {violations:1,fixed:1}", () => {
    const { fn, calls } = stubExec([
      MD012_OUTPUT, // before: 1 violation
      "", // --fix run
      CLEAN_OUTPUT, // after: 0 remaining
    ]);
    const logFn = vi.fn();

    const result = fixTasksMdMarkdown({ tasksPath: "TASKS.md", execSyncFn: fn, logFn });

    expect(result).toEqual({ violations: 1, fixed: 1 });
    expect(calls).toHaveLength(3);
    expect(calls[1]).toContain("--fix");
    // Fully fixed → no warning.
    expect(logFn).not.toHaveBeenCalled();
  });

  // (iii) MD012 + MD001 (unfixable) → { violations: 2, fixed: 1 } with warning
  it("MD012 + unfixable MD001 → {violations:2,fixed:1} and emits a warning", () => {
    const { fn } = stubExec([
      MD012_PLUS_MD001_OUTPUT, // before: 2 violations
      "", // --fix run
      MD001_ONLY_OUTPUT, // after: MD001 remains (unfixable)
    ]);
    const logFn = vi.fn();

    const result = fixTasksMdMarkdown({ tasksPath: "TASKS.md", execSyncFn: fn, logFn });

    expect(result).toEqual({ violations: 2, fixed: 1 });
    expect(logFn).toHaveBeenCalledTimes(1);
    expect(logFn.mock.calls[0]?.[0]).toContain("1 unfixable");
  });

  // (iv) dry-run mode asserts no file mutation
  it("dry-run reports the count but never runs --fix (no mutation)", () => {
    const { fn, calls } = stubExec([MD012_OUTPUT]);

    const result = fixTasksMdMarkdown({
      tasksPath: "TASKS.md",
      execSyncFn: fn,
      dryRun: true,
    });

    expect(result).toEqual({ violations: 1, fixed: 0 });
    expect(calls).toHaveLength(1);
    expect(calls.some((c) => c.includes("--fix"))).toBe(false);
  });
});
