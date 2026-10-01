// <!-- scope: human-approved task `daemon-silent-on-claude-account-rate-limit` (TASKS.md, P0/M1). Distinct from heal-agent-rate-limited (transient HTTP-429, 30/60/120s backoff): this is the ACCOUNT-LEVEL weekly-window exhaustion signal `You've hit your limit · resets <date>` that `claude --print` emits on exit 1. Backoff is useless against a multi-day reset — the heal parses the reset time, surfaces a budget-paused-claude verdict, notifies once (edge-triggered), and pauses until reset instead of busy-looping. -->
//
// Helper: heal-claude-account-rate-limit
//
// Catalogued failure mode: the operator's Claude account has exhausted
// its weekly usage window. `claude --print` exits 1 and prints to stderr:
//   - "You've hit your limit · resets May 31 at 8pm (America/Toronto)"
//   - "You've hit your limit · resets Jun 2 at 10am"
//   - "you've hit your limit · resets tomorrow at 9am"
// (the middle dot is U+00B7 `·`; the reset clause is free-form, emitted by
// the Claude CLI). The daemon, lacking a parser for this, keeps spawning
// `claude --print` every tick — each exits 1 with `provider=""` — burning
// machine cycles and obscuring the root cause behind a generic
// "spawn-failed". No amount of work in the cwd can heal this: it is an
// account-level wall, not a transient rate-limit.
//
// This is NOT the heal-agent-rate-limited case. That one handles HTTP 429
// ("rate limit exceeded", "429 Too Many Requests") with a 30s/60s/120s
// exponential backoff — the right move for a transient per-minute limit.
// A weekly-window exhaustion is measured in hours-to-days; backing off for
// two minutes then retrying just re-triggers the same exit-1 forever. The
// correct heal is: parse the reset time, pause the daemon until then, and
// tell the operator ONCE (so they can switch to local-only mode or wait).
//
// Heal: detect via stderr regex → parse the reset clause → compute the
// pause-until duration (`resetAt - now`, clamped to a sane floor) → emit a
// `budget-paused-claude` outcome carrying `resetAt` → fire ONE operator
// notification (edge-triggered: re-applying while already paused does NOT
// re-notify) → sleep until reset (injected sleep; tests pass 0ms). When the
// reset wall passes, the next spawn succeeds and verify() reports healed —
// the daemon auto-resumes without operator intervention.
//
// Idempotent: only fires when the regex matches. Re-applying while
// `alreadyPaused=true` is a no-op that does NOT re-notify (edge-triggered
// debounce — the operator gets exactly one push per exhaustion transition).
//
// Pure-with-I/O-at-edge: the clock (`nowMs`), the sleep (`sleepMsFn`), and
// the notifier (`notifyFn`) are injected so tests run hermetically without
// real time, real sleeps, or a real ntfy push. The reset-time parser is a
// pure function exported for direct testing.
//
// User-story: 007-agent-self-heals-catalogued-failures.md

import type { ApplyResult, DetectResult, VerifyResult } from "./types.js";

/** Injected I/O seams so tests run hermetically without real time / sleep / push. */
export type ClaudeAccountRateLimitSeams = {
  /** Stderr buffer to scan for the account-exhaustion signal. */
  stderr: string;
  /** Current wall-clock in epoch ms. Tests inject a fixed value. */
  nowMs: number;
  /**
   * Sleep until the reset wall. Tests pass a no-op recorder; production
   * passes a setTimeout-based sleep (capped per tick by the caller — the
   * daemon re-enters this heal each tick so a multi-day wall is split into
   * tick-sized sleeps, never one multi-day timer).
   */
  sleepMsFn: (durationMs: number) => Promise<void>;
  /**
   * Has the daemon ALREADY transitioned to budget-paused-claude this
   * exhaustion window? The caller tracks this across ticks. When true,
   * `apply()` still pauses but does NOT re-notify (edge-triggered debounce).
   */
  alreadyPaused: boolean;
  /**
   * Fire ONE operator notification (ntfy push / log banner). Tests record
   * the call count. Throws on failure (rule #6 — let-it-crash at the I/O
   * boundary; the caller's supervisor restart re-enters the heal).
   */
  notifyFn: (message: string) => void;
  /**
   * Floor for the pause duration in ms. Even if the parsed reset is in the
   * past (clock skew) or unparseable, the daemon idles at least this long
   * rather than busy-looping. Default: {@link DEFAULT_PAUSE_FLOOR_MS}.
   */
  pauseFloorMs?: number;
  /**
   * Optional re-detect on the NEXT spawn's stderr (after the reset wall).
   * Tests inject; production reads the next tick's stderr. Empty / clean
   * means the account window reset and the heal succeeded.
   */
  nextStderrFn?: () => string;
};

