// Tests for lint-md-diff.mjs — pure selection + pure orchestration over
// injected seams. No real git, no real markdownlint. No @ts-check (matches
// sibling scripts/*.test.mjs convention).
//
// Chaos coverage (rule #7) for the public artefacts:
//   - selectMarkdownFiles: garbage / CRLF / ignored-path inputs
//   - lintMdDiff: empty-diff fast-path, clean, dirty, and the swarm-flap
//     regression (an unrelated churned file is NOT in the branch diff)
import { describe, expect, it } from "vitest";
import { effectiveDiffBase, lintMdDiff, parseArgs, selectMarkdownFiles } from "./lint-md-diff.mjs";

describe("selectMarkdownFiles", () => {
  it("keeps *.md, drops non-md and the lint:md ignore set", () => {
    const got = selectMarkdownFiles(
      [
        "TASKS.md",
        "docs/a.md",
        "src/index.ts",
        "node_modules/x/readme.md",
        ".minsky/notes.md",
        ".claude/scratch.md",
        ".worktrees/wt/TASKS.md",
        "opencode.notes.md",
        ".aider.chat.history.md",
        "pkg/.aider.tags.md",
        "README.MD",
      ].join("\n"),
    );
    expect(got).toEqual(["TASKS.md", "docs/a.md", "README.MD"]);
  });

  it("is robust to trailing newline, blank lines, and CRLF", () => {
    expect(selectMarkdownFiles("a.md\r\n\nb.md\n")).toEqual(["a.md", "b.md"]);
  });

  it("returns [] for empty / whitespace-only diff output", () => {
    expect(selectMarkdownFiles("")).toEqual([]);
    expect(selectMarkdownFiles("\n  \n")).toEqual([]);
  });
});

describe("parseArgs", () => {
  it("defaults to nulls", () => {
    expect(parseArgs([])).toEqual({ diffBase: null, diffFile: null });
  });
  it("parses --diff-base and the --diff test seam", () => {
    expect(parseArgs(["--diff-base=upstream/main", "--diff=/tmp/d.txt"])).toEqual({
      diffBase: "upstream/main",
      diffFile: "/tmp/d.txt",
    });
  });
});

describe("effectiveDiffBase", () => {
  it("argv beats env", () => {
    expect(
      effectiveDiffBase({ argBase: "feat/x", env: { LINT_MD_DIFF_BASE: "origin/main" } }),
    ).toBe("feat/x");
  });
  it("env wins when no argv", () => {
    expect(effectiveDiffBase({ argBase: null, env: { LINT_MD_DIFF_BASE: "origin/main" } })).toBe(
      "origin/main",
    );
  });
});

describe("lintMdDiff", () => {
  it("skips (exit 0, never spawns the linter) when the diff has no *.md", () => {
    let spawned = false;
    const r = lintMdDiff({
      diffBase: "origin/main",
      listChangedFiles: () => "src/index.ts\nlib/util.ts\n",
      runMarkdownlint: () => {
        spawned = true;
        return 1;
      },
    });
    expect(r).toEqual({ ok: true, skipped: true, files: [], exitCode: 0 });
    expect(spawned).toBe(false);
  });

  it("passes when markdownlint exits 0 on the diff's *.md files", () => {
    const r = lintMdDiff({
      diffBase: "origin/main",
      listChangedFiles: () => "TASKS.md\ndocs/a.md\n",
      runMarkdownlint: (files) => {
        expect(files).toEqual(["TASKS.md", "docs/a.md"]);
        return 0;
      },
    });
    expect(r).toEqual({ ok: true, skipped: false, files: ["TASKS.md", "docs/a.md"], exitCode: 0 });
  });

  it("fails (non-zero exit propagated) when markdownlint flags the diff", () => {
    const r = lintMdDiff({
      diffBase: "origin/main",
      listChangedFiles: () => "docs/bad.md\n",
      runMarkdownlint: () => 1,
    });
    expect(r).toEqual({ ok: false, skipped: false, files: ["docs/bad.md"], exitCode: 1 });
  });

  it("swarm-flap regression: a concurrently-churned file not in the branch diff cannot fail the push", () => {
    // The branch only committed scripts/*.mjs. A sibling worker re-dirtied
    // TASKS.md with markdownlint debt in the live tree — but `<base>...HEAD`
    // never lists it, so the push stays green.
    const r = lintMdDiff({
      diffBase: "origin/main",
      listChangedFiles: () => "scripts/lint-md-diff.mjs\nscripts/lint-md-diff.test.mjs\n",
      runMarkdownlint: () => {
        throw new Error("markdownlint must not run — diff has zero *.md");
      },
    });
    expect(r.skipped).toBe(true);
    expect(r.ok).toBe(true);
  });
});
