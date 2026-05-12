// Tests for the task-finder. xUnit paired fixtures (Meszaros 2007).

import { describe, expect, test } from "vitest";

import { findTask, isHostTaskEligible, parseTasksMd, pickHostTask } from "./task-finder.js";

const sampleTasksMd = `# Tasks

## P0

- [ ] Fix the slash command labels PROJ-840
  **ID**: proj-840-slash-command-labels
  **Tags**: bug, ai-native, one-shot
  **Details**: titles "hold" and "lead" should read "Put on hold" / "Lead support"
  **Hypothesis**: Replacing the title strings closes the labels gap.
  **Success**: tests pass; titles render as expected
  **Pivot**: <0.5
  **Measurement**: yarn vitest run plugins/example-ai-native
  **Anchor**: rule #9; vision.md § 9

- [ ] Add storybook coverage SOLID-2313
  **ID**: storybook-coverage-solid-2313
  **Tags**: docs, storybook

## P1

- [x] Already-done task (should be ignored as no ID)
`;

describe("parseTasksMd", () => {
  test("parses two tasks under P0", () => {
    const tasks = parseTasksMd(sampleTasksMd);
    expect(tasks.length).toBe(2);
    expect(tasks[0]?.id).toBe("proj-840-slash-command-labels");
    expect(tasks[1]?.id).toBe("storybook-coverage-solid-2313");
  });

  test("captures the priority for each task", () => {
    const tasks = parseTasksMd(sampleTasksMd);
    expect(tasks[0]?.priority).toBe("P0");
    expect(tasks[1]?.priority).toBe("P0");
  });

  test("captures all rule-#9 fields when present", () => {
    const tasks = parseTasksMd(sampleTasksMd);
    const t = tasks[0];
    expect(t?.hypothesis).toContain("Replacing the title strings");
    expect(t?.success).toContain("tests pass");
    expect(t?.pivot).toBe("<0.5");
    expect(t?.measurement).toContain("yarn vitest run");
    expect(t?.anchor).toContain("rule #9");
  });

  test("returns null for missing rule-#9 fields", () => {
    const tasks = parseTasksMd(sampleTasksMd);
    const t = tasks[1];
    expect(t?.hypothesis).toBeNull();
    expect(t?.measurement).toBeNull();
  });

  test("parses tags as comma-separated list", () => {
    const tasks = parseTasksMd(sampleTasksMd);
    expect(tasks[0]?.tags).toEqual(["bug", "ai-native", "one-shot"]);
  });

  test("ignores task blocks without an **ID** marker", () => {
    const tasks = parseTasksMd(sampleTasksMd);
    expect(tasks.find((t) => t.title.includes("Already-done"))).toBeUndefined();
  });

  test("returns empty array for content with no tasks", () => {
    expect(parseTasksMd("# Tasks\n\n## P0\n\n## P1\n")).toEqual([]);
  });
});

describe("findTask — exact ID match", () => {
  test("returns the task when ID matches exactly", () => {
    const result = findTask(sampleTasksMd, "proj-840-slash-command-labels");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task.id).toBe("proj-840-slash-command-labels");
  });

  test("ID match is case-sensitive (kebab-IDs are lower-case by convention)", () => {
    // Exact-ID match is case-sensitive. The mixed-case query "PROJ-840-..."
    // is NOT a substring of the title (which is "...labels PROJ-840"), and
    // uppercase doesn't match the kebab-id, so the lookup returns ok:false.
    const result = findTask(sampleTasksMd, "PROJ-840-SLASH-COMMAND-LABELS");
    expect(result.ok).toBe(false);
  });
});

describe("findTask — title substring (ticket-key matching)", () => {
  test("PROJ-840 matches the title", () => {
    const result = findTask(sampleTasksMd, "PROJ-840");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task.id).toBe("proj-840-slash-command-labels");
  });

  test("case-insensitive title match", () => {
    const result = findTask(sampleTasksMd, "proj-840");
    expect(result.ok).toBe(true);
  });

  test("substring match also works (e.g. partial ticket)", () => {
    const result = findTask(sampleTasksMd, "slash command");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task.id).toBe("proj-840-slash-command-labels");
  });
});

