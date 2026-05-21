// Helper: heal-stuck-command
//
// Catalogued failure mode: an agent's shell was polled three or more
// times with no new output. Most often vitest / pnpm pre-pr-lint that
// stalled. Detect → kill the shell + advise the agent to retry with a
// narrower command (e.g. one vitest file instead of the full suite).
//
// Wired in by the agent runtime's shell-polling loop, not the daemon —
// the loop already tracks `polls_without_output` per shell.
//
// User-story: 007-agent-self-heals-catalogued-failures.md
// Scenarios:
//   - "heal-stuck-command detects a shell with no output beyond the threshold"
//   - "heal-stuck-command is no-op below the threshold"
//   - "heal-stuck-command verify confirms the process actually died"

import type { ApplyResult, DetectResult, VerifyResult } from "./types.js";

export const STUCK_THRESHOLD = 3;

/** Injected I/O seams. */
export type StuckCommandSeams = {
  shellId: string;
  pollsWithoutOutput: number;
  processPid: number;
  /** Kill the process (SIGKILL or equivalent). Tests inject a stub. */
  killFn: (pid: number, signal: "SIGKILL") => void;
  /** Probe whether the pid is alive (kill 0). Throws ESRCH if dead. */
  probeFn: (pid: number, signal: 0) => void;
};

/** @otel-exempt pure-with-I/O-at-edge — span owned by caller (agent runtime or observer.heal). */
export function detect(seams: StuckCommandSeams): DetectResult {
  if (seams.pollsWithoutOutput < STUCK_THRESHOLD) {
    return { present: false };
  }
  return {
    present: true,
    signal: "stuck-command",
    evidence: {
      shellId: seams.shellId,
      pollsWithoutOutput: seams.pollsWithoutOutput,
    },
  };
}

/** @otel-exempt pure-with-I/O-at-edge — span owned by caller (agent runtime or observer.heal). */
export function apply(seams: StuckCommandSeams): ApplyResult {
  try {
    seams.probeFn(seams.processPid, 0);
    // rule-6: handled-locally — probe throwing ESRCH means the process raced to natural exit before we got to kill it; returning applied:false IS the correct outcome (no-op).
  } catch {
    return {
      applied: false,
      changedFiles: [],
      notes: "process already exited before kill",
    };
  }
  try {
    seams.killFn(seams.processPid, "SIGKILL");
    return {
      applied: true,
      changedFiles: [],
      notes: `killed pid ${seams.processPid}`,
    };
    // rule-6: handled-locally — kill failure (permission denied, ESRCH race) is reported in the ApplyResult.notes for the ledger; not a daemon-wide fault to supervise.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      applied: false,
      changedFiles: [],
      notes: `kill failed: ${message}`,
    };
  }
}

/** @otel-exempt pure-with-I/O-at-edge — span owned by caller (agent runtime or observer.heal). */
export function verify(seams: StuckCommandSeams): VerifyResult {
  try {
    seams.probeFn(seams.processPid, 0);
    return { healed: false, residualSignal: "process-still-alive" };
    // rule-6: handled-locally — ESRCH from probe is the success signal here (the process is dead, which is the goal of this heal). Not an error.
  } catch {
    return { healed: true };
  }
}
