// Tests for the task-finder. xUnit paired fixtures (Meszaros 2007).

import { describe, expect, test } from "vitest";

import {
  findTask,
  isHostTaskEligible,
  isNotBlocked,
  parseTasksMd,
  pickHostTask,
} from "./task-finder.js";

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

  test("captures multi-line continuation lines under **Details**:", () => {
    // Regression — discovered 2026-05-16 on the example-service-plugin run:
    // `bulletproof-ux-dashboard` had a numbered list under **Details**
    // that the parser silently dropped, so claude --print received a
    // brief with empty actionable steps and shipped nothing. The fix
    // captures any line whose indent is strictly greater than the
    // field-bullet's indent, until a sibling/parent bullet closes it.
    const md = `# Tasks

## P0

- [ ] Sample task with multi-line details

  - **ID**: sample-multiline
  - **Tags**: regression
  - **Hypothesis**: needs to survive multi-line
  - **Success**: details captures all 4 lines
  - **Pivot**: capture only first line
  - **Measurement**: yarn vitest run task-finder
  - **Anchor**: 2026-05-16 example-service-plugin run
  - **Details**: Walk the page state-by-state:
    1. \`default\` — the happy path
    2. \`loading\` — skeleton
    3. \`empty\` — no team
    4. \`error\` — PagerDuty 500

    Reuse \`src/shared/components/{Skeleton, EmptyState}\`.
`;
    const tasks = parseTasksMd(md);
    expect(tasks.length).toBe(1);
    const t = tasks[0];
    expect(t?.details).toContain("Walk the page state-by-state");
    expect(t?.details).toContain("1. `default`");
    expect(t?.details).toContain("4. `error`");
    expect(t?.details).toContain("Reuse");
    expect(t?.anchor).toBe("2026-05-16 example-service-plugin run");
    expect(t?.hypothesis).toBe("needs to survive multi-line");
  });

  test("continuation does not bleed across sibling **Field**: bullets", () => {
    const md = `# Tasks

## P0

- [ ] Sample task

  - **ID**: sample-no-bleed
  - **Tags**: regression
  - **Details**: First line of details.

    Continuation paragraph still part of Details.
  - **Hypothesis**: separate field, not in details
  - **Success**: ok
  - **Pivot**: ok
  - **Measurement**: ok
  - **Anchor**: ok
`;
    const tasks = parseTasksMd(md);
    const t = tasks[0];
    expect(t?.details).toContain("First line of details.");
    expect(t?.details).toContain("Continuation paragraph still part of Details.");
    expect(t?.details).not.toContain("separate field");
    expect(t?.hypothesis).toBe("separate field, not in details");
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

  test("skips tasks whose canonical branch has an open PR", () => {
    // Regression — discovered 2026-05-16 on example-service-plugin run:
    // after a salvage-merge of feat/<task.id> the loop kept re-picking
    // the same task on every iteration until TASKS.md was manually
    // cleaned. The fix lets the runner pass an openPrBranches set so
    // pickHostTask self-heals across the merge-vs-cleanup-task race.
    const tasksMd = `# Tasks

## P1

- [ ] First task (already shipped, has open PR)
  - **ID**: first-task
  - **Hypothesis**: h
  - **Success**: s
  - **Pivot**: p
  - **Measurement**: m
  - **Anchor**: a

- [ ] Second task (next in line)
  - **ID**: second-task
  - **Hypothesis**: h2
  - **Success**: s2
  - **Pivot**: p2
  - **Measurement**: m2
  - **Anchor**: a2
`;
    // Without the filter: first-task wins.
    expect(pickHostTask(tasksMd)?.id).toBe("first-task");
    // With the filter: first-task is skipped, second-task wins.
    const openPrBranches = new Set<string>(["feat/first-task"]);
    expect(pickHostTask(tasksMd, { openPrBranches, branchPrefix: "feat/" })?.id).toBe(
      "second-task",
    );
  });

  test("openPrBranches respects custom branchPrefix", () => {
    const tasksMd = `# Tasks

## P0

- [ ] First task
  - **ID**: first-task
  - **Hypothesis**: h
  - **Success**: s
  - **Pivot**: p
  - **Measurement**: m
  - **Anchor**: a
`;
    // Skip when branch prefix matches.
    expect(
      pickHostTask(tasksMd, {
        openPrBranches: new Set(["chore/first-task"]),
        branchPrefix: "chore/",
      }),
    ).toBeNull();
    // No skip when prefix doesn't match (default is feat/).
    expect(
      pickHostTask(tasksMd, {
        openPrBranches: new Set(["chore/first-task"]),
      })?.id,
    ).toBe("first-task");
  });

  test("skipTaskIds rotates past tasks already validated in this run", () => {
    // Regression — `walker-drains-one-host-forever` (filed 2026-05-18).
    // When a worker validates a task but does NOT open a PR (devin in
    // --print mode pre-fix, or a brief that doesn't instruct PR
    // creation), the task is still listed in TASKS.md AND has no open
    // PR — so `openPrBranches` doesn't filter it out. Without
    // `skipTaskIds`, the loop's next iteration picks the same task
    // again, blocking the walker from advancing to other hosts.
    const tasksMd = `# Tasks

## P0

- [ ] First task
  - **ID**: first-task
  - **Hypothesis**: h
  - **Success**: s
  - **Pivot**: p
  - **Measurement**: m
  - **Anchor**: a

- [ ] Second task
  - **ID**: second-task
  - **Hypothesis**: h2
  - **Success**: s2
  - **Pivot**: p2
  - **Measurement**: m2
  - **Anchor**: a2
`;
    // Without skip: first-task wins.
    expect(pickHostTask(tasksMd)?.id).toBe("first-task");
    // With first-task in skipTaskIds: rotates to second-task.
    expect(pickHostTask(tasksMd, { skipTaskIds: new Set(["first-task"]) })?.id).toBe("second-task");
    // With both in skipTaskIds: no eligible task → null.
    expect(
      pickHostTask(tasksMd, { skipTaskIds: new Set(["first-task", "second-task"]) }),
    ).toBeNull();
  });

  test("skipTaskIds composes with openPrBranches (both filters apply)", () => {
    const tasksMd = `# Tasks

## P0

- [ ] One
  - **ID**: one
  - **Hypothesis**: h
  - **Success**: s
  - **Pivot**: p
  - **Measurement**: m
  - **Anchor**: a

- [ ] Two
  - **ID**: two
  - **Hypothesis**: h
  - **Success**: s
  - **Pivot**: p
  - **Measurement**: m
  - **Anchor**: a

- [ ] Three
  - **ID**: three
  - **Hypothesis**: h
  - **Success**: s
  - **Pivot**: p
  - **Measurement**: m
  - **Anchor**: a
`;
    // `one` has an open PR; `two` was already validated in this run;
    // `three` is the only remaining eligible task.
    const task = pickHostTask(tasksMd, {
      openPrBranches: new Set(["feat/one"]),
      branchPrefix: "feat/",
      skipTaskIds: new Set(["two"]),
    });
    expect(task?.id).toBe("three");
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
        blocked: null,
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
      blocked: null,
    };
    expect(isHostTaskEligible({ ...base, hypothesis: null })).toBe(false);
    expect(isHostTaskEligible({ ...base, success: null })).toBe(false);
    expect(isHostTaskEligible({ ...base, pivot: null })).toBe(false);
    expect(isHostTaskEligible({ ...base, measurement: null })).toBe(false);
    expect(isHostTaskEligible({ ...base, anchor: null })).toBe(false);
  });
});

