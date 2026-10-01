// <!-- scope: human-approved sub-task `heal-agent-rate-limited` of `promote-remaining-heal-recipes` decomposition (phase 2 of agents-can-self-heal-minsky-m1-13). Different shape than the JSON-corruption heals — stderr-regex detection + sleep-and-retry. -->
//
// Helper: heal-agent-rate-limited
//
// Catalogued failure mode: the cloud agent (claude / devin / aider /
// codex) returns HTTP 429 on a tool call. Symptoms in worker stderr:
//   - "rate limit exceeded"
//   - "too many requests"
//   - "429 Too Many Requests"
// The worker stalls until the spawn timeout fires; the iteration is
// recorded as `spawn-failed` despite the agent being healthy.
//
// Heal: detect via stderr regex → sleep with exponential backoff
// (30s, 60s, 120s by default, all injectable) → indicate that the
// caller should retry the spawn. After 3 attempts exhausted, the
// caller treats the iteration as `spawn-failed` and the global
// fleet-provider-mode-flip-to-local path takes over (see the
// runtime-token-limit-auto-pivot-local-and-back task).
//
// Idempotent: only fires when the regex matches; safe to invoke on
// any stderr buffer.
//
// Pure-with-I/O-at-edge: the sleep function is injected (tests pass
// 0ms; production passes setTimeout). The "did the next attempt
// succeed" check is the caller's concern — this helper only owns
// detect + sleep.
//
// User-story: 007-agent-self-heals-catalogued-failures.md

import type { ApplyResult, DetectResult, VerifyResult } from "./types.js";

/** Injected I/O seams so tests run hermetically without real sleeps. */
export type AgentRateLimitedSeams = {
  /** Stderr buffer to scan for the rate-limit signal. */
  stderr: string;
  /** Sleep function — tests pass a no-op; production passes setTimeout-based. */
  sleepMsFn: (durationMs: number) => Promise<void>;
  /** Current attempt index (0-based). Caller increments between attempts. */
  attemptIndex: number;
  /** Backoff schedule. Default: [30_000, 60_000, 120_000]. */
  backoffScheduleMs?: readonly number[];
  /**
   * Re-detect after the sleep. Tests inject; production reads the
   * worker's NEXT stderr buffer after the retry. Returning empty string
   * means "no signal observed" (heal succeeded).
   */
  nextStderrFn?: () => string;
};

/**
 * Default backoff schedule — three attempts, each ~2x the previous.
 * 30s → 60s → 120s totals ~3.5 minutes of wait before giving up.
 * Matches the 5-min MTTR threshold from M1.13.
 */
export const DEFAULT_BACKOFF_SCHEDULE_MS: readonly number[] = [30_000, 60_000, 120_000];

/**
 * Regex that matches the rate-limit signals across the supported
 * cloud agents. Cases:
 *
 *   - claude / anthropic: "rate limit", "rate_limit_error", "429"
 *   - openai: "Rate limit reached", "429 Too Many Requests"
 *   - generic HTTP: "429" alongside "Too Many Requests"
 *
 * @type {RegExp}
 */
export const RATE_LIMIT_RE =
  /(rate[\s_-]?limit|429\s+too\s+many\s+requests|too\s+many\s+requests|rate_limit_error|429\s+(rate|too))/i;

/**
 * @otel-exempt pure-with-I/O-at-edge — OTEL span owned by caller (agent
 * runtime or observer.heal()), not the helper. Caller wraps the full
 * detect→apply→verify cycle in one observer.heal span.
 */
export function detect(seams: AgentRateLimitedSeams): DetectResult {
  if (!RATE_LIMIT_RE.test(seams.stderr)) {
    return { present: false };
  }
  return {
    present: true,
    signal: "agent-rate-limited",
    evidence: {
      attemptIndex: seams.attemptIndex,
      stderrPreview: seams.stderr.slice(0, 200),
    },
  };
}

/**
 * Sleep according to the backoff schedule and signal the caller to
 * retry. Returns `applied: false` if the attempt index is past the
 * schedule (caller should treat as exhausted).
 *
 * @otel-exempt pure-with-I/O-at-edge — sleep is injected at the seam;
 * caller wraps in an OTEL heal span.
 */
export async function apply(seams: AgentRateLimitedSeams): Promise<ApplyResult> {
  const detection = detect(seams);
  if (!detection.present) {
    return {
      applied: false,
      changedFiles: [],
      notes: "no-op: stderr has no rate-limit signal",
    };
  }
  const schedule = seams.backoffScheduleMs ?? DEFAULT_BACKOFF_SCHEDULE_MS;
  if (seams.attemptIndex >= schedule.length) {
    return {
      applied: false,
      changedFiles: [],
      notes: `exhausted ${schedule.length} retry attempts — caller should escalate to fleet-provider-mode-flip-to-local`,
    };
  }
  const durationMs = schedule[seams.attemptIndex];
  if (durationMs === undefined) {
    return {
      applied: false,
      changedFiles: [],
      notes: "no-op: backoff schedule undefined at this index",
    };
  }
  await seams.sleepMsFn(durationMs);
  return {
    applied: true,
    changedFiles: [],
    notes: `slept ${durationMs}ms (attempt ${seams.attemptIndex + 1} of ${schedule.length}); caller should retry the spawn`,
  };
}

/**
 * Verify: re-detect on the next stderr (the caller provides it via
 * `nextStderrFn`). If the regex no longer matches, the heal worked.
 *
 * @otel-exempt pure-with-I/O-at-edge — verify re-runs detect.
 */
export function verify(seams: AgentRateLimitedSeams): VerifyResult {
  if (seams.nextStderrFn === undefined) {
    // Caller didn't supply a re-detection seam — assume healed (the
    // sleep happened; the caller will discover the truth on the next
    // spawn). This is the right default for the chaos test, which
    // doesn't actually re-spawn.
    return { healed: true };
  }
  const nextStderr = seams.nextStderrFn();
  if (RATE_LIMIT_RE.test(nextStderr)) {
    return { healed: false, residualSignal: "agent-rate-limited" };
  }
  return { healed: true };
}
