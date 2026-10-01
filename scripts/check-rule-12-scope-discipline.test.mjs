// Tests for the pure function in check-rule-12-scope-discipline.mjs.
// Pattern: rule #10 deterministic gate; xUnit paired fixtures
// (Meszaros, *xUnit Test Patterns*, 2007).

import { describe, expect, test } from "vitest";

import { checkRule12ScopeDiscipline } from "./check-rule-12-scope-discipline.mjs";

const TASKS_MD_FIXTURE = [
  "# Tasks",
  "",
  "- [ ] `existing-task` — some existing task",
  "  - **ID**: existing-task",
  "  - **Tags**: ci",
  "  - **Files**: `novel/example/src/foo.ts`, `scripts/check-existing.mjs`.",
  "",
  "- [ ] `unrelated-task` — another task",
  "  - **ID**: unrelated-task",
  "  - **Tags**: docs",
  "  - **Files**: `docs/unrelated.md`.",
  "",
].join("\n");

const EXPERIMENT_WITH_PATH = [
  "id: example-feature-2026-05-04",
  "hypothesis: |",
  "  Adding novel/example/src/bar.ts will reduce X by Y.",
  "success: |",
  "  - vitest run novel/example exits 0.",
  "pivot: |",
  "  Below 5%, retire.",
  "measurement: |",
  "  - test foo",
  "anchor: |",
  "  Beck 1999.",
].join("\n");

const EXPERIMENTS_FIXTURE = new Map([
  ["experiments/example-feature-2026-05-04.yaml", EXPERIMENT_WITH_PATH],
]);
const NO_EXPERIMENTS = /** @type {Map<string, string>} */ (new Map());
const NO_OPT_OUTS = /** @type {Map<string, string>} */ (new Map());

