// Paired tests for scripts/check-task-block-citations.mjs.
//
// Pinned cases (rule #9 — pre-registration):
//   (a) clean diff (no TASKS.md changes)              → ok: true
//   (b) PR removes block AND test still cites the ID  → ok: false, orphans = [{id, citations}]
//   (c) PR removes block AND removes citation         → ok: true (citation gone from HEAD corpus)
//   (d) PR removes block with escape-hatch marker     → ok: true
//   (e) PR removes 2 blocks, one orphan one clean     → ok: false, only the orphan reported
//   (f) PR removes block but no test cites it         → ok: true
//   (g) multi-line block — escape-hatch on line N+5   → ok: true (marker found anywhere in deletion span)
//   (h) regression guard for PR #864 (daemon-pre-pr-lint-gate)
//   (i) the escape-hatch marker INSIDE prose (e.g. a `**Details**:` field that DESCRIBES the marker)
//       does NOT trip detection — the regex requires the marker
//       at the start of a standalone deletion-side line.
//
// Source: docs/daemon-pre-pr-gate.md § "check-task-block-citations"
// (the canonical citation site) and the parent PR that introduced
// the lint. The original task block in TASKS.md was removed in the
// same PR per the rule-#2 "single canonical site" pattern; docs/
// is stable across orphan-cleanup cycles.

import { describe, expect, test } from "vitest";
import {
  checkTaskBlockCitations,
  findCitations,
  parseRemovedTaskBlocks,
} from "./check-task-block-citations.mjs";

// ---- parseRemovedTaskBlocks ----------------------------------------------

describe("parseRemovedTaskBlocks", () => {
  test("empty diff yields no removed blocks", () => {
    expect(parseRemovedTaskBlocks("")).toEqual([]);
  });

  test("a single removed block is detected", () => {
    const diff = [
      "diff --git a/TASKS.md b/TASKS.md",
      "index abc..def 100644",
      "--- a/TASKS.md",
      "+++ b/TASKS.md",
      "@@ -10,5 +10,0 @@",
      "-- [ ] `foo-bar` — does the thing",
      "-  - **ID**: foo-bar",
      "-  - **Tags**: p1, demo",
      "-  - **Details**: ...",
    ].join("\n");
    expect(parseRemovedTaskBlocks(diff)).toEqual([{ id: "foo-bar", blockHadEscapeHatch: false }]);
  });

  test("escape-hatch marker is detected when present in the deletion span", () => {
    const diff = [
      "@@ -10,5 +10,0 @@",
      "-- [ ] `legacy-task` — old shipped task",
      "-  - **ID**: legacy-task",
      "-  <!-- DO NOT DELETE — citation site for tests/foo.test.mjs:42 -->",
      "-  - **Details**: ...",
    ].join("\n");
    expect(parseRemovedTaskBlocks(diff)).toEqual([
      { id: "legacy-task", blockHadEscapeHatch: true },
    ]);
  });

  test("two removed blocks are reported independently", () => {
    const diff = [
      "@@ -10,5 +10,0 @@",
      "-- [ ] `task-a` — first",
      "-  - **ID**: task-a",
      "-  - **Details**: ...",
      "@@ -50,3 +45,0 @@",
      "-- [ ] `task-b` — second",
      "-  - **ID**: task-b",
    ].join("\n");
    expect(parseRemovedTaskBlocks(diff)).toEqual([
      { id: "task-a", blockHadEscapeHatch: false },
      { id: "task-b", blockHadEscapeHatch: false },
    ]);
  });

  test("addition-side task headers (new tasks added to TASKS.md) are NOT counted as removals", () => {
    // A line like `+- [ ] \`new-task\` — ...` starts with `+- [` and
    // does NOT match REMOVED_TASK_HEADER_RE which expects `-- [`.
    const diff = [
      "@@ -10,0 +10,5 @@",
      "+- [ ] `new-task` — fresh task",
      "+  - **ID**: new-task",
    ].join("\n");
    expect(parseRemovedTaskBlocks(diff)).toEqual([]);
  });

  test("a context line (started with space) closes the current removal span — the next removed block starts fresh", () => {
    const diff = [
      "@@ -10,8 +10,3 @@",
      "-- [ ] `task-a` — first",
      "-  - **ID**: task-a",
      "   (context — unchanged line in TASKS.md)",
      "-- [ ] `task-b` — second",
      "-  - **ID**: task-b",
    ].join("\n");
    expect(parseRemovedTaskBlocks(diff)).toEqual([
      { id: "task-a", blockHadEscapeHatch: false },
      { id: "task-b", blockHadEscapeHatch: false },
    ]);
  });

  test("escape-hatch on one block does NOT leak to a subsequent removed block", () => {
    const diff = [
      "@@ -10,8 +10,3 @@",
      "-- [ ] `task-a` — has marker",
      "-  <!-- DO NOT DELETE — citation site for tests/foo.test.mjs:1 -->",
      "   (context line)",
      "-- [ ] `task-b` — no marker",
      "-  - **ID**: task-b",
    ].join("\n");
    expect(parseRemovedTaskBlocks(diff)).toEqual([
      { id: "task-a", blockHadEscapeHatch: true },
      { id: "task-b", blockHadEscapeHatch: false },
    ]);
  });

  test("(i) marker INSIDE a `**Details**:` prose field is NOT treated as the escape hatch", () => {
    // Discovered 2026-05-25 when this lint's own task block (an
    // earlier draft) ended up in TASKS.md with a `**Details**`
    // field that cited the escape-hatch pattern as a literal
    // example. Pre-fix, the looser regex matched the example and
    // the lint silently passed despite the citation in the test
    // file. Post-fix, the regex requires the marker to start a
    // standalone deletion-side line.
    const diff = [
      "@@ -10,5 +10,0 @@",
      "-- [ ] `task-a` — task whose prose mentions the marker",
      "-  - **Details**: (a) ... (d) Escape hatch: a `<!-- DO NOT DELETE — citation site for tests/X.test.mjs:Y -->` line-comment inside the task block silences the lint.",
      "-  - **Acceptance**: ...",
    ].join("\n");
    expect(parseRemovedTaskBlocks(diff)).toEqual([{ id: "task-a", blockHadEscapeHatch: false }]);
  });

  test("(j) marker at the END of a line — without leading whitespace — is NOT matched (avoids the embedded-in-list-item false positive)", () => {
    // A line like `-  - <!-- DO NOT DELETE — ... -->` could
    // theoretically be intended as a marker but is more likely a
    // markdown list-item starting with the comment. The regex
    // requires the `<!--` immediately after the diff prefix +
    // optional whitespace, NOT after another markdown bullet, so
    // we reject the ambiguous case. Operators wanting the marker
    // should write it as a standalone line:
    //   `  <!-- DO NOT DELETE — citation site for ... -->`
    // (in the diff: `-  <!-- DO NOT DELETE ...`).
    const diff = [
      "@@ -10,3 +10,0 @@",
      "-- [ ] `task-a` — task with marker inside list-item",
      "-  - <!-- DO NOT DELETE — citation site for tests/foo.test.mjs:1 -->",
      "-  - **ID**: task-a",
    ].join("\n");
    expect(parseRemovedTaskBlocks(diff)).toEqual([{ id: "task-a", blockHadEscapeHatch: false }]);
  });
});

