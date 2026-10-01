// Tests for the pure function in check-rule-3-doc-first.mjs.
// Pattern: rule #10 deterministic gate; xUnit paired fixtures (Meszaros 2007).

import { describe, expect, test } from "vitest";

import { checkRule3DocFirst } from "./check-rule-3-doc-first.mjs";

const TASKS_MD_FIXTURE = [
  "# Tasks",
  "",
  "- [ ] Some task",
  "  - **ID**: example-followup",
  "  - **Tags**: docs",
  "",
].join("\n");

describe("checkRule3DocFirst", () => {
  test("PR with only code under novel/ (no doc touched) → fails", () => {
    const result = checkRule3DocFirst({
      changedFiles: [{ status: "M", path: "novel/budget-guard/src/foo.ts" }],
      prBody: "## Summary\nrefactor only.\n",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("budget-guard"))).toBe(true);
  });

  test("PR with code AND a touched user-stories/ file → passes", () => {
    const result = checkRule3DocFirst({
      changedFiles: [
        { status: "A", path: "novel/budget-guard/src/foo.ts" },
        { status: "M", path: "user-stories/004-budget-auto-pause.md" },
      ],
      prBody: "",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(true);
  });

  test("PR with code AND the package's README → passes", () => {
    const result = checkRule3DocFirst({
      changedFiles: [
        { status: "M", path: "novel/budget-guard/src/foo.ts" },
        { status: "M", path: "novel/budget-guard/README.md" },
      ],
      prBody: "",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(true);
  });

  test("PR with code AND a different package's README → fails (per-package scope)", () => {
    const result = checkRule3DocFirst({
      changedFiles: [
        { status: "M", path: "novel/budget-guard/src/foo.ts" },
        { status: "M", path: "novel/handoff-spec/README.md" },
      ],
      prBody: "",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("budget-guard"))).toBe(true);
  });

  test("PR body with valid deferral comment + existing task → passes", () => {
    const result = checkRule3DocFirst({
      changedFiles: [{ status: "M", path: "novel/budget-guard/src/foo.ts" }],
      prBody: "## Summary\n<!-- rule-3: doc-deferred-to-followup-task: example-followup -->\n",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(true);
  });

  test("PR body with deferral comment for unknown task → fails with named error", () => {
    const result = checkRule3DocFirst({
      changedFiles: [{ status: "M", path: "novel/budget-guard/src/foo.ts" }],
      prBody: "<!-- rule-3: doc-deferred-to-followup-task: nonexistent-task -->\n",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("nonexistent-task"))).toBe(true);
  });

  test("PR body with refactor-no-public-surface marker → passes", () => {
    const result = checkRule3DocFirst({
      changedFiles: [{ status: "M", path: "novel/budget-guard/src/foo.ts" }],
      prBody: "Internal rename. <!-- rule-3: refactor-no-public-surface -->",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(true);
  });

  test("PR with only test files under novel/ → passes (tests are not 'code' for rule-3)", () => {
    const result = checkRule3DocFirst({
      changedFiles: [{ status: "M", path: "novel/budget-guard/src/foo.test.ts" }],
      prBody: "",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(true);
  });

  test("PR with only deleted code → passes (no addition triggers the rule)", () => {
    const result = checkRule3DocFirst({
      changedFiles: [{ status: "D", path: "novel/budget-guard/src/foo.ts" }],
      prBody: "",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(true);
  });

  test("PR touching only docs (no novel/ code) → passes", () => {
    const result = checkRule3DocFirst({
      changedFiles: [{ status: "M", path: "README.md" }],
      prBody: "",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(true);
  });

  test("PR touching adapters' code requires the adapter's own README", () => {
    // novel/adapters/observability uses 3-segment package boundary.
    const result = checkRule3DocFirst({
      changedFiles: [
        { status: "M", path: "novel/adapters/observability/src/foo.ts" },
        { status: "M", path: "novel/adapters/observability/README.md" },
      ],
      prBody: "",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(true);
  });

  test("PR touching bridges' code uses the bridges/<pkg> 3-segment boundary too", () => {
    const result = checkRule3DocFirst({
      changedFiles: [
        { status: "A", path: "novel/bridges/omc-tasksmd/src/foo.ts" },
        { status: "A", path: "novel/bridges/omc-tasksmd/README.md" },
      ],
      prBody: "",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(true);
  });

  test("PR touching multiple novel packages requires a doc-touch per package", () => {
    const result = checkRule3DocFirst({
      changedFiles: [
        { status: "M", path: "novel/budget-guard/src/foo.ts" },
        { status: "M", path: "novel/budget-guard/README.md" },
        { status: "M", path: "novel/handoff-spec/src/bar.ts" },
        // No handoff-spec README touched → fails for handoff-spec only.
      ],
      prBody: "",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("handoff-spec");
    expect(result.errors[0]).not.toContain("budget-guard");
  });

  test("user-stories/ touch satisfies all modified packages at once", () => {
    const result = checkRule3DocFirst({
      changedFiles: [
        { status: "M", path: "novel/budget-guard/src/foo.ts" },
        { status: "M", path: "novel/handoff-spec/src/bar.ts" },
        { status: "M", path: "user-stories/004-budget-auto-pause.md" },
      ],
      prBody: "",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(true);
  });

  test("renamed file (status R) is treated as 'touched' for doc-first scope", () => {
    const result = checkRule3DocFirst({
      changedFiles: [
        { status: "R100", path: "novel/budget-guard/src/foo-renamed.ts" },
        { status: "M", path: "novel/budget-guard/README.md" },
      ],
      prBody: "",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(true);
  });

  test("deferral with extra whitespace and uppercase still parses", () => {
    const result = checkRule3DocFirst({
      changedFiles: [{ status: "M", path: "novel/budget-guard/src/foo.ts" }],
      prBody: "<!--   Rule-3:   doc-deferred-to-followup-task:   example-followup   -->",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(true);
  });

  test("deeper code paths (novel/<pkg>/src/sub/foo.ts) still resolve to the right package", () => {
    const result = checkRule3DocFirst({
      changedFiles: [
        { status: "M", path: "novel/budget-guard/src/sub/deep/foo.ts" },
        { status: "M", path: "novel/budget-guard/README.md" },
      ],
      prBody: "",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(true);
  });

  test("files outside novel/ (e.g., scripts/, distribution/) do not trigger rule-3", () => {
    const result = checkRule3DocFirst({
      changedFiles: [
        { status: "A", path: "scripts/check-rule-X.mjs" },
        { status: "A", path: "distribution/foo.sh" },
      ],
      prBody: "",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(true);
  });

  test("malformed deferral comment (missing task-id) is ignored, not an error", () => {
    // The regex requires a kebab-case id; if missing, the deferral doesn't
    // match and the normal doc-touch requirement still applies.
    const result = checkRule3DocFirst({
      changedFiles: [{ status: "M", path: "novel/budget-guard/src/foo.ts" }],
      prBody: "<!-- rule-3: doc-deferred-to-followup-task: -->",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(false); // falls through to normal check
    if (result.ok) return;
    expect(result.errors[0]).toContain("budget-guard");
  });

  test("competitive-benchmark code + competitors/<name>.md doc → passes (corpus-refresh surface)", () => {
    const result = checkRule3DocFirst({
      changedFiles: [
        { status: "M", path: "novel/competitive-benchmark/src/competitors.ts" },
        { status: "M", path: "competitors/openhands.md" },
      ],
      prBody: "",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(true);
  });

  test("competitors/<name>.md only counts for the competitive-benchmark package, not others", () => {
    const result = checkRule3DocFirst({
      changedFiles: [
        { status: "M", path: "novel/budget-guard/src/foo.ts" },
        { status: "M", path: "competitors/openhands.md" },
      ],
      prBody: "",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain("budget-guard");
  });

  test("competitive-benchmark code with NO doc still fails (hint names competitors/*.md)", () => {
    const result = checkRule3DocFirst({
      changedFiles: [{ status: "M", path: "novel/competitive-benchmark/src/competitors.ts" }],
      prBody: "",
      tasksMd: TASKS_MD_FIXTURE,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain("competitors/*.md");
  });
});
