// <!-- scope: paired tests for `task-rotation-cli-wiring.ts` — covers the
// three production-binding factories with injected seams (no real
// subprocess, no real filesystem outside a tmpdir for the file-backed
// reader). Same shape as `metrics-render-cli-wiring.test.ts`. -->
/**
 * Tests for `task-rotation-cli-wiring.ts`. Each factory has a
 * happy-path test, a let-it-crash test (rule #6), and the
 * file-backed reader has an ENOENT-propagation test (the
 * `missing-tasks-md` daemon shape would short-circuit before this is
 * called, but the contract still propagates ENOENT to the
 * supervisor).
 *
 * @module tick-loop/task-rotation-cli-wiring.test
 */

import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile as writeFileNode } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createFileBackedGetTasksMd,
  createGhMergedPrList,
  createGitBackedApplyRemoval,
} from "./task-rotation-cli-wiring.js";

describe("createFileBackedGetTasksMd", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "task-rotation-wiring-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("returns the TASKS.md content as a string when the file exists", async () => {
    const path = join(workDir, "TASKS.md");
    await writeFileNode(path, "# Tasks\n\n## P0\n\n- [ ] `alpha` — a\n", "utf-8");
    const reader = createFileBackedGetTasksMd(path);
    expect(await reader()).toBe("# Tasks\n\n## P0\n\n- [ ] `alpha` — a\n");
  });

  it("re-reads on every call (a write between calls is observed)", async () => {
    const path = join(workDir, "TASKS.md");
    await writeFileNode(path, "v1", "utf-8");
    const reader = createFileBackedGetTasksMd(path);
    expect(await reader()).toBe("v1");
    await writeFileNode(path, "v2", "utf-8");
    expect(await reader()).toBe("v2");
  });

  it("propagates ENOENT (supervisor sees the misconfiguration; the `missing-tasks-md` daemon shape filters this BEFORE the wire-in fires)", async () => {
    const path = join(workDir, "missing.md");
    const reader = createFileBackedGetTasksMd(path);
    await expect(reader()).rejects.toThrow(/ENOENT|no such file/);
  });
});

// ---- Fake child_process.spawn for the gh + git wrappers ------------------

interface FakeSpawnOpts {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  emitErrorBeforeClose?: Error;
}

/**
 * Build a fake `child_process.spawn` that records the call + emits
 * the requested exit/stdout/stderr. Same shape as the fake in
 * `metrics-render-cli-wiring.test.ts`. Used by both the gh and the
 * default-spawn-checked-call paths.
 */
