// Tests for daemon-task-rotation.ts — the I/O wrapper around the pure
// `decideTaskCompletion` detector. Paired positive/negative fixtures
// (Meszaros 2007); the seams are injected so no filesystem / gh / git.

import { describe, expect, it, vi } from "vitest";

import {
  type RunTaskRotationArgs,
  rotationCommitMessage,
  runTaskRotation,
  spliceTaskBlock,
} from "./daemon-task-rotation.js";
import type { MergedPrSnapshot } from "./task-completion-detector.js";

const SHIPPED_BLOCK = [
  "- [ ] `shipped-task` — substrate already merged",
  "  - **ID**: shipped-task",
  "  - **Tags**: p0",
  "  - **Hypothesis**: H",
  "  - **Acceptance**: All criteria below ship.",
].join("\n");

const NEXT_BLOCK = [
  "- [ ] `other-task` — still open",
  "  - **ID**: other-task",
  "  - **Tags**: p1",
].join("\n");

function tasksMdWith(...sections: string[]): string {
  return `# Tasks\n\n## P0\n\n${sections.join("\n\n")}\n`;
}

describe("spliceTaskBlock", () => {
  it("removes a mid-file block and keeps the surviving heading at column 0", () => {
    const md = tasksMdWith(SHIPPED_BLOCK, NEXT_BLOCK);
    const result = spliceTaskBlock(md, "shipped-task");
    expect(result).toBeDefined();
    if (result === undefined) throw new Error("unreachable");
    expect(result.block).toContain("**ID**: shipped-task");
    expect(result.without).not.toContain("shipped-task");
    expect(result.without).toContain("- [ ] `other-task`");
    // No double blank line ahead of the surviving heading.
    expect(result.without).not.toMatch(/\n\n\n- \[ \] `other-task`/);
  });

  it("removes the last block before EOF and collapses trailing whitespace", () => {
    const md = tasksMdWith(NEXT_BLOCK, SHIPPED_BLOCK);
    const result = spliceTaskBlock(md, "shipped-task");
    expect(result).toBeDefined();
    if (result === undefined) throw new Error("unreachable");
    expect(result.without).not.toContain("shipped-task");
    expect(result.without).toContain("- [ ] `other-task`");
    expect(result.without.endsWith("\n")).toBe(true);
    expect(result.without).not.toMatch(/\n\n+$/);
  });

  it("uses the next `## ` section heading as the block boundary", () => {
    const md = `# Tasks\n\n## P0\n\n${SHIPPED_BLOCK}\n\n## P1\n\n${NEXT_BLOCK}\n`;
    const result = spliceTaskBlock(md, "shipped-task");
    expect(result).toBeDefined();
    if (result === undefined) throw new Error("unreachable");
    expect(result.without).toContain("## P1");
    expect(result.without).not.toContain("shipped-task");
  });

  it("returns undefined when the task ID is absent (already rotated out)", () => {
    expect(spliceTaskBlock(tasksMdWith(NEXT_BLOCK), "shipped-task")).toBeUndefined();
  });

  it("escapes regex metacharacters in the task ID", () => {
    const block = "- [ ] `rule-#13.4` — x\n  - **ID**: rule-#13.4";
    const md = tasksMdWith(block, NEXT_BLOCK);
    const result = spliceTaskBlock(md, "rule-#13.4");
    expect(result).toBeDefined();
    if (result === undefined) throw new Error("unreachable");
    expect(result.without).not.toContain("rule-#13.4");
  });
});

describe("rotationCommitMessage", () => {
  it("names the task, the via-PR, and the criteria-checker reason", () => {
    expect(
      rotationCommitMessage({
        taskId: "shipped-task",
        viaPrNumber: 309,
        reason: "1 merged PR(s) named shipped-task; latest #309",
      }),
    ).toBe(
      "chore(tasks): auto-remove `shipped-task` — shipped via #309 (1 merged PR(s) named shipped-task; latest #309)",
    );
  });
});

type Seams = {
  getTasksMd: ReturnType<typeof vi.fn>;
  listMergedPrs: ReturnType<typeof vi.fn>;
  applyRemoval: ReturnType<typeof vi.fn>;
};

