/**
 * Paired tests for `local-llm-server-launcher.ts`. Slice 10 of P0 task
 * `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Covers all 5 chaos-table rows from `pollUntilReachable`'s JSDoc:
 *   1. Probe ready on first call → 1 attempt, ready
 *   2. Probe ready on Nth call → N attempts, ready
 *   3. Probe never ready → times out
 *   4. Probe rejects → captured, retried, eventually times out
 *   5. Zero timeout → exactly one probe attempt
 */

import { describe, expect, it } from "vitest";
import type { ServerState } from "./local-llm-bootstrap.js";
import {
  type PollUntilReachableOpts,
  type ServerProbeFn,
  type SleepFn,
  pollUntilReachable,
} from "./local-llm-server-launcher.js";

// ---- helpers --------------------------------------------------------------

/** Synthetic clock that advances by `intervalMs` on each call. */
function makeAdvancingNow(intervalMs: number): () => number {
  let n = 0;
  return () => {
    const t = n;
    n += intervalMs;
    return t;
  };
}

/** No-op sleep — tests run in zero wall-clock. */
const noSleep: SleepFn = async () => {
  /* swallow */
};

const reachable: ServerState = { reachable: true, url: "http://127.0.0.1:8080/v1/models" };
const unreachableEconn: ServerState = {
  reachable: false,
  url: "http://127.0.0.1:8080/v1/models",
  reason: "ECONNREFUSED",
};

const baseOpts = (probe: ServerProbeFn): PollUntilReachableOpts => ({
  probe,
  intervalMs: 100,
  timeoutMs: 500,
  sleepFn: noSleep,
  nowFn: makeAdvancingNow(100),
});

// ---- chaos-table row 1: ready immediately --------------------------------

describe("pollUntilReachable — chaos-table row 1: ready immediately", () => {
  it("returns ready after one probe when probe reports reachable", async () => {
    const probe: ServerProbeFn = async () => reachable;
    const outcome = await pollUntilReachable(baseOpts(probe));
    expect(outcome.ready).toBe(true);
    expect(outcome.attempts).toBe(1);
  });
});

// ---- chaos-table row 2: ready after N retries ----------------------------

describe("pollUntilReachable — chaos-table row 2: ready after N retries", () => {
  it("returns ready after the Nth probe call", async () => {
    let calls = 0;
    const probe: ServerProbeFn = async () => {
      calls += 1;
      return calls < 3 ? unreachableEconn : reachable;
    };
    const outcome = await pollUntilReachable(baseOpts(probe));
    expect(outcome.ready).toBe(true);
    expect(outcome.attempts).toBe(3);
  });
});

// ---- chaos-table row 3: never ready --------------------------------------

describe("pollUntilReachable — chaos-table row 3: never ready", () => {
  it("times out with the last reason carried in lastReason", async () => {
    const probe: ServerProbeFn = async () => unreachableEconn;
    const outcome = await pollUntilReachable(baseOpts(probe));
    expect(outcome.ready).toBe(false);
    expect(outcome.lastReason).toBe("ECONNREFUSED");
    // 5 attempts when intervalMs=100, timeoutMs=500 (loop breaks
    // once elapsed + interval > timeout).
    expect(outcome.attempts).toBeGreaterThanOrEqual(4);
    expect(outcome.attempts).toBeLessThanOrEqual(6);
  });
});

// ---- chaos-table row 4: probe rejects ------------------------------------

describe("pollUntilReachable — chaos-table row 4: probe rejects", () => {
  it("captures rejection as a non-ready attempt and continues", async () => {
    const probe: ServerProbeFn = async () => {
      throw new Error("ECONNRESET during warmup");
    };
    const outcome = await pollUntilReachable(baseOpts(probe));
    expect(outcome.ready).toBe(false);
    expect(outcome.lastReason).toMatch(/rejected: ECONNRESET/);
    expect(outcome.attempts).toBeGreaterThan(1);
  });

  it("recovers when probe rejects then resolves reachable", async () => {
    let calls = 0;
    const probe: ServerProbeFn = async () => {
      calls += 1;
      if (calls === 1) throw new Error("ECONNRESET");
      return reachable;
    };
    const outcome = await pollUntilReachable(baseOpts(probe));
    expect(outcome.ready).toBe(true);
    expect(outcome.attempts).toBe(2);
  });
});

// ---- chaos-table row 5: zero timeout -------------------------------------

describe("pollUntilReachable — chaos-table row 5: zero timeout", () => {
  it("runs exactly one probe attempt", async () => {
    let calls = 0;
    const probe: ServerProbeFn = async () => {
      calls += 1;
      return unreachableEconn;
    };
    const outcome = await pollUntilReachable({
      probe,
      intervalMs: 100,
      timeoutMs: 0,
      sleepFn: noSleep,
      nowFn: makeAdvancingNow(100),
    });
    expect(outcome.ready).toBe(false);
    expect(outcome.attempts).toBe(1);
    expect(calls).toBe(1);
  });

  it("returns ready when zero-timeout probe is reachable on first call", async () => {
    const probe: ServerProbeFn = async () => reachable;
    const outcome = await pollUntilReachable({
      probe,
      intervalMs: 100,
      timeoutMs: 0,
      sleepFn: noSleep,
      nowFn: makeAdvancingNow(100),
    });
    expect(outcome.ready).toBe(true);
    expect(outcome.attempts).toBe(1);
  });
});

// ---- defaults sanity ------------------------------------------------------

describe("pollUntilReachable — defaults", () => {
  it("uses sane intervalMs/timeoutMs defaults when none are provided", async () => {
    // Probe returns reachable on the first call so the test runs fast
    // even if defaults wire `setTimeout` (we never sleep).
    const probe: ServerProbeFn = async () => reachable;
    const outcome = await pollUntilReachable({ probe });
    expect(outcome.ready).toBe(true);
    expect(outcome.attempts).toBe(1);
  });
});
