/**
 * Paired tests for `log-path-fallback.ts` — slice 2 of
 * `minsky-runtime-resilience`.
 *
 * The helper tries the primary log path first; on EACCES / EROFS /
 * ENOSPC falls through to the tmp-fallback path; on a SECOND failure
 * throws (loud-crash per Armstrong 2007).
 */

import { describe, expect, it } from "vitest";
import { type LogPathOutcome, pickLogPath } from "./log-path-fallback.js";

const FAKE_FD = 7;

describe("pickLogPath — primary writable", () => {
  it("returns the primary path when openSyncFn succeeds", () => {
    const result = pickLogPath({
      primary: "/repo/.minsky/workers/0.log",
      fallbackTmp: "/tmp/minsky-worker-0-1234.log",
      openSyncFn: () => FAKE_FD,
    });
    expect(result).toEqual<LogPathOutcome>({
      path: "/repo/.minsky/workers/0.log",
      fellBack: false,
      fd: FAKE_FD,
    });
  });
});

describe("pickLogPath — fallback paths", () => {
  it("falls back on EACCES", () => {
    let calls = 0;
    const result = pickLogPath({
      primary: "/repo/.minsky/workers/0.log",
      fallbackTmp: "/tmp/minsky-worker-0-1234.log",
      openSyncFn: (p) => {
        calls++;
        if (p === "/repo/.minsky/workers/0.log") {
          const e = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
          e.code = "EACCES";
          throw e;
        }
        return FAKE_FD;
      },
    });
    expect(calls).toBe(2);
    expect(result.fellBack).toBe(true);
    expect(result.path).toBe("/tmp/minsky-worker-0-1234.log");
    expect(result.reason).toMatch(/EACCES/);
  });

  it("falls back on EROFS", () => {
    const result = pickLogPath({
      primary: "/repo/.minsky/workers/0.log",
      fallbackTmp: "/tmp/minsky-worker-0-1234.log",
      openSyncFn: (p) => {
        if (p === "/repo/.minsky/workers/0.log") {
          const e = new Error("EROFS: read-only file system") as NodeJS.ErrnoException;
          e.code = "EROFS";
          throw e;
        }
        return FAKE_FD;
      },
    });
    expect(result.fellBack).toBe(true);
    expect(result.path).toBe("/tmp/minsky-worker-0-1234.log");
    expect(result.reason).toMatch(/EROFS/);
  });

  it("falls back on ENOSPC", () => {
    const result = pickLogPath({
      primary: "/repo/.minsky/workers/0.log",
      fallbackTmp: "/tmp/minsky-worker-0-1234.log",
      openSyncFn: (p) => {
        if (p === "/repo/.minsky/workers/0.log") {
          const e = new Error("ENOSPC: no space left") as NodeJS.ErrnoException;
          e.code = "ENOSPC";
          throw e;
        }
        return FAKE_FD;
      },
    });
    expect(result.fellBack).toBe(true);
    expect(result.path).toBe("/tmp/minsky-worker-0-1234.log");
    expect(result.reason).toMatch(/ENOSPC/);
  });
});

describe("pickLogPath — chaos: both paths fail", () => {
  it("throws when both primary AND fallback fail (loud-crash per Armstrong)", () => {
    expect(() =>
      pickLogPath({
        primary: "/repo/.minsky/workers/0.log",
        fallbackTmp: "/tmp/minsky-worker-0-1234.log",
        openSyncFn: () => {
          const e = new Error("EACCES") as NodeJS.ErrnoException;
          e.code = "EACCES";
          throw e;
        },
      }),
    ).toThrow(/EACCES/);
  });
});

describe("pickLogPath — chaos: unknown errno bubbles up", () => {
  it("does NOT fall back on unknown errno (must surface)", () => {
    expect(() =>
      pickLogPath({
        primary: "/repo/.minsky/workers/0.log",
        fallbackTmp: "/tmp/minsky-worker-0-1234.log",
        openSyncFn: () => {
          const e = new Error("EBUSY") as NodeJS.ErrnoException;
          e.code = "EBUSY";
          throw e;
        },
      }),
    ).toThrow(/EBUSY/);
  });
});