/**
 * Default pause floor — 5 minutes. If the reset clause can't be parsed
 * into a future epoch, the daemon still idles 5 min before re-probing
 * instead of busy-looping every tick. Matches the tick-interval clamp
 * ceiling in AGENTS.md § 14b (dynamic timeouts).
 */
export const DEFAULT_PAUSE_FLOOR_MS = 5 * 60_000;

/**
 * Regex that matches the Claude ACCOUNT-LEVEL exhaustion signal and
 * captures the free-form reset clause. The Claude CLI prints, on weekly
 * window exhaustion (exit 1):
 *
 *   "You've hit your limit · resets May 31 at 8pm (America/Toronto)"
 *
 * The middle dot is U+00B7 (`·`); we also accept a plain hyphen / colon /
 * "—" separator and a lowercase "you've" for robustness against minor
 * CLI wording drift. The capture group is the reset clause after "resets".
 *
 * Deliberately distinct from heal-agent-rate-limited's `RATE_LIMIT_RE`
 * (which keys on "rate limit" / "429" — the transient per-minute case).
 * "You've hit your limit" has no "rate" token, so the two regexes do not
 * collide; a stderr buffer is matched by exactly one helper.
 *
 * @type {RegExp}
 */
export const CLAUDE_ACCOUNT_LIMIT_RE =
  /you'?ve\s+hit\s+your\s+(?:usage\s+)?limit\b(?:[^\n]*?\bresets?\b\s*([^\n]+))?/i;

/**
 * Pivot fallback (per TASKS.md `daemon-silent-on-claude-account-rate-limit`
 * Pivot clause): if Anthropic changes the exact wording and the strict
 * regex above misses, this looser probe still catches the exhaustion class
 * via the "limit" + "resets" co-occurrence so the daemon pauses rather
 * than busy-looping. detect() falls back to this only when the strict
 * regex misses, and records `parsedFromFallback: true` in the evidence.
 *
 * @type {RegExp}
 */
export const CLAUDE_ACCOUNT_LIMIT_FALLBACK_RE = /\blimit\b[^\n]*?\bresets?\b\s*([^\n]+)/i;

/**
 * Parse the free-form reset clause from the Claude exhaustion message into
 * an epoch-ms timestamp, relative to `nowMs`. Handles the shapes the CLI
 * emits today:
 *
 *   - "May 31 at 8pm (America/Toronto)"  → next May 31 20:00 (parenthetical
 *                                          timezone label is stripped; the
 *                                          time is interpreted in the host's
 *                                          local zone — see note below)
 *   - "Jun 2 at 10am"                    → next Jun 2 10:00
 *   - "tomorrow at 9am"                  → now + 1 day at 09:00
 *   - "in 3 hours"                       → now + 3h
 *
 * Returns `null` when the clause is absent or unparseable — the caller
 * then falls back to {@link DEFAULT_PAUSE_FLOOR_MS}. Timezone fidelity is
 * intentionally best-effort: the parenthetical "(America/Toronto)" label
 * is dropped because Node has no built-in IANA-zone date constructor and
 * rule #1 forbids pulling in a date library for a single best-effort
 * pause-floor computation. A small skew (operator's machine zone vs the
 * label) only changes WHEN the daemon re-probes by at most a few hours —
 * the floor guarantees it never busy-loops regardless.
 *
 * Pure function — no I/O, `nowMs` injected.
 *
 * @otel-exempt pure-function — no span; the caller's heal span covers it.
 * @param {string} clause the text captured after "resets"
 * @param {number} nowMs current epoch ms
 * @returns {number | null} reset epoch ms, or null if unparseable
 */
export function parseResetClause(clause: string, nowMs: number): number | null {
  const trimmed = clause
    .trim()
    .replace(/\([^)]*\)/g, "")
    .trim();
  if (trimmed.length === 0) return null;

  // Try each shape in order; the first that matches wins. Each parser is a
  // small pure function so this dispatcher stays under the cognitive-
  // complexity budget (biome `noExcessiveCognitiveComplexity`).
  const clock = parseClockPart(trimmed);
  return (
    parseRelativeDuration(trimmed, nowMs) ??
    parseRelativeDay(trimmed, nowMs, clock) ??
    parseMonthDay(trimmed, nowMs, clock)
  );
}

/** The "at HH[:MM][am|pm]" clock part of a reset clause. */
type ClockPart = { hour24: number; minute: number };

