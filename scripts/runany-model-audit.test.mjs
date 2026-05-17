// Tests for runany-model-audit.mjs. Pattern: paired positive/negative
// fixtures over the pure scenario runners (Meszaros 2007); the decider
// seam (`resolveRunAnyModel`) is both stubbed (to prove the harness FAILs
// a broken decider) and wired to the real source export (to prove the
// task's three acceptance scenarios pass end-to-end).

import { describe, expect, test } from "vitest";

import { resolveRunAnyModel } from "@minsky/tick-loop";

import {
  ALL_DOWN_MIN_LOCAL_FRACTION,
  DYNAMIC_MIN_BANDED_CORRECT,
  PIN_MIN_PINNED_FRACTION,
  parseArgs,
  runAllDownScenario,
  runAudit,
  runDynamicScenario,
  runPinScenario,
} from "./runany-model-audit.mjs";

describe("pre-registered thresholds (transcribe the task Success line)", () => {
  test("pin = 100% pinned-model dispatch", () => {
    expect(PIN_MIN_PINNED_FRACTION).toBe(1.0);
  });
  test("dynamic = 100% banded-correct", () => {
    expect(DYNAMIC_MIN_BANDED_CORRECT).toBe(1.0);
  });
  test("all-down ≥95% local dispatch", () => {
    expect(ALL_DOWN_MIN_LOCAL_FRACTION).toBeCloseTo(0.95, 5);
  });
});

describe("parseArgs", () => {
  test("defaults to all scenarios, human output", () => {
    expect(parseArgs([])).toEqual({ scenario: "all", json: false });
  });
  test("--scenario=pin --json", () => {
    expect(parseArgs(["--scenario=pin", "--json"])).toEqual({ scenario: "pin", json: true });
  });
});

describe("scenario runners — real resolveRunAnyModel passes (acceptance)", () => {
  test("pin scenario passes", () => {
    const r = runPinScenario(resolveRunAnyModel);
    expect(r.pass).toBe(true);
    expect(r.metrics["pinnedFraction"]).toBe(1);
  });
  test("dynamic scenario passes", () => {
    const r = runDynamicScenario(resolveRunAnyModel);
    expect(r.pass).toBe(true);
    expect(r.metrics["bandedCorrect"]).toBe(1);
  });
  test("all-down scenario passes (≤1 iter to switch, ≥95% local, 0 wedge, recovers)", () => {
    const r = runAllDownScenario(resolveRunAnyModel);
    expect(r.pass).toBe(true);
    expect(r.metrics["itersToSwitch"]).toBeLessThanOrEqual(1);
    expect(r.metrics["localFraction"]).toBeGreaterThanOrEqual(0.95);
    expect(r.metrics["wedged"]).toBe(0);
    expect(r.metrics["recoveredToRemote"]).toBe(true);
  });
  test("runAudit('all') aggregates ok=true with the real decider", () => {
    const { ok, results } = runAudit(resolveRunAnyModel, "all");
    expect(ok).toBe(true);
    expect(results.map((x) => x.scenario).sort()).toEqual(["all-down", "dynamic", "pin"]);
  });
});

describe("scenario runners — a broken decider FAILs the harness (negative)", () => {
  // A decider that always returns claude-opus regardless of input must
  // fail every scenario (pin ignored, no budget tracking, never local).
  const brokenAlwaysOpus = () => ({
    model: "claude-opus-4-7",
    agent: "claude",
    source: "dynamic",
  });

  test("pin scenario fails (pin ignored)", () => {
    expect(runPinScenario(brokenAlwaysOpus).pass).toBe(false);
  });
  test("dynamic scenario fails (no budget tracking)", () => {
    expect(runDynamicScenario(brokenAlwaysOpus).pass).toBe(false);
  });
  test("all-down scenario fails (never switches to local)", () => {
    expect(runAllDownScenario(brokenAlwaysOpus).pass).toBe(false);
  });
  test("runAudit reports ok=false when any scenario fails", () => {
    expect(runAudit(brokenAlwaysOpus, "all").ok).toBe(false);
  });
  test("unknown scenario name is a non-pass result", () => {
    const { ok, results } = runAudit(resolveRunAnyModel, "bogus");
    expect(ok).toBe(false);
    expect(String(results[0]?.metrics?.["error"] ?? "")).toContain("unknown scenario");
  });
});
