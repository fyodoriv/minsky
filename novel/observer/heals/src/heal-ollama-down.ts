// <!-- scope: human-approved sub-task `heal-ollama-down` of `promote-remaining-heal-recipes` decomposition. Mirrors heal-agent-rate-limited (stderr-regex + injected exec/probe). -->
//
// Helper: heal-ollama-down
//
// Catalogued failure mode: `cloud_agent_model` is `ollama_chat/*` (or
// similar local-mode), but the ollama daemon isn't running. The spawn
// fails with `ECONNREFUSED localhost:11434` (or similar
// `connection refused` / `connect ECONNREFUSED 127.0.0.1:11434`).
//
// Heal: detect via stderr regex → invoke the injected `kickFn` (in
// production this runs `launchctl kickstart -k
// gui/$(id -u)/com.minsky.ollama-keepalive` OR
// `nohup ollama serve >/dev/null 2>&1 &`, depending on host config) →
// verify by probing `http://localhost:11434/api/tags`. Idempotent.
//
// Pivot: if the heal requires `sudo` (e.g. system-mode ollama on
// Linux), refuse + keep recipe as operator. macOS launchd user-mode
// works without privilege escalation per the task body.
//
// User-story: 007-agent-self-heals-catalogued-failures.md

import type { ApplyResult, DetectResult, VerifyResult } from "./types.js";

/** Injected I/O seams so tests run hermetically without spawning ollama. */
export type OllamaDownSeams = {
  /** Stderr buffer to scan for the ECONNREFUSED:11434 signal. */
  stderr: string;
  /**
   * "Kick" the ollama daemon: production runs `launchctl kickstart`
   * or `ollama serve &`. Tests record a kicked flag.
   * Throws on failure (rule #6 — let-it-crash at the I/O boundary).
   */
  kickFn: () => void;
  /**
   * Probe whether ollama is reachable now. Tests flip this between
   * apply and verify.
   * Returns true when `GET /api/tags` would succeed.
   */
  probeFn: () => boolean;
};

/**
 * Regex that matches the ollama-down signal. Cases:
 *
 *   - node: `ECONNREFUSED 127.0.0.1:11434` / `localhost:11434`
 *   - openhands: `Connection error: ... ollama ...`
 *   - generic: `connect ECONNREFUSED ... :11434`
 *
 * @type {RegExp}
 */
export const OLLAMA_DOWN_RE =
  /(econnrefused\s+(?:127\.0\.0\.1|localhost|::1)[:\s]?11434|connection\s+(?:error|refused).*ollama|ollama.*(?:connection\s+refused|not\s+running|unreachable))/i;

/**
 * @otel-exempt pure-with-I/O-at-edge — OTEL span owned by caller.
 */
export function detect(seams: OllamaDownSeams): DetectResult {
  if (!OLLAMA_DOWN_RE.test(seams.stderr)) {
    return { present: false };
  }
  return {
    present: true,
    signal: "ollama-down",
    evidence: {
      stderrPreview: seams.stderr.slice(0, 200),
    },
  };
}

/**
 * Kick the ollama daemon and report whether it came up. Idempotent:
 * if ollama is already running (probe returns true before kick), the
 * function still calls `kickFn` — `launchctl kickstart` is a no-op
 * against a healthy daemon.
 *
 * @otel-exempt pure-with-I/O-at-edge — kick is injected at the seam.
 */
export function apply(seams: OllamaDownSeams): ApplyResult {
  const detection = detect(seams);
  if (!detection.present) {
    return {
      applied: false,
      changedFiles: [],
      notes: "no-op: stderr has no ollama-down signal",
    };
  }
  seams.kickFn();
  return {
    applied: true,
    changedFiles: [],
    notes: "kicked ollama daemon — caller should retry the spawn",
  };
}

/**
 * Verify: probe ollama directly. If the probe succeeds, the heal
 * worked. If not, the kick didn't bring ollama up (likely a
 * configuration issue beyond this helper's scope).
 *
 * @otel-exempt pure-with-I/O-at-edge — probe is injected at the seam.
 */
export function verify(seams: OllamaDownSeams): VerifyResult {
  if (seams.probeFn()) {
    return { healed: true };
  }
  return { healed: false, residualSignal: "ollama-down" };
}
