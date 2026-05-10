/**
 * Paired tests for `local-llm-server-stopper.ts`. Slice 11 of P0 task
 * `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Covers all 5 chaos-table rows from {@link stopLocalLlmServer}'s JSDoc:
 *   1. No PID file → no-op outcome
 *   2. PID file unparseable → unlink + invalid-pid-file
 *   3. PID dead (ESRCH) → unlink + stale-cleaned
 *   4. PID alive → SIGTERM + unlink + stopped
 *   5. SIGTERM rejected (EPERM) → leave file + kill-failed
 */

import { describe, expect, it } from "vitest";
import { type StopServerIo, stopLocalLlmServer } from "./local-llm-server-stopper.js";

// ---- helpers --------------------------------------------------------------

interface FakeFs {
  readonly pidFiles: Map<string, string>;
  readonly killCalls: Array<{ pid: number; signal: 0 | NodeJS.Signals }>;
  readonly unlinkCalls: string[];
}

/**
 * Build a fake `StopServerIo` over an in-memory map. `aliveSet` is the
 * set of PIDs the fake `kill(pid, 0)` reports as live. `killTermBehavior`
 * lets a row inject an EPERM throw on the SIGTERM call only.
 */
function makeFakeIo(args: {
  pidFiles: Record<string, string>;
  aliveSet: ReadonlySet<number>;
  killTermBehavior?: "ok" | "eperm";
}): { io: StopServerIo; fs: FakeFs } {
  const pidFiles = new Map(Object.entries(args.pidFiles));
  const killCalls: FakeFs["killCalls"] = [];
  const unlinkCalls: string[] = [];
  const io: StopServerIo = {
    pidExistsFn: (path) => pidFiles.has(path),
    readPidFn: (path) => {
      const v = pidFiles.get(path);
      if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return v;
    },
    killFn: (pid, signal) => {
      killCalls.push({ pid, signal });
      if (signal === 0) {
        if (!args.aliveSet.has(pid)) {
          throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
        }
        return;
      }
      // SIGTERM (or other terminating signal)
      if (args.killTermBehavior === "eperm") {
        throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
      }
      pidFiles.delete; // intentional no-op — kill is in-memory
    },
    unlinkFn: (path) => {
      unlinkCalls.push(path);
      pidFiles.delete(path);
    },
  };
  return { io, fs: { pidFiles, killCalls, unlinkCalls } };
}

const PID_PATH = "/tmp/test/.minsky/local-llm.pid";

// ---- row 1: no pid file ---------------------------------------------------

describe("stopLocalLlmServer — row 1: no pid file", () => {
  it("returns { kind: 'no-pid-file' } and touches nothing", () => {
    const { io, fs } = makeFakeIo({ pidFiles: {}, aliveSet: new Set() });
    const outcome = stopLocalLlmServer({ pidPath: PID_PATH, io });
    expect(outcome).toEqual({ kind: "no-pid-file" });
    expect(fs.killCalls).toHaveLength(0);
    expect(fs.unlinkCalls).toHaveLength(0);
  });
});

// ---- row 2: invalid pid file ---------------------------------------------

describe("stopLocalLlmServer — row 2: invalid pid file", () => {
  it("unlinks and reports invalid-pid-file when contents are non-numeric", () => {
    const { io, fs } = makeFakeIo({
      pidFiles: { [PID_PATH]: "not-a-number\n" },
      aliveSet: new Set(),
    });
    const outcome = stopLocalLlmServer({ pidPath: PID_PATH, io });
    expect(outcome).toEqual({ kind: "invalid-pid-file" });
    expect(fs.killCalls).toHaveLength(0);
    expect(fs.unlinkCalls).toEqual([PID_PATH]);
  });

  it("unlinks and reports invalid-pid-file when contents are empty", () => {
    const { io, fs } = makeFakeIo({
      pidFiles: { [PID_PATH]: "   \n" },
      aliveSet: new Set(),
    });
    const outcome = stopLocalLlmServer({ pidPath: PID_PATH, io });
    expect(outcome.kind).toBe("invalid-pid-file");
    expect(fs.unlinkCalls).toEqual([PID_PATH]);
  });

  it("unlinks and reports invalid-pid-file when PID is zero or negative", () => {
    const { io, fs } = makeFakeIo({
      pidFiles: { [PID_PATH]: "-1" },
      aliveSet: new Set(),
    });
    const outcome = stopLocalLlmServer({ pidPath: PID_PATH, io });
    expect(outcome.kind).toBe("invalid-pid-file");
    expect(fs.unlinkCalls).toEqual([PID_PATH]);
  });
});

// ---- row 3: stale pid (ESRCH) --------------------------------------------

describe("stopLocalLlmServer — row 3: stale pid (ESRCH)", () => {
  it("unlinks and reports stale-cleaned when kill(pid, 0) throws ESRCH", () => {
    const { io, fs } = makeFakeIo({
      pidFiles: { [PID_PATH]: "12345" },
      aliveSet: new Set(), // pid 12345 not alive → kill(0) throws ESRCH
    });
    const outcome = stopLocalLlmServer({ pidPath: PID_PATH, io });
    expect(outcome).toEqual({ kind: "stale-cleaned", pid: 12345 });
    // Only the liveness probe (signal 0) — never the SIGTERM
    expect(fs.killCalls).toEqual([{ pid: 12345, signal: 0 }]);
    expect(fs.unlinkCalls).toEqual([PID_PATH]);
  });
});

// ---- row 4: happy stop ---------------------------------------------------

describe("stopLocalLlmServer — row 4: happy stop", () => {
  it("sends SIGTERM, unlinks, reports stopped", () => {
    const { io, fs } = makeFakeIo({
      pidFiles: { [PID_PATH]: "98765\n" },
      aliveSet: new Set([98765]),
    });
    const outcome = stopLocalLlmServer({ pidPath: PID_PATH, io });
    expect(outcome).toEqual({ kind: "stopped", pid: 98765 });
    expect(fs.killCalls).toEqual([
      { pid: 98765, signal: 0 },
      { pid: 98765, signal: "SIGTERM" },
    ]);
    expect(fs.unlinkCalls).toEqual([PID_PATH]);
  });
});

// ---- row 5: kill rejects (EPERM) -----------------------------------------

describe("stopLocalLlmServer — row 5: SIGTERM rejected (EPERM)", () => {
  it("leaves the PID file in place and reports kill-failed with reason", () => {
    const { io, fs } = makeFakeIo({
      pidFiles: { [PID_PATH]: "11111" },
      aliveSet: new Set([11111]),
      killTermBehavior: "eperm",
    });
    const outcome = stopLocalLlmServer({ pidPath: PID_PATH, io });
    expect(outcome).toEqual({ kind: "kill-failed", pid: 11111, reason: "EPERM" });
    // PID file NOT unlinked — operator can retry from a privileged shell
    expect(fs.unlinkCalls).toHaveLength(0);
    expect(fs.killCalls).toEqual([
      { pid: 11111, signal: 0 },
      { pid: 11111, signal: "SIGTERM" },
    ]);
  });
});
