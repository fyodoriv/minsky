// Tests for heal-agent-rate-limited
//
// Scenarios map to user-stories/007-agent-self-heals-catalogued-failures.md.

import { describe, expect, test } from "vitest";
import type { AgentRateLimitedSeams } from "./heal-agent-rate-limited.js";
import * as heal from "./heal-agent-rate-limited.js";

function makeSeams(overrides: Partial<AgentRateLimitedSeams> = {}): AgentRateLimitedSeams {
  return {
    stderr: "",
    sleepMsFn: async () => {
      await Promise.resolve();
    },
    attemptIndex: 0,
    ...overrides,
  };
}

describe("heal-agent-rate-limited", () => {
  test.each([
    "Error: rate limit exceeded",
    "anthropic.RateLimitError: 429 Too Many Requests",
    "rate_limit_error: limit reached",
    '{"type":"error","error":{"type":"rate_limit_error","message":"Rate limit reached"}}',
    "openai: 429 too many requests",
    "Rate Limit hit",
    "RATE-LIMIT exceeded",
  ])("detects rate-limit signal in stderr: %s", (stderr) => {
    const seams = makeSeams({ stderr });
    const result = heal.detect(seams);
    expect(result.present).toBe(true);
    if (result.present) {
      expect(result.signal).toBe("agent-rate-limited");
    }
  });

  test.each([
    "",
    "Error: unrelated stderr message",
    "ERR_NETWORK_TIMEOUT",
    "MODULE_NOT_FOUND: vitest",
    "Permission denied",
  ])("does NOT detect on non-rate-limit stderr: %s", (stderr) => {
    const seams = makeSeams({ stderr });
    expect(heal.detect(seams).present).toBe(false);
  });

  test("apply sleeps the backoff duration for the first attempt", async () => {
    let sleptMs = -1;
    const seams = makeSeams({
      stderr: "rate limit exceeded",
      sleepMsFn: async (ms) => {
        sleptMs = ms;
        await Promise.resolve();
      },
      attemptIndex: 0,
    });
    const result = await heal.apply(seams);
    expect(result.applied).toBe(true);
    expect(sleptMs).toBe(30_000);
    expect(result.notes).toContain("attempt 1 of 3");
  });

  test("apply uses the second slot for attemptIndex=1", async () => {
    let sleptMs = -1;
    const seams = makeSeams({
      stderr: "rate limit",
      sleepMsFn: async (ms) => {
        sleptMs = ms;
        await Promise.resolve();
      },
      attemptIndex: 1,
    });
    await heal.apply(seams);
    expect(sleptMs).toBe(60_000);
  });

  test("apply uses the third slot for attemptIndex=2", async () => {
    let sleptMs = -1;
    const seams = makeSeams({
      stderr: "rate limit",
      sleepMsFn: async (ms) => {
        sleptMs = ms;
        await Promise.resolve();
      },
      attemptIndex: 2,
    });
    await heal.apply(seams);
    expect(sleptMs).toBe(120_000);
  });

  test("apply returns exhausted after attemptIndex >= schedule.length", async () => {
    let slept = false;
    const seams = makeSeams({
      stderr: "rate limit",
      sleepMsFn: async () => {
        slept = true;
        await Promise.resolve();
      },
      attemptIndex: 3,
    });
    const result = await heal.apply(seams);
    expect(result.applied).toBe(false);
    expect(slept).toBe(false);
    expect(result.notes).toContain("exhausted");
    expect(result.notes).toContain("fleet-provider-mode-flip-to-local");
  });

  test("apply is a no-op when stderr has no rate-limit signal", async () => {
    let slept = false;
    const seams = makeSeams({
      stderr: "ERR_NETWORK_TIMEOUT",
      sleepMsFn: async () => {
        slept = true;
        await Promise.resolve();
      },
      attemptIndex: 0,
    });
    const result = await heal.apply(seams);
    expect(result.applied).toBe(false);
    expect(slept).toBe(false);
    expect(result.notes).toContain("no-op");
  });

  test("apply honors injected custom backoff schedule", async () => {
    let sleptMs = -1;
    const seams = makeSeams({
      stderr: "rate limit",
      sleepMsFn: async (ms) => {
        sleptMs = ms;
        await Promise.resolve();
      },
      attemptIndex: 0,
      backoffScheduleMs: [5_000, 10_000],
    });
    await heal.apply(seams);
    expect(sleptMs).toBe(5_000);
  });

  test("verify returns healed when no re-detection seam is provided", () => {
    const seams = makeSeams({ stderr: "rate limit" });
    expect(heal.verify(seams).healed).toBe(true);
  });

  test("verify returns healed when re-detection returns clean stderr", () => {
    const seams = makeSeams({
      stderr: "rate limit",
      nextStderrFn: () => "next attempt succeeded",
    });
    expect(heal.verify(seams).healed).toBe(true);
  });

  test("verify returns not-healed when next stderr still has the signal", () => {
    const seams = makeSeams({
      stderr: "rate limit",
      nextStderrFn: () => "rate limit STILL exceeded",
    });
    const result = heal.verify(seams);
    expect(result.healed).toBe(false);
    if (!result.healed) {
      expect(result.residualSignal).toBe("agent-rate-limited");
    }
  });
});
