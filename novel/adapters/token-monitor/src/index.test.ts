import { describe, expect, it } from "vitest";

import { StubTokenMonitor, type TokenSnapshot, consumedFraction } from "./index.js";

describe("StubTokenMonitor", () => {
  it("returns the default snapshot until set() is called", async () => {
    const tm = new StubTokenMonitor();
    const s = await tm.snapshot();
    expect(s.tokensRemainingInWindow).toBe(1_000_000);
    expect(s.windowSizeTokens).toBe(1_000_000);
    expect(s.weeklyHeadroomFraction).toBe(1.0);
  });

  it("reflects programmed values on subsequent snapshots", async () => {
    const tm = new StubTokenMonitor();
    tm.set({ tokensRemainingInWindow: 250_000 });
    const s = await tm.snapshot();
    expect(s.tokensRemainingInWindow).toBe(250_000);
    // Untouched fields keep defaults.
    expect(s.windowSizeTokens).toBe(1_000_000);
  });

  it("constructor accepts a partial initial snapshot", async () => {
    const tm = new StubTokenMonitor({ weeklyHeadroomFraction: 0.5 });
    const s = await tm.snapshot();
    expect(s.weeklyHeadroomFraction).toBe(0.5);
  });
});

describe("consumedFraction", () => {
  const base = (overrides: Partial<TokenSnapshot> = {}): TokenSnapshot => ({
    tokensRemainingInWindow: 500,
    windowSizeTokens: 1000,
    secondsUntilWindowReset: 100,
    weeklyHeadroomFraction: 1,
    observedAt: "2026-05-03T00:00:00Z",
    ...overrides,
  });

  it("returns 0 for a full window", () => {
    expect(consumedFraction(base({ tokensRemainingInWindow: 1000 }))).toBe(0);
  });

  it("returns 1 for an empty window", () => {
    expect(consumedFraction(base({ tokensRemainingInWindow: 0 }))).toBe(1);
  });

  it("returns 0.5 at half consumption", () => {
    expect(consumedFraction(base())).toBe(0.5);
  });

  it("clamps negative fractions to 0", () => {
    expect(consumedFraction(base({ tokensRemainingInWindow: 1500 }))).toBe(0);
  });

  it("clamps fractions over 1 to 1", () => {
    expect(consumedFraction(base({ tokensRemainingInWindow: -100 }))).toBe(1);
  });

  it("returns 0 when windowSizeTokens is 0 (avoid div-by-zero)", () => {
    expect(consumedFraction(base({ windowSizeTokens: 0 }))).toBe(0);
  });
});