describe("findTask — not found", () => {
  test("returns ok:false with available IDs when no match", () => {
    const result = findTask(sampleTasksMd, "no-such-task");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.availableIds).toContain("proj-840-slash-command-labels");
    expect(result.availableIds).toContain("storybook-coverage-solid-2313");
    expect(result.reason).toContain("no-such-task");
  });

  test("returns empty availableIds when TASKS.md has no tasks", () => {
    const result = findTask("# Tasks\n", "anything");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.availableIds).toEqual([]);
  });

  test("parses nested-bullet metadata format (observer dogfood regression 2026-05-12)", () => {
    // Discovered running `minsky --host ~/apps/tooling/minsky --no-live
    // --max-iterations=1` on minsky's own TASKS.md: the parser returned 0
    // tasks because every metadata line used the tasks.md-spec nested-bullet
    // format (e.g. `  - **ID**: foo`) instead of the indented-only format
    // (`  **ID**: foo`) used by the integration-test fixture. Both are valid
    // tasks.md; the parser must accept both.
    const nestedBulletTasksMd = [
      "# Tasks",
      "",
      "## P0",
      "",
      "- [ ] `some-task` — a task in minsky's own TASKS.md shape",
      "  - **ID**: some-task",
      "  - **Tags**: p0, bug",
      "  - **Hypothesis**: parser handles nested-bullet format",
      "  - **Success**: parseTasksMd returns 1 task",
      "  - **Pivot**: retire parser if fix breaks >3 existing tests",
      "  - **Measurement**: `pnpm vitest run task-finder`",
      "  - **Anchor**: tasks.md spec; rule #9",
      "",
    ].join("\n");
    const tasks = parseTasksMd(nestedBulletTasksMd);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: "some-task",
      priority: "P0",
      hypothesis: "parser handles nested-bullet format",
      success: "parseTasksMd returns 1 task",
      pivot: "retire parser if fix breaks >3 existing tests",
      measurement: "`pnpm vitest run task-finder`",
      anchor: "tasks.md spec; rule #9",
    });
    // And the task must be pick-eligible (all 5 rule-#9 fields present).
    const picked = pickHostTask(nestedBulletTasksMd);
    expect(picked).not.toBeNull();
    expect(picked?.id).toBe("some-task");
  });

  test("parses asterisk-bullet metadata format (* instead of -)", () => {
    // tasks.md spec allows either `- ` or `* ` as the bullet; the parser
    // must handle both. This pair covers the full strip-leading-bullet
    // contract.
    const starBulletTasksMd = [
      "# Tasks",
      "",
      "## P1",
      "",
      "- [ ] star-bullet",
      "  * **ID**: star-bullet",
      "  * **Hypothesis**: h",
      "  * **Success**: s",
      "  * **Pivot**: p",
      "  * **Measurement**: m",
      "  * **Anchor**: a",
      "",
    ].join("\n");
    const tasks = parseTasksMd(starBulletTasksMd);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe("star-bullet");
    expect(tasks[0]?.hypothesis).toBe("h");
  });
});

describe("pickHostTask", () => {
  test("returns the first rule-#9-compliant P0 task", () => {
    const task = pickHostTask(sampleTasksMd);
    expect(task).not.toBeNull();
    expect(task?.id).toBe("proj-840-slash-command-labels");
    expect(task?.priority).toBe("P0");
  });

  test("returns null when no rule-#9-compliant task exists", () => {
    const tasksMd = `# Tasks

## P0

- [ ] Incomplete task
  **ID**: incomplete-task
  **Tags**: bug
`;
    expect(pickHostTask(tasksMd)).toBeNull();
  });

  test("returns null when TASKS.md is empty", () => {
    expect(pickHostTask("# Tasks\n")).toBeNull();
  });

  test("prefers P0 over P1 even when P1 appears first in document order", () => {
    const tasksMd = `# Tasks

## P1

- [ ] P1-first
  **ID**: p1-first
  **Hypothesis**: h
  **Success**: s
  **Pivot**: p
  **Measurement**: m
  **Anchor**: a

## P0

- [ ] P0-second
  **ID**: p0-second
  **Hypothesis**: h
  **Success**: s
  **Pivot**: p
  **Measurement**: m
  **Anchor**: a
`;
    const task = pickHostTask(tasksMd);
    expect(task?.id).toBe("p0-second");
  });

  test("falls through to P1 when no P0 task is eligible", () => {
    const tasksMd = `# Tasks

## P0

- [ ] Incomplete P0
  **ID**: incomplete-p0
  **Tags**: bug

## P1

- [ ] Complete P1
  **ID**: complete-p1
  **Hypothesis**: h
  **Success**: s
  **Pivot**: p
  **Measurement**: m
  **Anchor**: a
`;
    const task = pickHostTask(tasksMd);
    expect(task?.id).toBe("complete-p1");
    expect(task?.priority).toBe("P1");
  });

  test("ignores P2 / P3 tasks even when fully rule-#9 compliant", () => {
    const tasksMd = `# Tasks

## P2

- [ ] P2 task
  **ID**: p2-task
  **Hypothesis**: h
  **Success**: s
  **Pivot**: p
  **Measurement**: m
  **Anchor**: a
`;
    expect(pickHostTask(tasksMd)).toBeNull();
  });
});

describe("isHostTaskEligible", () => {
  test("true when all 5 rule-#9 fields are present", () => {
    expect(
      isHostTaskEligible({
        id: "x",
        title: "t",
        priority: "P0",
        tags: [],
        details: null,
        hypothesis: "h",
        success: "s",
        pivot: "p",
        measurement: "m",
        anchor: "a",
      }),
    ).toBe(true);
  });

  test("false when any one rule-#9 field is missing", () => {
    const base = {
      id: "x",
      title: "t",
      priority: "P0",
      tags: [],
      details: null,
      hypothesis: "h",
      success: "s",
      pivot: "p",
      measurement: "m",
      anchor: "a",
    };
    expect(isHostTaskEligible({ ...base, hypothesis: null })).toBe(false);
    expect(isHostTaskEligible({ ...base, success: null })).toBe(false);
    expect(isHostTaskEligible({ ...base, pivot: null })).toBe(false);
    expect(isHostTaskEligible({ ...base, measurement: null })).toBe(false);
    expect(isHostTaskEligible({ ...base, anchor: null })).toBe(false);
  });
});
