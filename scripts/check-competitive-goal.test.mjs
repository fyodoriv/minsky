import { describe, expect, test } from "vitest";

import { classifyTasks, parseTasks } from "./check-competitive-goal.mjs";

const MINIMAL_TASKSMD = `# Tasks

## P0

- [ ] First P0 task with the field
  - **ID**: first-p0-with-field
  - **Tags**: p0
  - **Competitive-goal**: drives \`autonomous-merge-rate\` toward 0.80.
  - **Details**: ...

- [ ] Second P0 task WITHOUT the field
  - **ID**: second-p0-missing-field
  - **Tags**: p0
  - **Details**: ...

## P1

- [ ] First P1 task WITHOUT the field
  - **ID**: first-p1-missing-field
  - **Tags**: p1
  - **Details**: ...

- [ ] Second P1 task with the field
  - **ID**: second-p1-with-field
  - **Tags**: p1
  - **Competitive-goal**: drives \`cost-per-merged-pr\` down.
  - **Details**: ...

## P2

- [ ] P2 task without the field — exempt per the lint
  - **ID**: p2-exempt
  - **Tags**: p2
  - **Details**: ...

## P3

- [ ] P3 task without the field — exempt per the lint
  - **ID**: p3-exempt
  - **Tags**: p3
  - **Details**: ...
`;

describe("parseTasks", () => {
  test("(a) parses every priority-classified task block with its id and competitive-goal status", () => {
    const tasks = parseTasks(MINIMAL_TASKSMD);
    expect(tasks).toHaveLength(6);
    const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
    expect(byId["first-p0-with-field"]?.priority).toBe("P0");
    expect(byId["first-p0-with-field"]?.hasCompetitiveGoal).toBe(true);
    expect(byId["second-p0-missing-field"]?.hasCompetitiveGoal).toBe(false);
    expect(byId["first-p1-missing-field"]?.priority).toBe("P1");
    expect(byId["first-p1-missing-field"]?.hasCompetitiveGoal).toBe(false);
    expect(byId["second-p1-with-field"]?.hasCompetitiveGoal).toBe(true);
    expect(byId["p2-exempt"]?.priority).toBe("P2");
    expect(byId["p3-exempt"]?.priority).toBe("P3");
  });

  test("(b) skips lines outside any priority section (e.g. preamble)", () => {
    const body =
      "# Tasks\n\nIntro paragraph.\n\n- [ ] Orphan task before any heading\n  - **ID**: orphan\n\n## P0\n\n- [ ] Real task\n  - **ID**: real\n  - **Competitive-goal**: x\n";
    const tasks = parseTasks(body);
    // The orphan task has no priority section assignment so it does NOT
    // appear in the classified output (priority="" is filtered).
    expect(tasks.map((t) => t.id)).toEqual(["real"]);
  });

  test("(c) tolerates `- [x]` (checked) and `- [ ]` (unchecked) markers", () => {
    const body =
      "# Tasks\n\n## P0\n\n- [x] Completed task\n  - **ID**: done\n  - **Competitive-goal**: x\n";
    const tasks = parseTasks(body);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.hasCompetitiveGoal).toBe(true);
  });

  test("(d) flags empty `**Competitive-goal**:` as missing (no whitespace-only allowed)", () => {
    const body =
      "# Tasks\n\n## P0\n\n- [ ] Task with empty field\n  - **ID**: empty\n  - **Competitive-goal**:   \n  - **Details**: ...\n";
    const tasks = parseTasks(body);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.hasCompetitiveGoal).toBe(false);
  });

  test("(e) requires the exact label `**Competitive-goal**:` (case-sensitive)", () => {
    const body =
      "# Tasks\n\n## P0\n\n- [ ] Task with wrong-case field\n  - **ID**: wrong-case\n  - **competitive-goal**: lowercase variant\n";
    const tasks = parseTasks(body);
    expect(tasks).toHaveLength(1);
    // Lowercase variant should NOT match (we require the canonical capitalization).
    expect(tasks[0]?.hasCompetitiveGoal).toBe(false);
  });
});

describe("classifyTasks", () => {
  test("(f) P0/P1 missing the field are violators; P2/P3 are exempt", () => {
    const tasks = parseTasks(MINIMAL_TASKSMD);
    const { violators, grandfathered } = classifyTasks(tasks);
    // The minimal fixture's grandfather list is empty (only the
    // production allowlist is populated; tests don't run against it).
    expect(grandfathered).toHaveLength(0);
    expect(violators.map((v) => v.id).sort()).toEqual([
      "first-p1-missing-field",
      "second-p0-missing-field",
    ]);
    // P2/P3 must NOT appear in either list
    const allIds = [...violators, ...grandfathered].map((t) => t.id);
    expect(allIds).not.toContain("p2-exempt");
    expect(allIds).not.toContain("p3-exempt");
  });

  test("(g) tasks that DO carry the field never appear in either list", () => {
    const tasks = parseTasks(MINIMAL_TASKSMD);
    const { violators, grandfathered } = classifyTasks(tasks);
    const allIds = [...violators, ...grandfathered].map((t) => t.id);
    expect(allIds).not.toContain("first-p0-with-field");
    expect(allIds).not.toContain("second-p1-with-field");
  });
});
