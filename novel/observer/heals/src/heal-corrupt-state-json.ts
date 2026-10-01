// <!-- scope: human-approved sub-task `heal-corrupt-state-json` of `promote-remaining-heal-recipes` decomposition (phase 2 of agents-can-self-heal-minsky-m1-13). Mirrors the heal-stale-tsbuildinfo shape. -->
//
// Helper: heal-corrupt-state-json
//
// Catalogued failure mode: `.minsky/state.json` is unparseable (truncated
// mid-write during a crash, JSON syntax error, empty file). The daemon
// reads it on startup and refuses to launch.
//
// Heal: detect by attempting JSON.parse; if it throws, the file is
// corrupt. Apply: atomic backup-and-reseed — move the bad file to
// `state.json.corrupt.<timestamp>` and write a fresh `{}` placeholder
// that the daemon can populate on next iteration. Verify: subsequent
// JSON.parse succeeds.
//
// Idempotent: re-running on a healthy state.json is a no-op (detect
// returns present:false).
//
// User-story: 007-agent-self-heals-catalogued-failures.md
// Scenarios:
//   - "heal-corrupt-state-json detects an unparseable state file"
//   - "heal-corrupt-state-json backs up the bad file and reseeds empty {}"
//   - "heal-corrupt-state-json is a no-op when state.json parses cleanly"
//   - "heal-corrupt-state-json is idempotent under replay"

import type { ApplyResult, DetectResult, VerifyResult } from "./types.js";

/** Injected I/O seams so tests run hermetically without mocking globals. */
export type CorruptStateJsonSeams = {
  /** Absolute path to the state.json under test. */
  stateFilePath: string;
  /** Timestamp the apply step uses for the `.corrupt.<ts>` suffix. */
  nowFn: () => number;
  existsSyncFn: (path: string) => boolean;
  readFileSyncFn: (path: string, encoding: "utf8") => string;
  writeFileSyncFn: (path: string, content: string) => void;
  renameSyncFn: (oldPath: string, newPath: string) => void;
};

const isParseable = (content: string): boolean => {
  if (content.length === 0) return false;
  try {
    JSON.parse(content);
    return true;
    // rule-6: handled-locally — a JSON.parse throw IS the detector's success signal (the file IS corrupt); not an error to supervise.
  } catch {
    return false;
  }
};

/**
 * @otel-exempt pure-with-I/O-at-edge — OTEL span owned by caller (agent
 * runtime or observer.heal()), not the helper. Caller wraps the full
 * detect→apply→verify cycle in one observer.heal span.
 */
export function detect(seams: CorruptStateJsonSeams): DetectResult {
  if (!seams.existsSyncFn(seams.stateFilePath)) {
    // Missing file isn't corrupt — daemon's first-run path creates it.
    // This heal is scoped to the "file present but unparseable" case
    // only; missing-file is a different signal (and a different heal).
    return { present: false };
  }
  const content = seams.readFileSyncFn(seams.stateFilePath, "utf8");
  if (isParseable(content)) {
    return { present: false };
  }
  return {
    present: true,
    signal: "corrupt-state-json",
    evidence: {
      stateFilePath: seams.stateFilePath,
      contentLength: content.length,
      contentPreview: content.slice(0, 80),
    },
  };
}

/**
 * Atomic backup-and-reseed: rename `state.json` to
 * `state.json.corrupt.<ts>`, then write fresh `{}`. If detect would
 * return present:false (file already healthy), this is a no-op.
 *
 * @otel-exempt pure-with-I/O-at-edge — OTEL span owned by caller
 * (observer.heal()), not the helper. Apply step records to the heal-ledger
 * via the caller's span; this function only mutates the fs at the seam.
 */
export function apply(seams: CorruptStateJsonSeams): ApplyResult {
  const detection = detect(seams);
  if (!detection.present) {
    return { applied: false, changedFiles: [], notes: "no-op: state.json parses cleanly" };
  }
  const backupPath = `${seams.stateFilePath}.corrupt.${seams.nowFn()}`;
  seams.renameSyncFn(seams.stateFilePath, backupPath);
  seams.writeFileSyncFn(seams.stateFilePath, "{}\n");
  return {
    applied: true,
    changedFiles: [seams.stateFilePath, backupPath],
    notes: `backed up to ${backupPath} and reseeded with empty object`,
  };
}

/**
 * Re-detect after apply. If the file parses cleanly, the heal succeeded.
 *
 * @otel-exempt pure-with-I/O-at-edge — verify just re-runs detect, which
 * is OTEL-exempt itself. Caller owns the heal span.
 */
export function verify(seams: CorruptStateJsonSeams): VerifyResult {
  const post = detect(seams);
  if (post.present) {
    return { healed: false, residualSignal: post.signal };
  }
  return { healed: true };
}
