import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Readable, Writable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createFileBackedSnapshotExists,
  createPnpmSnapshotCapture,
} from "./snapshot-cli-wiring.js";

describe("createFileBackedSnapshotExists", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), "snapshot-exists-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns true when the snapshot file exists at <root>/.minsky/metric-snapshots/<date>.json", async () => {
    const snapshotsDir = resolve(dir, ".minsky", "metric-snapshots");
    mkdirSync(snapshotsDir, { recursive: true });
    writeFileSync(resolve(snapshotsDir, "2026-05-05.json"), "{}", "utf-8");
    const exists = createFileBackedSnapshotExists(dir);
    expect(await exists("2026-05-05")).toBe(true);
  });

  it("returns false when the snapshot file is missing", async () => {
    const exists = createFileBackedSnapshotExists(dir);
    expect(await exists("2026-05-05")).toBe(false);
  });

  it("returns false when the .minsky/metric-snapshots subdir doesn't exist yet (fresh checkout)", async () => {
    const exists = createFileBackedSnapshotExists(dir);
    expect(await exists("2026-05-05")).toBe(false);
  });

  it("rejects malformed dates as non-existent (defense-in-depth against path traversal)", async () => {
    const snapshotsDir = resolve(dir, ".minsky", "metric-snapshots");
    mkdirSync(snapshotsDir, { recursive: true });
    writeFileSync(resolve(snapshotsDir, "2026-05-05.json"), "{}", "utf-8");
    const exists = createFileBackedSnapshotExists(dir);
    expect(await exists("../../../etc/passwd")).toBe(false);
    expect(await exists("2026-5-5")).toBe(false);
    expect(await exists("not-a-date")).toBe(false);
    expect(await exists("")).toBe(false);
  });

  it("captures rootDir at construction time", async () => {
    const snapshotsDir = resolve(dir, ".minsky", "metric-snapshots");
    mkdirSync(snapshotsDir, { recursive: true });
    const exists = createFileBackedSnapshotExists(dir);
    expect(await exists("2026-05-05")).toBe(false);
    writeFileSync(resolve(snapshotsDir, "2026-05-05.json"), "{}", "utf-8");
    expect(await exists("2026-05-05")).toBe(true);
  });

  it("only matches the .json extension at the canonical path", async () => {
    const snapshotsDir = resolve(dir, ".minsky", "metric-snapshots");
    mkdirSync(snapshotsDir, { recursive: true });
    writeFileSync(resolve(snapshotsDir, "2026-05-05.txt"), "{}", "utf-8");
    const exists = createFileBackedSnapshotExists(dir);
    expect(await exists("2026-05-05")).toBe(false);
  });
});

// ---- createPnpmSnapshotCapture -------------------------------------------

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