describe("checkRule12ScopeDiscipline", () => {
  test("new file under novel/ with matching TASKS.md task → justified-by-task", () => {
    const result = checkRule12ScopeDiscipline({
      changedFiles: [{ status: "A", path: "novel/example/src/foo.ts" }],
      tasksMd: TASKS_MD_FIXTURE,
      experimentsByPath: NO_EXPERIMENTS,
      prBody: "",
      optOuts: NO_OPT_OUTS,
    });
    expect(result.classifications).toHaveLength(1);
    expect(result.classifications[0]?.verdict).toBe("justified-by-task");
    expect(result.classifications[0]?.evidence).toBe("existing-task");
  });

  test("new file under novel/ with matching experiment → justified-by-experiment", () => {
    const result = checkRule12ScopeDiscipline({
      changedFiles: [{ status: "A", path: "novel/example/src/bar.ts" }],
      tasksMd: TASKS_MD_FIXTURE,
      experimentsByPath: EXPERIMENTS_FIXTURE,
      prBody: "",
      optOuts: NO_OPT_OUTS,
    });
    expect(result.classifications).toHaveLength(1);
    expect(result.classifications[0]?.verdict).toBe("justified-by-experiment");
    expect(result.classifications[0]?.evidence).toBe("experiments/example-feature-2026-05-04.yaml");
  });

  test("new file under novel/ with no justification → unjustified", () => {
    const result = checkRule12ScopeDiscipline({
      changedFiles: [{ status: "A", path: "novel/orphan/src/baz.ts" }],
      tasksMd: TASKS_MD_FIXTURE,
      experimentsByPath: EXPERIMENTS_FIXTURE,
      prBody: "",
      optOuts: NO_OPT_OUTS,
    });
    expect(result.classifications).toHaveLength(1);
    expect(result.classifications[0]?.verdict).toBe("unjustified");
    expect(result.classifications[0]?.path).toBe("novel/orphan/src/baz.ts");
  });

  test("new file with in-file opt-out comment → human-approved with reason", () => {
    const optOuts = new Map([
      ["novel/orphan/src/baz.ts", "operator chose this in-session 2026-05-04"],
    ]);
    const result = checkRule12ScopeDiscipline({
      changedFiles: [{ status: "A", path: "novel/orphan/src/baz.ts" }],
      tasksMd: TASKS_MD_FIXTURE,
      experimentsByPath: NO_EXPERIMENTS,
      prBody: "",
      optOuts,
    });
    expect(result.classifications).toHaveLength(1);
    const c = result.classifications[0];
    expect(c?.verdict).toBe("human-approved");
    expect(c?.evidence).toBe("in-file-comment");
    expect(c?.reason).toBe("operator chose this in-session 2026-05-04");
  });

  test("PR-body opt-out resolves all otherwise-unjustified additions", () => {
    const result = checkRule12ScopeDiscipline({
      changedFiles: [
        { status: "A", path: "novel/orphan/src/baz.ts" },
        { status: "A", path: "scripts/check-orphan.mjs" },
      ],
      tasksMd: TASKS_MD_FIXTURE,
      experimentsByPath: NO_EXPERIMENTS,
      prBody: "## Summary\n<!-- scope: human-approved emergency hotfix per oncall 2026-05-04 -->\n",
      optOuts: NO_OPT_OUTS,
    });
    expect(result.classifications).toHaveLength(2);
    for (const c of result.classifications) {
      expect(c.verdict).toBe("human-approved");
      expect(c.evidence).toBe("pr-body-comment");
      expect(c.reason).toBe("emergency hotfix per oncall 2026-05-04");
    }
  });

  test("modifications (status M) and renames (status R) are grandfathered → no classifications", () => {
    const result = checkRule12ScopeDiscipline({
      changedFiles: [
        { status: "M", path: "novel/example/src/foo.ts" },
        { status: "R100", path: "novel/example/src/renamed.ts" },
      ],
      tasksMd: TASKS_MD_FIXTURE,
      experimentsByPath: NO_EXPERIMENTS,
      prBody: "",
      optOuts: NO_OPT_OUTS,
    });
    expect(result.classifications).toHaveLength(0);
  });

  test("test files (*.test.ts, *.test.mjs) are not eligible", () => {
    const result = checkRule12ScopeDiscipline({
      changedFiles: [
        { status: "A", path: "novel/orphan/src/baz.test.ts" },
        { status: "A", path: "scripts/check-orphan.test.mjs" },
      ],
      tasksMd: TASKS_MD_FIXTURE,
      experimentsByPath: NO_EXPERIMENTS,
      prBody: "",
      optOuts: NO_OPT_OUTS,
    });
    expect(result.classifications).toHaveLength(0);
  });

  test("fixture files are not eligible", () => {
    const result = checkRule12ScopeDiscipline({
      changedFiles: [{ status: "A", path: "novel/orphan/src/baz.fixture.ts" }],
      tasksMd: TASKS_MD_FIXTURE,
      experimentsByPath: NO_EXPERIMENTS,
      prBody: "",
      optOuts: NO_OPT_OUTS,
    });
    expect(result.classifications).toHaveLength(0);
  });

  test("new top-level workflow file with TASKS.md mention → justified", () => {
    const tasksMd = [
      "- [ ] task",
      "  - **ID**: workflow-task",
      "  - **Files**: `.github/workflows/new-gate.yml`.",
    ].join("\n");
    const result = checkRule12ScopeDiscipline({
      changedFiles: [{ status: "A", path: ".github/workflows/new-gate.yml" }],
      tasksMd,
      experimentsByPath: NO_EXPERIMENTS,
      prBody: "",
      optOuts: NO_OPT_OUTS,
    });
    expect(result.classifications).toHaveLength(1);
    expect(result.classifications[0]?.verdict).toBe("justified-by-task");
    expect(result.classifications[0]?.evidence).toBe("workflow-task");
  });

  test("new top-level script under scripts/ requires justification", () => {
    const result = checkRule12ScopeDiscipline({
      changedFiles: [{ status: "A", path: "scripts/check-new-thing.mjs" }],
      tasksMd: TASKS_MD_FIXTURE,
      experimentsByPath: NO_EXPERIMENTS,
      prBody: "",
      optOuts: NO_OPT_OUTS,
    });
    expect(result.classifications).toHaveLength(1);
    expect(result.classifications[0]?.verdict).toBe("unjustified");
  });

  test("paths outside the eligible roots (e.g., docs/, root-level *.md) are skipped", () => {
    const result = checkRule12ScopeDiscipline({
      changedFiles: [
        { status: "A", path: "docs/host-transformation-checklist.md" },
        { status: "A", path: "user-stories/007-foo.md" },
        { status: "A", path: "RANDOM.md" },
      ],
      tasksMd: TASKS_MD_FIXTURE,
      experimentsByPath: NO_EXPERIMENTS,
      prBody: "",
      optOuts: NO_OPT_OUTS,
    });
    expect(result.classifications).toHaveLength(0);
  });

  test("multiple new files: some justified, some not — only the unjustified are flagged", () => {
    const result = checkRule12ScopeDiscipline({
      changedFiles: [
        { status: "A", path: "novel/example/src/foo.ts" }, // task-justified
        { status: "A", path: "novel/orphan/src/baz.ts" }, // unjustified
        { status: "A", path: "novel/example/src/bar.ts" }, // experiment-justified
      ],
      tasksMd: TASKS_MD_FIXTURE,
      experimentsByPath: EXPERIMENTS_FIXTURE,
      prBody: "",
      optOuts: NO_OPT_OUTS,
    });
    expect(result.classifications).toHaveLength(3);
    const verdicts = result.classifications.map((c) => c.verdict).sort();
    expect(verdicts).toEqual(["justified-by-experiment", "justified-by-task", "unjustified"]);
    const unjustified = result.classifications.find((c) => c.verdict === "unjustified");
    expect(unjustified?.path).toBe("novel/orphan/src/baz.ts");
  });

  test("empty diff produces empty classifications (no-op gate)", () => {
    const result = checkRule12ScopeDiscipline({
      changedFiles: [],
      tasksMd: TASKS_MD_FIXTURE,
      experimentsByPath: NO_EXPERIMENTS,
      prBody: "",
      optOuts: NO_OPT_OUTS,
    });
    expect(result.classifications).toHaveLength(0);
  });

  test("in-file opt-out takes precedence over PR-body opt-out (more specific reason wins)", () => {
    const optOuts = new Map([["novel/orphan/src/baz.ts", "specific in-file reason"]]);
    const result = checkRule12ScopeDiscipline({
      changedFiles: [{ status: "A", path: "novel/orphan/src/baz.ts" }],
      tasksMd: TASKS_MD_FIXTURE,
      experimentsByPath: NO_EXPERIMENTS,
      prBody: "<!-- scope: human-approved generic PR-body reason -->",
      optOuts,
    });
    expect(result.classifications[0]?.reason).toBe("specific in-file reason");
    expect(result.classifications[0]?.evidence).toBe("in-file-comment");
  });

  test("TASKS.md task block must own an `**ID**:` line — bare path mention without an ID block does NOT justify", () => {
    const tasksMd = "Some prose mentioning novel/orphan/src/baz.ts but no task block.";
    const result = checkRule12ScopeDiscipline({
      changedFiles: [{ status: "A", path: "novel/orphan/src/baz.ts" }],
      tasksMd,
      experimentsByPath: NO_EXPERIMENTS,
      prBody: "",
      optOuts: NO_OPT_OUTS,
    });
    expect(result.classifications[0]?.verdict).toBe("unjustified");
  });
});