// ---- findCitations -------------------------------------------------------

describe("findCitations", () => {
  test("returns empty list when no test file cites the ID", () => {
    const corpus = new Map([["tests/foo.test.mjs", "expect(1).toBe(1);"]]);
    expect(findCitations("orphan-id", corpus)).toEqual([]);
  });

  test("finds the ID literally and reports file:line (1-indexed)", () => {
    const corpus = new Map([
      ["tests/foo.test.mjs", 'expect(tasks).toContain("daemon-pre-pr-lint-gate");\n'],
    ]);
    expect(findCitations("daemon-pre-pr-lint-gate", corpus)).toEqual([
      { file: "tests/foo.test.mjs", line: 1 },
    ]);
  });

  test("reports every matching line in every file", () => {
    const corpus = new Map([
      ["tests/foo.test.mjs", 'expect(tasks).toContain("task-a");'],
      [
        "tests/bar.test.mjs",
        ["// task-a appears here in a comment too", 'expect(tasks).toContain("task-a");'].join(
          "\n",
        ),
      ],
    ]);
    expect(findCitations("task-a", corpus)).toEqual([
      { file: "tests/foo.test.mjs", line: 1 },
      { file: "tests/bar.test.mjs", line: 1 },
      { file: "tests/bar.test.mjs", line: 2 },
    ]);
  });

  test("returns 1-indexed line numbers for multi-line files", () => {
    const corpus = new Map([
      [
        "tests/multi.test.mjs",
        ["line 1", "line 2", 'expect(tasks).toContain("target-id");', "line 4"].join("\n"),
      ],
    ]);
    expect(findCitations("target-id", corpus)).toEqual([{ file: "tests/multi.test.mjs", line: 3 }]);
  });

  // The lint scans test files for literal task-ID substrings. When the
  // implementation file is named for the task (`heal-foo.ts` implements
  // task `heal-foo`), the import statement in the chaos test contains
  // the literal substring as a file path, not a citation. Skip those
  // — they are code-level deps, not task references.
  test("ignores `import ... from '...heal-foo.js'` lines (code-level dep, not citation)", () => {
    const corpus = new Map([
      [
        "tests/chaos.test.mjs",
        'import * as healFoo from "../../src/heal-foo.js";\nexpect(true).toBe(true);\n',
      ],
    ]);
    expect(findCitations("heal-foo", corpus)).toEqual([]);
  });

  test("ignores `import { detect } from './heal-foo.js'` named-import shape", () => {
    const corpus = new Map([["tests/chaos.test.mjs", 'import { detect } from "./heal-foo.js";\n']]);
    expect(findCitations("heal-foo", corpus)).toEqual([]);
  });

  test("ignores `const x = require('./heal-foo.js')` CJS shape", () => {
    const corpus = new Map([["tests/chaos.test.mjs", 'const heal = require("./heal-foo.js");\n']]);
    expect(findCitations("heal-foo", corpus)).toEqual([]);
  });

  test("still flags real citations on the same file even when imports also match", () => {
    const corpus = new Map([
      [
        "tests/chaos.test.mjs",
        [
          'import * as healFoo from "../../src/heal-foo.js";',
          'expect(tasks).toContain("heal-foo");',
        ].join("\n"),
      ],
    ]);
    expect(findCitations("heal-foo", corpus)).toEqual([{ file: "tests/chaos.test.mjs", line: 2 }]);
  });

  test("ignores `// Tests for heal-foo` comment line (self-doc)", () => {
    const corpus = new Map([
      ["tests/heal-foo.test.mjs", ["// Tests for heal-foo", "// Scenarios per …"].join("\n")],
    ]);
    expect(findCitations("heal-foo", corpus)).toEqual([]);
  });

  test('ignores `describe("heal-foo", ...)` block name (self-doc)', () => {
    const corpus = new Map([
      [
        "tests/heal-foo.test.mjs",
        ['describe("heal-foo", () => {', "  test('...', ...);", "});"].join("\n"),
      ],
    ]);
    expect(findCitations("heal-foo", corpus)).toEqual([]);
  });

  test('ignores `describe.skip("heal-foo", ...)` block name (self-doc with modifier)', () => {
    const corpus = new Map([["tests/heal-foo.test.mjs", 'describe.skip("heal-foo", () => {});\n']]);
    expect(findCitations("heal-foo", corpus)).toEqual([]);
  });
});

