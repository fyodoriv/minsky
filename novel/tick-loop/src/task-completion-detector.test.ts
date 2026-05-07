import { describe, expect, it } from "vitest";
import { decideTaskCompletion, titleNamesTask } from "./task-completion-detector.js";

describe("titleNamesTask", () => {
  it("matches feat(task-id): … shape with word boundaries", () => {
    expect(titleNamesTask("feat(my-task): foo", "my-task")).toBe(true);
    expect(titleNamesTask("feat(my-task-extension): foo", "my-task")).toBe(false);
  });

  it("escapes regex metacharacters", () => {
    expect(titleNamesTask("feat(rule-#13.4): foo", "rule-#13.4")).toBe(true);
  });
});

describe("decideTaskCompletion", () => {
  const TASK_BLOCK_NO_ACCEPTANCE = [
    "- [ ] `my-task` — clean",
    "  - **ID**: my-task",
    "  - **Tags**: p0",
    "  - **Hypothesis**: H",
  ].join("\n");

  const TASK_BLOCK_ACCEPTANCE_ALL_CHECKED = [
    "- [ ] `my-task` — clean",
    "  - **ID**: my-task",
    "  - **Hypothesis**: H",
    "  - **Acceptance**: All criteria below ship.",
    "  - **Anchor**: rule #9",
  ].join("\n");

  const TASK_BLOCK_ACCEPTANCE_HAS_UNCHECKED = [
    "- [ ] `my-task` — clean",
    "  - **ID**: my-task",
    "  - **Hypothesis**: H",
    "  - **Acceptance**: (1) `[x]` slice 1 ships; (2) `[ ]` slice 2 ships.",
    "  - **Anchor**: rule #9",
  ].join("\n");

  it("returns 'no-merged-pr' when no merged PR names the task", () => {
    const verdict = decideTaskCompletion({
      taskId: "my-task",
      taskBlock: TASK_BLOCK_NO_ACCEPTANCE,
      mergedPrs: [{ number: 1, title: "feat(other): bar" }],
    });
    expect(verdict.kind).toBe("no-merged-pr");
  });

  it("returns 'remove' when a merged PR names the task and there's no Acceptance field", () => {
    const verdict = decideTaskCompletion({
      taskId: "my-task",
      taskBlock: TASK_BLOCK_NO_ACCEPTANCE,
      mergedPrs: [{ number: 7, title: "feat(my-task): slice 1" }],
    });
    expect(verdict.kind).toBe("remove");
    if (verdict.kind !== "remove") throw new Error("unreachable");
    expect(verdict.viaPrNumber).toBe(7);
    expect(verdict.reason).toContain("no **Acceptance** field");
  });

  it("returns 'remove' when Acceptance field exists with no unchecked boxes", () => {
    const verdict = decideTaskCompletion({
      taskId: "my-task",
      taskBlock: TASK_BLOCK_ACCEPTANCE_ALL_CHECKED,
      mergedPrs: [{ number: 7, title: "feat(my-task): slice 1" }],
    });
    expect(verdict.kind).toBe("remove");
    if (verdict.kind !== "remove") throw new Error("unreachable");
    expect(verdict.reason).toContain("no unchecked boxes");
  });

  it("returns 'keep' when Acceptance field has unchecked `[ ]` boxes", () => {
    const verdict = decideTaskCompletion({
      taskId: "my-task",
      taskBlock: TASK_BLOCK_ACCEPTANCE_HAS_UNCHECKED,
      mergedPrs: [{ number: 7, title: "feat(my-task): slice 1" }],
    });
    expect(verdict.kind).toBe("keep");
    if (verdict.kind !== "keep") throw new Error("unreachable");
    expect(verdict.reason).toContain("unchecked");
  });

  it("picks the LATEST merged PR's number when multiple match", () => {
    const verdict = decideTaskCompletion({
      taskId: "my-task",
      taskBlock: TASK_BLOCK_NO_ACCEPTANCE,
      mergedPrs: [
        { number: 5, title: "feat(my-task): slice 1" },
        { number: 7, title: "feat(my-task): slice 2" },
        { number: 9, title: "feat(my-task): slice 3" },
      ],
    });
    expect(verdict.kind).toBe("remove");
    if (verdict.kind !== "remove") throw new Error("unreachable");
    expect(verdict.viaPrNumber).toBe(9);
  });

  it("does not match different task IDs (suffix collision protection)", () => {
    const verdict = decideTaskCompletion({
      taskId: "my-task",
      taskBlock: TASK_BLOCK_NO_ACCEPTANCE,
      mergedPrs: [{ number: 7, title: "feat(my-task-extension): slice 1" }],
    });
    expect(verdict.kind).toBe("no-merged-pr");
  });

  it("ignores empty Acceptance field (treats as no-field)", () => {
    const block = ["- [ ] `my-task` — clean", "  - **ID**: my-task", "  - **Acceptance**: "].join(
      "\n",
    );
    const verdict = decideTaskCompletion({
      taskId: "my-task",
      taskBlock: block,
      mergedPrs: [{ number: 7, title: "feat(my-task): foo" }],
    });
    expect(verdict.kind).toBe("remove");
  });

  it("**Status**: in-progress vetoes auto-removal even with merged PRs", () => {
    const block = [
      "- [ ] `my-task` — clean",
      "  - **ID**: my-task",
      "  - **Status**: in-progress",
      "  - **Hypothesis**: H",
    ].join("\n");
    const verdict = decideTaskCompletion({
      taskId: "my-task",
      taskBlock: block,
      mergedPrs: [{ number: 7, title: "feat(my-task): slice 1" }],
    });
    expect(verdict.kind).toBe("keep");
    if (verdict.kind !== "keep") throw new Error("unreachable");
    expect(verdict.reason).toContain("in-progress");
  });

  it("**Status**: blocked vetoes auto-removal", () => {
    const block = [
      "- [ ] `my-task` — clean",
      "  - **ID**: my-task",
      "  - **Status**: blocked",
    ].join("\n");
    const verdict = decideTaskCompletion({
      taskId: "my-task",
      taskBlock: block,
      mergedPrs: [{ number: 7, title: "feat(my-task): slice 1" }],
    });
    expect(verdict.kind).toBe("keep");
    if (verdict.kind !== "keep") throw new Error("unreachable");
    expect(verdict.reason).toContain("blocked");
  });

  it("**Status**: shipped + merged PR is the fast path", () => {
    const block = [
      "- [ ] `my-task` — clean",
      "  - **ID**: my-task",
      "  - **Status**: shipped",
    ].join("\n");
    const verdict = decideTaskCompletion({
      taskId: "my-task",
      taskBlock: block,
      mergedPrs: [{ number: 7, title: "feat(my-task): slice 1" }],
    });
    expect(verdict.kind).toBe("remove");
    if (verdict.kind !== "remove") throw new Error("unreachable");
    expect(verdict.reason).toContain("**Status**: shipped");
  });

  it("**Status**: shipped without merged PR still requires the merged PR (defensive)", () => {
    const block = [
      "- [ ] `my-task` — clean",
      "  - **ID**: my-task",
      "  - **Status**: shipped",
    ].join("\n");
    const verdict = decideTaskCompletion({
      taskId: "my-task",
      taskBlock: block,
      mergedPrs: [],
    });
    expect(verdict.kind).toBe("no-merged-pr");
  });

  it("unknown **Status** value falls back to heuristics (no opinion)", () => {
    const block = [
      "- [ ] `my-task` — clean",
      "  - **ID**: my-task",
      "  - **Status**: typo-here",
    ].join("\n");
    const verdict = decideTaskCompletion({
      taskId: "my-task",
      taskBlock: block,
      mergedPrs: [{ number: 7, title: "feat(my-task): slice 1" }],
    });
    expect(verdict.kind).toBe("remove");
  });

  it("folder-mode (whole-file as block) — works the same as single-file mode", () => {
    // Whole-file shape: no leading `- [ ]` checkbox bullet (that lives in
    // the parent TASKS.md heading); fields stand alone at top of file.
    const wholeFile = [
      "# my-task",
      "",
      "**ID**: my-task",
      "**Tags**: p0",
      "**Hypothesis**: H",
      "**Acceptance**: All criteria below ship.",
      "**Status**: shipped",
    ].join("\n");
    const verdict = decideTaskCompletion({
      taskId: "my-task",
      taskBlock: wholeFile,
      mergedPrs: [{ number: 7, title: "feat(my-task): slice 1" }],
    });
    expect(verdict.kind).toBe("remove");
  });
});
