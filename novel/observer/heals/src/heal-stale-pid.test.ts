// Tests for heal-stale-pid
//
// Each scenario maps to a Given/When/Then block in
// user-stories/007-agent-self-heals-catalogued-failures.md.

import { describe, expect, test } from "vitest";
import * as healStalePid from "./heal-stale-pid.js";
import type { StalePidSeams } from "./heal-stale-pid.js";

/** Build a hermetic in-memory seam set for testing. */
function makeSeams(
  initialFiles: Record<string, string>,
  alivePids: number[] = [],
): { seams: StalePidSeams; files: Map<string, string> } {
  const files = new Map(Object.entries(initialFiles));
  const seams: StalePidSeams = {
    pidFilePath: "/tmp/test-daemon.pid",
    readFileSyncFn: (path) => {
      const value = files.get(path);
      if (value === undefined) {
        const err = new Error(`ENOENT: no such file ${path}`) as Error & {
          code: string;
        };
        err.code = "ENOENT";
        throw err;
      }
      return value;
    },
    existsSyncFn: (path) => files.has(path),
    unlinkSyncFn: (path) => {
      files.delete(path);
    },
    killFn: (pid, _signal) => {
      if (!alivePids.includes(pid)) {
        const err = new Error("ESRCH: no such process") as Error & {
          code: string;
        };
        err.code = "ESRCH";
        throw err;
      }
      // pid is alive → success (no throw)
    },
  };
  return { seams, files };
}

describe("heal-stale-pid", () => {
  // scenario: "heal-stale-pid detects and removes a pid file pointing at a dead process"
  test("detects, applies, and verifies when pid is dead", () => {
    const { seams, files } = makeSeams({ "/tmp/test-daemon.pid": "99999\n" });
    const detected = healStalePid.detect(seams);
    expect(detected.present).toBe(true);
    if (detected.present) {
      expect(detected.signal).toBe("stale-pid");
      expect(detected.evidence).toEqual({ pid: 99999 });
    }
    const applied = healStalePid.apply(seams);
    expect(applied.applied).toBe(true);
    expect(applied.changedFiles).toEqual(["/tmp/test-daemon.pid"]);
    expect(files.has("/tmp/test-daemon.pid")).toBe(false);
    expect(healStalePid.verify(seams)).toEqual({ healed: true });
  });

  // scenario: "heal-stale-pid is a no-op when the pid is alive"
  test("returns present:false when pid is alive", () => {
    const { seams } = makeSeams({ "/tmp/test-daemon.pid": "12345\n" }, [12345]);
    const detected = healStalePid.detect(seams);
    expect(detected.present).toBe(false);
  });

  // scenario: "heal-stale-pid is a no-op when the pid file does not exist"
  test("returns present:false when pid file does not exist", () => {
    const { seams } = makeSeams({});
    const detected = healStalePid.detect(seams);
    expect(detected.present).toBe(false);
  });

  // scenario: "heal-stale-pid is idempotent under replay"
  test("apply is idempotent under replay", () => {
    const { seams, files } = makeSeams({ "/tmp/test-daemon.pid": "99999\n" });
    const first = healStalePid.apply(seams);
    expect(first.applied).toBe(true);
    // Second apply: file is already gone — should be a no-op, not a throw.
    const second = healStalePid.apply(seams);
    expect(second.applied).toBe(false);
    expect(second.notes).toBe("no pid file present");
    expect(files.has("/tmp/test-daemon.pid")).toBe(false);
  });

  test("garbage pid file content is treated as stale", () => {
    const { seams } = makeSeams({ "/tmp/test-daemon.pid": "not-a-number\n" });
    const detected = healStalePid.detect(seams);
    expect(detected.present).toBe(true);
    if (detected.present) {
      expect(detected.signal).toBe("stale-pid");
    }
  });

  test("verify returns healed:false when pid file still present", () => {
    const { seams } = makeSeams({ "/tmp/test-daemon.pid": "99999\n" });
    // Don't call apply — verify should say not healed.
    expect(healStalePid.verify(seams)).toEqual({
      healed: false,
      residualSignal: "pid-file-still-present",
    });
  });
});
