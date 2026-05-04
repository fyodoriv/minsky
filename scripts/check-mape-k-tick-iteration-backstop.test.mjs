// Tests for check-mape-k-tick-iteration-backstop.mjs. Pattern:
// deterministic CI gate over a prose-only tick-iteration backstop integer
// — paired positive/negative fixtures (Meszaros 2007, *xUnit Test
// Patterns*) plus a dormant-on-missing-config case (rule #7 graceful
// degrade).

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  DEFAULT_EXPECTED_BACKSTOP,
  checkMapeKTickIterationBackstop,
  readMapeKConfig,
} from "./check-mape-k-tick-iteration-backstop.mjs";

describe("checkMapeKTickIterationBackstop (pure)", () => {
  test("at prose anchor 1000 → ok", () => {
    const result = checkMapeKTickIterationBackstop({
      config: { tick_iteration_backstop: 1000 },
    });
    expect(result.ok).toBe(true);
  });

  test("under prose anchor 500 → fail with reason naming both sides", () => {
    const result = checkMapeKTickIterationBackstop({
      config: { tick_iteration_backstop: 500 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("500");
      expect(result.reason).toContain("1000");
      expect(result.reason).toMatch(/ARCHITECTURE\.md/);
    }
  });

  test("over prose anchor 5000 → fail", () => {
    const result = checkMapeKTickIterationBackstop({
      config: { tick_iteration_backstop: 5000 },
    });
    expect(result.ok).toBe(false);
  });

  test("matching value under alternate field name `tick_iteration_backstop_ticks` → ok", () => {
    const result = checkMapeKTickIterationBackstop({
      config: { tick_iteration_backstop_ticks: 1000 },
    });
    expect(result.ok).toBe(true);
  });

  test("config with neither field → fail (malformed input)", () => {
    const result = checkMapeKTickIterationBackstop({ config: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/tick_iteration_backstop/);
    }
  });

  test("non-integer value → fail (malformed input)", () => {
    const result = checkMapeKTickIterationBackstop({
      config: { tick_iteration_backstop: 1000.5 },
    });
    expect(result.ok).toBe(false);
  });

  test("DEFAULT_EXPECTED_BACKSTOP matches the ARCHITECTURE.md prose anchor (1000)", () => {
    expect(DEFAULT_EXPECTED_BACKSTOP).toBe(1000);
  });
});

describe("readMapeKConfig (I/O boundary)", () => {
  /** @type {string} */
  let dir;

  beforeEach(() => {
    dir = join(tmpdir(), `mape-k-backstop-test-${process.pid}-${Date.now()}-${Math.random()}`);
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
    writeFileSync(path, JSON.stringify({ tick_iteration_backstop: 1000 }));
    const result = readMapeKConfig(path);
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.tick_iteration_backstop).toBe(1000);
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