function seams(opts: {
  tasksMd?: string;
  mergedPrs?: readonly MergedPrSnapshot[];
}): Seams {
  return {
    getTasksMd: vi.fn(async () => opts.tasksMd ?? ""),
    listMergedPrs: vi.fn(async () => opts.mergedPrs ?? []),
    applyRemoval: vi.fn(async () => {}),
  };
}

function args(over: Partial<RunTaskRotationArgs> & Seams): RunTaskRotationArgs {
  return {
    taskId: "shipped-task",
    env: {},
    ...over,
  };
}

describe("runTaskRotation", () => {
  it("skips on MINSKY_TASK_ROTATION=off without reading TASKS.md", async () => {
    const s = seams({});
    const out = await runTaskRotation(args({ ...s, env: { MINSKY_TASK_ROTATION: "off" } }));
    expect(out).toEqual({ outcome: "skipped", reason: "env-off" });
    expect(s.getTasksMd).not.toHaveBeenCalled();
  });

  it("skips when the iteration picked no task", async () => {
    const s = seams({});
    const out = await runTaskRotation(args({ ...s, taskId: undefined }));
    expect(out).toEqual({ outcome: "skipped", reason: "no-task-id" });
    expect(s.getTasksMd).not.toHaveBeenCalled();
  });

  it("skips on a blank task ID", async () => {
    const s = seams({});
    const out = await runTaskRotation(args({ ...s, taskId: "   " }));
    expect(out).toEqual({ outcome: "skipped", reason: "no-task-id" });
  });

  it("skips on block-absent WITHOUT the gh round-trip (round-trip elimination)", async () => {
    const s = seams({ tasksMd: tasksMdWith(NEXT_BLOCK) });
    const out = await runTaskRotation(args({ ...s }));
    expect(out).toEqual({ outcome: "skipped", reason: "block-absent" });
    expect(s.getTasksMd).toHaveBeenCalledTimes(1);
    // The optimization under test: no `gh pr list` when there's no block.
    expect(s.listMergedPrs).not.toHaveBeenCalled();
    expect(s.applyRemoval).not.toHaveBeenCalled();
  });

  it("keeps the block when Acceptance has unchecked boxes", async () => {
    const block = [
      "- [ ] `shipped-task` — x",
      "  - **ID**: shipped-task",
      "  - **Acceptance**: (1) `[x]` slice a; (2) `[ ]` slice b.",
    ].join("\n");
    const s = seams({
      tasksMd: tasksMdWith(block, NEXT_BLOCK),
      mergedPrs: [{ number: 7, title: "feat(shipped-task): slice a" }],
    });
    const out = await runTaskRotation(args({ ...s }));
    expect(out.outcome).toBe("kept");
    expect(s.applyRemoval).not.toHaveBeenCalled();
  });

  it("reports no-merged-pr when no merged PR names the task", async () => {
    const s = seams({
      tasksMd: tasksMdWith(SHIPPED_BLOCK, NEXT_BLOCK),
      mergedPrs: [{ number: 1, title: "feat(other-task): unrelated" }],
    });
    const out = await runTaskRotation(args({ ...s }));
    expect(out.outcome).toBe("no-merged-pr");
    expect(s.applyRemoval).not.toHaveBeenCalled();
  });

  it("removes the block + commits when substrate shipped via a merged PR", async () => {
    const s = seams({
      tasksMd: tasksMdWith(SHIPPED_BLOCK, NEXT_BLOCK),
      mergedPrs: [{ number: 309, title: "feat(shipped-task): the substrate" }],
    });
    const out = await runTaskRotation(args({ ...s }));
    expect(out.outcome).toBe("removed");
    if (out.outcome !== "removed") throw new Error("unreachable");
    expect(out.viaPrNumber).toBe(309);
    expect(s.applyRemoval).toHaveBeenCalledTimes(1);
    const firstCall = s.applyRemoval.mock.calls[0];
    if (firstCall === undefined) throw new Error("unreachable");
    const call = firstCall[0] as {
      tasksMd: string;
      commitMessage: string;
      viaPrNumber: number;
    };
    expect(call.tasksMd).not.toContain("shipped-task");
    expect(call.tasksMd).toContain("- [ ] `other-task`");
    expect(call.viaPrNumber).toBe(309);
    expect(call.commitMessage).toMatch(
      /^chore\(tasks\): auto-remove `shipped-task` — shipped via #309 \(/,
    );
  });
});
