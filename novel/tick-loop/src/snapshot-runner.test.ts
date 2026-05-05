import { describe, expect, it } from "vitest";

import { type SnapshotCapture, runSnapshot, shouldRunSnapshot } from "./snapshot-runner.js";

describe("shouldRunSnapshot", () => {
  it("runs when env is unset and snapshot does not exist", () => {
    expect(shouldRunSnapshot({ env: {}, snapshotAlreadyExists: false })).toBe(true);
  });

  it("skips when MINSKY_CHANGELOG=off (umbrella opt-out)", () => {
    expect(
      shouldRunSnapshot({ env: { MINSKY_CHANGELOG: "off" }, snapshotAlreadyExists: false }),
    ).toBe(false);
  });

  it("skips when today's snapshot already exists on disk", () => {
    expect(shouldRunSnapshot({ env: {}, snapshotAlreadyExists: true })).toBe(false);
  });

  it("ignores MINSKY_CHANGELOG values other than 'off'", () => {
    expect(
      shouldRunSnapshot({ env: { MINSKY_CHANGELOG: "on" }, snapshotAlreadyExists: false }),
    ).toBe(true);
    expect(shouldRunSnapshot({ env: { MINSKY_CHANGELOG: "" }, snapshotAlreadyExists: false })).toBe(
      true,
    );
  });

  it("env-off takes precedence over the existence check", () => {
    expect(
      shouldRunSnapshot({
        env: { MINSKY_CHANGELOG: "off" },
        snapshotAlreadyExists: true,
      }),
    ).toBe(false);
  });
});

