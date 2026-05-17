#!/usr/bin/env node
// @ts-check
// `scripts/chaos-restart-schedule.mjs` — operator-facing chaos test for
// `runany-self-restart-bounded-timelimit` (TASKS.md P0). It is the
// task's `**Measurement**`:
//
//   node scripts/chaos-restart-schedule.mjs --json
//     → {schedule_followed:true, reset_on_health:true,
//        stopped_at_limit:true, restarts_after_limit:0}
//
// Pattern conformance (vision.md § "Pattern conformance index"):
//   - Chaos engineering — Basiri et al., "Principles of Chaos
//     Engineering", *IEEE Software* 2016: steady-state hypothesis +
//     fault injection + assertion against the steady state. Here the
//     fault is a synthetic crash schedule injected over a deterministic
//     *virtual* clock (no real process spawn/kill — that would be flaky,
//     slow, and machine-dependent; the decision under test is the pure
//     `decideRestart`, so a discrete-event sim is the faithful and
//     deterministic harness — same discipline as the pure-core +
//     virtual-clock pattern used elsewhere in scripts/).
//
// Steady-state hypothesis (restated from the task):
//   1. Crash the conductor every 30s for 10 min → the restart intervals
//      follow the escalating, capped backoff ladder (5s → 30s → 300s …).
//   2. Then a 20-min sustained-healthy window → the next crash's backoff
//      resets to base.
//   3. With MINSKY_RUN_TIME_LIMIT=600s the supervisor stops cleanly
//      (exit 0) within 600±30s, and fires zero restarts after the limit.
//
// Exit 0 iff all four observables hold; 1 otherwise (Basiri assertion
// against steady state). The sim is pure and exported so the paired
// .test.mjs drives it deterministically.

import {
  DEFAULT_BACKOFF_SCHEDULE_SEC,
  backoffMsFor,
  decideRestart,
} from "./restart-supervisor.mjs";

const CRASH_PERIOD_MS = 30_000; // "kill the conductor every 30s"
const CRASH_PHASE_MS = 10 * 60_000; // "for 10 min"
const HEALTHY_WINDOW_MS = 20 * 60_000; // "then a 20-min healthy window"
const HEALTHY_RESET_MS = 20 * 60_000; // sustained-health resets backoff
const TIME_LIMIT_MS = 600_000; // MINSKY_RUN_TIME_LIMIT=600s

/**
 * Scenario A — crash every 30s for 10 min (each life < healthy-reset, so
 * backoff escalates), then a 20-min sustained-healthy window, then one
 * more crash (must reset to base).
 *
 * @returns {{ schedule_followed: boolean, reset_on_health: boolean }}
 */
function scenarioReset() {
  const bigLimit = Number.MAX_SAFE_INTEGER; // deadline not under test here
  let restartIndex = 0;
  let t = 0;
  /** @type {number[]} */
  const observed = [];
  for (; t < CRASH_PHASE_MS; t += CRASH_PERIOD_MS) {
    const d = decideRestart({
      elapsedMs: t,
      timeLimitMs: bigLimit,
      restartIndex,
      healthyMs: CRASH_PERIOD_MS, // lived only ~30s ⇒ not recovered
      healthyResetMs: HEALTHY_RESET_MS,
    });
    if (d.action !== "restart") break;
    observed.push(d.backoffMs);
    restartIndex = d.nextRestartIndex;
  }
  // Expected ladder for the same number of consecutive restarts.
  const expected = observed.map((_, i) => backoffMsFor(i));
  const escalated = Math.max(...observed) > backoffMsFor(0);
  // `escalated` proves the ladder actually climbed (not a flat line).
  const schedule_followed =
    observed.length === expected.length && observed.every((v, i) => v === expected[i]) && escalated;

  // Sustained-healthy window, then the next crash → base backoff.
  const afterHealth = decideRestart({
    elapsedMs: t + HEALTHY_WINDOW_MS,
    timeLimitMs: bigLimit,
    restartIndex,
    healthyMs: HEALTHY_WINDOW_MS, // recovered ≥ healthy-reset window
    healthyResetMs: HEALTHY_RESET_MS,
  });
  const reset_on_health =
    afterHealth.action === "restart" &&
    afterHealth.backoffMs === backoffMsFor(0) &&
    afterHealth.reason === "restart-after-health-reset";

  return { schedule_followed, reset_on_health };
}

/**
 * Scenario B — MINSKY_RUN_TIME_LIMIT=600s, crash every 30s past the
 * limit. The supervisor must stop cleanly within 600±30s and fire zero
 * restarts at or after the limit.
 *
 * @returns {{ stopped_at_limit: boolean, restarts_after_limit: number }}
 */
function scenarioLimit() {
  let restartIndex = 0;
  /** @type {number | null} */
  let stoppedAt = null;
  let restartsAfterLimit = 0;
  // Crash past the limit; the first decision at/after the deadline must
  // be a clean stop. `decideRestart` is monotonic past the ceiling, so
  // breaking on the first stop is faithful — any restart at t ≥ limit
  // would have to precede that stop, and is counted before the break.
  for (let t = CRASH_PERIOD_MS; t <= TIME_LIMIT_MS + 4 * CRASH_PERIOD_MS; t += CRASH_PERIOD_MS) {
    const d = decideRestart({
      elapsedMs: t,
      timeLimitMs: TIME_LIMIT_MS,
      restartIndex,
      healthyMs: CRASH_PERIOD_MS,
      healthyResetMs: HEALTHY_RESET_MS,
    });
    if (d.action === "stop") {
      stoppedAt = t;
      break;
    }
    restartIndex = d.nextRestartIndex;
    if (t >= TIME_LIMIT_MS) restartsAfterLimit += 1;
  }
  const stopped_at_limit =
    stoppedAt !== null && Math.abs(stoppedAt - TIME_LIMIT_MS) <= CRASH_PERIOD_MS;
  return { stopped_at_limit, restarts_after_limit: restartsAfterLimit };
}

/**
 * The full chaos measurement. Pure (deterministic virtual clock) and
 * exported so the paired test drives it without spawning processes.
 *
 * @returns {{
 *   schedule_followed: boolean,
 *   reset_on_health: boolean,
 *   stopped_at_limit: boolean,
 *   restarts_after_limit: number,
 * }}
 */
export function simulateChaos() {
  const a = scenarioReset();
  const b = scenarioLimit();
  return { ...a, ...b };
}

/**
 * @param {{ schedule_followed: boolean, reset_on_health: boolean,
 *   stopped_at_limit: boolean, restarts_after_limit: number }} r
 * @returns {boolean}
 */
export function allHold(r) {
  return (
    r.schedule_followed === true &&
    r.reset_on_health === true &&
    r.stopped_at_limit === true &&
    r.restarts_after_limit === 0
  );
}

// ---- CLI -----------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const jsonOnly = process.argv.slice(2).includes("--json");
  const result = simulateChaos();
  const ok = allHold(result);
  if (!jsonOnly) {
    process.stdout.write(
      `chaos-restart-schedule: backoff ladder ${JSON.stringify(
        Array.from(DEFAULT_BACKOFF_SCHEDULE_SEC),
      )}s, time-limit ${TIME_LIMIT_MS / 1000}s\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!jsonOnly) {
    process.stdout.write(
      ok
        ? "chaos-restart-schedule: STEADY STATE HELD — all observables true\n"
        : "chaos-restart-schedule: STEADY STATE VIOLATED\n",
    );
  }
  process.exit(ok ? 0 : 1);
}
