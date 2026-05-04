import { type Mock, describe, expect, it, vi } from "vitest";

import { OMC_BIN, OmcPersonaSpawner, type SpawnFn, type SpawnedChild } from "./omc.js";

/**
 * Build a fake `SpawnedChild` that synchronously fires a `close` event
 * with the given exit code on the next microtask. Tests assert that
 * `OmcPersonaSpawner.spawn()` resolves with the captured code.
 */
function fakeChild(closeCode: number | null): SpawnedChild {
  const closeListeners: ((code: number | null) => void)[] = [];
  const errorListeners: ((err: Error) => void)[] = [];
  function on(event: "close", listener: (code: number | null) => void): SpawnedChild;
  function on(event: "error", listener: (err: Error) => void): SpawnedChild;
  function on(
    event: "close" | "error",
    listener: ((code: number | null) => void) | ((err: Error) => void),
  ): SpawnedChild {
    if (event === "close") {
      closeListeners.push(listener as (code: number | null) => void);
      queueMicrotask(() => {
        for (const l of closeListeners) l(closeCode);
      });
    } else {
      errorListeners.push(listener as (err: Error) => void);
    }
    return child;
  }
  const child: SpawnedChild = { on };
  return child;
}

/**
 * Build a fake `SpawnedChild` that fires an `error` event on the next
 * microtask (post-spawn ENOENT — the binary was not found). Mirrors the
 * Node `child_process.spawn` behaviour where the failure is reported
 * via the `error` event rather than a synchronous throw.
 */
function erroringChild(): SpawnedChild {
  const closeListeners: ((code: number | null) => void)[] = [];
  const errorListeners: ((err: Error) => void)[] = [];
  function on(event: "close", listener: (code: number | null) => void): SpawnedChild;
  function on(event: "error", listener: (err: Error) => void): SpawnedChild;
  function on(
    event: "close" | "error",
    listener: ((code: number | null) => void) | ((err: Error) => void),
  ): SpawnedChild {
    if (event === "close") {
      closeListeners.push(listener as (code: number | null) => void);
    } else {
      errorListeners.push(listener as (err: Error) => void);
      queueMicrotask(() => {
        for (const l of errorListeners) l(new Error("ENOENT"));
      });
    }
    return child;
  }
  const child: SpawnedChild = { on };
  return child;
}

type SpawnMock = Mock<
  (
    command: string,
    args: readonly string[],
    options: { cwd: string; stdio: readonly ("ignore" | "pipe")[] },
  ) => SpawnedChild
>;

const asSpawn = (m: SpawnMock): SpawnFn => m as unknown as SpawnFn;

describe("OmcPersonaSpawner — spawn argv shape", () => {
  it("invokes `omc /team <persona>` with cwd = workingDir", async () => {
    const m: SpawnMock = vi.fn(() => fakeChild(0));
    const sp = new OmcPersonaSpawner({
      spawnFn: asSpawn(m),
      now: () => 1000,
    });
    const r = await sp.spawn({
      taskId: "task-007",
      persona: "engineer",
      workingDir: "/tmp/work",
    });
    expect(m).toHaveBeenCalledTimes(1);
    const call = m.mock.calls[0];
    if (call === undefined) throw new Error("expected one spawn call");
    const [cmd, argv, opts] = call;
    expect(cmd).toBe(OMC_BIN);
    expect(argv).toEqual(["/team", "engineer"]);
    expect(opts.cwd).toBe("/tmp/work");
    expect(opts.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(r.exitCode).toBe(0);
    expect(r.omcStateDir).toBe("/tmp/work/.omc/state/team/task-007");
  });

  it("uses an explicit teamName in the omcStateDir when supplied", async () => {
    const m: SpawnMock = vi.fn(() => fakeChild(0));
    const sp = new OmcPersonaSpawner({ spawnFn: asSpawn(m) });
    const r = await sp.spawn({
      taskId: "task-007",
      persona: "researcher",
      workingDir: "/tmp/w",
      teamName: "alpha",
    });
    expect(r.omcStateDir).toBe("/tmp/w/.omc/state/team/alpha");
  });

  it("returns the child's exit code on a clean close", async () => {
    const m: SpawnMock = vi.fn(() => fakeChild(2));
    const sp = new OmcPersonaSpawner({ spawnFn: asSpawn(m) });
    const r = await sp.spawn({
      taskId: "x",
      persona: "engineer",
      workingDir: "/tmp/w",
    });
    expect(r.exitCode).toBe(2);
  });

  it("computes durationMs from the injected clock", async () => {
    const m: SpawnMock = vi.fn(() => fakeChild(0));
    let t = 1000;
    const sp = new OmcPersonaSpawner({
      spawnFn: asSpawn(m),
      now: () => {
        const cur = t;
        t += 250;
        return cur;
      },
    });
    const r = await sp.spawn({
      taskId: "x",
      persona: "engineer",
      workingDir: "/tmp/w",
    });
    expect(r.durationMs).toBe(250);
  });
});

describe("OmcPersonaSpawner — graceful-degrade (rule #7)", () => {
  it("returns exitCode -1 when spawn throws synchronously (binary missing)", async () => {
    const m: SpawnMock = vi.fn(() => {
      throw new Error("ENOENT");
    });
    const sp = new OmcPersonaSpawner({ spawnFn: asSpawn(m) });
    const r = await sp.spawn({
      taskId: "x",
      persona: "engineer",
      workingDir: "/tmp/w",
    });
    expect(r.exitCode).toBe(-1);
  });

  it("returns exitCode -1 when child fires an error event (post-spawn ENOENT)", async () => {
    const m: SpawnMock = vi.fn(() => erroringChild());
    const sp = new OmcPersonaSpawner({ spawnFn: asSpawn(m) });
    const r = await sp.spawn({
      taskId: "x",
      persona: "engineer",
      workingDir: "/tmp/w",
    });
    expect(r.exitCode).toBe(-1);
  });
});

describe("OmcPersonaSpawner — selfTest lattice", () => {
  it("returns green when omc is on PATH", async () => {
    const sp = new OmcPersonaSpawner({
      spawnFn: asSpawn(vi.fn(() => fakeChild(0))),
      hasBinaryOnPath: async () => true,
    });
    const r = await sp.selfTest();
    expect(r.status).toBe("green");
    expect(r.message).toContain("found on PATH");
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(r.lastCheck))).toBe(false);
  });

  it("returns yellow when omc is missing from PATH", async () => {
    const sp = new OmcPersonaSpawner({
      spawnFn: asSpawn(vi.fn(() => fakeChild(0))),
      hasBinaryOnPath: async () => false,
    });
    const r = await sp.selfTest();
    expect(r.status).toBe("yellow");
    expect(r.message).toContain("missing from PATH");
  });

  it("returns red when the PATH probe itself rejects", async () => {
    const sp = new OmcPersonaSpawner({
      spawnFn: asSpawn(vi.fn(() => fakeChild(0))),
      hasBinaryOnPath: async () => {
        throw new Error("EACCES");
      },
    });
    const r = await sp.selfTest();
    expect(r.status).toBe("red");
    expect(r.message).toContain("probe failed");
  });
});
