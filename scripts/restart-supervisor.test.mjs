// Tests for restart-supervisor.mjs. Pure decision core (rule #10 — no
// I/O in the decision); these pin the escalating-capped backoff ladder,
// the reset-on-sustained-health behaviour, and the hard-deadline clean
// stop for `runany-self-restart-bounded-timelimit`.
// No @ts-check (matches sibling scripts/*.test.mjs convention).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BACKOFF_SCHEDULE_SEC,
  DEFAULT_HEALTHY_RESET_SEC,
  DEFAULT_RUN_TIME_LIMIT_SEC,
  backoffMsFor,
  decideRestart,
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
