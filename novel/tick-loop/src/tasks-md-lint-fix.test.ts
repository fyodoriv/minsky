import { describe, expect, it, vi } from "vitest";
import {
  type MarkdownlintExec,
  fixTasksMdMarkdown,
  parseSummaryCount,
} from "./tasks-md-lint-fix.js";

/** Synthetic `markdownlint-cli2` output carrying a given error count. */
function summary(n: number): string {
  return `markdownlint-cli2 v0.22.1 (markdownlint v0.40.0)\nFinding: TASKS.md\nLinting: 1 file(s)\nSummary: ${n} error(s)\n`;
}

/**
 * Build a stub `MarkdownlintExec` driven by scripted per-call outputs.
 * Records each `{ fix }` invocation so tests can assert call shape (the
 * dry-run "no mutation" guarantee = `fix:true` is never invoked).
 */
function stubExec(outputs: readonly string[]): {
  exec: MarkdownlintExec;
  calls: { fix: boolean }[];
} {
  const calls: { fix: boolean }[] = [];
  let i = 0;
  const exec: MarkdownlintExec = ({ fix }) => {
    calls.push({ fix });
    return outputs[i++] ?? summary(0);
  };
  return { exec, calls };
}

describe("parseSummaryCount", () => {
  it("extracts the count from the canonical Summary line", () => {
    expect(parseSummaryCount(summary(0))).toBe(0);
    expect(parseSummaryCount(summary(7))).toBe(7);
  });

  it("throws (rule #6 visible-not-silent) when no Summary line is present — a tool crash must not be silently read as 0 violations", () => {
    expect(() => parseSummaryCount("TypeError: boom\n    at markdownlint-cli2")).toThrow(
      /no "Summary: N error\(s\)" line/,
    );
  });
});

describe("fixTasksMdMarkdown", () => {
  it("(i) clean input → { violations: 0, fixed: 0 } and skips the --fix spawn entirely", () => {
    const { exec, calls } = stubExec([summary(0)]);
    const result = fixTasksMdMarkdown({ tasksPath: "TASKS.md", execSyncFn: exec });
    expect(result).toEqual({ violations: 0, fixed: 0 });
    // skip-earlier gate: a clean file must not trigger the mutating spawn.
    expect(calls).toEqual([{ fix: false }]);
  });

  it("(ii) one MD012 double-blank-line → { violations: 1, fixed: 1 }", () => {
    // before: 1 violation; --fix run re-lints and reports 0 remaining.
    const { exec, calls } = stubExec([summary(1), summary(0)]);
    const warn = vi.fn();
    const result = fixTasksMdMarkdown({ tasksPath: "TASKS.md", execSyncFn: exec, warn });
    expect(result).toEqual({ violations: 1, fixed: 1 });
    expect(calls).toEqual([{ fix: false }, { fix: true }]);
    // fully fixed → no unfixable-violation warning.
    expect(warn).not.toHaveBeenCalled();
  });

  it("(iii) MD012 + unfixable MD001 → { violations: 2, fixed: 1 } and emits a warning, never blocks", () => {
    // before: 2 violations; --fix fixes MD012, MD001 (heading order) remains.
    const { exec } = stubExec([summary(2), summary(1)]);
    const warn = vi.fn();
    const result = fixTasksMdMarkdown({ tasksPath: "TASKS.md", execSyncFn: exec, warn });
    expect(result).toEqual({ violations: 2, fixed: 1 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/1 unfixable violation\(s\) remain/);
    expect(warn.mock.calls[0]?.[0]).toMatch(/proceeding with commit/);
  });

  it("(iv) dryRun → reports the count but NEVER invokes --fix (no file mutation)", () => {
    const { exec, calls } = stubExec([summary(3)]);
    const result = fixTasksMdMarkdown({
      tasksPath: "TASKS.md",
      execSyncFn: exec,
      dryRun: true,
    });
    expect(result).toEqual({ violations: 3, fixed: 0 });
    // the only call is the read-only count; `fix:true` is never reached.
    expect(calls).toEqual([{ fix: false }]);
    expect(calls.some((c) => c.fix)).toBe(false);
  });
});
