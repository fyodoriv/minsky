// @ts-check
import { describe, expect, it } from "vitest";
import { checkTouchesField, parseP0P1Blocks } from "./check-touches-field.mjs";

describe("parseP0P1Blocks", () => {
  it("extracts P0 task blocks", () => {
    const md = [
      "# Tasks",
      "",
      "## P0",
      "",
      "- [ ] `task-a` — title",
      "  - **ID**: task-a",
      "  - **Touches**: novel/foo/",
      "",
      "## P1",
      "",
      "- [ ] `task-b` — title",
      "  - **ID**: task-b",
      "",
      "## P2",
      "",
      "- [ ] `task-c` — title",
      "  - **ID**: task-c",
    ].join("\n");
    const blocks = parseP0P1Blocks(md);
    expect(blocks.length).toBe(2);
    expect(blocks[0]?.id).toBe("task-a");
    expect(blocks[0]?.section).toBe("P0");
    expect(blocks[1]?.id).toBe("task-b");
    expect(blocks[1]?.section).toBe("P1");
  });

  it("preserves body across blank lines between title and metadata", () => {
    const md = [
      "## P1",
      "",
      "- [ ] `task-a` — title",
      "",
      "  - **ID**: task-a",
      "  - **Touches**: foo/",
    ].join("\n");
    const blocks = parseP0P1Blocks(md);
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.body).toContain("**Touches**: foo/");
  });

  it("ignores P2/P3 blocks", () => {
    const md = ["## P2", "", "- [ ] `p2-task` — title", "  - **ID**: p2-task"].join("\n");
    expect(parseP0P1Blocks(md)).toEqual([]);
  });
});

describe("checkTouchesField", () => {
  it("passes when P0/P1 task has Touches field", () => {
    const md = [
      "## P0",
      "",
      "- [ ] `new-task` — title",
      "  - **ID**: new-task",
      "  - **Touches**: novel/foo/, scripts/bar.mjs",
    ].join("\n");
    const result = checkTouchesField({ tasksMdContent: md });
    expect(result.ok).toBe(true);
  });

  it("passes when P0/P1 task has explicit Touches none opt-out", () => {
    const md = [
      "## P0",
      "",
      "- [ ] `new-task` — title",
      "  - **ID**: new-task",
      "  - **Touches**: <none>",
    ].join("\n");
    const result = checkTouchesField({ tasksMdContent: md });
    expect(result.ok).toBe(true);
  });

  it("fails when NEW P0 task lacks Touches", () => {
    const md = [
      "## P0",
      "",
      "- [ ] `brand-new-task` — title",
      "  - **ID**: brand-new-task",
      "  - **Tags**: p0, feature",
    ].join("\n");
    const result = checkTouchesField({ tasksMdContent: md });
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/brand-new-task/);
    expect(result.violations[0]).toMatch(/missing `\*\*Touches\*\*:`/);
  });

  it("fails when NEW P1 task lacks Touches", () => {
    const md = ["## P1", "", "- [ ] `brand-new-p1` — title", "  - **ID**: brand-new-p1"].join("\n");
    const result = checkTouchesField({ tasksMdContent: md });
    expect(result.ok).toBe(false);
  });

  it("ignores P2/P3 tasks", () => {
    const md = ["## P2", "", "- [ ] `p2-task` — title", "  - **ID**: p2-task"].join("\n");
    const result = checkTouchesField({ tasksMdContent: md });
    expect(result.ok).toBe(true);
  });

  it("real production scan passes (smoke against current TASKS.md)", () => {
    const result = checkTouchesField();
    expect(result.ok).toBe(true);
  });
});
