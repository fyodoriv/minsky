import { describe, expect, it } from "vitest";
import {
  type WorkerConfig,
  claudeArgsForWorker,
  parseWorkerArgs,
  workerBranchName,
  workerStartupLine,
  workerWorktreeName,
} from "./worker-config.js";

describe("parseWorkerArgs", () => {
  it("returns undefined when neither flag is present (single-process default)", () => {
    expect(parseWorkerArgs([])).toBeUndefined();
    expect(parseWorkerArgs(["--max-iterations=4"])).toBeUndefined();
  });

  it("returns the parsed config when both flags are present", () => {
    expect(parseWorkerArgs(["--worker-id=0", "--workers-total=2"])).toEqual({
      workerId: 0,
      workersTotal: 2,
    });
    expect(parseWorkerArgs(["--worker-id=1", "--workers-total=3"])).toEqual({
      workerId: 1,
      workersTotal: 3,
    });
  });

  it("returns an error when only one of the two flags is present", () => {
    const result1 = parseWorkerArgs(["--worker-id=0"]);
    expect(result1).toMatchObject({ error: expect.stringMatching(/must be passed together/) });
    const result2 = parseWorkerArgs(["--workers-total=2"]);
    expect(result2).toMatchObject({ error: expect.stringMatching(/must be passed together/) });
  });

  it("returns an error when values are not integers", () => {
    expect(parseWorkerArgs(["--worker-id=abc", "--workers-total=2"])).toMatchObject({
      error: expect.stringMatching(/must both be integers/),
    });
    expect(parseWorkerArgs(["--worker-id=0", "--workers-total=2.5"])).toMatchObject({
      error: expect.stringMatching(/must both be integers/),
    });
  });

  it("returns an error when workersTotal is <1", () => {
    expect(parseWorkerArgs(["--worker-id=0", "--workers-total=0"])).toMatchObject({
      error: expect.stringMatching(/must be ≥1/),
    });
  });

  it("returns an error when workerId is out of range", () => {
    expect(parseWorkerArgs(["--worker-id=2", "--workers-total=2"])).toMatchObject({
      error: expect.stringMatching(/0 ≤ id < total/),
    });
    expect(parseWorkerArgs(["--worker-id=-1", "--workers-total=2"])).toMatchObject({
      error: expect.stringMatching(/0 ≤ id < total/),
    });
  });

  it("ignores unrelated flags", () => {
    expect(
      parseWorkerArgs([
        "--max-iterations=4",
        "--worker-id=0",
        "--tick-interval-ms=300000",
        "--workers-total=2",
      ]),
    ).toEqual({ workerId: 0, workersTotal: 2 });
  });
});

describe("workerBranchName", () => {
  it("namespaces by workerId so two workers can't collide on the same task's branch", () => {
    expect(workerBranchName({ workerId: 0, taskId: "my-task" })).toBe("daemon/0/my-task");
    expect(workerBranchName({ workerId: 1, taskId: "my-task" })).toBe("daemon/1/my-task");
  });

  it("preserves the task-id verbatim (downstream lints depend on substring match)", () => {
    expect(workerBranchName({ workerId: 2, taskId: "scan-secrets-precommit-and-ci" })).toBe(
      "daemon/2/scan-secrets-precommit-and-ci",
    );
  });
});

describe("workerWorktreeName", () => {
  it("uses dash separators (POSIX worktree names can't contain slashes)", () => {
    expect(workerWorktreeName({ workerId: 0, taskId: "my-task" })).toBe("daemon-0-my-task");
  });

  it("preserves the worker namespace prefix `daemon-<id>-` so sweepers can match", () => {
    expect(workerWorktreeName({ workerId: 0, taskId: "any" }).startsWith("daemon-0-")).toBe(true);
    expect(workerWorktreeName({ workerId: 7, taskId: "any" }).startsWith("daemon-7-")).toBe(true);
  });
});

describe("claudeArgsForWorker", () => {
  it("returns baseArgs unchanged in single-process mode", () => {
    const baseArgs = ["--print"];
    expect(claudeArgsForWorker({ baseArgs, taskId: "t", workerConfig: undefined })).toEqual([
      "--print",
    ]);
  });

  it("appends --worktree <name> when workerConfig is set", () => {
    const baseArgs = ["--print"];
    const cfg: WorkerConfig = { workerId: 0, workersTotal: 2 };
    expect(claudeArgsForWorker({ baseArgs, taskId: "my-task", workerConfig: cfg })).toEqual([
      "--print",
      "--worktree",
      "daemon-0-my-task",
    ]);
  });

  it("preserves existing args verbatim — no reordering", () => {
    const baseArgs = ["--print", "--model=claude-opus-4-7"];
    const cfg: WorkerConfig = { workerId: 1, workersTotal: 3 };
    expect(claudeArgsForWorker({ baseArgs, taskId: "t", workerConfig: cfg })).toEqual([
      "--print",
      "--model=claude-opus-4-7",
      "--worktree",
      "daemon-1-t",
    ]);
  });

  it("does not mutate baseArgs", () => {
    const baseArgs = ["--print"];
    const cfg: WorkerConfig = { workerId: 0, workersTotal: 2 };
    claudeArgsForWorker({ baseArgs, taskId: "t", workerConfig: cfg });
    expect(baseArgs).toEqual(["--print"]);
  });
});

describe("workerStartupLine", () => {
  it("announces single-process mode when undefined", () => {
    expect(workerStartupLine(undefined)).toContain("single-process mode");
  });

  it("announces worker N of M with branch + worktree namespace hints", () => {
    const line = workerStartupLine({ workerId: 1, workersTotal: 3 });
    expect(line).toContain("worker 1 of 3");
    expect(line).toContain("daemon/1/<task-id>");
    expect(line).toContain("daemon-1-<task-id>");
  });
});
