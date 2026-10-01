// Paired tests for `auto-close-orphan-prs.mjs`. Pure-function
// tests over `extractTaskIdFromBranch`, `decideOrphanClose`, and
// `executeOrphanCloses` with injected I/O seams (rule #2).

import { describe, expect, test } from "vitest";

import {
  decideOrphanClose,
  executeOrphanCloses,
  extractTaskIdFromBranch,
} from "./auto-close-orphan-prs.mjs";

describe("extractTaskIdFromBranch", () => {
  test("strips known daemon-shaped prefixes (feat/fix/chore/docs/refactor/test)", () => {
    expect(extractTaskIdFromBranch("feat/some-feature-task")).toBe("some-feature-task");
    expect(extractTaskIdFromBranch("chore/some-chore-task")).toBe("some-chore-task");
    expect(extractTaskIdFromBranch("docs/some-docs-task")).toBe("some-docs-task");
    expect(extractTaskIdFromBranch("refactor/refactor-thing")).toBe("refactor-thing");
    expect(extractTaskIdFromBranch("test/test-thing")).toBe("test-thing");
    expect(extractTaskIdFromBranch("fix/fix-thing")).toBe("fix-thing");
  });

  test("returns null for non-daemon-shaped branches", () => {
    expect(extractTaskIdFromBranch("main")).toBeNull();
    expect(extractTaskIdFromBranch("operator-branch")).toBeNull();
    expect(extractTaskIdFromBranch("dependabot/npm/foo")).toBeNull();
  });

  test("strips trailing slash-separated components (flat kebab-case only)", () => {
    expect(extractTaskIdFromBranch("feat/foo/bar")).toBe("foo");
  });
});

/** @returns {import("./auto-close-orphan-prs.mjs").OpenPrSnapshot} */
function pr(over = {}) {
  return {
    number: 100,
    headRefName: "feat/some-task",
    title: "feat: some task",
    author: "fyodoriv",
    ...over,
  };
}

describe("decideOrphanClose — pure decisions", () => {
  test("closes a daemon PR whose task ID is absent from TASKS.md", () => {
    const decisions = decideOrphanClose([pr({ headRefName: "feat/missing-task" })], {
      tasksMdContent: "# Tasks\n\n## P0\n\n- [ ] `other-task`\n  - **ID**: other-task\n",
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.action).toBe("close");
    expect(decisions[0]?.taskId).toBe("missing-task");
  });

  test("skips a daemon PR whose task ID is still in TASKS.md", () => {
    const decisions = decideOrphanClose([pr({ headRefName: "feat/active-task" })], {
      tasksMdContent: "# Tasks\n\n## P0\n\n- [ ] `active-task`\n  - **ID**: active-task\n",
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.action).toBe("skip");
    expect(decisions[0]?.reason).toMatch(/still in TASKS\.md/);
  });

  test("skips a non-daemon-shaped branch (operator's hand-authored work)", () => {
    const decisions = decideOrphanClose([pr({ headRefName: "operator-experiment" })], {
      tasksMdContent: "",
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.action).toBe("skip");
    expect(decisions[0]?.reason).toMatch(/not daemon-shaped/);
  });

  test("respects --limit cap (bounded per-cycle work)", () => {
    const prs = Array.from({ length: 10 }, (_, i) =>
      pr({ number: 200 + i, headRefName: `feat/orphan-${i}` }),
    );
    const decisions = decideOrphanClose(prs, { tasksMdContent: "", limit: 3 });
    expect(decisions.filter((d) => d.action === "close")).toHaveLength(3);
  });

  test("substring-safe: does NOT false-positive when prose mentions the task ID", () => {
    // Prose mentions like "see also missing-task" should NOT count as
    // the task being present — only `**ID**: missing-task` does.
    const decisions = decideOrphanClose([pr({ headRefName: "feat/missing-task" })], {
      tasksMdContent:
        "# Tasks\n\n## P3\n\n- [ ] some other task referencing `missing-task` in prose\n",
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.action).toBe("close");
  });

  test("skips an operator-authored daemon-shaped branch (no experiment-store row)", () => {
    // Regression for 2026-05-27 PR #902 false-positive: branch
    // `feat/metric-list-single-source` matched the daemon prefix
    // shape but was operator-authored — no experiment-store row exists
    // for that task ID. The daemon never opened the PR, so the orphan
    // heuristic must NOT close it. The positive `daemonOpenedTaskIds`
    // signal is the discriminator.
    const decisions = decideOrphanClose([pr({ headRefName: "feat/metric-list-single-source" })], {
      tasksMdContent: "# Tasks\n\n## P0\n\n- [ ] some unrelated task\n  - **ID**: other\n",
      daemonOpenedTaskIds: new Set(["daemon-iterated-task-1", "daemon-iterated-task-2"]),
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.action).toBe("skip");
    expect(decisions[0]?.reason).toMatch(/operator-authored|not opened by daemon/);
  });

  test("closes a daemon-opened PR when its task ID is absent from TASKS.md AND present in experiment-store", () => {
    // Companion to the regression test above: when the daemon HAS
    // touched the task (experiment-store row exists) AND the task is
    // absent from TASKS.md (operator removed it), the orphan
    // heuristic should still close the PR — that's the load-bearing
    // case the script was originally written for.
    const decisions = decideOrphanClose([pr({ headRefName: "feat/daemon-shipped-task" })], {
      tasksMdContent: "# Tasks\n\n## P0\n\n- [ ] some other task\n  - **ID**: other\n",
      daemonOpenedTaskIds: new Set(["daemon-shipped-task"]),
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.action).toBe("close");
    expect(decisions[0]?.taskId).toBe("daemon-shipped-task");
  });
});

describe("executeOrphanCloses — actions via injected seams", () => {
  test("close action invokes the closeFn with pr + task ID", () => {
    /** @type {Array<{pr:number,taskId:string}>} */
    const calls = [];
    /** @type {(n: number, taskId: string) => void} */
    const closeFn = (n, taskId) => {
      calls.push({ pr: n, taskId });
    };
    const out = executeOrphanCloses(
      [{ pr: 100, taskId: "task-a", action: "close", reason: "absent" }],
      { closeFn, dryRun: false },
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.outcome).toBe("closed");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ pr: 100, taskId: "task-a" });
  });

  test("dry-run: closeFn is NEVER called", () => {
    let closeCalled = 0;
    const closeFn = () => {
      closeCalled += 1;
    };
    const out = executeOrphanCloses(
      [{ pr: 200, taskId: "task-b", action: "close", reason: "absent" }],
      { closeFn, dryRun: true },
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.outcome).toBe("dry-run");
    expect(closeCalled).toBe(0);
  });

  test("skip decisions pass through to skipped outcome", () => {
    const out = executeOrphanCloses(
      [{ pr: 300, taskId: "task-c", action: "skip", reason: "still in TASKS.md" }],
      {
        closeFn: () => {
          /* no-op */
        },
        dryRun: false,
      },
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.outcome).toBe("skipped");
  });
});
