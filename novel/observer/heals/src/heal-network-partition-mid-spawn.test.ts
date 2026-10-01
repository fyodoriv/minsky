// Tests for heal-network-partition-mid-spawn
//
// Scenarios map to user-stories/007-agent-self-heals-catalogued-failures.md.

import { describe, expect, test } from "vitest";
import type { NetworkPartitionMidSpawnSeams } from "./heal-network-partition-mid-spawn.js";
import * as heal from "./heal-network-partition-mid-spawn.js";

function makeSeams(
  overrides: Partial<NetworkPartitionMidSpawnSeams> = {},
): NetworkPartitionMidSpawnSeams {
  return {
    stderr: "",
    sleepMsFn: async () => {
      await Promise.resolve();
    },
    alreadyRetried: false,
    ...overrides,
  };
}

describe("heal-network-partition-mid-spawn", () => {
  test.each([
    "Error: getaddrinfo ENOTFOUND api.anthropic.com",
    "EAI_AGAIN api.openai.com",
    "FetchError: ETIMEDOUT during TLS handshake",
    "TLS handshake timeout",
    "TLS handshake failed",
    "ECONNRESET mid-stream",
    "network unreachable",
    "ENETUNREACH",
    "ENOTCONN",
  ])("detects network-partition signal in stderr: %s", (stderr) => {
    const seams = makeSeams({ stderr });
    const result = heal.detect(seams);
    expect(result.present).toBe(true);
    if (result.present) {
      expect(result.signal).toBe("network-partition-mid-spawn");
    }
  });

  test.each([
    "",
    "ECONNREFUSED 127.0.0.1:11434",
    "429 too many requests",
    "MODULE_NOT_FOUND: vitest",
    "ESRCH: no such process",
    "Permission denied",
  ])("does NOT detect on non-network-partition stderr: %s", (stderr) => {
    const seams = makeSeams({ stderr });
    expect(heal.detect(seams).present).toBe(false);
  });

  test("apply sleeps the default 30s on first call", async () => {
    let sleptMs = -1;
    const seams = makeSeams({
      stderr: "getaddrinfo ENOTFOUND",
      sleepMsFn: async (ms) => {
        sleptMs = ms;
        await Promise.resolve();
      },
    });
    const result = await heal.apply(seams);
    expect(result.applied).toBe(true);
    expect(sleptMs).toBe(30_000);
    expect(result.notes).toContain("retry the spawn once");
  });

  test("apply honors injected custom retrySleepMs", async () => {
    let sleptMs = -1;
    const seams = makeSeams({
      stderr: "ECONNRESET",
      sleepMsFn: async (ms) => {
        sleptMs = ms;
        await Promise.resolve();
      },
      retrySleepMs: 5_000,
    });
    await heal.apply(seams);
    expect(sleptMs).toBe(5_000);
  });

  test("apply refuses retry when alreadyRetried (escalation path)", async () => {
    let slept = false;
    const seams = makeSeams({
      stderr: "ETIMEDOUT",
      sleepMsFn: async () => {
        slept = true;
        await Promise.resolve();
      },
      alreadyRetried: true,
    });
    const result = await heal.apply(seams);
    expect(result.applied).toBe(false);
    expect(slept).toBe(false);
    expect(result.notes).toContain("exhausted");
    expect(result.notes).toContain("fleet-provider-mode-flip-to-local");
  });

  test("apply is a no-op when stderr has no network-partition signal", async () => {
    let slept = false;
    const seams = makeSeams({
      stderr: "MODULE_NOT_FOUND",
      sleepMsFn: async () => {
        slept = true;
        await Promise.resolve();
      },
    });
    const result = await heal.apply(seams);
    expect(result.applied).toBe(false);
    expect(slept).toBe(false);
    expect(result.notes).toContain("no-op");
  });

  test("verify returns healed when no re-detection seam is provided", () => {
    const seams = makeSeams({ stderr: "ETIMEDOUT" });
    expect(heal.verify(seams).healed).toBe(true);
  });

  test("verify returns healed when re-detection returns clean stderr", () => {
    const seams = makeSeams({
      stderr: "ETIMEDOUT",
      nextStderrFn: () => "next attempt succeeded",
    });
    expect(heal.verify(seams).healed).toBe(true);
  });

  test("verify returns not-healed when next stderr still has the signal", () => {
    const seams = makeSeams({
      stderr: "ETIMEDOUT",
      nextStderrFn: () => "ETIMEDOUT STILL",
    });
    const result = heal.verify(seams);
    expect(result.healed).toBe(false);
    if (!result.healed) {
      expect(result.residualSignal).toBe("network-partition-mid-spawn");
    }
  });
});
