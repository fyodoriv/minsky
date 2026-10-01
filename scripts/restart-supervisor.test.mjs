// Tests for restart-supervisor.mjs. Pure decision core (rule #10 — no
// I/O in the decision); these pin the escalating-capped backoff ladder,
// the reset-on-sustained-health behaviour, and the hard-deadline clean
// stop for `runany-self-restart-bounded-timelimit`.
// No @ts-check (matches sibling scripts/*.test.mjs convention).
import { describe, expect, it } from "vitest";
import {
  backoffMsFor,
  DEFAULT_BACKOFF_SCHEDULE_SEC,
  DEFAULT_HEALTHY_RESET_SEC,
  DEFAULT_RUN_TIME_LIMIT_SEC,
  decideRestart,
  decideStartupThrottle,
  parseDurationSec,
} from "./restart-supervisor.mjs";

describe("defaults", () => {
  it("backoff ladder composes the tick-loop anchor [5, 30, 300]", () => {
    expect(Array.from(DEFAULT_BACKOFF_SCHEDULE_SEC)).toEqual([5, 30, 300]);
  });
  it("default time limit is 10h, healthy-reset is 20min", () => {
    expect(DEFAULT_RUN_TIME_LIMIT_SEC).toBe(36000);
    expect(DEFAULT_HEALTHY_RESET_SEC).toBe(1200);
  });
});

describe("parseDurationSec", () => {
  it("parses s/m/h units", () => {
    expect(parseDurationSec("600s", 1)).toBe(600);
    expect(parseDurationSec("30m", 1)).toBe(1800);
    expect(parseDurationSec("10h", 1)).toBe(36000);
  });
  it("bare number is seconds", () => {
    expect(parseDurationSec("600", 1)).toBe(600);
  });
  it("falls back on undefined/empty/garbage (rule #7 graceful degrade)", () => {
    expect(parseDurationSec(undefined, 42)).toBe(42);
    expect(parseDurationSec("", 42)).toBe(42);
    expect(parseDurationSec("nope", 42)).toBe(42);
    expect(parseDurationSec("-5s", 42)).toBe(42);
    expect(parseDurationSec("0", 42)).toBe(42);
  });
});

describe("backoffMsFor (escalating, capped)", () => {
  it("escalates along the ladder then caps at the last entry", () => {
    expect(backoffMsFor(0)).toBe(5000);
    expect(backoffMsFor(1)).toBe(30000);
    expect(backoffMsFor(2)).toBe(300000);
    expect(backoffMsFor(3)).toBe(300000); // capped
    expect(backoffMsFor(99)).toBe(300000); // still capped
  });
  it("clamps negatives to base", () => {
    expect(backoffMsFor(-1)).toBe(5000);
  });
});

describe("decideRestart", () => {
  const limit = 600_000;

  it("restarts with escalating backoff while unhealthy (short-lived)", () => {
    const d0 = decideRestart({
      elapsedMs: 30_000,
      timeLimitMs: limit,
      restartIndex: 0,
      healthyMs: 30_000,
      healthyResetMs: 1_200_000,
    });
    expect(d0).toMatchObject({ action: "restart", backoffMs: 5000, nextRestartIndex: 1 });

    const d2 = decideRestart({
      elapsedMs: 90_000,
      timeLimitMs: limit,
      restartIndex: 2,
      healthyMs: 30_000,
      healthyResetMs: 1_200_000,
    });
    expect(d2).toMatchObject({ action: "restart", backoffMs: 300000, nextRestartIndex: 3 });
  });

  it("resets the ladder to base after a sustained-healthy window", () => {
    const d = decideRestart({
      elapsedMs: 200_000,
      timeLimitMs: limit,
      restartIndex: 5, // had been escalating
      healthyMs: 1_300_000, // > healthyResetMs ⇒ recovered
      healthyResetMs: 1_200_000,
    });
    expect(d.action).toBe("restart");
    expect(d.backoffMs).toBe(5000); // back to base
    expect(d.reason).toBe("restart-after-health-reset");
    expect(d.nextRestartIndex).toBe(1); // a fresh crash-loop still ramps
  });

  it("stops cleanly at the hard wall-clock limit (limit wins over health)", () => {
    const d = decideRestart({
      elapsedMs: 600_000,
      timeLimitMs: limit,
      restartIndex: 0,
      healthyMs: 9_999_999, // healthy, but past the deadline
      healthyResetMs: 1_200_000,
    });
    expect(d).toMatchObject({ action: "stop", backoffMs: 0, reason: "time-limit" });
  });

  it("never restarts once past the limit", () => {
    const d = decideRestart({
      elapsedMs: 999_999,
      timeLimitMs: limit,
      restartIndex: 1,
      healthyMs: 0,
      healthyResetMs: 1_200_000,
    });
    expect(d.action).toBe("stop");
  });

  it("is pure — same input, same output", () => {
    const args = {
      elapsedMs: 100,
      timeLimitMs: limit,
      restartIndex: 1,
      healthyMs: 0,
      healthyResetMs: 1_200_000,
    };
    expect(decideRestart(args)).toEqual(decideRestart(args));
  });
});

