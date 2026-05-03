import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StubTokenMonitor, type TokenSnapshot } from "@minsky/token-monitor";

import { type BudgetDecision, BudgetGuard, DEFAULT_THRESHOLDS, decide } from "./index.js";

const snapshot = (overrides: Partial<TokenSnapshot> = {}): TokenSnapshot => ({
  tokensRemainingInWindow: 1_000_000,
  windowSizeTokens: 1_000_000,
  secondsUntilWindowReset: 5 * 60 * 60,
  weeklyHeadroomFraction: 1,
  observedAt: "2026-05-03T00:00:00Z",
  ...overrides,
});

describe("decide", () => {
  it("returns normal when consumption is below all thresholds", () => {
    const d = decide(snapshot({ tokensRemainingInWindow: 500_000 }));
    expect(d.action).toBe("normal");
  });

  it("returns graceful-degrade at 70% consumption", () => {
    const d = decide(snapshot({ tokensRemainingInWindow: 300_000 }));
    expect(d.action).toBe("graceful-degrade");
    expect(d.consumed).toBeCloseTo(0.7);
  });

  it("returns circuit-break-and-notify at 85% consumption", () => {
    const d = decide(snapshot({ tokensRemainingInWindow: 150_000 }));
    expect(d.action).toBe("circuit-break-and-notify");
    expect(d.consumed).toBeCloseTo(0.85);
  });

  it("circuit-break wins the lattice meet over graceful-degrade", () => {
    const d = decide(snapshot({ tokensRemainingInWindow: 50_000 }));
    expect(d.action).toBe("circuit-break-and-notify");
  });

  it("returns weekly-cap-warn when only weekly headroom is low", () => {
    const d = decide(snapshot({ weeklyHeadroomFraction: 0.1 }));
    expect(d.action).toBe("weekly-cap-warn");
  });

  it("circuit-break still wins when weekly is also low (severity precedence)", () => {
    const d = decide(snapshot({ tokensRemainingInWindow: 100_000, weeklyHeadroomFraction: 0.1 }));
    expect(d.action).toBe("circuit-break-and-notify");
  });

  it("respects custom thresholds", () => {
    const d = decide(snapshot({ tokensRemainingInWindow: 600_000 }), {
      ...DEFAULT_THRESHOLDS,
      degradeAt: 0.3,
    });
    expect(d.action).toBe("graceful-degrade");
  });

  it("populates the reason string with concrete percentages", () => {
    const d = decide(snapshot({ tokensRemainingInWindow: 100_000 }));
    expect(d.reason).toMatch(/90.0%.*85% circuit-break/);
  });

  it("populates ISO-8601 decidedAt", () => {
    const d = decide(snapshot());
    expect(d.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("BudgetGuard", () => {
  let monitor: StubTokenMonitor;
  let received: BudgetDecision[];
  let guard: BudgetGuard;

  beforeEach(() => {
    monitor = new StubTokenMonitor();
    received = [];
    guard = new BudgetGuard(monitor, (d) => received.push(d), DEFAULT_THRESHOLDS, 1000);
    vi.useFakeTimers();
  });

  afterEach(() => {
    guard.stop();
    vi.useRealTimers();
  });

  it("tick() pushes one decision and returns it", async () => {
    monitor.set({ tokensRemainingInWindow: 50_000 });
    const decision = await guard.tick();
    expect(decision.action).toBe("circuit-break-and-notify");
    expect(received).toHaveLength(1);
    expect(received[0]?.action).toBe("circuit-break-and-notify");
  });

  it("start() begins polling at the configured interval", async () => {
    monitor.set({ tokensRemainingInWindow: 1_000_000 });
    guard.start();

    // First poll fires after pollIntervalMs.
    await vi.advanceTimersByTimeAsync(1000);
    expect(received.length).toBeGreaterThanOrEqual(1);

    monitor.set({ tokensRemainingInWindow: 50_000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(received.at(-1)?.action).toBe("circuit-break-and-notify");
  });

  it("start() is idempotent — calling twice doesn't double the poll rate", async () => {
    guard.start();
    guard.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(received).toHaveLength(1);
  });

  it("stop() halts the poll loop and is idempotent", async () => {
    guard.start();
    await vi.advanceTimersByTimeAsync(1000);
    const before = received.length;
    guard.stop();
    guard.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(received.length).toBe(before);
  });
});
