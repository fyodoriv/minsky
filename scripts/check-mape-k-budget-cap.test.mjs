// Tests for check-mape-k-budget-cap.mjs. Pattern: deterministic CI gate
// over a rule-#9 cost-budget contract — paired positive/negative fixtures
// (Meszaros 2007, *xUnit Test Patterns*) plus boundary-inclusive case at
// exactly 5.7 % (the ARCHITECTURE.md § "MAPE-K cadence" anchor).

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  checkMapeKBudgetCap,
  DEFAULT_CAP_FRACTION,
  readMapeKConfig,
} from "./check-mape-k-budget-cap.mjs";

const WEEKLY_BUDGET = 1_000_000;

describe("checkMapeKBudgetCap (pure)", () => {
  test("synthetic config at 5.5 % (under cap) → ok", () => {
    const result = checkMapeKBudgetCap({
      config: { weeklyProjectedTokens: 55_000 },
      weeklyBudgetTokens: WEEKLY_BUDGET,
    });
    expect(result.ok).toBe(true);
  });

  test("synthetic config at 5.8 % (over cap) → fail with reason naming both sides", () => {
    const result = checkMapeKBudgetCap({
      config: { weeklyProjectedTokens: 58_000 },
      weeklyBudgetTokens: WEEKLY_BUDGET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("58000");
      expect(result.reason).toContain("1000000");
      expect(result.reason).toMatch(/MAPE-K cadence/);
    }
  });

  test("synthetic config at exactly 5.7 % (at cap, boundary inclusive) → ok", () => {
    // 0.057 * 1_000_000 = 57_000 exactly — guards the equality semantics
    // documented in the script header (Beyer SRE 2016 Ch. 3: "you have
    // used X % of your budget" is not a violation until X *exceeds* it).
    const result = checkMapeKBudgetCap({
      config: { weeklyProjectedTokens: 57_000 },
      weeklyBudgetTokens: WEEKLY_BUDGET,
    });
    expect(result.ok).toBe(true);
  });

  test("derived shape (ticksPerWeek × tokensPerTick) under cap → ok", () => {
    // research.md § "MAPE-K cadence": 14 watchdog passes/week ×
    // ≤0.3 % per pass; the test fixture multiplies out to 4.2 % of the
    // weekly budget (under the 5.7 % cap).
    const result = checkMapeKBudgetCap({
      config: { ticksPerWeek: 14, tokensPerTick: 3_000 },
      weeklyBudgetTokens: WEEKLY_BUDGET,
    });
    expect(result.ok).toBe(true);
  });

  test("derived shape (ticksPerWeek × tokensPerTick) over cap → fail", () => {
    // 14 × 5_000 = 70_000 = 7 % of the weekly budget → over the cap.
    const result = checkMapeKBudgetCap({
      config: { ticksPerWeek: 14, tokensPerTick: 5_000 },
      weeklyBudgetTokens: WEEKLY_BUDGET,
    });
    expect(result.ok).toBe(false);
  });

  test("config with neither shape → fail (malformed input)", () => {
    const result = checkMapeKBudgetCap({
      config: {},
      weeklyBudgetTokens: WEEKLY_BUDGET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/weeklyProjectedTokens/);
    }
  });

  test("zero or negative weeklyBudgetTokens → fail (malformed input)", () => {
    const zero = checkMapeKBudgetCap({
      config: { weeklyProjectedTokens: 1_000 },
      weeklyBudgetTokens: 0,
    });
    expect(zero.ok).toBe(false);
    const neg = checkMapeKBudgetCap({
      config: { weeklyProjectedTokens: 1_000 },
      weeklyBudgetTokens: -1,
    });
    expect(neg.ok).toBe(false);
  });

  test("explicit capFraction override is honoured", () => {
    // 6 % is over the default 5.7 % cap but under an 8 % cap.
    const overDefault = checkMapeKBudgetCap({
      config: { weeklyProjectedTokens: 60_000 },
      weeklyBudgetTokens: WEEKLY_BUDGET,
    });
    expect(overDefault.ok).toBe(false);
    const underOverride = checkMapeKBudgetCap({
      config: { weeklyProjectedTokens: 60_000 },
      weeklyBudgetTokens: WEEKLY_BUDGET,
      capFraction: 0.08,
    });
    expect(underOverride.ok).toBe(true);
  });

  test("DEFAULT_CAP_FRACTION matches the ARCHITECTURE.md prose anchor (5.7 %)", () => {
    // Locks the constant so a silent edit to the default is a loud test
    // failure. The cap is *constitutional* (rule #10) — drift requires
    // an EXPERIMENT.yaml pivot, not a one-line PR.
    expect(DEFAULT_CAP_FRACTION).toBe(0.057);
  });
});

describe("readMapeKConfig (I/O boundary)", () => {
  /** @type {string} */
  let dir;

  beforeEach(() => {
    dir = join(tmpdir(), `mape-k-budget-cap-test-${process.pid}-${Date.now()}-${Math.random()}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("missing file (ENOENT) → null (dormant state)", () => {
    const result = readMapeKConfig(join(dir, "does-not-exist.json"));
    expect(result).toBeNull();
  });

  test("valid file → parsed config + budget", () => {
    const path = join(dir, "mape-k.json");
    writeFileSync(
      path,
      JSON.stringify({ weeklyProjectedTokens: 50_000, weeklyBudgetTokens: 1_000_000 }),
    );
    const result = readMapeKConfig(path);
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.weeklyBudgetTokens).toBe(1_000_000);
      expect(result.config.weeklyProjectedTokens).toBe(50_000);
    }
  });

  test("file present but missing weeklyBudgetTokens → throws (rule-#6 let-it-crash)", () => {
    const path = join(dir, "mape-k.json");
    writeFileSync(path, JSON.stringify({ weeklyProjectedTokens: 50_000 }));
    expect(() => readMapeKConfig(path)).toThrow(/weeklyBudgetTokens/);
  });

  test("file present but malformed JSON → throws", () => {
    const path = join(dir, "mape-k.json");
    writeFileSync(path, "{ not valid json");
    expect(() => readMapeKConfig(path)).toThrow();
  });

  test("file is a JSON array, not an object → throws", () => {
    const path = join(dir, "mape-k.json");
    writeFileSync(path, "[]");
    expect(() => readMapeKConfig(path)).toThrow(/JSON object/);
  });
});
