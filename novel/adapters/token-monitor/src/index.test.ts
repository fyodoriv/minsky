import { describe, expect, it } from "vitest";
import {
  consumedFraction,
  remainingFractions,
  StubTokenMonitor,
  type TokenSnapshot,
} from "./index.js";

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
    monthlyHeadroomFraction: 1,
    secondsUntilWeekReset: 7 * 24 * 60 * 60,
    secondsUntilMonthReset: 30 * 24 * 60 * 60,
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

describe("remainingFractions — slice 1 of `claude-usage-aware-strategic-model-router`", () => {
  const base = (overrides: Partial<TokenSnapshot> = {}): TokenSnapshot => ({
    tokensRemainingInWindow: 500,
    windowSizeTokens: 1000,
    secondsUntilWindowReset: 100,
    weeklyHeadroomFraction: 0.5,
    observedAt: "2026-05-10T00:00:00Z",
    monthlyHeadroomFraction: 0.7,
    secondsUntilWeekReset: 7 * 24 * 60 * 60,
    secondsUntilMonthReset: 30 * 24 * 60 * 60,
    ...overrides,
  });

  it("computes fivehour from tokensRemainingInWindow / windowSizeTokens", () => {
    const r = remainingFractions(base({ tokensRemainingInWindow: 750, windowSizeTokens: 1000 }));
    expect(r.fivehour).toBe(0.75);
  });

  it("passes through weekly and monthly fractions verbatim", () => {
    const r = remainingFractions(
      base({ weeklyHeadroomFraction: 0.3, monthlyHeadroomFraction: 0.9 }),
    );
    expect(r.weekly).toBe(0.3);
    expect(r.monthly).toBe(0.9);
  });

  it("propagates observedAt for staleness checks downstream", () => {
    const r = remainingFractions(base({ observedAt: "2026-05-10T12:34:56Z" }));
    expect(r.observedAt).toBe("2026-05-10T12:34:56Z");
  });

  it("returns fivehour=0 when windowSizeTokens is 0 (cold-start / div-by-zero guard)", () => {
    const r = remainingFractions(base({ windowSizeTokens: 0, tokensRemainingInWindow: 100 }));
    expect(r.fivehour).toBe(0);
  });

  it("clamps fivehour above 1 (negative tokensRemainingInWindow shouldn't blow past 1)", () => {
    const r = remainingFractions(base({ tokensRemainingInWindow: 2000, windowSizeTokens: 1000 }));
    expect(r.fivehour).toBe(1);
  });

  it("clamps weekly above 1", () => {
    const r = remainingFractions(base({ weeklyHeadroomFraction: 1.5 }));
    expect(r.weekly).toBe(1);
  });

  it("clamps weekly below 0", () => {
    const r = remainingFractions(base({ weeklyHeadroomFraction: -0.5 }));
    expect(r.weekly).toBe(0);
  });

  it("clamps monthly above 1", () => {
    const r = remainingFractions(base({ monthlyHeadroomFraction: 2 }));
    expect(r.monthly).toBe(1);
  });

  it("clamps monthly below 0", () => {
    const r = remainingFractions(base({ monthlyHeadroomFraction: -1 }));
    expect(r.monthly).toBe(0);
  });

  it("treats NaN as 0 (defensive — Maciek's parser can emit NaN under malformed input)", () => {
    const r = remainingFractions(base({ weeklyHeadroomFraction: Number.NaN }));
    expect(r.weekly).toBe(0);
  });

  it("treats Infinity as 0 (defensive — same)", () => {
    const r = remainingFractions(base({ monthlyHeadroomFraction: Number.POSITIVE_INFINITY }));
    expect(r.monthly).toBe(0);
  });

  it("returns 1.0 across all windows on a defaultSnapshot-shaped fresh state", () => {
    const r = remainingFractions(
      base({
        tokensRemainingInWindow: 1000,
        windowSizeTokens: 1000,
        weeklyHeadroomFraction: 1,
        monthlyHeadroomFraction: 1,
      }),
    );
    expect(r.fivehour).toBe(1);
    expect(r.weekly).toBe(1);
    expect(r.monthly).toBe(1);
  });

  it("returns 0 across all windows on an exhausted state", () => {
    const r = remainingFractions(
      base({
        tokensRemainingInWindow: 0,
        windowSizeTokens: 1000,
        weeklyHeadroomFraction: 0,
        monthlyHeadroomFraction: 0,
      }),
    );
    expect(r.fivehour).toBe(0);
    expect(r.weekly).toBe(0);
    expect(r.monthly).toBe(0);
  });
});
