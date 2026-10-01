// Tests for heal-claude-account-rate-limit
//
// Scenarios map to user-stories/007-agent-self-heals-catalogued-failures.md.
// scenario: "heal-claude-account-rate-limit detects the account-exhaustion signal"
// scenario: "heal-claude-account-rate-limit parses the reset clause and pauses until reset"
// scenario: "heal-claude-account-rate-limit notifies the operator exactly once (edge-triggered)"
// scenario: "heal-claude-account-rate-limit does NOT match transient 429 (belongs to heal-agent-rate-limited)"

import { describe, expect, test } from "vitest";
import type { ClaudeAccountRateLimitSeams } from "./heal-claude-account-rate-limit.js";
import * as heal from "./heal-claude-account-rate-limit.js";

// A fixed clock: 2026-05-30T12:00:00.000Z (a Saturday).
const NOW_MS = Date.UTC(2026, 4, 30, 12, 0, 0);

function makeSeams(overrides: Partial<ClaudeAccountRateLimitSeams> = {}): {
  seams: ClaudeAccountRateLimitSeams;
  notifications: string[];
  sleeps: number[];
} {
  const notifications: string[] = [];
  const sleeps: number[] = [];
  const seams: ClaudeAccountRateLimitSeams = {
    stderr: "",
    nowMs: NOW_MS,
    sleepMsFn: async (ms) => {
      sleeps.push(ms);
      await Promise.resolve();
    },
    alreadyPaused: false,
    notifyFn: (m) => {
      notifications.push(m);
    },
    ...overrides,
  };
  return { seams, notifications, sleeps };
}

