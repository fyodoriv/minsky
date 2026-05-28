// <!-- scope: human-approved sub-task `heal-network-partition-mid-spawn` of `promote-remaining-heal-recipes` decomposition. Same shape as heal-agent-rate-limited (stderr regex + injected sleep) but tighter retry budget (1 attempt vs 3). -->
//
// Helper: heal-network-partition-mid-spawn
//
// Catalogued failure mode: a worker spawn hits DNS resolution failure
// or TLS timeout against the cloud agent. Symptoms in stderr:
//   - `getaddrinfo ENOTFOUND api.anthropic.com`
//   - `ETIMEDOUT` during TLS handshake
//   - `ECONNRESET` mid-call
//   - `network unreachable`
//
// Heal: detect via stderr regex → sleep 30s once → signal caller to
// retry. Conservative single retry — multiple retries amplify
// duplicate-spawn risk (rule #6 — let-it-crash if the second attempt
// fails; the caller's spawn-failed verdict + global-fleet-flip path
// handles the persistent case).
//
// Pivot path: if network failures persist (≥3 consecutive iterations),
// escalate to fleet-provider-mode-flip-to-local. Same shape as
// heal-agent-rate-limited's exhaustion path.
//
// User-story: 007-agent-self-heals-catalogued-failures.md

import type { ApplyResult, DetectResult, VerifyResult } from "./types.js";

/** Injected I/O seams so tests run hermetically. */
export type NetworkPartitionMidSpawnSeams = {
  /** Stderr buffer to scan for the network-failure signal. */
  stderr: string;
  /** Sleep function — tests pass a no-op; production passes setTimeout. */
  sleepMsFn: (durationMs: number) => Promise<void>;
  /** Has the heal already been applied this iteration? Caller tracks. */
  alreadyRetried: boolean;
  /** Sleep duration before retry. Default: 30_000 (30s). */
  retrySleepMs?: number;
  /** Optional re-detect on the next spawn's stderr. */
  nextStderrFn?: () => string;
};

/**
 * Default retry sleep — 30 seconds. Single attempt; if the network
 * is still partitioned after 30s, the caller should escalate (per
 * pivot text in the task body).
 */
export const DEFAULT_RETRY_SLEEP_MS = 30_000;

/**
 * Regex matching the network-partition signals. Cases:
 *
 *   - DNS: `getaddrinfo ENOTFOUND`, `EAI_AGAIN`
 *   - TLS: `ETIMEDOUT` during handshake
 *   - TCP: `ECONNRESET` mid-call
 *   - generic: `network unreachable`
 *
 * Explicitly NOT matched: `ECONNREFUSED` (that's for heal-ollama-down
 * / 11434-specific paths) or `429` (heal-agent-rate-limited).
 *
 * @type {RegExp}
 */
export const NETWORK_PARTITION_RE =
  /(getaddrinfo\s+ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|network\s+unreachable|ENETUNREACH|ENOTCONN|tls\s+handshake\s+(?:timeout|failed))/i;

/**
 * @otel-exempt pure-with-I/O-at-edge — OTEL span owned by caller.
 */
export function detect(seams: NetworkPartitionMidSpawnSeams): DetectResult {
  if (!NETWORK_PARTITION_RE.test(seams.stderr)) {
    return { present: false };
  }
  return {
    present: true,
    signal: "network-partition-mid-spawn",
    evidence: {
      alreadyRetried: seams.alreadyRetried,
      stderrPreview: seams.stderr.slice(0, 200),
    },
  };
}

/**
 * Sleep 30s and signal the caller to retry — once. If the caller has
 * already retried (alreadyRetried=true), refuse with an exhaustion
 * note pointing at the fleet-flip path.
 *
 * @otel-exempt pure-with-I/O-at-edge — sleep is injected.
 */
export async function apply(seams: NetworkPartitionMidSpawnSeams): Promise<ApplyResult> {
  const detection = detect(seams);
  if (!detection.present) {
    return {
      applied: false,
      changedFiles: [],
      notes: "no-op: stderr has no network-partition signal",
    };
  }
  if (seams.alreadyRetried) {
    return {
      applied: false,
      changedFiles: [],
      notes:
        "exhausted single retry — caller should escalate to fleet-provider-mode-flip-to-local (persistent network failure)",
    };
  }
  const durationMs = seams.retrySleepMs ?? DEFAULT_RETRY_SLEEP_MS;
  await seams.sleepMsFn(durationMs);
  return {
    applied: true,
    changedFiles: [],
    notes: `slept ${durationMs}ms; caller should retry the spawn once`,
  };
}

/**
 * Verify: re-detect on the next stderr buffer. If the regex no longer
 * matches, the heal worked.
 *
 * @otel-exempt pure-with-I/O-at-edge — verify re-runs detect.
 */
export function verify(seams: NetworkPartitionMidSpawnSeams): VerifyResult {
  if (seams.nextStderrFn === undefined) {
    return { healed: true };
  }
  const nextStderr = seams.nextStderrFn();
  if (NETWORK_PARTITION_RE.test(nextStderr)) {
    return { healed: false, residualSignal: "network-partition-mid-spawn" };
  }
  return { healed: true };
}
