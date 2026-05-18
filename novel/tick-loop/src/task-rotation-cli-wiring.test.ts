import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createFileBackedGetTasksMd,
  createGhMergedPrList,
  createGitBackedApplyRemoval,
} from "./task-rotation-cli-wiring.js";

describe("createFileBackedGetTasksMd", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), "task-rotation-tasks-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the file contents verbatim when TASKS.md exists", async () => {
    const path = resolve(dir, "TASKS.md");
    const body = "# Tasks\n\n## P0\n\n- [ ] `x` — y\n";
    writeFileSync(path, body, "utf-8");
    const read = createFileBackedGetTasksMd(path);
    expect(await read()).toBe(body);
  });

  it("degrades to '' on ENOENT (genesis / no-TASKS.md case)", async () => {
    const read = createFileBackedGetTasksMd(resolve(dir, "TASKS.md"));
    expect(await read()).toBe("");
  });

  it("degrades to '' when the parent directory itself is missing (still ENOENT)", async () => {
    const read = createFileBackedGetTasksMd(resolve(dir, "missing-subdir", "TASKS.md"));
    expect(await read()).toBe("");
  });

  it("propagates non-ENOENT errors (EISDIR — the path is a directory)", async () => {
    // The TASKS.md path being a directory is a misconfigured repo, not the
    // genesis case. It must surface as a real crash, not a silent "" that
    // makes the watchdog never rotate.
    const read = createFileBackedGetTasksMd(dir);
    await expect(read()).rejects.toMatchObject({ code: "EISDIR" });
  });

  it("re-reads per call (rotating a block out is observed next call)", async () => {
    const path = resolve(dir, "TASKS.md");
    writeFileSync(path, "before", "utf-8");
    const read = createFileBackedGetTasksMd(path);
    expect(await read()).toBe("before");
    writeFileSync(path, "after", "utf-8");
    expect(await read()).toBe("after");
  });
});

// ---- createGhMergedPrList -------------------------------------------------

describe("createGhMergedPrList", () => {
  it("invokes `gh pr list --state merged --json number,title,state --limit 50` by default", async () => {
    let captured: readonly string[] = [];
    const list = createGhMergedPrList({
      runGhPrList: async (args) => {
        captured = args;
        return "[]";
      },
    });
    await list();
    expect(captured).toEqual([
      "pr",
      "list",
      "--state",
      "merged",
      "--json",
      "number,title,state",
      "--limit",
      "50",
    ]);
  });

  it("honors a custom --limit", async () => {
    let captured: readonly string[] = [];
    const list = createGhMergedPrList({
      limit: 7,
      runGhPrList: async (args) => {
        captured = args;
        return "[]";
      },
    });
    await list();
    expect(captured.slice(-2)).toEqual(["--limit", "7"]);
  });

  it("appends --repo when an override is supplied", async () => {
    let captured: readonly string[] = [];
    const list = createGhMergedPrList({
      repo: "fyodoriv/minsky",
      runGhPrList: async (args) => {
        captured = args;
        return "[]";
      },
    });
    await list();
    expect(captured.slice(-2)).toEqual(["--repo", "fyodoriv/minsky"]);
  });

  it("maps merged rows to MergedPrSnapshot ({ number, title })", async () => {
    const raw = JSON.stringify([
      { number: 309, title: "feat(daemon-pre-pr-lint-gate): gate (#309)", state: "MERGED" },
      { number: 604, title: "feat(daemon-duplicate-work-detection): parser", state: "MERGED" },
    ]);
    const list = createGhMergedPrList({ runGhPrList: async () => raw });
    expect(await list()).toEqual([
      { number: 309, title: "feat(daemon-pre-pr-lint-gate): gate (#309)" },
      { number: 604, title: "feat(daemon-duplicate-work-detection): parser" },
    ]);
  });

  it("filters out non-MERGED rows defensively", async () => {
    const raw = JSON.stringify([
      { number: 1, title: "merged one", state: "MERGED" },
      { number: 2, title: "still open", state: "OPEN" },
      { number: 3, title: "closed unplanned", state: "CLOSED" },
    ]);
    const list = createGhMergedPrList({ runGhPrList: async () => raw });
    expect(await list()).toEqual([{ number: 1, title: "merged one" }]);
  });

  it("degrades to [] on a gh failure (no auto-removal on a gh outage)", async () => {
    const list = createGhMergedPrList({
      runGhPrList: async () => {
        throw new Error("gh: command not found");
      },
    });
    expect(await list()).toEqual([]);
  });

  it("degrades to [] on malformed JSON (reused parser's rule-#6/#7 contract)", async () => {
    const list = createGhMergedPrList({ runGhPrList: async () => "not json {{{" });
    expect(await list()).toEqual([]);
  });
});

// ---- createGitBackedApplyRemoval ------------------------------------------

describe("createGitBackedApplyRemoval", () => {
  it("writes the block-stripped TASKS.md then commits ONLY that file", async () => {
    const writes: { path: string; content: string }[] = [];
    const gitCalls: { args: readonly string[]; cwd: string | undefined }[] = [];
    const apply = createGitBackedApplyRemoval("/repo/TASKS.md", {
      cwd: "/repo",
      writeFileFn: async (path, content) => {
        writes.push({ path, content });
      },
      runGit: async (args, cwd) => {
        gitCalls.push({ args, cwd });
      },
    });
    await apply({
      tasksMd: "# Tasks\n\n## P0\n",
      taskId: "daemon-task-rotation-on-completion",
      viaPrNumber: 630,
      commitMessage: "chore(tasks): auto-remove `x` — shipped via #630 (reason)",
    });
    expect(writes).toEqual([{ path: "/repo/TASKS.md", content: "# Tasks\n\n## P0\n" }]);
    expect(gitCalls).toEqual([
      {
        args: [
          "commit",
          "--only",
          "/repo/TASKS.md",
          "-m",
          "chore(tasks): auto-remove `x` — shipped via #630 (reason)",
        ],
        cwd: "/repo",
      },
    ]);
  });

  it("writes BEFORE it commits (ordering is load-bearing for the diff)", async () => {
    const order: string[] = [];
    const apply = createGitBackedApplyRemoval("/repo/TASKS.md", {
      writeFileFn: async () => {
        order.push("write");
      },
      runGit: async () => {
        order.push("commit");
      },
    });
    await apply({ tasksMd: "x", taskId: "t", viaPrNumber: 1, commitMessage: "m" });
    expect(order).toEqual(["write", "commit"]);
  });

  it("passes cwd: undefined through to the git runner when not configured", async () => {
    let seenCwd: string | undefined = "sentinel";
    const apply = createGitBackedApplyRemoval("/repo/TASKS.md", {
      writeFileFn: async () => {},
      runGit: async (_args, cwd) => {
        seenCwd = cwd;
      },
    });
    await apply({ tasksMd: "x", taskId: "t", viaPrNumber: 1, commitMessage: "m" });
    expect(seenCwd).toBeUndefined();
  });

  it("propagates a git failure (rule #6 let-it-crash — supervisor restarts)", async () => {
    const apply = createGitBackedApplyRemoval("/repo/TASKS.md", {
      writeFileFn: async () => {},
      runGit: async () => {
        throw new Error("git: hook rejected the commit");
      },
    });
    await expect(
      apply({ tasksMd: "x", taskId: "t", viaPrNumber: 1, commitMessage: "m" }),
    ).rejects.toThrow(/hook rejected/);
  });
});
