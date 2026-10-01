// Tests for check-cadence-pivot-threshold.mjs. Pattern: deterministic
// CI gate over a prose-only cadence-pivot threshold fraction. Paired
// positive/negative fixtures (Meszaros 2007, *xUnit Test Patterns*) plus
// dormant-on-missing-config (rule #7 graceful degrade).

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  checkCadencePivotThreshold,
  DEFAULT_EXPECTED_PCT,
  readMapeKConfig,
} from "./check-cadence-pivot-threshold.mjs";

describe("checkCadencePivotThreshold (pure)", () => {
  test("at prose anchor 8 % → ok", () => {
    const result = checkCadencePivotThreshold({
      config: { cadence_pivot_threshold_pct: 8 },
    });
    expect(result.ok).toBe(true);
  });

  test("under prose anchor 5 % → fail with reason naming both sides", () => {
    const result = checkCadencePivotThreshold({
      config: { cadence_pivot_threshold_pct: 5 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("5 %");
      expect(result.reason).toContain("8 %");
      expect(result.reason).toMatch(/research\.md/);
    }
  });

  test("over prose anchor 10 % → fail", () => {
    const result = checkCadencePivotThreshold({
      config: { cadence_pivot_threshold_pct: 10 },
    });
    expect(result.ok).toBe(false);
  });

  test("matching fraction 0.08 under alternate field name `cadence_pivot_spend_fraction` → ok", () => {
    const result = checkCadencePivotThreshold({
      config: { cadence_pivot_spend_fraction: 0.08 },
    });
    expect(result.ok).toBe(true);
  });

  test("drift fraction 0.05 under alternate field name → fail", () => {
    const result = checkCadencePivotThreshold({
      config: { cadence_pivot_spend_fraction: 0.05 },
    });
    expect(result.ok).toBe(false);
  });

  test("config with neither field → fail (malformed input)", () => {
    const result = checkCadencePivotThreshold({ config: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/cadence_pivot/);
    }
  });

  test("zero or non-finite fraction → fail (malformed input)", () => {
    const zero = checkCadencePivotThreshold({
      config: { cadence_pivot_spend_fraction: 0 },
    });
    expect(zero.ok).toBe(false);
    const ge1 = checkCadencePivotThreshold({
      config: { cadence_pivot_spend_fraction: 1 },
    });
    expect(ge1.ok).toBe(false);
  });

  test("DEFAULT_EXPECTED_PCT matches the research.md prose anchor (8)", () => {
    expect(DEFAULT_EXPECTED_PCT).toBe(8);
  });
});

describe("readMapeKConfig (I/O boundary)", () => {
  /** @type {string} */
  let dir;

  beforeEach(() => {
    dir = join(tmpdir(), `cadence-pivot-test-${process.pid}-${Date.now()}-${Math.random()}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("missing file (ENOENT) → null (dormant state)", () => {
    const result = readMapeKConfig(join(dir, "does-not-exist.json"));
    expect(result).toBeNull();
  });

  test("valid file → parsed config", () => {
    const path = join(dir, "mape-k.json");
    writeFileSync(path, JSON.stringify({ cadence_pivot_threshold_pct: 8 }));
    const result = readMapeKConfig(path);
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.cadence_pivot_threshold_pct).toBe(8);
    }
  });

  test("malformed JSON → throws (rule-#6 let-it-crash)", () => {
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