describe("createPnpmSnapshotCapture", () => {
  it("invokes `pnpm changelog:snapshot --date <date>` by default", async () => {
    const rec: { command?: string; args?: readonly string[] } = {};
    const capture = createPnpmSnapshotCapture({ spawnFn: makeSpawnFn(rec) });
    await capture.capture({ date: "2026-05-05", env: {} });
    expect(rec.command).toBe("pnpm");
    expect(rec.args).toEqual(["changelog:snapshot", "--date", "2026-05-05"]);
  });

  it("passes through env to the subprocess", async () => {
    const rec: {
      command?: string;
      args?: readonly string[];
      env?: Record<string, string | undefined>;
    } = {};
    const capture = createPnpmSnapshotCapture({ spawnFn: makeSpawnFn(rec) });
    await capture.capture({ date: "2026-05-05", env: { FOO: "bar", PATH: "/usr/bin" } });
    expect(rec.env).toEqual({ FOO: "bar", PATH: "/usr/bin" });
  });

  it("returns exitCode 0 with bounded stdout/stderr tails on the happy path", async () => {
    const rec: { command?: string } = {};
    const capture = createPnpmSnapshotCapture({
      spawnFn: makeSpawnFn(rec, {
        exitCode: 0,
        stdoutChunks: ["wrote .minsky/metric-snapshots/2026-05-05.json\n"],
        stderrChunks: [],
      }),
    });
    const result = await capture.capture({ date: "2026-05-05", env: {} });
    expect(result.exitCode).toBe(0);
    expect(result.stdoutTail).toContain("wrote .minsky/metric-snapshots/2026-05-05.json");
    expect(result.stderrTail).toBe("");
    expect(typeof result.durationMs).toBe("number");
  });

  it("propagates non-zero exitCode without throwing (rule #6 — failure is data)", async () => {
    const rec: { command?: string } = {};
    const capture = createPnpmSnapshotCapture({
      spawnFn: makeSpawnFn(rec, {
        exitCode: 1,
        stderrChunks: ["gh: not authenticated\n"],
      }),
    });
    const result = await capture.capture({ date: "2026-05-05", env: {} });
    expect(result.exitCode).toBe(1);
    expect(result.stderrTail).toContain("gh: not authenticated");
  });

  it("rejects when the spawn itself errors (let-it-crash on missing pnpm / EACCES)", async () => {
    const rec: { command?: string } = {};
    const capture = createPnpmSnapshotCapture({
      spawnFn: makeSpawnFn(rec, { emitErrorBeforeClose: new Error("ENOENT: pnpm not found") }),
    });
    await expect(capture.capture({ date: "2026-05-05", env: {} })).rejects.toThrow(/ENOENT/);
  });

  it("caps stdout/stderr tails at 4 KB (rule #7 bounded log capture)", async () => {
    const rec: { command?: string } = {};
    const huge = "x".repeat(10_000);
    const capture = createPnpmSnapshotCapture({
      spawnFn: makeSpawnFn(rec, {
        exitCode: 0,
        stdoutChunks: [huge],
        stderrChunks: [huge],
      }),
    });
    const result = await capture.capture({ date: "2026-05-05", env: {} });
    expect(result.stdoutTail.length).toBe(4096);
    expect(result.stderrTail.length).toBe(4096);
    expect(result.stdoutTail).toBe("x".repeat(4096));
  });

  it("honors a custom command + baseArgs override", async () => {
    const rec: { command?: string; args?: readonly string[] } = {};
    const capture = createPnpmSnapshotCapture({
      command: "node",
      baseArgs: ["scripts/changelog-snapshot.mjs"],
      spawnFn: makeSpawnFn(rec),
    });
    await capture.capture({ date: "2026-05-05", env: {} });
    expect(rec.command).toBe("node");
    expect(rec.args).toEqual(["scripts/changelog-snapshot.mjs", "--date", "2026-05-05"]);
  });

  it("forwards an explicit cwd to the subprocess options", async () => {
    const rec: { command?: string; cwd?: string } = {};
    const capture = createPnpmSnapshotCapture({ cwd: "/tmp/some/repo", spawnFn: makeSpawnFn(rec) });
    await capture.capture({ date: "2026-05-05", env: {} });
    expect(rec.cwd).toBe("/tmp/some/repo");
  });

  it("omits cwd from spawn options when not provided (inherit from parent)", async () => {
    const rec: { command?: string; cwd?: string } = {};
    const capture = createPnpmSnapshotCapture({ spawnFn: makeSpawnFn(rec) });
    await capture.capture({ date: "2026-05-05", env: {} });
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
    const capture = createPnpmSnapshotCapture({ spawnFn: captures });
    await capture.capture({ date: "2026-05-05", env: {} });
    await capture.capture({ date: "2026-05-06", env: {} });
    expect(recA.args).toEqual(["changelog:snapshot", "--date", "2026-05-05"]);
    expect(recB.args).toEqual(["changelog:snapshot", "--date", "2026-05-06"]);
  });

  it("measures durationMs across the spawn lifecycle (≥0, finite)", async () => {
    const rec: { command?: string } = {};
    const capture = createPnpmSnapshotCapture({ spawnFn: makeSpawnFn(rec) });
    const result = await capture.capture({ date: "2026-05-05", env: {} });
    expect(Number.isFinite(result.durationMs)).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