describe("isNotBlocked", () => {
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
    blocked: null,
  };

  test("true when blocked is null", () => {
    expect(isNotBlocked({ ...base, blocked: null })).toBe(true);
  });

  test("true when blocked is empty string", () => {
    expect(isNotBlocked({ ...base, blocked: "" })).toBe(true);
  });

  test("true when blocked is whitespace-only", () => {
    expect(isNotBlocked({ ...base, blocked: "   " })).toBe(true);
  });

  test("false when blocked carries a real reason", () => {
    expect(isNotBlocked({ ...base, blocked: "needs-user-approval" })).toBe(false);
    expect(isNotBlocked({ ...base, blocked: "needs-external-action — wait on dep" })).toBe(false);
  });
});

describe("parseTasksMd — Blocked field", () => {
  test("captures **Blocked**: reason on the task block", () => {
    const tasksMd = `# Tasks

## P0

- [ ] Task with external block
  - **ID**: blocked-task
  - **Blocked**: needs-external-action — waiting on June 1 CLI release
  - **Hypothesis**: h
  - **Success**: s
  - **Pivot**: p
  - **Measurement**: m
  - **Anchor**: a
`;
    const tasks = parseTasksMd(tasksMd);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.blocked).toBe("needs-external-action — waiting on June 1 CLI release");
  });

  test("blocked is null when the field is absent", () => {
    const tasksMd = `# Tasks

## P0

- [ ] Unblocked task
  - **ID**: unblocked-task
  - **Hypothesis**: h
  - **Success**: s
  - **Pivot**: p
  - **Measurement**: m
  - **Anchor**: a
`;
    const tasks = parseTasksMd(tasksMd);
    expect(tasks[0]?.blocked).toBeNull();
  });

  test("**Blocked by**: <id> task-dependency form does NOT populate `blocked`", () => {
    // `**Blocked by**: <id>` is a separate dependency-graph field
    // resolved at a different layer; the `**Blocked**:` regex must NOT
    // capture it (Blocked by** is a distinct token from Blocked**).
    const tasksMd = `# Tasks

## P0

- [ ] Dep-blocked task
  - **ID**: dep-blocked
  - **Blocked by**: other-task
  - **Hypothesis**: h
  - **Success**: s
  - **Pivot**: p
  - **Measurement**: m
  - **Anchor**: a
`;
    const tasks = parseTasksMd(tasksMd);
    expect(tasks[0]?.blocked).toBeNull();
  });
});

