// Tests for heal-stuck-command
//
// Scenarios map to user-stories/007-agent-self-heals-catalogued-failures.md.

import { describe, expect, test } from "vitest";
import type { StuckCommandSeams } from "./heal-stuck-command.js";
import * as healStuck from "./heal-stuck-command.js";

function makeSeams(opts: {
  pollsWithoutOutput: number;
  processPid: number;
  alivePids: Set<number>;
}): { seams: StuckCommandSeams; kills: number[]; alivePids: Set<number> } {
  const kills: number[] = [];
  const seams: StuckCommandSeams = {
    shellId: "test-shell",
    pollsWithoutOutput: opts.pollsWithoutOutput,
    processPid: opts.processPid,
    killFn: (pid, _signal) => {
      kills.push(pid);
      opts.alivePids.delete(pid);
    },
    probeFn: (pid, _signal) => {
      if (!opts.alivePids.has(pid)) {
        const err = new Error("ESRCH: no such process") as Error & {
          code: string;
        };
        err.code = "ESRCH";
        throw err;
      }
    },
  };
  return { seams, kills, alivePids: opts.alivePids };
}

describe("heal-stuck-command", () => {
  // scenario: "heal-stuck-command detects a shell with no output beyond the threshold"
  test("detects, applies, verifies for a stuck shell", () => {
    const alivePids = new Set([12345]);
    const { seams, kills } = makeSeams({
      pollsWithoutOutput: 3,
      processPid: 12345,
      alivePids,
    });

    const detected = healStuck.detect(seams);
    expect(detected.present).toBe(true);
    if (detected.present) {
      expect(detected.signal).toBe("stuck-command");
      expect(detected.evidence).toEqual({
        shellId: "test-shell",
        pollsWithoutOutput: 3,
      });
    }

    const applied = healStuck.apply(seams);
    expect(applied.applied).toBe(true);
    expect(kills).toEqual([12345]);
    expect(alivePids.has(12345)).toBe(false);

    expect(healStuck.verify(seams)).toEqual({ healed: true });
  });

  // scenario: "heal-stuck-command is no-op below the threshold"
  test("returns present:false when pollsWithoutOutput < 3", () => {
    const { seams } = makeSeams({
      pollsWithoutOutput: 2,
      processPid: 12345,
      alivePids: new Set([12345]),
    });
    expect(healStuck.detect(seams).present).toBe(false);
  });

  // scenario: "heal-stuck-command verify confirms the process actually died"
  test("verify returns healed:false for a still-alive pid (negative control)", () => {
    const alivePids = new Set([12345]);
    const { seams } = makeSeams({
      pollsWithoutOutput: 3,
      processPid: 12345,
      alivePids,
    });
    // Don't call apply — pid remains alive — verify should fail.
    expect(healStuck.verify(seams)).toEqual({
      healed: false,
      residualSignal: "process-still-alive",
    });
  });

  test("apply is no-op if process already exited (race)", () => {
    const alivePids = new Set<number>(); // pid 12345 is already dead
    const { seams, kills } = makeSeams({
      pollsWithoutOutput: 3,
      processPid: 12345,
      alivePids,
    });
    const applied = healStuck.apply(seams);
    expect(applied.applied).toBe(false);
    expect(applied.notes).toBe("process already exited before kill");
    expect(kills).toHaveLength(0);
  });

  test("STUCK_THRESHOLD is exactly 3", () => {
    expect(healStuck.STUCK_THRESHOLD).toBe(3);
    // boundary check
    const aliveAt3 = new Set([12345]);
    const seams3 = makeSeams({
      pollsWithoutOutput: 3,
      processPid: 12345,
      alivePids: aliveAt3,
    }).seams;
    expect(healStuck.detect(seams3).present).toBe(true);
  });
});