describe("runSnapshot", () => {
  function makeCapture(): {
    capture: SnapshotCapture;
    calls: Array<{ date: string; env: Record<string, string | undefined> }>;
  } {
    const calls: Array<{ date: string; env: Record<string, string | undefined> }> = [];
    const capture: SnapshotCapture = {
      capture: async (input) => {
        calls.push({ date: input.date, env: { ...input.env } });
        return { exitCode: 0, durationMs: 7, stdoutTail: "ok", stderrTail: "" };
      },
    };
    return { capture, calls };
  }

  it("skips when MINSKY_CHANGELOG=off without probing the filesystem", async () => {
    const { capture, calls } = makeCapture();
    let probeCount = 0;
    const result = await runSnapshot({
      date: "2026-05-05",
      env: { MINSKY_CHANGELOG: "off" },
      snapshotExists: async () => {
        probeCount += 1;
        return false;
      },
      capture,
    });
    expect(result).toEqual({ outcome: "skipped", reason: "env-off" });
    expect(calls).toHaveLength(0);
    expect(probeCount).toBe(0);
  });

  it("skips when today's snapshot already exists", async () => {
    const { capture, calls } = makeCapture();
    const result = await runSnapshot({
      date: "2026-05-05",
      env: {},
      snapshotExists: async () => true,
      capture,
    });
    expect(result).toEqual({ outcome: "skipped", reason: "already-captured" });
    expect(calls).toHaveLength(0);
  });

  it("captures with the date on the happy path", async () => {
    const { capture, calls } = makeCapture();
    const result = await runSnapshot({
      date: "2026-05-05",
      env: {},
      snapshotExists: async () => false,
      capture,
    });
    expect(result.outcome).toBe("ran");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.date).toBe("2026-05-05");
  });

  it("returns the capture-seam result fields when the runner ran", async () => {
    const capture: SnapshotCapture = {
      capture: async () => ({
        exitCode: 9,
        durationMs: 4242,
        stdoutTail: "stdout-tail",
        stderrTail: "stderr-tail",
      }),
    };
    const result = await runSnapshot({
      date: "2026-05-05",
      env: {},
      snapshotExists: async () => false,
      capture,
    });
    expect(result).toEqual({
      outcome: "ran",
      exitCode: 9,
      durationMs: 4242,
      stdoutTail: "stdout-tail",
      stderrTail: "stderr-tail",
    });
  });

  it("propagates env into the capture invocation", async () => {
    const calls: Record<string, string | undefined>[] = [];
    const capture: SnapshotCapture = {
      capture: async (input) => {
        calls.push(input.env);
        return { exitCode: 0, durationMs: 0, stdoutTail: "", stderrTail: "" };
      },
    };
    await runSnapshot({
      date: "2026-05-05",
      env: { FOO: "bar" },
      snapshotExists: async () => false,
      capture,
    });
    expect(calls[0]).toEqual({ FOO: "bar" });
  });

  it("is idempotent — second run on the same date after first captured is a skip", async () => {
    const { capture, calls } = makeCapture();
    let captured = false;
    const snapshotExists = async (): Promise<boolean> => captured;
    const first = await runSnapshot({
      date: "2026-05-05",
      env: {},
      snapshotExists,
      capture,
    });
    expect(first.outcome).toBe("ran");

    captured = true;

    const second = await runSnapshot({
      date: "2026-05-05",
      env: {},
      snapshotExists,
      capture,
    });
    expect(second).toEqual({ outcome: "skipped", reason: "already-captured" });
    expect(calls).toHaveLength(1);
  });

  it("env-off short-circuits even when the snapshot does not exist", async () => {
    const { capture, calls } = makeCapture();
    const result = await runSnapshot({
      date: "2026-05-05",
      env: { MINSKY_CHANGELOG: "off" },
      snapshotExists: async () => false,
      capture,
    });
    expect(result).toEqual({ outcome: "skipped", reason: "env-off" });
    expect(calls).toHaveLength(0);
  });

  it("propagates a non-zero capture exitCode in the 'ran' outcome (rule #6 — failure is data)", async () => {
    const capture: SnapshotCapture = {
      capture: async () => ({
        exitCode: 1,
        durationMs: 12,
        stdoutTail: "",
        stderrTail: "gh: rate-limited",
      }),
    };
    const result = await runSnapshot({
      date: "2026-05-05",
      env: {},
      snapshotExists: async () => false,
      capture,
    });
    expect(result).toEqual({
      outcome: "ran",
      exitCode: 1,
      durationMs: 12,
      stdoutTail: "",
      stderrTail: "gh: rate-limited",
    });
  });

  it("probes existence with the exact date passed in (no UTC drift)", async () => {
    const probedDates: string[] = [];
    const { capture } = makeCapture();
    await runSnapshot({
      date: "2026-05-05",
      env: {},
      snapshotExists: async (date) => {
        probedDates.push(date);
        return false;
      },
      capture,
    });
    expect(probedDates).toEqual(["2026-05-05"]);
  });

  it("captures with the exact date passed in (no UTC drift)", async () => {
    const { capture, calls } = makeCapture();
    await runSnapshot({
      date: "2026-05-05",
      env: {},
      snapshotExists: async () => false,
      capture,
    });
    expect(calls[0]?.date).toBe("2026-05-05");
  });

  it("does not call capture when MINSKY_CHANGELOG=off even if the existence-probe stub would say no", async () => {
    let captureCount = 0;
    const capture: SnapshotCapture = {
      capture: async () => {
        captureCount += 1;
        return { exitCode: 0, durationMs: 0, stdoutTail: "", stderrTail: "" };
      },
    };
    await runSnapshot({
      date: "2026-05-05",
      env: { MINSKY_CHANGELOG: "off" },
      snapshotExists: async () => false,
      capture,
    });
    expect(captureCount).toBe(0);
  });

  it("does not call capture when the snapshot already exists", async () => {
    let captureCount = 0;
    const capture: SnapshotCapture = {
      capture: async () => {
        captureCount += 1;
        return { exitCode: 0, durationMs: 0, stdoutTail: "", stderrTail: "" };
      },
    };
    await runSnapshot({
      date: "2026-05-05",
      env: {},
      snapshotExists: async () => true,
      capture,
    });
    expect(captureCount).toBe(0);
  });
});
