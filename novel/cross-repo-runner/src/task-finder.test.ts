// Tests for the task-finder. xUnit paired fixtures (Meszaros 2007).

import { describe, expect, test } from "vitest";

import { findTask, parseTasksMd } from "./task-finder.js";

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
});
