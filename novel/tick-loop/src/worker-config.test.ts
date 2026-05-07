import { describe, expect, it } from "vitest";
import {
  type WorkerConfig,
  buildChildWorkerArgs,
  claudeArgsForWorker,
  parseSpawnAdditionalWorkers,
  parseWorkerArgs,
  workerBranchName,
  workerStartupLine,
  workerWorktreeName,
} from "./worker-config.js";

describe("parseWorkerArgs", () => {
  it("defaults to claim-aware worker 0 of 1 when neither flag is present (2026-05-06 default change)", () => {
    expect(parseWorkerArgs([])).toEqual({ workerId: 0, workersTotal: 1 });
    expect(parseWorkerArgs(["--max-iterations=4"])).toEqual({ workerId: 0, workersTotal: 1 });
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

  it("defaults workerId=0 when --workers-total alone is supplied (operator launches root)", () => {
    expect(parseWorkerArgs(["--workers-total=3"])).toEqual({ workerId: 0, workersTotal: 3 });
  });

  it("returns an error when --worker-id is supplied without --workers-total", () => {
    expect(parseWorkerArgs(["--worker-id=0"])).toMatchObject({
      error: expect.stringMatching(/--worker-id requires --workers-total/),
    });
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

describe("parseSpawnAdditionalWorkers", () => {
  it("returns count: 0 when --spawn-additional-workers is absent (default)", () => {
    expect(parseSpawnAdditionalWorkers({ argv: [], env: {} })).toEqual({ count: 0 });
    expect(parseSpawnAdditionalWorkers({ argv: ["--max-iterations=4"], env: {} })).toEqual({
      count: 0,
    });
  });

  it("returns the count when the flag is present and env is unset (root worker)", () => {
    expect(
      parseSpawnAdditionalWorkers({ argv: ["--spawn-additional-workers=2"], env: {} }),
    ).toEqual({ count: 2 });
  });

  it("returns count: 0 for explicit zero (no spawn)", () => {
    expect(
      parseSpawnAdditionalWorkers({ argv: ["--spawn-additional-workers=0"], env: {} }),
    ).toEqual({ count: 0 });
  });

  it("returns an error when MINSKY_WORKER_SPAWNED=1 (depth-2 cap — only grandchildren allowed)", () => {
    expect(
      parseSpawnAdditionalWorkers({
        argv: ["--spawn-additional-workers=1"],
        env: { MINSKY_WORKER_SPAWNED: "1" },
      }),
    ).toMatchObject({ error: expect.stringMatching(/only grandchildren allowed/) });
  });

  it("the depth-2 cap only triggers on positive count — count=0 is a no-op even in spawned children", () => {
    expect(
      parseSpawnAdditionalWorkers({
        argv: ["--spawn-additional-workers=0"],
        env: { MINSKY_WORKER_SPAWNED: "1" },
      }),
    ).toEqual({ count: 0 });
  });

  it("returns an error for non-integer / negative counts", () => {
    expect(
      parseSpawnAdditionalWorkers({ argv: ["--spawn-additional-workers=abc"], env: {} }),
    ).toMatchObject({ error: expect.stringMatching(/non-negative integer/) });
    expect(
      parseSpawnAdditionalWorkers({ argv: ["--spawn-additional-workers=-1"], env: {} }),
    ).toMatchObject({ error: expect.stringMatching(/non-negative integer/) });
  });
});

describe("buildChildWorkerArgs", () => {
  it("strips --spawn-additional-workers + --worker-id + --workers-total from parent argv before adding child's", () => {
    const parentArgv = [
      "--max-iterations=10",
      "--spawn-additional-workers=2",
      "--worker-id=0",
      "--workers-total=99",
      "--tick-interval-ms=300000",
    ];
    const child = buildChildWorkerArgs({ parentArgv, childIndex: 1, totalAfterSpawn: 3 });
    expect(child).not.toContain("--spawn-additional-workers=2");
    expect(child).not.toContain("--worker-id=0");
    expect(child).not.toContain("--workers-total=99");
    expect(child).toContain("--worker-id=1");
    expect(child).toContain("--workers-total=3");
  });

  it("preserves other args verbatim", () => {
    const parentArgv = ["--max-iterations=10", "--tick-interval-ms=300000"];
    const child = buildChildWorkerArgs({ parentArgv, childIndex: 1, totalAfterSpawn: 2 });
    expect(child).toContain("--max-iterations=10");
    expect(child).toContain("--tick-interval-ms=300000");
  });

  it("computes child worker-id 1..count (not 0 — that's the root)", () => {
    expect(buildChildWorkerArgs({ parentArgv: [], childIndex: 1, totalAfterSpawn: 3 })).toEqual([
      "--worker-id=1",
      "--workers-total=3",
    ]);
    expect(buildChildWorkerArgs({ parentArgv: [], childIndex: 2, totalAfterSpawn: 3 })).toEqual([
      "--worker-id=2",
      "--workers-total=3",
    ]);
  });
});
