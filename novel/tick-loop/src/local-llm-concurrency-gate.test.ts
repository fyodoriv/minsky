import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalLlmConcurrencyGate } from "./local-llm-concurrency-gate.js";
import type { SpawnInput, SpawnResult, SpawnStrategy } from "./spawn-strategy.js";

class FakeInner implements SpawnStrategy {
  public calls = 0;
  public inFlight = 0;
  public maxObservedInFlight = 0;
  public concurrencyViolationDetected = false;
  constructor(
    private readonly resolveAfterMs: number,
    private readonly sleepFn: (ms: number) => Promise<void>,
  ) {}
  async spawn(input: SpawnInput): Promise<SpawnResult> {
    this.calls += 1;
    this.inFlight += 1;
    if (this.inFlight > 1) this.concurrencyViolationDetected = true;
    this.maxObservedInFlight = Math.max(this.maxObservedInFlight, this.inFlight);
    await this.sleepFn(this.resolveAfterMs);
    this.inFlight -= 1;
    return {
      exitCode: 0,
      durationMs: this.resolveAfterMs,
      stdoutTail: `done ${input.taskId}`,
      stderrTail: "",
    };
  }
}

const baseInput: SpawnInput = Object.freeze({
  taskId: "fake-task",
  brief: "do work",
  env: {},
});