describe("heal-claude-account-rate-limit", () => {
  test.each([
    "You've hit your limit · resets May 31 at 8pm (America/Toronto)",
    "you've hit your limit · resets Jun 2 at 10am",
    "Youve hit your limit · resets tomorrow at 9am",
    "You've hit your usage limit · resets in 3 hours",
    "Error: You've hit your limit (exit 1)",
  ])("detects the account-exhaustion signal: %s", (stderr) => {
    const { seams } = makeSeams({ stderr });
    const result = heal.detect(seams);
    expect(result.present).toBe(true);
    if (result.present) {
      expect(result.signal).toBe("claude-account-rate-limit");
    }
  });

  test.each([
    "",
    "Error: rate limit exceeded",
    "anthropic.RateLimitError: 429 Too Many Requests",
    "rate_limit_error: limit reached",
    "MODULE_NOT_FOUND: vitest",
    "ECONNREFUSED 127.0.0.1:11434",
  ])("does NOT detect on non-account-exhaustion stderr: %s", (stderr) => {
    const { seams } = makeSeams({ stderr });
    expect(heal.detect(seams).present).toBe(false);
  });

  test("does NOT collide with heal-agent-rate-limited's transient 429 signal", async () => {
    // The two regexes must partition the space: a plain 429 belongs to
    // heal-agent-rate-limited, NOT here.
    const agentRateLimited = await import("./heal-agent-rate-limited.js");
    const noopSleep = async (): Promise<void> => {
      await Promise.resolve();
    };
    const transient = "anthropic.RateLimitError: 429 Too Many Requests — rate limit exceeded";
    const account = "You've hit your limit · resets May 31 at 8pm (America/Toronto)";

    expect(heal.detect(makeSeams({ stderr: transient }).seams).present).toBe(false);
    expect(
      agentRateLimited.detect({ stderr: transient, sleepMsFn: noopSleep, attemptIndex: 0 }).present,
    ).toBe(true);

    expect(heal.detect(makeSeams({ stderr: account }).seams).present).toBe(true);
    expect(
      agentRateLimited.detect({ stderr: account, sleepMsFn: noopSleep, attemptIndex: 0 }).present,
    ).toBe(false);
  });

  test("detect parses the reset clause into a future epoch", () => {
    const { seams } = makeSeams({
      stderr: "You've hit your limit · resets May 31 at 8pm (America/Toronto)",
    });
    const result = heal.detect(seams);
    expect(result.present).toBe(true);
    if (result.present) {
      expect(typeof result.evidence["resetAt"]).toBe("number");
      expect(result.evidence["resetAt"] as number).toBeGreaterThan(NOW_MS);
      expect(result.evidence["parsedFromFallback"]).toBe(false);
    }
  });

  test("detect falls back to the loose probe on wording drift", () => {
    // Hypothetical future wording Anthropic might emit — no "hit your limit"
    // phrase, but still "limit … resets".
    const { seams } = makeSeams({
      stderr: "Weekly usage limit reached for your plan; resets Jun 2 at 10am.",
    });
    const result = heal.detect(seams);
    expect(result.present).toBe(true);
    if (result.present) {
      expect(result.evidence["parsedFromFallback"]).toBe(true);
      expect(result.evidence["resetAt"] as number).toBeGreaterThan(NOW_MS);
    }
  });

  describe("parseResetClause", () => {
    test('"May 31 at 8pm" → May 31 20:00 of the current year', () => {
      const ts = heal.parseResetClause("May 31 at 8pm (America/Toronto)", NOW_MS);
      expect(ts).not.toBeNull();
      const d = new Date(ts as number);
      expect(d.getMonth()).toBe(4); // May
      expect(d.getDate()).toBe(31);
      expect(d.getHours()).toBe(20);
    });

    test('"tomorrow at 9am" → next day 09:00', () => {
      const ts = heal.parseResetClause("tomorrow at 9am", NOW_MS);
      expect(ts).not.toBeNull();
      const d = new Date(ts as number);
      const tomorrow = new Date(NOW_MS);
      tomorrow.setDate(tomorrow.getDate() + 1);
      expect(d.getDate()).toBe(tomorrow.getDate());
      expect(d.getHours()).toBe(9);
    });

    test('"in 3 hours" → now + 3h', () => {
      const ts = heal.parseResetClause("in 3 hours", NOW_MS);
      expect(ts).toBe(NOW_MS + 3 * 3_600_000);
    });

    test("rolls a past month/day to next year", () => {
      // Jan 1 is well in the past relative to NOW (late May) → next Jan 1.
      const ts = heal.parseResetClause("Jan 1 at 12am", NOW_MS);
      expect(ts).not.toBeNull();
      const d = new Date(ts as number);
      expect(d.getMonth()).toBe(0);
      expect(d.getFullYear()).toBe(new Date(NOW_MS).getFullYear() + 1);
    });

    test("returns null for an unparseable clause", () => {
      expect(heal.parseResetClause("soon-ish maybe", NOW_MS)).toBeNull();
      expect(heal.parseResetClause("", NOW_MS)).toBeNull();
    });
  });

  test("apply pauses until the parsed reset and notifies once", async () => {
    const fixture = makeSeams({
      stderr: "You've hit your limit · resets in 2 hours",
    });
    const result = await heal.apply(fixture.seams);
    expect(result.applied).toBe(true);
    expect(result.notes).toContain("budget-paused-claude");
    // 2 hours > 5-min floor → sleeps the full 2 hours.
    expect(fixture.sleeps).toEqual([2 * 3_600_000]);
    expect(fixture.notifications).toHaveLength(1);
    expect(fixture.notifications[0]).toContain("Claude account exhausted");
  });

  test("apply floors the pause when reset is unparseable", async () => {
    const fixture = makeSeams({
      stderr: "You've hit your limit (no reset clause given)",
    });
    const result = await heal.apply(fixture.seams);
    expect(result.applied).toBe(true);
    // Unparseable → falls back to the 5-min floor, never busy-loops.
    expect(fixture.sleeps).toEqual([heal.DEFAULT_PAUSE_FLOOR_MS]);
  });

  test("apply floors the pause when reset is in the past (clock skew)", async () => {
    const fixture = makeSeams({
      stderr: "You've hit your limit · resets in 0 minutes",
    });
    await heal.apply(fixture.seams);
    expect(fixture.sleeps).toEqual([heal.DEFAULT_PAUSE_FLOOR_MS]);
  });

  test("apply does NOT re-notify when already paused (edge-triggered debounce)", async () => {
    const fixture = makeSeams({
      stderr: "You've hit your limit · resets in 2 hours",
      alreadyPaused: true,
    });
    const result = await heal.apply(fixture.seams);
    expect(result.applied).toBe(true);
    expect(fixture.notifications).toHaveLength(0);
    expect(result.notes).toContain("already paused");
    // Still sleeps — the daemon keeps idling until the wall passes.
    expect(fixture.sleeps).toEqual([2 * 3_600_000]);
  });

  test("apply is a no-op when stderr has no account-exhaustion signal", async () => {
    const fixture = makeSeams({ stderr: "ERR_NETWORK_TIMEOUT" });
    const result = await heal.apply(fixture.seams);
    expect(result.applied).toBe(false);
    expect(fixture.sleeps).toHaveLength(0);
    expect(fixture.notifications).toHaveLength(0);
    expect(result.notes).toContain("no-op");
  });

  test("apply honors an injected custom pause floor", async () => {
    const fixture = makeSeams({
      stderr: "You've hit your limit (no reset clause)",
      pauseFloorMs: 1_000,
    });
    await heal.apply(fixture.seams);
    expect(fixture.sleeps).toEqual([1_000]);
  });

  test("notifyFn throw propagates (rule #6 — let-it-crash at the I/O boundary)", async () => {
    const fixture = makeSeams({
      stderr: "You've hit your limit · resets in 2 hours",
      notifyFn: () => {
        throw new Error("ntfy push failed");
      },
    });
    await expect(heal.apply(fixture.seams)).rejects.toThrow("ntfy push failed");
  });

  test("verify returns healed when no re-detection seam is provided", () => {
    const { seams } = makeSeams({ stderr: "You've hit your limit · resets in 2 hours" });
    expect(heal.verify(seams).healed).toBe(true);
  });

  test("verify returns healed when the next stderr is clean (reset wall passed)", () => {
    const { seams } = makeSeams({
      stderr: "You've hit your limit · resets in 2 hours",
      nextStderrFn: () => "iteration succeeded",
    });
    expect(heal.verify(seams).healed).toBe(true);
  });

  test("verify returns not-healed when the next stderr still has the signal", () => {
    const { seams } = makeSeams({
      stderr: "You've hit your limit · resets in 2 hours",
      nextStderrFn: () => "You've hit your limit · resets in 1 hour",
    });
    const result = heal.verify(seams);
    expect(result.healed).toBe(false);
    if (!result.healed) {
      expect(result.residualSignal).toBe("claude-account-rate-limit");
    }
  });

  test("end-to-end: detect → apply (notify+pause) → verify-healed after reset wall passes", async () => {
    let nextStderr = "You've hit your limit · resets in 2 hours";
    const fixture = makeSeams({
      stderr: "You've hit your limit · resets in 2 hours",
      nextStderrFn: () => nextStderr,
    });
    expect(heal.detect(fixture.seams).present).toBe(true);
    await heal.apply(fixture.seams);
    expect(fixture.notifications).toHaveLength(1);
    // Wall passes → next spawn succeeds.
    nextStderr = "iteration succeeded";
    expect(heal.verify(fixture.seams).healed).toBe(true);
  });
});
