// Helper: heal-stale-pid
//
// Catalogued failure mode: `stale PID file (PID XXXX not running)` —
// daemon's pid file points at a dead process; the daemon refuses to start
// because it thinks another instance is running. The #1 most common
// failure in the catalogue.
//
// User-story: 007-agent-self-heals-catalogued-failures.md
// Scenarios:
//   - "heal-stale-pid detects and removes a pid file pointing at a dead process"
//   - "heal-stale-pid is a no-op when the pid is alive"
//   - "heal-stale-pid is a no-op when the pid file does not exist"
//   - "heal-stale-pid is idempotent under replay"

import type { ApplyResult, DetectResult, VerifyResult } from "./types.js";

/** Injected I/O seams so tests run hermetically without mocking globals. */
export type StalePidSeams = {
  pidFilePath: string;
  readFileSyncFn: (path: string, encoding: "utf8") => string;
  existsSyncFn: (path: string) => boolean;
  unlinkSyncFn: (path: string) => void;
  killFn: (pid: number, signal: 0) => void; // throws ESRCH if pid is dead
};

export function detect(seams: StalePidSeams): DetectResult {
  if (!seams.existsSyncFn(seams.pidFilePath)) {
    return { present: false };
  }
  const raw = seams.readFileSyncFn(seams.pidFilePath, "utf8").trim();
  const pid = Number(raw);
  if (!Number.isInteger(pid) || pid <= 0) {
    // Garbage pid file is also stale.
    return {
      present: true,
      signal: "stale-pid",
      evidence: { pidFileContent: raw },
    };
  }
  try {
    seams.killFn(pid, 0);
    // pid is alive — not stale.
    return { present: false };
  } catch {
    // ESRCH (or any other error from kill 0) → pid is dead.
    return { present: true, signal: "stale-pid", evidence: { pid } };
  }
}

export function apply(seams: StalePidSeams): ApplyResult {
  if (!seams.existsSyncFn(seams.pidFilePath)) {
    return { applied: false, changedFiles: [], notes: "no pid file present" };
  }
  seams.unlinkSyncFn(seams.pidFilePath);
  return {
    applied: true,
    changedFiles: [seams.pidFilePath],
    notes: "removed stale pid file",
  };
}

export function verify(seams: StalePidSeams): VerifyResult {
  if (seams.existsSyncFn(seams.pidFilePath)) {
    return { healed: false, residualSignal: "pid-file-still-present" };
  }
  return { healed: true };
}