/**
 * Extract the "at <time>" clock part (e.g. "8pm", "10am", "8:30pm").
 * Missing time defaults to 00:00. Pure helper.
 *
 * @otel-exempt pure-function — internal parse helper.
 * @param {string} trimmed normalised reset clause
 * @returns {ClockPart}
 */
function parseClockPart(trimmed: string): ClockPart {
  const m = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(trimmed);
  if (m === null) return { hour24: 0, minute: 0 };
  const hour24 = to24Hour(m[1], m[3]);
  const minute = m[2] !== undefined ? Number.parseInt(m[2], 10) : 0;
  return { hour24, minute };
}

/**
 * "in N hours|minutes|days" → `nowMs + N·unit`. Returns null on no match.
 *
 * @otel-exempt pure-function — internal parse helper.
 * @param {string} trimmed normalised reset clause
 * @param {number} nowMs current epoch ms
 * @returns {number | null}
 */
function parseRelativeDuration(trimmed: string, nowMs: number): number | null {
  const m = /^in\s+(\d+)\s+(hour|minute|day)s?\b/i.exec(trimmed);
  if (m?.[1] === undefined || m[2] === undefined) return null;
  const n = Number.parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const unitMs = unit === "minute" ? 60_000 : unit === "hour" ? 3_600_000 : 86_400_000;
  return nowMs + n * unitMs;
}

/**
 * "today|tomorrow at <time>" → that calendar day at the clock part.
 * Returns null on no match.
 *
 * @otel-exempt pure-function — internal parse helper.
 * @param {string} trimmed normalised reset clause
 * @param {number} nowMs current epoch ms
 * @param {ClockPart} clock parsed clock part
 * @returns {number | null}
 */
function parseRelativeDay(trimmed: string, nowMs: number, clock: ClockPart): number | null {
  const isTomorrow = /^tomorrow\b/i.test(trimmed);
  const isToday = /^today\b/i.test(trimmed);
  if (!isTomorrow && !isToday) return null;
  const d = new Date(nowMs);
  if (isTomorrow) d.setDate(d.getDate() + 1);
  d.setHours(clock.hour24, clock.minute, 0, 0);
  return d.getTime();
}

/**
 * "<Month> <day> at <time>" → the next occurrence of that month/day (rolls
 * to next year if it already passed). Returns null on no match.
 *
 * @otel-exempt pure-function — internal parse helper.
 * @param {string} trimmed normalised reset clause
 * @param {number} nowMs current epoch ms
 * @param {ClockPart} clock parsed clock part
 * @returns {number | null}
 */
function parseMonthDay(trimmed: string, nowMs: number, clock: ClockPart): number | null {
  const m = /\b([a-z]{3,9})\.?\s+(\d{1,2})\b/i.exec(trimmed);
  if (m?.[1] === undefined || m[2] === undefined) return null;
  const monthIdx = monthIndex(m[1]);
  if (monthIdx === null) return null;
  const day = Number.parseInt(m[2], 10);
  const year = new Date(nowMs).getFullYear();
  const candidate = new Date(year, monthIdx, day, clock.hour24, clock.minute, 0, 0);
  if (candidate.getTime() <= nowMs) {
    return new Date(year + 1, monthIdx, day, clock.hour24, clock.minute, 0, 0).getTime();
  }
  return candidate.getTime();
}

/**
 * Convert a 12-hour clock hour + am/pm marker to a 24-hour hour.
 * No marker → interpret the raw hour as-is (24h). Pure helper.
 *
 * @otel-exempt pure-function — internal arithmetic helper.
 * @param {string | undefined} rawHour
 * @param {string | undefined} ampm
 * @returns {number} hour in [0, 23]
 */