describe("pickHostTask — Blocked filter", () => {
  test("skips a blocked P0 task and falls through to an unblocked P1", () => {
    // Regression — 2026-05-23 honest-status-check verified pickHostTask
    // returned `add-openhands-as-pluggable-backend` despite its
    // `**Blocked**:` field. Wasted iteration budget. Fix: filter
    // blocked tasks in the picker.
    const tasksMd = `# Tasks

## P0

- [ ] Blocked P0
  - **ID**: blocked-p0
  - **Blocked**: needs-external-action — June 1 CLI not yet shipped
  - **Hypothesis**: h
  - **Success**: s
  - **Pivot**: p
  - **Measurement**: m
  - **Anchor**: a

## P1

- [ ] Unblocked P1
  - **ID**: unblocked-p1
  - **Hypothesis**: h
  - **Success**: s
  - **Pivot**: p
  - **Measurement**: m
  - **Anchor**: a
`;
    const task = pickHostTask(tasksMd);
    expect(task?.id).toBe("unblocked-p1");
    expect(task?.priority).toBe("P1");
  });

  test("returns null when EVERY P0/P1 task is blocked", () => {
    const tasksMd = `# Tasks

## P0

- [ ] Blocked P0
  - **ID**: blocked-p0
  - **Blocked**: needs-user-approval
  - **Hypothesis**: h
  - **Success**: s
  - **Pivot**: p
  - **Measurement**: m
  - **Anchor**: a

## P1

- [ ] Blocked P1
  - **ID**: blocked-p1
  - **Blocked**: policy-refused — not allowed in current scope
  - **Hypothesis**: h
  - **Success**: s
  - **Pivot**: p
  - **Measurement**: m
  - **Anchor**: a
`;
    expect(pickHostTask(tasksMd)).toBeNull();
  });

  test("empty-string blocked field does not exclude the task (graceful absence)", () => {
    // A `**Blocked**:` line with no payload after the colon is treated
    // as not-blocked (graceful absence pattern, same as `details: null`).
    const tasksMd = `# Tasks

## P0

- [ ] Task with empty block
  - **ID**: empty-block
  - **Blocked**: 
  - **Hypothesis**: h
  - **Success**: s
  - **Pivot**: p
  - **Measurement**: m
  - **Anchor**: a
`;
    // Regex requires at least one char after Blocked**:\s* so an empty
    // payload won't even capture; blocked stays null. Worst-case if
    // someone hand-edits a whitespace-only block, isNotBlocked trims
    // it and still returns true.
    const task = pickHostTask(tasksMd);
    expect(task?.id).toBe("empty-block");
  });
});