// ---- checkTaskBlockCitations (the orchestrator) --------------------------

describe("checkTaskBlockCitations — the four canonical cases", () => {
  test("(a) clean diff → ok", () => {
    expect(checkTaskBlockCitations("", new Map())).toEqual({ ok: true });
  });

  test("(b) block removed AND test still cites the ID → FAIL with orphan listing", () => {
    const diff = [
      "@@ -10,5 +10,0 @@",
      "-- [ ] `daemon-pre-pr-lint-gate` — old shipped task",
      "-  - **ID**: daemon-pre-pr-lint-gate",
      "-  - **Details**: ...",
    ].join("\n");
    const corpus = new Map([
      [
        "scripts/daemon-pr-lint-metrics.test.mjs",
        'expect(tasks).toContain("daemon-pre-pr-lint-gate");',
      ],
    ]);
    expect(checkTaskBlockCitations(diff, corpus)).toEqual({
      ok: false,
      orphans: [
        {
          id: "daemon-pre-pr-lint-gate",
          citations: [{ file: "scripts/daemon-pr-lint-metrics.test.mjs", line: 1 }],
        },
      ],
    });
  });

  test("(c) block removed AND test ALSO removed the citation in same PR → ok (citation gone from HEAD corpus)", () => {
    const diff = [
      "@@ -10,5 +10,0 @@",
      "-- [ ] `daemon-pre-pr-lint-gate` — old shipped task",
      "-  - **ID**: daemon-pre-pr-lint-gate",
    ].join("\n");
    // The HEAD-state corpus has NO citation for the removed ID (the
    // test file was updated in the same PR).
    const corpus = new Map([
      ["scripts/daemon-pr-lint-metrics.test.mjs", "expect(tasks).toContain('some-other-task');"],
    ]);
    expect(checkTaskBlockCitations(diff, corpus)).toEqual({ ok: true });
  });

  test("(d) block removed with escape-hatch marker → ok (marker overrides)", () => {
    const diff = [
      "@@ -10,5 +10,0 @@",
      "-- [ ] `legacy-task` — old task",
      "-  - **ID**: legacy-task",
      "-  <!-- DO NOT DELETE — citation site for tests/foo.test.mjs:1 -->",
    ].join("\n");
    // Citation still exists in corpus — but the marker says we're
    // doing this on purpose.
    const corpus = new Map([["tests/foo.test.mjs", 'expect(tasks).toContain("legacy-task");']]);
    expect(checkTaskBlockCitations(diff, corpus)).toEqual({ ok: true });
  });
});

