// Tests for check-mape-k-watchdog-cadence.mjs. Pattern: deterministic
// CI gate over a prose-only watchdog cadence (hours). Paired
// positive/negative fixtures (Meszaros 2007, *xUnit Test Patterns*) plus
// dormant-on-missing-config (rule #7 graceful degrade).

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  checkMapeKWatchdogCadence,
  DEFAULT_EXPECTED_HOURS,
  readMapeKConfig,
} from "./check-mape-k-watchdog-cadence.mjs";

describe("checkMapeKWatchdogCadence (pure)", () => {
  test("at prose anchor 12 → ok", () => {
    const result = checkMapeKWatchdogCadence({
      config: { watchdog_hours: 12 },
    });
    expect(result.ok).toBe(true);
  });

  test("under prose anchor 6 → fail with reason naming both sides", () => {
    const result = checkMapeKWatchdogCadence({
      config: { watchdog_hours: 6 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("6 h");
      expect(result.reason).toContain("12 h");
      expect(result.reason).toMatch(/ARCHITECTURE\.md/);
    }
  });

  test("over prose anchor 24 → fail", () => {
    const result = checkMapeKWatchdogCadence({
      config: { watchdog_hours: 24 },
    });
    expect(result.ok).toBe(false);
  });

  test("matching value under alternate field name `watchdog_period_hours` → ok", () => {
    const result = checkMapeKWatchdogCadence({
      config: { watchdog_period_hours: 12 },
    });
    expect(result.ok).toBe(true);
  });

  test("config with neither field → fail (malformed input)", () => {
    const result = checkMapeKWatchdogCadence({ config: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/watchdog_hours/);
    }
  });

  test("zero or negative value → fail (malformed input)", () => {
    const zero = checkMapeKWatchdogCadence({
      config: { watchdog_hours: 0 },
    });
    expect(zero.ok).toBe(false);
    const neg = checkMapeKWatchdogCadence({
      config: { watchdog_hours: -12 },
    });
    expect(neg.ok).toBe(false);
  });

  test("DEFAULT_EXPECTED_HOURS matches the ARCHITECTURE.md prose anchor (12)", () => {
    expect(DEFAULT_EXPECTED_HOURS).toBe(12);
  });
});

describe("readMapeKConfig (I/O boundary)", () => {
  /** @type {string} */
  let dir;

  beforeEach(() => {
    dir = join(tmpdir(), `mape-k-watchdog-test-${process.pid}-${Date.now()}-${Math.random()}`);
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
    writeFileSync(path, JSON.stringify({ watchdog_hours: 12 }));
    const result = readMapeKConfig(path);
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.watchdog_hours).toBe(12);
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