describe("decideStartupThrottle (production boot wire-in)", () => {
  const resetMs = 1_200_000; // 20 min

  it("first-ever launch: no sleep, fresh origin, index → 1", () => {
    const t = decideStartupThrottle({
      prevStartMs: null,
      prevOriginMs: null,
      prevRestartIndex: 0,
      nowMs: 5_000,
      healthyResetMs: resetMs,
    });
    expect(t).toEqual({
      sleepMs: 0,
      nextRestartIndex: 1,
      startMs: 5_000,
      originMs: 5_000,
      reason: "first-run",
    });
  });

  it("short-lived crash-loop escalates and carries the supervised-run origin", () => {
    // Previous life started at 1_000_000, origin at 800_000, crashed
    // ~20s later (well under the 20-min health window) → escalate.
    const t = decideStartupThrottle({
      prevStartMs: 1_000_000,
      prevOriginMs: 800_000,
      prevRestartIndex: 1,
      nowMs: 1_020_000,
      healthyResetMs: resetMs,
    });
    expect(t.sleepMs).toBe(backoffMsFor(1)); // 30s — escalated
    expect(t.nextRestartIndex).toBe(2);
    expect(t.reason).toBe("restart-backoff");
    // Crucial for Acceptance #3: the deadline origin is NOT reset by a
    // crash — the 10h ceiling is bounded across launchd respawns.
    expect(t.originMs).toBe(800_000);
    expect(t.startMs).toBe(1_020_000);
  });

  it("caps the escalation at the ladder ceiling", () => {
    const t = decideStartupThrottle({
      prevStartMs: 1_000_000,
      prevOriginMs: 1_000_000,
      prevRestartIndex: 9,
      nowMs: 1_010_000,
      healthyResetMs: resetMs,
    });
    expect(t.sleepMs).toBe(backoffMsFor(99)); // capped at 300s
  });

  it("recovered run (lived ≥ health window) resets backoff AND deadline origin", () => {
    // Previous life ran 25 min before crashing — past the 20-min
    // health window: fresh ladder AND a fresh wall-clock budget.
    const t = decideStartupThrottle({
      prevStartMs: 1_000_000,
      prevOriginMs: 100_000, // a long-past origin
      prevRestartIndex: 7,
      nowMs: 1_000_000 + 25 * 60_000,
      healthyResetMs: resetMs,
    });
    expect(t.sleepMs).toBe(backoffMsFor(0)); // base
    expect(t.nextRestartIndex).toBe(1);
    expect(t.reason).toBe("restart-after-health-reset");
    expect(t.originMs).toBe(t.startMs); // fresh budget for the recovered run
  });

  it("missing persisted origin (legacy state) starts a fresh origin", () => {
    const t = decideStartupThrottle({
      prevStartMs: 1_000_000,
      prevOriginMs: null, // old state file without originMs
      prevRestartIndex: 2,
      nowMs: 1_005_000,
      healthyResetMs: resetMs,
    });
    expect(t.originMs).toBe(1_005_000);
    expect(t.reason).toBe("restart-backoff");
  });

  it("defaults healthyResetMs to DEFAULT_HEALTHY_RESET_SEC when omitted", () => {
    const justUnder = decideStartupThrottle({
      prevStartMs: 0,
      prevOriginMs: 0,
      prevRestartIndex: 0,
      nowMs: DEFAULT_HEALTHY_RESET_SEC * 1000 - 1,
    });
    expect(justUnder.reason).toBe("restart-backoff");
    const atWindow = decideStartupThrottle({
      prevStartMs: 0,
      prevOriginMs: 0,
      prevRestartIndex: 0,
      nowMs: DEFAULT_HEALTHY_RESET_SEC * 1000,
    });
    expect(atWindow.reason).toBe("restart-after-health-reset");
  });

  it("is pure — same input, same output", () => {
    const args = {
      prevStartMs: 1_000,
      prevOriginMs: 500,
      prevRestartIndex: 3,
      nowMs: 2_000,
      healthyResetMs: resetMs,
    };
    expect(decideStartupThrottle(args)).toEqual(decideStartupThrottle(args));
  });
});
