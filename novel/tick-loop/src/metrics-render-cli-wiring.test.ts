import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Readable, Writable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createFileBackedLastRenderedDate,
  createPnpmMetricsRender,
} from "./metrics-render-cli-wiring.js";

describe("createFileBackedLastRenderedDate", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), "metrics-mtime-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when METRICS.md does not exist (genesis case)", async () => {
    const probe = createFileBackedLastRenderedDate(dir);
    expect(await probe()).toBeNull();
  });

  it("returns the UTC date string of METRICS.md's mtime when present", async () => {
    const path = resolve(dir, "METRICS.md");
    writeFileSync(path, "# stub\n", "utf-8");
    // Set mtime explicitly to a known UTC moment; atime stays current.
    const mtime = new Date("2026-05-04T17:42:11.000Z");
    utimesSync(path, mtime, mtime);
    const probe = createFileBackedLastRenderedDate(dir);
    expect(await probe()).toBe("2026-05-04");
  });

  it("formats mtime in UTC, not local time (boundary matches daemon's `today`)", async () => {
    const path = resolve(dir, "METRICS.md");
    writeFileSync(path, "# stub\n", "utf-8");
    // 2026-05-05T00:30:00Z — late on May 4 in PST, early May 5 in UTC.
    // The probe must follow UTC so it matches `new Date(now()).toISOString().slice(0,10)`.
    const mtime = new Date("2026-05-05T00:30:00.000Z");
    utimesSync(path, mtime, mtime);
    const probe = createFileBackedLastRenderedDate(dir);
    expect(await probe()).toBe("2026-05-05");
  });

  it("captures rootDir at construction time", async () => {
    const probe = createFileBackedLastRenderedDate(dir);
    expect(await probe()).toBeNull();
    const path = resolve(dir, "METRICS.md");
    writeFileSync(path, "# stub\n", "utf-8");
    const mtime = new Date("2026-05-05T12:00:00.000Z");
    utimesSync(path, mtime, mtime);
    expect(await probe()).toBe("2026-05-05");
  });

  it("propagates non-ENOENT errors (rule #6 — let-it-crash)", async () => {
    // Pointing at a path whose parent component is a regular file, not a
    // directory, surfaces ENOTDIR — a non-ENOENT error code we expect to
    // propagate so the supervisor sees the misconfiguration.
    const trap = resolve(dir, "trap");
    writeFileSync(trap, "not a dir", "utf-8");
    const probe = createFileBackedLastRenderedDate(trap);
    await expect(probe()).rejects.toThrow();
  });

  it("only probes METRICS.md (not METRICS.txt or other extensions)", async () => {
    writeFileSync(resolve(dir, "METRICS.txt"), "# wrong\n", "utf-8");
    const probe = createFileBackedLastRenderedDate(dir);
    expect(await probe()).toBeNull();
  });
});

// ---- createPnpmMetricsRender ---------------------------------------------

interface FakeChildOptions {
  readonly exitCode?: number;
  readonly stdoutChunks?: readonly string[];
  readonly stderrChunks?: readonly string[];
  readonly emitErrorBeforeClose?: Error;
}

function makeFakeChild(opts: FakeChildOptions = {}): ChildProcess {
  const ee = new EventEmitter() as ChildProcess & EventEmitter;
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const stdin = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
  Object.assign(ee, { stdout, stderr, stdin });
  setImmediate(() => {
    if (opts.emitErrorBeforeClose) {
      ee.emit("error", opts.emitErrorBeforeClose);
      return;
    }
    for (const chunk of opts.stdoutChunks ?? []) {
      stdout.push(Buffer.from(chunk, "utf-8"));
    }
    stdout.push(null);
    for (const chunk of opts.stderrChunks ?? []) {
      stderr.push(Buffer.from(chunk, "utf-8"));
    }
    stderr.push(null);
    ee.emit("close", opts.exitCode ?? 0);
  });
  return ee;
}

interface SpawnRecorder {
  command?: string;
  args?: readonly string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
}

function makeSpawnFn(
  recorder: SpawnRecorder,
  childOpts: FakeChildOptions = {},
): typeof import("node:child_process").spawn {
  return ((command: string, args: readonly string[], options: Record<string, unknown>) => {
    recorder.command = command;
    recorder.args = [...args];
    if (options["cwd"] !== undefined) recorder.cwd = options["cwd"] as string;
    if (options["env"] !== undefined) {
      recorder.env = options["env"] as Record<string, string | undefined>;
    }
    return makeFakeChild(childOpts);
  }) as typeof import("node:child_process").spawn;
}

