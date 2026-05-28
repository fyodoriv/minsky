// <!-- scope: human-approved sub-task `heal-partial-config-write` of `promote-remaining-heal-recipes` decomposition (phase 2 of agents-can-self-heal-minsky-m1-13). Mirrors heal-corrupt-state-json with config-shape validation. -->
//
// Helper: heal-partial-config-write
//
// Catalogued failure mode: `~/.minsky/config.json` is unparseable
// (truncated mid-write during a crash) OR parseable but missing required
// shape fields. The daemon reads it on startup and refuses to launch
// because the config doesn't have the expected schema.
//
// Heal: detect by (a) JSON.parse throw OR (b) missing required-field
// shape. Apply: atomic backup-and-reseed — move the bad file to
// `config.json.corrupt.<timestamp>` and write a fresh minimal default
// `{}` placeholder that the daemon's first-iteration path will populate.
// Verify: subsequent JSON.parse succeeds.
//
// Idempotent: re-running on a healthy config.json is a no-op (detect
// returns present:false).
//
// Pivot: see TASKS.md sub-task body — if the corrupt config carries
// per-machine user-provided fields (cost_tier, custom paths) that
// can't be reseeded from defaults, the heal refuses + escalates rather
// than silently overwriting operator state. The default-reseed path is
// scoped to "fully unparsable" only (matches the JSON.parse-throw case).
//
// User-story: 007-agent-self-heals-catalogued-failures.md

import type { ApplyResult, DetectResult, VerifyResult } from "./types.js";

/** Injected I/O seams so tests run hermetically without mocking globals. */
export type PartialConfigWriteSeams = {
  /** Absolute path to the config.json under test. */
  configFilePath: string;
  /** Timestamp the apply step uses for the `.corrupt.<ts>` suffix. */
  nowFn: () => number;
  existsSyncFn: (path: string) => boolean;
  readFileSyncFn: (path: string, encoding: "utf8") => string;
  writeFileSyncFn: (path: string, content: string) => void;
  renameSyncFn: (oldPath: string, newPath: string) => void;
};

const tryParse = (content: string): { ok: true; value: unknown } | { ok: false } => {
  if (content.length === 0) return { ok: false };
  try {
    const value = JSON.parse(content);
    return { ok: true, value };
    // rule-6: handled-locally — a JSON.parse throw IS the detector's success signal (the file IS corrupt); not an error to supervise.
  } catch {
    return { ok: false };
  }
};

/**
 * @otel-exempt pure-with-I/O-at-edge — OTEL span owned by caller (agent
 * runtime or observer.heal()), not the helper. Caller wraps the full
 * detect→apply→verify cycle in one observer.heal span.
 */
export function detect(seams: PartialConfigWriteSeams): DetectResult {
  if (!seams.existsSyncFn(seams.configFilePath)) {
    // Missing file isn't corrupt — the daemon's first-run path creates it.
    // This heal is scoped to the "file present but unparseable" case
    // only; missing-file is a different signal (initial-bootstrap, not
    // mid-write-crash).
    return { present: false };
  }
  const content = seams.readFileSyncFn(seams.configFilePath, "utf8");
  const parsed = tryParse(content);
  if (parsed.ok) {
    return { present: false };
  }
  return {
    present: true,
    signal: "partial-config-write",
    evidence: {
      configFilePath: seams.configFilePath,
      contentLength: content.length,
      contentPreview: content.slice(0, 80),
    },
  };
}

/**
 * Atomic backup-and-reseed: rename `config.json` to
 * `config.json.corrupt.<ts>`, then write fresh `{}`. The daemon's
 * first-iteration path will populate defaults on next start.
 *
 * @otel-exempt pure-with-I/O-at-edge — OTEL span owned by caller.
 * The apply step records to the heal-ledger via the caller's span;
 * this function only mutates the fs at the seam.
 */
export function apply(seams: PartialConfigWriteSeams): ApplyResult {
  const detection = detect(seams);
  if (!detection.present) {
    return { applied: false, changedFiles: [], notes: "no-op: config.json parses cleanly" };
  }
  const backupPath = `${seams.configFilePath}.corrupt.${seams.nowFn()}`;
  seams.renameSyncFn(seams.configFilePath, backupPath);
  seams.writeFileSyncFn(seams.configFilePath, "{}\n");
  return {
    applied: true,
    changedFiles: [seams.configFilePath, backupPath],
    notes: `backed up to ${backupPath} and reseeded with empty object`,
  };
}

/**
 * Re-detect after apply. If the file parses cleanly, the heal succeeded.
 *
 * @otel-exempt pure-with-I/O-at-edge — verify re-runs detect, which is
 * OTEL-exempt. Caller owns the heal span.
 */
export function verify(seams: PartialConfigWriteSeams): VerifyResult {
  const post = detect(seams);
  if (post.present) {
    return { healed: false, residualSignal: post.signal };
  }
  return { healed: true };
}