describe("LocalLlmConcurrencyGate — `local-server-concurrency-aware-worker-spawn` slice 2.5", () => {
  let lockDir: string;
  beforeEach(() => {
    lockDir = mkdtempSync(join(tmpdir(), "minsky-gate-test-"));
  });
  afterEach(() => {
    rmSync(lockDir, { recursive: true, force: true });
  });

  it("delegates to inner.spawn and returns the result unchanged", async () => {
    const fakeSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const inner = new FakeInner(0, fakeSleep);
    const gate = new LocalLlmConcurrencyGate({
      inner,
      workerId: "w-0",
      lockPath: join(lockDir, "gate.lock"),
      sleepMs: fakeSleep,
    });
    const r = await gate.spawn(baseInput);
    expect(r.exitCode).toBe(0);
    expect(r.stdoutTail).toBe("done fake-task");
    expect(inner.calls).toBe(1);
  });

  it("serializes concurrent spawns (only one inner.spawn in-flight at a time)", async () => {
    // Use a small real timer so the gate's polling can actually observe a held lock.
    const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const inner = new FakeInner(50, realSleep);
    const makeGate = (workerId: string) =>
      new LocalLlmConcurrencyGate({
        inner,
        workerId,
        lockPath: join(lockDir, "gate.lock"),
        pollIntervalMs: 5,
        sleepMs: realSleep,
      });
    // Fire 3 spawns "concurrently"; with the gate serializing, max in-flight
    // should be 1, total wall-clock ≥ 3 * 50ms.
    const start = Date.now();
    const results = await Promise.all([
      makeGate("w-0").spawn(baseInput),
      makeGate("w-1").spawn(baseInput),
      makeGate("w-2").spawn(baseInput),
    ]);
    const elapsed = Date.now() - start;
    expect(results).toHaveLength(3);
    expect(inner.calls).toBe(3);
    expect(inner.maxObservedInFlight).toBe(1);
    expect(inner.concurrencyViolationDetected).toBe(false);
    expect(elapsed).toBeGreaterThanOrEqual(140); // 3 × 50ms minus jitter
  });

  it("writes lock body containing worker id + acquiredAt + expiresAt while held", async () => {
    let resolveInner!: () => void;
    const innerHold = new Promise<void>((r) => {
      resolveInner = r;
    });
    const inner: SpawnStrategy = {
      spawn: async (): Promise<SpawnResult> => {
        await innerHold;
        return { exitCode: 0, durationMs: 0, stdoutTail: "", stderrTail: "" };
      },
    };
    const lockPath = join(lockDir, "gate.lock");
    const gate = new LocalLlmConcurrencyGate({
      inner,
      workerId: "w-42",
      lockPath,
      now: () => 1000,
      lockTtlMs: 60_000,
      sleepMs: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    });
    const inflight = gate.spawn(baseInput);
    // Yield to let the gate acquire + invoke inner (synchronous up to await).
    await new Promise<void>((r) => setTimeout(r, 10));
    const body = JSON.parse(readFileSync(lockPath, "utf8"));
    expect(body.workerId).toBe("w-42");
    expect(body.acquiredAt).toBe(1000);
    expect(body.expiresAt).toBe(61_000);
    resolveInner();
    await inflight;
  });

  it("releases lock even when inner throws (finally branch)", async () => {
    const inner: SpawnStrategy = {
      spawn: async () => {
        throw new Error("inner kaboom");
      },
    };
    const lockPath = join(lockDir, "gate.lock");
    const gate = new LocalLlmConcurrencyGate({
      inner,
      workerId: "w-0",
      lockPath,
      sleepMs: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    });
    await expect(gate.spawn(baseInput)).rejects.toThrow("inner kaboom");
    // Lock is released; second spawn should succeed immediately.
    const inner2: SpawnStrategy = {
      spawn: async () => ({ exitCode: 0, durationMs: 0, stdoutTail: "ok", stderrTail: "" }),
    };
    const gate2 = new LocalLlmConcurrencyGate({
      inner: inner2,
      workerId: "w-1",
      lockPath,
      sleepMs: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    });
    const r = await gate2.spawn(baseInput);
    expect(r.stdoutTail).toBe("ok");
  });

  it("recovers stale lock (expiresAt in the past) by force-clearing", async () => {
    // Pre-stage a "stale" lock file.
    const lockPath = join(lockDir, "gate.lock");
    const stale = JSON.stringify({
      workerId: "w-crashed",
      acquiredAt: 0,
      expiresAt: 100, // long ago
    });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(lockPath, stale);
    const inner: SpawnStrategy = {
      spawn: async () => ({ exitCode: 0, durationMs: 0, stdoutTail: "recovered", stderrTail: "" }),
    };
    const gate = new LocalLlmConcurrencyGate({
      inner,
      workerId: "w-fresh",
      lockPath,
      now: () => 10_000_000, // far in the future
      sleepMs: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    });
    const r = await gate.spawn(baseInput);
    expect(r.stdoutTail).toBe("recovered");
  });

  it("recovers unparseable lock body by force-clearing on next loop turn", async () => {
    const lockPath = join(lockDir, "gate.lock");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(lockPath, "not-json{{{");
    const inner: SpawnStrategy = {
      spawn: async () => ({ exitCode: 0, durationMs: 0, stdoutTail: "recovered", stderrTail: "" }),
    };
    const gate = new LocalLlmConcurrencyGate({
      inner,
      workerId: "w-fresh",
      lockPath,
      now: () => 10_000_000,
      sleepMs: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    });
    const r = await gate.spawn(baseInput);
    expect(r.stdoutTail).toBe("recovered");
  });

  it("throws local-llm-concurrency-gate-timeout when wait exceeds acquireTimeoutMs", async () => {
    // Pre-stage a fresh-not-stale lock (held by another worker, still live).
    const lockPath = join(lockDir, "gate.lock");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      lockPath,
      JSON.stringify({
        workerId: "w-other",
        acquiredAt: 0,
        expiresAt: 999_999_999_999, // far future — never stale
      }),
    );
    let nowMs = 0;
    const inner: SpawnStrategy = {
      spawn: async () => ({ exitCode: 0, durationMs: 0, stdoutTail: "", stderrTail: "" }),
    };
    const gate = new LocalLlmConcurrencyGate({
      inner,
      workerId: "w-wait",
      lockPath,
      pollIntervalMs: 1,
      acquireTimeoutMs: 50,
      now: () => nowMs,
      sleepMs: async (ms) => {
        nowMs += ms + 100; // advance clock past the timeout in one tick
      },
    });
    await expect(gate.spawn(baseInput)).rejects.toThrow("local-llm-concurrency-gate-timeout");
  });
});
