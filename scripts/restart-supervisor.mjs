#!/usr/bin/env node
// @ts-check
// `scripts/restart-supervisor.mjs` — pure restart-supervisor decision
// core for `runany-self-restart-bounded-timelimit` (TASKS.md P0).
//
// The supervising layer (launchd KeepAlive + the conductor's in-process
// deadline guard in scripts/orchestrate.mjs) restarts the conductor on
// crash/non-zero exit with an *escalating, capped* backoff that RESETS
// after a sustained-healthy interval, and stops cleanly once a hard
// wall-clock ceiling (`MINSKY_RUN_TIME_LIMIT`) is reached.
//
// Everything here is pure (rule #10 — no I/O in the decision): given the
// elapsed wall-clock, how long the conductor has been continuously
// healthy since its last (re)start, and how many consecutive restarts
// have happened, decide restart-with-backoff vs clean-stop. The I/O
// wiring (launchd, the orchestrate setTimeout chain, the chaos sim) lives
// at the edges and composes these functions.
//
// Pattern conformance (vision.md § "Pattern conformance index"):
//   - Supervisor restart — Armstrong 2007 (let-it-crash + supervised
//     restart). Conformance: full (decision only; respawn is launchd).
//   - Retry budget / backoff — Beyer, Jones, Petoff et al., *Site
//     Reliability Engineering*, O'Reilly 2016 (capped escalating backoff
//     to avoid hammering on systematic failure; reset on sustained
//     health so a recovered run isn't penalised forever).
//   - Bounded stay-alive — rule #6 (stay alive, but bounded): the run
//     never restarts past the configured wall-clock deadline.
//
// The default backoff ladder COMPOSES the existing tick-loop
// restart-backoff anchor (ARCHITECTURE.md L215: "backoff (5s → 30s →
// 5min)", also pinned by scripts/check-tick-loop-backoff-schedule.mjs)
// rather than introducing a second, drifting schedule (rule #1 — compose,
// don't duplicate).

/**
 * Base (first-rung) restart-backoff delay, in seconds. Also the typed
 * fallback when an index lands outside a pathological empty schedule
 * (rule #7 graceful degrade — never a 0ms busy-loop).
 * @type {number}
 */
export const BASE_BACKOFF_SEC = 5;

/**
 * Default escalating restart-backoff ladder, in seconds. Frozen so a
 * silent edit trips the paired test. The last entry is the cap — any
 * further consecutive restart waits that long. Matches the
 * tick-loop-backoff-schedule anchor `[5, 30, 300]`.
 * @type {readonly number[]}
 */
export const DEFAULT_BACKOFF_SCHEDULE_SEC = Object.freeze([BASE_BACKOFF_SEC, 30, 300]);

/** Default hard wall-clock ceiling: 10h (rule #6 keystone "run 10h"). */
export const DEFAULT_RUN_TIME_LIMIT_SEC = 10 * 60 * 60;

/**
 * Default sustained-healthy window that resets the backoff ladder to
 * base. If the conductor stays up this long after a restart, the next
 * crash is treated as fresh (base backoff) rather than continuing the
 * escalation from a long-past crash-loop.
 */
export const DEFAULT_HEALTHY_RESET_SEC = 20 * 60;

/**
 * Parse an operator-supplied duration into whole seconds. Accepts
 * `<n>s` / `<n>m` / `<n>h` (and a bare number = seconds). Anything
 * unparseable (incl. `undefined`/empty) falls back to `fallbackSec`
 * (rule #7 graceful degrade — a typo'd env var must not disable the
 * deadline). Pure.
 *
 * @param {string | undefined | null} raw
 * @param {number} fallbackSec
 * @returns {number}
 */
export function parseDurationSec(raw, fallbackSec) {
  if (raw === undefined || raw === null) return fallbackSec;
  const s = String(raw).trim().toLowerCase();
  if (s.length === 0) return fallbackSec;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(s|m|h)?$/);
  if (!m) return fallbackSec;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return fallbackSec;
  const unit = m[2] ?? "s";
  const mult = unit === "h" ? 3600 : unit === "m" ? 60 : 1;
  return Math.round(n * mult);
}

/**
 * Backoff delay (ms) for the Nth consecutive restart, capped at the
 * last schedule entry. `restartIndex` is 0-based (0 = the wait before
 * the first restart). Pure.
 *
 * @param {number} restartIndex
 * @param {readonly number[]} [scheduleSec]
 * @returns {number}
 */
export function backoffMsFor(restartIndex, scheduleSec = DEFAULT_BACKOFF_SCHEDULE_SEC) {
  const last = scheduleSec.length - 1;
  const i = Math.min(Math.max(Math.trunc(restartIndex) || 0, 0), last);
  // `?? BASE_BACKOFF_SEC` is the typed fallback for a pathological empty
  // `scheduleSec` (rule #7 — degrade to base, never 0ms). On the frozen
  // default ladder the clamped index is always in-bounds.
  return (scheduleSec[i] ?? BASE_BACKOFF_SEC) * 1000;
}

/**
 * The supervisor's per-crash decision. Pure (rule #10).
 *
 * Precedence (rule #6 — bounded stay-alive): the hard wall-clock limit
 * always wins. Past `timeLimitMs` the run stops cleanly (exit 0); it is
 * never restarted again, regardless of health or backoff state. Below
 * the limit, a conductor that stayed continuously healthy for
 * `healthyResetMs` since its last start has its ladder reset to base —
 * a recovered run is not penalised for a long-past crash-loop.
 *
 * @param {{
 *   elapsedMs: number,         // wall-clock since the run started
 *   timeLimitMs: number,       // MINSKY_RUN_TIME_LIMIT, in ms
 *   restartIndex: number,      // consecutive restarts so far (0-based)
 *   healthyMs: number,         // continuous healthy time since last start
 *   healthyResetMs: number,    // sustained-health window that resets backoff
 *   scheduleSec?: readonly number[],
 * }} s
 * @returns {{
 *   action: "restart" | "stop",
 *   backoffMs: number,
 *   nextRestartIndex: number,
 *   reason: "time-limit" | "restart-after-health-reset" | "restart-backoff",
 * }}
 */
export function decideRestart(s) {
  if (s.elapsedMs >= s.timeLimitMs) {
    return {
      action: "stop",
      backoffMs: 0,
      nextRestartIndex: s.restartIndex,
      reason: "time-limit",
    };
  }
  const healthy = s.healthyMs >= s.healthyResetMs;
  const idx = healthy ? 0 : s.restartIndex;
  return {
    action: "restart",
    backoffMs: backoffMsFor(idx, s.scheduleSec),
    // After a health-reset the ladder restarts: the *next* consecutive
    // crash (without an intervening healthy window) escalates from
    // index 1, not 0 — so a fresh crash-loop still ramps.
    nextRestartIndex: healthy ? 1 : s.restartIndex + 1,
    reason: healthy ? "restart-after-health-reset" : "restart-backoff",
  };
}