describe("createPnpmMetricsRender", () => {
  it("invokes `pnpm metrics:render --date <date>` by default", async () => {
    const rec: SpawnRecorder = {};
    const render = createPnpmMetricsRender({ spawnFn: makeSpawnFn(rec) });
    await render.render({ date: "2026-05-05", env: {} });
    expect(rec.command).toBe("pnpm");
    expect(rec.args).toEqual(["metrics:render", "--date", "2026-05-05"]);
  });

  it("passes through env to the subprocess", async () => {
    const rec: SpawnRecorder = {};
    const render = createPnpmMetricsRender({ spawnFn: makeSpawnFn(rec) });
    await render.render({ date: "2026-05-05", env: { FOO: "bar", PATH: "/usr/bin" } });
    expect(rec.env).toEqual({ FOO: "bar", PATH: "/usr/bin" });
  });

  it("returns exitCode 0 with bounded stdout/stderr tails on the happy path", async () => {
    const rec: SpawnRecorder = {};
    const render = createPnpmMetricsRender({
      spawnFn: makeSpawnFn(rec, {
        exitCode: 0,
        stdoutChunks: ["/repo/METRICS.md\n"],
        stderrChunks: [],
      }),
    });
    const result = await render.render({ date: "2026-05-05", env: {} });
    expect(result.exitCode).toBe(0);
    expect(result.stdoutTail).toContain("/repo/METRICS.md");
    expect(result.stderrTail).toBe("");
    expect(typeof result.durationMs).toBe("number");
  });

  it("propagates non-zero exitCode without throwing (rule #6 — failure is data)", async () => {
    const rec: SpawnRecorder = {};
    const render = createPnpmMetricsRender({
      spawnFn: makeSpawnFn(rec, {
        exitCode: 1,
        stderrChunks: ["snapshot file malformed\n"],
      }),
    });
    const result = await render.render({ date: "2026-05-05", env: {} });
    expect(result.exitCode).toBe(1);
    expect(result.stderrTail).toContain("snapshot file malformed");
  });

  it("rejects when the spawn itself errors (let-it-crash on missing pnpm / EACCES)", async () => {
    const rec: SpawnRecorder = {};
    const render = createPnpmMetricsRender({
      spawnFn: makeSpawnFn(rec, { emitErrorBeforeClose: new Error("ENOENT: pnpm not found") }),
    });
    await expect(render.render({ date: "2026-05-05", env: {} })).rejects.toThrow(/ENOENT/);
  });

  it("caps stdout/stderr tails at 4 KB (rule #7 bounded log capture)", async () => {
    const rec: SpawnRecorder = {};
    const huge = "x".repeat(10_000);
    const render = createPnpmMetricsRender({
      spawnFn: makeSpawnFn(rec, {
        exitCode: 0,
        stdoutChunks: [huge],
        stderrChunks: [huge],
      }),
    });
    const result = await render.render({ date: "2026-05-05", env: {} });
    expect(result.stdoutTail.length).toBe(4096);
    expect(result.stderrTail.length).toBe(4096);
    expect(result.stdoutTail).toBe("x".repeat(4096));
  });

  it("honors a custom command + baseArgs override", async () => {
    const rec: SpawnRecorder = {};
    const render = createPnpmMetricsRender({
      command: "node",
      baseArgs: ["scripts/metrics-render.mjs"],
      spawnFn: makeSpawnFn(rec),
    });
    await render.render({ date: "2026-05-05", env: {} });
    expect(rec.command).toBe("node");
    expect(rec.args).toEqual(["scripts/metrics-render.mjs", "--date", "2026-05-05"]);
  });

  it("forwards an explicit cwd to the subprocess options", async () => {
    const rec: SpawnRecorder = {};
    const render = createPnpmMetricsRender({ cwd: "/tmp/some/repo", spawnFn: makeSpawnFn(rec) });
    await render.render({ date: "2026-05-05", env: {} });
    expect(rec.cwd).toBe("/tmp/some/repo");
  });

  it("omits cwd from spawn options when not provided (inherit from parent)", async () => {
    const rec: SpawnRecorder = {};
    const render = createPnpmMetricsRender({ spawnFn: makeSpawnFn(rec) });
    await render.render({ date: "2026-05-05", env: {} });
    expect(rec.cwd).toBeUndefined();
  });

  it("composes args per-call (date is not constructor-fixed)", async () => {
    const recA: SpawnRecorder = {};
    const recB: SpawnRecorder = {};
    let callIdx = 0;
    const captures: typeof import("node:child_process").spawn = ((
      command: string,
      args: readonly string[],
      _options: Record<string, unknown>,
    ) => {
      const target = callIdx === 0 ? recA : recB;
      target.command = command;
      target.args = [...args];
      callIdx += 1;
      return makeFakeChild({ exitCode: 0 });
    }) as typeof import("node:child_process").spawn;
    const render = createPnpmMetricsRender({ spawnFn: captures });
    await render.render({ date: "2026-05-05", env: {} });
    await render.render({ date: "2026-05-06", env: {} });
    expect(recA.args).toEqual(["metrics:render", "--date", "2026-05-05"]);
    expect(recB.args).toEqual(["metrics:render", "--date", "2026-05-06"]);
  });

  it("measures durationMs across the spawn lifecycle (≥0, finite)", async () => {
    const rec: SpawnRecorder = {};
    const render = createPnpmMetricsRender({ spawnFn: makeSpawnFn(rec) });
    const result = await render.render({ date: "2026-05-05", env: {} });
    expect(Number.isFinite(result.durationMs)).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
