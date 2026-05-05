import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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

  it("returns the mtime UTC date as YYYY-MM-DD when METRICS.md exists", async () => {
    const path = resolve(dir, "METRICS.md");
    writeFileSync(path, "# stub\n", "utf-8");
    // Pin mtime to a known UTC moment so the formatting is deterministic.
    const fixed = new Date("2026-05-05T12:34:56.000Z");
    utimesSync(path, fixed, fixed);
    const probe = createFileBackedLastRenderedDate(path);
    expect(await probe()).toBe("2026-05-05");
  });

  it("returns null on ENOENT (genesis case — METRICS.md not yet authored)", async () => {
    const probe = createFileBackedLastRenderedDate(resolve(dir, "METRICS.md"));
    expect(await probe()).toBeNull();
  });

  it("returns null when the parent directory itself is missing (still ENOENT)", async () => {
    const probe = createFileBackedLastRenderedDate(resolve(dir, "missing-subdir", "METRICS.md"));
    expect(await probe()).toBeNull();
  });

  it("propagates non-ENOENT errors (ENOTDIR — parent component is a regular file)", async () => {
    // Treating an existing file as if it had children triggers ENOTDIR
    // at stat time, not ENOENT. The probe must surface this rather than
    // mask it as `null` (which would make every iteration re-render).
    const fileAsParent = resolve(dir, "not-a-dir");
    writeFileSync(fileAsParent, "{}", "utf-8");
    const probe = createFileBackedLastRenderedDate(resolve(fileAsParent, "METRICS.md"));
    await expect(probe()).rejects.toMatchObject({ code: "ENOTDIR" });
  });

  it("treats a directory at the path as a successful stat (mtime → date)", async () => {
    // Sanity: `stat` on a directory succeeds; the probe formats the
    // directory's mtime. The runner's invariant is that the file IS the
    // record — if METRICS.md is somehow a directory, the next render
    // spawn fails loudly (EISDIR) and the supervisor sees it. The probe
    // is not the place to police that.
    const sub = resolve(dir, "METRICS.md");
    mkdirSync(sub);
    const probe = createFileBackedLastRenderedDate(sub);
    expect(await probe()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("re-derives mtime per call (touching the file flips the date)", async () => {
    const path = resolve(dir, "METRICS.md");
    writeFileSync(path, "# stub\n", "utf-8");
    utimesSync(path, new Date("2026-05-04T00:00:00Z"), new Date("2026-05-04T00:00:00Z"));
    const probe = createFileBackedLastRenderedDate(path);
    expect(await probe()).toBe("2026-05-04");
    utimesSync(path, new Date("2026-05-05T00:00:00Z"), new Date("2026-05-05T00:00:00Z"));
    expect(await probe()).toBe("2026-05-05");
  });

  it("captures metricsMdPath at construction time", async () => {
    const path = resolve(dir, "METRICS.md");
    const probe = createFileBackedLastRenderedDate(path);
    expect(await probe()).toBeNull();
    writeFileSync(path, "# stub\n", "utf-8");
    utimesSync(path, new Date("2026-05-05T00:00:00Z"), new Date("2026-05-05T00:00:00Z"));
    expect(await probe()).toBe("2026-05-05");
  });

  it("formats UTC even when local TZ would render a different day", async () => {
    const path = resolve(dir, "METRICS.md");
    writeFileSync(path, "# stub\n", "utf-8");
    // 23:59 UTC on 2026-05-05 is 19:59 EDT same day, but 01:59 next day in
    // CEST. The probe must format UTC so the daemon's `today` (also UTC)
    // matches.
    const ts = new Date("2026-05-05T23:59:00.000Z");
    utimesSync(path, ts, ts);
    const probe = createFileBackedLastRenderedDate(path);
    expect(await probe()).toBe("2026-05-05");
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
    const rec: { command?: string; args?: readonly string[] } = {};
    const render = createPnpmMetricsRender({ spawnFn: makeSpawnFn(rec) });
    await render.render({ date: "2026-05-05", env: {} });
    expect(rec.command).toBe("pnpm");
    expect(rec.args).toEqual(["metrics:render", "--date", "2026-05-05"]);
  });

  it("passes through env to the subprocess", async () => {
    const rec: {
      command?: string;
      args?: readonly string[];
      env?: Record<string, string | undefined>;
    } = {};
    const render = createPnpmMetricsRender({ spawnFn: makeSpawnFn(rec) });
    await render.render({ date: "2026-05-05", env: { FOO: "bar", PATH: "/usr/bin" } });
    expect(rec.env).toEqual({ FOO: "bar", PATH: "/usr/bin" });
  });

  it("returns exitCode 0 with bounded stdout/stderr tails on the happy path", async () => {
    const rec: { command?: string } = {};
    const render = createPnpmMetricsRender({
      spawnFn: makeSpawnFn(rec, {
        exitCode: 0,
        stdoutChunks: ["wrote METRICS.md\n"],
        stderrChunks: [],
      }),
    });
    const result = await render.render({ date: "2026-05-05", env: {} });
    expect(result.exitCode).toBe(0);
    expect(result.stdoutTail).toContain("wrote METRICS.md");
    expect(result.stderrTail).toBe("");
    expect(typeof result.durationMs).toBe("number");
  });

  it("propagates non-zero exitCode without throwing (rule #6 — failure is data)", async () => {
    const rec: { command?: string } = {};
    const render = createPnpmMetricsRender({
      spawnFn: makeSpawnFn(rec, {
        exitCode: 1,
        stderrChunks: ["TypeError: snapshot not found\n"],
      }),
    });
    const result = await render.render({ date: "2026-05-05", env: {} });
    expect(result.exitCode).toBe(1);
    expect(result.stderrTail).toContain("TypeError: snapshot not found");
  });

  it("rejects when the spawn itself errors (let-it-crash on missing pnpm / EACCES)", async () => {
    const rec: { command?: string } = {};
    const render = createPnpmMetricsRender({
      spawnFn: makeSpawnFn(rec, { emitErrorBeforeClose: new Error("ENOENT: pnpm not found") }),
    });
    await expect(render.render({ date: "2026-05-05", env: {} })).rejects.toThrow(/ENOENT/);
  });

  it("caps stdout/stderr tails at 4 KB (rule #7 bounded log capture)", async () => {
    const rec: { command?: string } = {};
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
    const rec: { command?: string; args?: readonly string[] } = {};
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
    const rec: { command?: string; cwd?: string } = {};
    const render = createPnpmMetricsRender({
      cwd: "/tmp/some/repo",
      spawnFn: makeSpawnFn(rec),
    });
    await render.render({ date: "2026-05-05", env: {} });
    expect(rec.cwd).toBe("/tmp/some/repo");
  });

  it("omits cwd from spawn options when not provided (inherit from parent)", async () => {
    const rec: { command?: string; cwd?: string } = {};
    const render = createPnpmMetricsRender({ spawnFn: makeSpawnFn(rec) });
    await render.render({ date: "2026-05-05", env: {} });
    expect(rec.cwd).toBeUndefined();
  });

  it("composes args per-call (date is not constructor-fixed)", async () => {
    const recA: { command?: string; args?: readonly string[] } = {};
    const recB: { command?: string; args?: readonly string[] } = {};
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
    const rec: { command?: string } = {};
    const render = createPnpmMetricsRender({ spawnFn: makeSpawnFn(rec) });
    const result = await render.render({ date: "2026-05-05", env: {} });
    expect(Number.isFinite(result.durationMs)).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
