// Tests for check-tick-loop-backoff-schedule.mjs. Pattern: deterministic
// CI gate over a prose-only restart-backoff schedule — paired
// positive/negative fixtures (Meszaros 2007, *xUnit Test Patterns*) plus
// a dormant-on-missing-config case (rule #7 graceful degrade).

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  checkTickLoopBackoffSchedule,
  DEFAULT_EXPECTED_SCHEDULE,
  readTickLoopConfig,
} from "./check-tick-loop-backoff-schedule.mjs";

describe("checkTickLoopBackoffSchedule (pure)", () => {
  test("matching schedule [5, 30, 300] → ok", () => {
    const result = checkTickLoopBackoffSchedule({
      config: { backoff_schedule: [5, 30, 300] },
    });
    expect(result.ok).toBe(true);
  });

  test("drift under prose anchor [1, 5, 60] → fail with reason naming both sides", () => {
    const result = checkTickLoopBackoffSchedule({
      config: { backoff_schedule: [1, 5, 60] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("[1,5,60]");
      expect(result.reason).toContain("[5,30,300]");
      expect(result.reason).toMatch(/ARCHITECTURE\.md/);
    }
  });

  test("drift over prose anchor [10, 60, 600] → fail", () => {
    const result = checkTickLoopBackoffSchedule({
      config: { backoff_schedule: [10, 60, 600] },
    });
    expect(result.ok).toBe(false);
  });

  test("matching schedule under alternate field name `backoff_schedule_seconds` → ok", () => {
    const result = checkTickLoopBackoffSchedule({
      config: { backoff_schedule_seconds: [5, 30, 300] },
    });
    expect(result.ok).toBe(true);
  });

  test("config with neither field → fail (malformed input)", () => {
    const result = checkTickLoopBackoffSchedule({ config: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/backoff_schedule/);
    }
  });

  test("non-numeric array entries → fail (malformed input)", () => {
    const result = checkTickLoopBackoffSchedule({
      config: { backoff_schedule: [5, "30", 300] },
    });
    expect(result.ok).toBe(false);
  });

  test("DEFAULT_EXPECTED_SCHEDULE matches the ARCHITECTURE.md prose anchor", () => {
    expect(Array.from(DEFAULT_EXPECTED_SCHEDULE)).toEqual([5, 30, 300]);
  });
});

describe("readTickLoopConfig (I/O boundary)", () => {
  /** @type {string} */
  let dir;

  beforeEach(() => {
    dir = join(tmpdir(), `tick-loop-backoff-test-${process.pid}-${Date.now()}-${Math.random()}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("missing file (ENOENT) → null (dormant state)", () => {
    const result = readTickLoopConfig(join(dir, "does-not-exist.json"));
    expect(result).toBeNull();
  });

  test("valid file → parsed config", () => {
    const path = join(dir, "tick-loop.json");
    writeFileSync(path, JSON.stringify({ backoff_schedule: [5, 30, 300] }));
    const result = readTickLoopConfig(path);
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.backoff_schedule).toEqual([5, 30, 300]);
    }
  });

  test("malformed JSON → throws (rule-#6 let-it-crash)", () => {
    const path = join(dir, "tick-loop.json");
    writeFileSync(path, "{ not valid json");
    expect(() => readTickLoopConfig(path)).toThrow();
  });

  test("file is a JSON array, not an object → throws", () => {
    const path = join(dir, "tick-loop.json");
    writeFileSync(path, "[]");
    expect(() => readTickLoopConfig(path)).toThrow(/JSON object/);
  });
});
