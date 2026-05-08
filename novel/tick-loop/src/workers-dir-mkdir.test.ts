/**
 * Paired tests for `workers-dir-mkdir.ts` — slice 2 of
 * `minsky-runtime-resilience`.
 *
 * The helper wraps `mkdirSync({ recursive: true })`. Returns ok on
 * success or when the dir already exists; classifies EACCES / EROFS
 * / unknown errno into a recovery hint on failure.
 */

import { describe, expect, it } from "vitest";
import {
  type WorkersDirMkdirOutcome,
  ensureWorkersDir,
  formatWorkersDirRecoveryMessage,
} from "./workers-dir-mkdir.js";

describe("ensureWorkersDir — happy path", () => {
  it("returns { ok: true } when mkdirSyncFn succeeds", () => {
    const result = ensureWorkersDir({
      dir: "/repo/.minsky/workers",
      mkdirSyncFn: () => undefined,
    });
    expect(result).toEqual<WorkersDirMkdirOutcome>({ ok: true });
  });
});

describe("ensureWorkersDir — EACCES (permission denied)", () => {
  it("classifies EACCES with the chmod recovery hint", () => {
    const result = ensureWorkersDir({
      dir: "/repo/.minsky/workers",
      mkdirSyncFn: () => {
        const e = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
        e.code = "EACCES";
        throw e;
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.errCode).toBe("EACCES");
      expect(result.recoveryHint).toMatch(/chmod|writable|MINSKY_HOME/);
    }
  });
});

describe("ensureWorkersDir — EROFS (read-only filesystem)", () => {
  it("classifies EROFS with the writable-mount recovery hint", () => {
    const result = ensureWorkersDir({
      dir: "/repo/.minsky/workers",
      mkdirSyncFn: () => {
        const e = new Error("EROFS: read-only file system") as NodeJS.ErrnoException;
        e.code = "EROFS";
        throw e;
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.errCode).toBe("EROFS");
      expect(result.recoveryHint).toMatch(/MINSKY_HOME|read-only|writable/i);
    }
  });
});

describe("ensureWorkersDir — chaos: unknown errno", () => {
  it("classifies unknown errno with a generic hint that names the path", () => {
    const result = ensureWorkersDir({
      dir: "/repo/.minsky/workers",
      mkdirSyncFn: () => {
        const e = new Error("EXOTIC: weird") as NodeJS.ErrnoException;
        e.code = "EXOTIC";
        throw e;
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.errCode).toBe("EXOTIC");
      expect(result.recoveryHint).toMatch(/repo\/\.minsky\/workers|workers|MINSKY_HOME/);
    }
  });
});

describe("formatWorkersDirRecoveryMessage", () => {
  it("starts with `minsky:` prefix and names the path + recovery hint", () => {
    const msg = formatWorkersDirRecoveryMessage({
      dir: "/Users/fivanishche/apps/minsky/.minsky/workers",
      errCode: "EACCES",
      recoveryHint: "run `chmod u+w /Users/.../.minsky` or set MINSKY_HOME=/writable/path",
    });
    expect(msg).toMatch(/^minsky:/);
    expect(msg).toContain("/Users/fivanishche/apps/minsky/.minsky/workers");
    expect(msg).toMatch(/chmod|MINSKY_HOME/);
  });

  it("renders as a single line (no embedded newlines)", () => {
    const msg = formatWorkersDirRecoveryMessage({
      dir: "/x/y",
      errCode: "EACCES",
      recoveryHint: "chmod u+w /x",
    });
    expect(msg.split("\n").length).toBe(1);
  });
});
