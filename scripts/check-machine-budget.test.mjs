// Tests for check-machine-budget.mjs. Pattern: deterministic CI gate
// over the operator machine-budget contract — paired positive/negative
// fixtures (Meszaros 2007, *xUnit Test Patterns*) plus the empirically-
// motivated `ProcessType=Background` regression case (operator directive
// 2026-05-17 — the worker plist once shipped Background, making the
// budget unreachable).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  TRIVIAL_BUDGET_PCT,
  checkMachineBudget,
  readLaunchdPlists,
} from "./check-machine-budget.mjs";

/** Minimal controller source that satisfies all three contract checks. */
const GOOD_CONTROLLER = `
export function resolveMachineBudgetPct(env) { return env; }
export const MACHINE_BUDGET_POLICY = Object.freeze({
  defaultBudgetPct: 70,
  swarmMaxBudgetPct: 80,
});
export function computeWorkerTarget(state) { return state; }
`;

/** Minimal test source covering the three pre-registered suites. */
const GOOD_CONTROLLER_TEST = `
describe("computeWorkerTarget — ramp-up", () => {});
describe("computeWorkerTarget — knee detection", () => {});
describe("computeWorkerTarget — gridlock backoff", () => {});
`;

/**
 * @param {string} label
 * @param {string} [processType]
 * @returns {string}
 */
const PLIST = (label, processType) =>
  `<plist><dict>
    <key>Label</key><string>${label}</string>
    ${processType ? `<key>ProcessType</key><string>${processType}</string>` : ""}
  </dict></plist>`;

describe("checkMachineBudget (pure)", () => {
  test("good controller + clean plists → ok", () => {
    const result = checkMachineBudget({
      controllerSource: GOOD_CONTROLLER,
      controllerTestSource: GOOD_CONTROLLER_TEST,
      plists: [{ path: "tick-loop.plist", text: PLIST("com.minsky.tick-loop") }],
    });
    expect(result.ok).toBe(true);
  });

  test("ProcessType=Background on a tick-loop plist → hard fail naming launchd", () => {
    const result = checkMachineBudget({
      controllerSource: GOOD_CONTROLLER,
      controllerTestSource: GOOD_CONTROLLER_TEST,
      plists: [
        { path: "com.minsky.tick-loop.plist", text: PLIST("com.minsky.tick-loop", "Background") },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.join("\n")).toContain("com.minsky.tick-loop.plist");
      expect(result.reasons.join("\n")).toMatch(/Background/);
      expect(result.reasons.join("\n")).toMatch(/launchd\.plist|unreachable/);
    }
  });

  test("ProcessType=Standard on a tick-loop plist → ok (the in-session stopgap)", () => {
    const result = checkMachineBudget({
      controllerSource: GOOD_CONTROLLER,
      controllerTestSource: GOOD_CONTROLLER_TEST,
      plists: [{ path: "tick-loop.plist", text: PLIST("com.minsky.tick-loop", "Standard") }],
    });
    expect(result.ok).toBe(true);
  });

  test("Background on a NON-minsky helper plist → ignored (only worker/tick-loop plists count)", () => {
    const result = checkMachineBudget({
      controllerSource: GOOD_CONTROLLER,
      controllerTestSource: GOOD_CONTROLLER_TEST,
      plists: [
        { path: "com.example.helper.plist", text: PLIST("com.example.helper", "Background") },
      ],
    });
    expect(result.ok).toBe(true);
  });

  test("absent ProcessType key → ok (launchd default is non-throttled)", () => {
    const result = checkMachineBudget({
      controllerSource: GOOD_CONTROLLER,
      controllerTestSource: GOOD_CONTROLLER_TEST,
      plists: [{ path: "com.minsky.tick-loop.plist", text: PLIST("com.minsky.tick-loop") }],
    });
    expect(result.ok).toBe(true);
  });

  test("missing resolveMachineBudgetPct export → fail (budget stops being parsed)", () => {
    const result = checkMachineBudget({
      controllerSource: GOOD_CONTROLLER.replace("resolveMachineBudgetPct", "resolveSomethingElse"),
      controllerTestSource: GOOD_CONTROLLER_TEST,
      plists: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.join("\n")).toMatch(/resolveMachineBudgetPct/);
  });

  test("defaultBudgetPct drifted off 70 → fail (vision.md rule #15 default)", () => {
    const result = checkMachineBudget({
      controllerSource: GOOD_CONTROLLER.replace("defaultBudgetPct: 70", "defaultBudgetPct: 50"),
      controllerTestSource: GOOD_CONTROLLER_TEST,
      plists: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.join("\n")).toMatch(/defaultBudgetPct/);
  });

  test("swarmMaxBudgetPct drifted off 80 → fail (operator swarm ceiling)", () => {
    const result = checkMachineBudget({
      controllerSource: GOOD_CONTROLLER.replace("swarmMaxBudgetPct: 80", "swarmMaxBudgetPct: 95"),
      controllerTestSource: GOOD_CONTROLLER_TEST,
      plists: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.join("\n")).toMatch(/swarmMaxBudgetPct/);
  });

  test("a deleted pre-registered behaviour suite → fail naming the suite (rule #9)", () => {
    const result = checkMachineBudget({
      controllerSource: GOOD_CONTROLLER,
      controllerTestSource: GOOD_CONTROLLER_TEST.replace("gridlock backoff", "something-else"),
      plists: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.join("\n")).toMatch(/gridlock backoff/);
  });

  test("null source → fail with the documented CLI-owns-dormant message", () => {
    const result = checkMachineBudget({
      controllerSource: null,
      controllerTestSource: null,
      plists: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.reasons.join("\n")).toMatch(/dormant short-circuit lives in the CLI/);
  });

  test("TRIVIAL_BUDGET_PCT is exported and low enough that the 70 default is non-trivial", () => {
    expect(TRIVIAL_BUDGET_PCT).toBeLessThan(70);
  });
});

describe("readLaunchdPlists (I/O)", () => {
  /** @type {string} */
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mbudget-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns [] when the directory is absent (dormant-friendly)", () => {
    expect(readLaunchdPlists(join(dir, "does-not-exist"))).toEqual([]);
  });

  test("reads only .plist files and carries their text", () => {
    writeFileSync(join(dir, "com.minsky.tick-loop.plist"), PLIST("com.minsky.tick-loop"));
    writeFileSync(join(dir, "README.md"), "not a plist");
    const plists = readLaunchdPlists(dir);
    expect(plists).toHaveLength(1);
    expect(plists[0]?.text).toMatch(/com\.minsky\.tick-loop/);
  });
});