function makeFakeSpawn(opts: FakeSpawnOpts) {
  const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
  const fakeSpawn = ((command: string, args: readonly string[], options: { cwd?: string }) => {
    calls.push({
      command,
      args: [...args],
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    const ee = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter | null;
      stderr: EventEmitter | null;
    };
    ee.stdout = new EventEmitter();
    ee.stderr = new EventEmitter();
    setImmediate(() => {
      if (opts.stdout !== undefined) ee.stdout?.emit("data", Buffer.from(opts.stdout));
      if (opts.stderr !== undefined) ee.stderr?.emit("data", Buffer.from(opts.stderr));
      if (opts.emitErrorBeforeClose !== undefined) {
        ee.emit("error", opts.emitErrorBeforeClose);
        return;
      }
      ee.emit("close", opts.exitCode ?? 0);
    });
    return ee;
    // biome-ignore lint/suspicious/noExplicitAny: tests stub the subprocess shape; the fake doesn't implement the full ChildProcess interface
  }) as any;
  return { fakeSpawn, calls };
}

describe("createGhMergedPrList", () => {
  it("invokes `gh pr list --state merged --json number,title --limit 50` by default", async () => {
    const { fakeSpawn, calls } = makeFakeSpawn({ stdout: "[]" });
    const list = createGhMergedPrList({ spawnFn: fakeSpawn });
    await list();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("gh");
    expect(calls[0]?.args).toEqual([
      "pr",
      "list",
      "--state",
      "merged",
      "--json",
      "number,title",
      "--limit",
      "50",
    ]);
  });

  it("parses the JSON array into MergedPrSnapshot[] (happy path)", async () => {
    const { fakeSpawn } = makeFakeSpawn({
      stdout: JSON.stringify([
        { number: 309, title: "feat(alpha): substrate" },
        { number: 343, title: "duplicate of #309" },
      ]),
    });
    const list = createGhMergedPrList({ spawnFn: fakeSpawn });
    const prs = await list();
    expect(prs).toEqual([
      { number: 309, title: "feat(alpha): substrate" },
      { number: 343, title: "duplicate of #309" },
    ]);
  });

  it("returns [] on an empty array (no merged PRs is a valid steady state)", async () => {
    const { fakeSpawn } = makeFakeSpawn({ stdout: "[]" });
    const list = createGhMergedPrList({ spawnFn: fakeSpawn });
    expect(await list()).toEqual([]);
  });

  it("rejects on non-zero exit (rule #6 — broken `gh` install is a real misconfig)", async () => {
    const { fakeSpawn } = makeFakeSpawn({ exitCode: 1, stderr: "gh: command not found" });
    const list = createGhMergedPrList({ spawnFn: fakeSpawn });
    await expect(list()).rejects.toThrow(/gh pr list exited 1/);
  });

  it("rejects on malformed JSON (rule #6 — schema mismatch is a real bug)", async () => {
    const { fakeSpawn } = makeFakeSpawn({ stdout: "not json at all" });
    const list = createGhMergedPrList({ spawnFn: fakeSpawn });
    await expect(list()).rejects.toThrow(/malformed JSON/);
  });

  it("rejects when JSON is valid but not an array (e.g. `gh` returns an object)", async () => {
    const { fakeSpawn } = makeFakeSpawn({ stdout: '{"error":"rate limit"}' });
    const list = createGhMergedPrList({ spawnFn: fakeSpawn });
    await expect(list()).rejects.toThrow(/non-array JSON/);
  });

  it("rejects when the spawn itself errors (let-it-crash on missing gh / EACCES)", async () => {
    const { fakeSpawn } = makeFakeSpawn({ emitErrorBeforeClose: new Error("ENOENT") });
    const list = createGhMergedPrList({ spawnFn: fakeSpawn });
    await expect(list()).rejects.toThrow(/ENOENT/);
  });

  it("honours a custom limit + cwd override", async () => {
    const { fakeSpawn, calls } = makeFakeSpawn({ stdout: "[]" });
    const list = createGhMergedPrList({ spawnFn: fakeSpawn, limit: 200, cwd: "/some/repo" });
    await list();
    expect(calls[0]?.cwd).toBe("/some/repo");
    expect(calls[0]?.args[calls[0].args.length - 1]).toBe("200");
  });
});

describe("createGitBackedApplyRemoval", () => {
  it("writes the stripped TASKS.md then commits with --only + the supplied message", async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const execs: Array<{ command: string; args: readonly string[]; cwd?: string }> = [];
    const applyRemoval = createGitBackedApplyRemoval({
      tasksMdPath: "/repo/TASKS.md",
      cwd: "/repo",
      writeFileFn: (path, content) => {
        writes.push({ path, content });
        return Promise.resolve();
      },
      execFn: (command, args, cwd) => {
        execs.push({ command, args, ...(cwd === undefined ? {} : { cwd }) });
        return Promise.resolve();
      },
    });
    await applyRemoval({
      tasksMd: "stripped\n",
      taskId: "alpha",
      viaPrNumber: 309,
      commitMessage: "chore(tasks): auto-remove `alpha` — shipped via #309",
    });
    expect(writes).toEqual([{ path: "/repo/TASKS.md", content: "stripped\n" }]);
    expect(execs).toHaveLength(1);
    expect(execs[0]?.command).toBe("git");
    expect(execs[0]?.args).toEqual([
      "commit",
      "--only",
      "/repo/TASKS.md",
      "-m",
      "chore(tasks): auto-remove `alpha` — shipped via #309",
    ]);
    expect(execs[0]?.cwd).toBe("/repo");
  });

  it("propagates writeFile errors without invoking git (write-then-commit ordering preserved on failure)", async () => {
    const execs: Array<{ command: string; args: readonly string[]; cwd?: string }> = [];
    const applyRemoval = createGitBackedApplyRemoval({
      tasksMdPath: "/repo/TASKS.md",
      cwd: "/repo",
      writeFileFn: () => Promise.reject(new Error("EACCES: read-only filesystem")),
      execFn: (command, args, cwd) => {
        execs.push({ command, args, ...(cwd === undefined ? {} : { cwd }) });
        return Promise.resolve();
      },
    });
    await expect(
      applyRemoval({
        tasksMd: "x",
        taskId: "alpha",
        viaPrNumber: 1,
        commitMessage: "x",
      }),
    ).rejects.toThrow(/EACCES/);
    expect(execs).toHaveLength(0);
  });

  it("propagates git commit errors (rule #6 — detached HEAD / no remote is a real misconfig)", async () => {
    const applyRemoval = createGitBackedApplyRemoval({
      tasksMdPath: "/repo/TASKS.md",
      cwd: "/repo",
      writeFileFn: () => Promise.resolve(),
      execFn: () => Promise.reject(new Error("git commit exited 1: nothing to commit")),
    });
    await expect(
      applyRemoval({
        tasksMd: "x",
        taskId: "alpha",
        viaPrNumber: 1,
        commitMessage: "x",
      }),
    ).rejects.toThrow(/nothing to commit/);
  });

  it("defaults cwd to process.cwd() when omitted", async () => {
    const execs: Array<{ command: string; args: readonly string[]; cwd?: string }> = [];
    const applyRemoval = createGitBackedApplyRemoval({
      tasksMdPath: "/repo/TASKS.md",
      writeFileFn: () => Promise.resolve(),
      execFn: (command, args, cwd) => {
        execs.push({ command, args, ...(cwd === undefined ? {} : { cwd }) });
        return Promise.resolve();
      },
    });
    await applyRemoval({
      tasksMd: "x",
      taskId: "alpha",
      viaPrNumber: 1,
      commitMessage: "x",
    });
    expect(execs[0]?.cwd).toBe(process.cwd());
  });
});