describe("checkTaskBlockCitations — composite cases", () => {
  test("(e) two removed blocks, one orphan + one clean → only the orphan is reported", () => {
    const diff = [
      "@@ -10,5 +10,0 @@",
      "-- [ ] `orphaned-task` — block whose ID is still cited",
      "-  - **ID**: orphaned-task",
      "@@ -50,3 +45,0 @@",
      "-- [ ] `clean-task` — block whose ID is NOT cited",
      "-  - **ID**: clean-task",
    ].join("\n");
    const corpus = new Map([["tests/foo.test.mjs", 'expect(tasks).toContain("orphaned-task");']]);
    const verdict = checkTaskBlockCitations(diff, corpus);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.orphans).toEqual([
      {
        id: "orphaned-task",
        citations: [{ file: "tests/foo.test.mjs", line: 1 }],
      },
    ]);
  });

  test("(f) block removed but no test cites the ID → ok", () => {
    const diff = [
      "@@ -10,5 +10,0 @@",
      "-- [ ] `truly-orphaned` — old task",
      "-  - **ID**: truly-orphaned",
    ].join("\n");
    const corpus = new Map([["tests/foo.test.mjs", "expect(1).toBe(1);"]]);
    expect(checkTaskBlockCitations(diff, corpus)).toEqual({ ok: true });
  });

  test("(g) multi-line block — escape-hatch on line N+5 is still detected (marker found anywhere in deletion span)", () => {
    const diff = [
      "@@ -10,10 +10,0 @@",
      "-- [ ] `marked-task` — task with marker on a later line",
      "-  - **ID**: marked-task",
      "-  - **Tags**: p1, demo",
      "-  - **Details**: foo bar baz",
      "-  - **Files**: scripts/foo.mjs",
      "-  <!-- DO NOT DELETE — citation site for tests/foo.test.mjs:42 -->",
      "-  - **Acceptance**: ...",
    ].join("\n");
    const corpus = new Map([["tests/foo.test.mjs", 'expect(tasks).toContain("marked-task");']]);
    expect(checkTaskBlockCitations(diff, corpus)).toEqual({ ok: true });
  });

  test("(h) regression guard for PR #864: removing `daemon-pre-pr-lint-gate` while parity tests cite it fires the gate", () => {
    // This is the exact pattern that broke PR #864. Pin it here so a
    // future agent attempting the same orphan-cleanup gets a loud
    // local failure before push.
    //
    // Citation: PR #864 retro notes; TASKS.md
    // `daemon-pre-pr-lint-gate-prose-citation-migration` (P3 follow-
    // up that resolves the underlying coupling).
    const diff = [
      "diff --git a/TASKS.md b/TASKS.md",
      "@@ -200,20 +200,0 @@",
      "-- [ ] `daemon-pre-pr-lint-gate` — original parent of the daemon's pre-PR-lint substrate",
      "-  - **ID**: daemon-pre-pr-lint-gate",
      "-  - **Tags**: p0, daemon, pre-pr-lint, shipped-acceptance",
      "-  - **Pivot**: if `daemon-pr-lint-pass-rate` < 80% over rolling 30d, ...",
    ].join("\n");
    const corpus = new Map([
      [
        "scripts/daemon-pr-lint-metrics.test.mjs",
        [
          "// PR #864 lesson — parity tests need the canonical block in TASKS.md",
          'expect(tasks).toContain("daemon-pre-pr-lint-gate");',
        ].join("\n"),
      ],
      [
        "scripts/self-diagnose.test.mjs",
        'const ROLLING_30D_MIN_PASS_RATE = "80%"; // from daemon-pre-pr-lint-gate',
      ],
    ]);
    const verdict = checkTaskBlockCitations(diff, corpus);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.orphans).toHaveLength(1);
    expect(verdict.orphans[0]?.id).toBe("daemon-pre-pr-lint-gate");
    // Both citation sites should be reported so the operator can fix in one pass.
    const cited = verdict.orphans[0]?.citations.map((c) => c.file) ?? [];
    expect(cited).toContain("scripts/daemon-pr-lint-metrics.test.mjs");
    expect(cited).toContain("scripts/self-diagnose.test.mjs");
  });
});