function to24Hour(rawHour: string | undefined, ampm: string | undefined): number {
  const h = rawHour !== undefined ? Number.parseInt(rawHour, 10) : 0;
  if (ampm === undefined) return Math.min(Math.max(h, 0), 23);
  const isPm = ampm.toLowerCase() === "pm";
  if (h === 12) return isPm ? 12 : 0;
  return isPm ? h + 12 : h;
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

/**
 * Map a month name (full or 3-letter, any case) to a 0-based month index.
 * Returns null for non-month tokens (e.g. "tomorrow", "at"). Pure helper.
 *
 * @otel-exempt pure-function — internal lookup helper.
 * @param {string} token
 * @returns {number | null}
 */
function monthIndex(token: string): number | null {
  const key = token.slice(0, 3).toLowerCase();
  const idx = MONTHS.indexOf(key as (typeof MONTHS)[number]);
  return idx === -1 ? null : idx;
}

/**
 * Detect the Claude account-level exhaustion signal in stderr. Tries the
 * strict regex first; on miss, falls back to the looser "limit … resets"
 * co-occurrence probe (pivot fallback) so wording drift doesn't silently
 * re-open the busy-loop. Records the parsed `resetAt` (or null) and which
 * regex matched in the evidence.
 *
 * @otel-exempt pure-with-I/O-at-edge — OTEL span owned by caller (the
 * observer.heal() cycle wraps detect→apply→verify in one span).
 */
export function detect(seams: ClaudeAccountRateLimitSeams): DetectResult {
  let clause: string | undefined;
  let parsedFromFallback = false;
  const strict = CLAUDE_ACCOUNT_LIMIT_RE.exec(seams.stderr);
  if (strict !== null) {
    clause = strict[1];
  } else {
    const fallback = CLAUDE_ACCOUNT_LIMIT_FALLBACK_RE.exec(seams.stderr);
    if (fallback === null) {
      return { present: false };
    }
    clause = fallback[1];
    parsedFromFallback = true;
  }
  const resetAt = clause !== undefined ? parseResetClause(clause, seams.nowMs) : null;
  return {
    present: true,
    signal: "claude-account-rate-limit",
    evidence: {
      resetAt,
      resetClause: clause?.trim() ?? null,
      parsedFromFallback,
      stderrPreview: seams.stderr.slice(0, 200),
    },
  };
}

/**
 * Apply the budget-paused-claude heal: notify the operator ONCE
 * (edge-triggered — skipped when `alreadyPaused`), then sleep until the
 * parsed reset wall (floored to `pauseFloorMs`). Returns `applied: true`
 * with a `budget-paused-claude` note carrying the resolved `resetAt` so the
 * caller can surface the supervisor state. Re-applying while paused is a
 * no-op-notify (idempotent debounce) but still sleeps — the daemon keeps
 * idling until the wall passes.
 *
 * @otel-exempt pure-with-I/O-at-edge — sleep + notify injected at the seam;
 * caller wraps the cycle in one heal span.
 */
export async function apply(seams: ClaudeAccountRateLimitSeams): Promise<ApplyResult> {
  const detection = detect(seams);
  if (!detection.present) {
    return {
      applied: false,
      changedFiles: [],
      notes: "no-op: stderr has no claude-account-rate-limit signal",
    };
  }
  const floor = seams.pauseFloorMs ?? DEFAULT_PAUSE_FLOOR_MS;
  const resetAt =
    typeof detection.evidence["resetAt"] === "number" ? detection.evidence["resetAt"] : null;
  const untilReset = resetAt !== null ? resetAt - seams.nowMs : 0;
  const pauseMs = Math.max(untilReset, floor);
  const resetLabel =
    resetAt !== null ? new Date(resetAt).toISOString() : "unknown (using pause floor)";

  // Edge-triggered notify: exactly one push per exhaustion transition.
  if (!seams.alreadyPaused) {
    seams.notifyFn(
      `Claude account exhausted until ${resetLabel}; minsky paused (budget-paused-claude). Switch to local-only mode or wait for the reset.`,
    );
  }

  await seams.sleepMsFn(pauseMs);
  return {
    applied: true,
    changedFiles: [],
    notes: `budget-paused-claude: slept ${pauseMs}ms until ${resetLabel}${
      seams.alreadyPaused ? " (already paused — no re-notify)" : " (notified operator once)"
    }`,
  };
}

/**
 * Verify: re-detect on the next spawn's stderr (after the reset wall).
 * When the reset has passed, `claude --print` succeeds and the next stderr
 * carries no exhaustion signal → healed. When the wall hasn't passed yet,
 * the signal recurs → not-healed (the caller keeps the supervisor in
 * budget-paused-claude and re-enters the heal next tick).
 *
 * @otel-exempt pure-with-I/O-at-edge — verify re-runs detect on injected stderr.
 */
export function verify(seams: ClaudeAccountRateLimitSeams): VerifyResult {
  if (seams.nextStderrFn === undefined) {
    // No re-detection seam (chaos test / single-pass): the sleep happened;
    // the caller discovers the truth on the next real spawn. Assume healed —
    // the right default for the hermetic chaos run.
    return { healed: true };
  }
  const nextStderr = seams.nextStderrFn();
  if (
    CLAUDE_ACCOUNT_LIMIT_RE.test(nextStderr) ||
    CLAUDE_ACCOUNT_LIMIT_FALLBACK_RE.test(nextStderr)
  ) {
    return { healed: false, residualSignal: "claude-account-rate-limit" };
  }
  return { healed: true };
}
