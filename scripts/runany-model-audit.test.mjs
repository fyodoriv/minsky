// Tests for runany-model-audit.mjs. Pattern: paired positive/negative
// fixtures over the pure scenario runner (Meszaros 2007); the decider seam
// is injected so the harness runs end-to-end against both the real shipped
// `decideRunAnyProvider` and a mutant decider that violates each
// pre-registered threshold (proving the audit actually fails-closed —
// rule #10: a regression must become an exit-1 gate break, not a green run).

import { describe, expect, test } from "vitest";

import {
  ALLDOWN_LOCAL_MIN,
  ALLDOWN_MAX_SWITCH_ITERS,
  PIN_DISPATCH_MIN,
  parseArgs,
  runScenario,
  SCENARIOS,
  summarize,
  tierOf,
  WEDGED_MAX,
} from "./runany-model-audit.mjs";

describe("pre-registered constants match the TASKS.md Success line", () => {
  test("pin dispatch threshold is 100%", () => {
    expect(PIN_DISPATCH_MIN).toBe(1.0);
  });
  test("all-down local-dispatch threshold is 95%", () => {
    expect(ALLDOWN_LOCAL_MIN).toBeCloseTo(0.95, 5);
  });
  test("all-down switch budget is ≤1 iteration", () => {
    expect(ALLDOWN_MAX_SWITCH_ITERS).toBe(1);
  });
  test("wedged-iteration budget is 0", () => {
    expect(WEDGED_MAX).toBe(0);
  });
  test("the three pre-registered scenarios are exactly pin|dynamic|all-down", () => {
    expect([...SCENARIOS]).toEqual(["pin", "dynamic", "all-down"]);
  });
});

describe("real shipped decider passes every pre-registered scenario", () => {
  for (const s of SCENARIOS) {
    test(`scenario=${s} → ok:true against decideRunAnyProvider`, () => {
      const r = runScenario(s);
      expect(r.ok).toBe(true);
      expect(r.scenario).toBe(s);
    });
  }

  test("pin: 100% pinned dispatch, 0 wedged", () => {
    const r = runScenario("pin");
    expect(r.metrics.pinnedRate).toBe(1.0);
    expect(r.metrics.wedged).toBe(0);
  });

  test("dynamic: tiers monotone non-decreasing, top tier-1, bottom local", () => {
    const r = runScenario("dynamic");
    expect(r.metrics.monotone).toBe(true);
    expect(r.metrics.topIsTier1).toBe(true);
    expect(r.metrics.bottomIsLocal).toBe(true);
  });

  test("all-down: switches within ≤1 iteration, ≥95% local, 0 wedged", () => {
    const r = runScenario("all-down");
    expect(r.metrics.switchIters).toBeLessThanOrEqual(ALLDOWN_MAX_SWITCH_ITERS);
    expect(r.metrics.localRate).toBeGreaterThanOrEqual(ALLDOWN_LOCAL_MIN);
    expect(r.metrics.wedged).toBe(0);
  });
});

describe("the audit fails-closed when the decider regresses (negative fixtures)", () => {
  test("pin: a decider that ignores the pin → ok:false", () => {
    const ignorePin = () => ({
      model: "claude-opus-4-7",
      agent: "claude",
      kind: "dynamic",
      reason: "mutant: ignored the pin",
    });
    expect(runScenario("pin", { decide: ignorePin }).ok).toBe(false);
  });

  test("all-down: a decider that never switches to local → ok:false", () => {
    const neverLocal = () => ({
      model: "claude-opus-4-7",
      agent: "claude",
      kind: "dynamic",
      reason: "mutant: stuck on remote while all backends are down",
    });
    expect(runScenario("all-down", { decide: neverLocal }).ok).toBe(false);
  });

  test("any scenario: a wedged (unknown-kind) decider → ok:false", () => {
    const wedged = () => ({ model: "", agent: "?", kind: "hold", reason: "mutant: wedged" });
    expect(runScenario("pin", { decide: wedged }).ok).toBe(false);
    expect(runScenario("dynamic", { decide: wedged }).ok).toBe(false);
    expect(runScenario("all-down", { decide: wedged }).ok).toBe(false);
  });

  test("dynamic: a decider whose quality IMPROVES as budget drops → ok:false", () => {
    // Returns a better tier as remaining shrinks — violates the monotone
    // budget-correlation contract.
    let call = 0;
    const inverted = () => {
      const ladder = ["local", "local", "claude-sonnet-4-6", "claude-opus-4-7"];
      const model = ladder[Math.min(call++, ladder.length - 1)] ?? "local";
      return { model, agent: model === "local" ? "local" : "claude", kind: "dynamic", reason: "x" };
    };
    expect(runScenario("dynamic", { decide: inverted }).ok).toBe(false);
  });
});

describe("tierOf", () => {
  test("maps a known catalog model to its qualityTier", () => {
    expect(tierOf("claude-opus-4-7")).toBe(1);
    expect(tierOf("claude-sonnet-4-6")).toBe(2);
    expect(tierOf("local")).toBe(3);
  });
  test("unknown model → +Infinity (sorts as lowest quality)", () => {
    expect(tierOf("not-a-model")).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("parseArgs", () => {
  test("no --scenario → all three scenarios, human output", () => {
    expect(parseArgs([])).toEqual({ scenarios: ["pin", "dynamic", "all-down"], json: false });
  });
  test("--scenario=all --json → all three, json", () => {
    expect(parseArgs(["--scenario=all", "--json"])).toEqual({
      scenarios: ["pin", "dynamic", "all-down"],
      json: true,
    });
  });
  test("--scenario=dynamic → just that one", () => {
    expect(parseArgs(["--scenario=dynamic"])).toEqual({ scenarios: ["dynamic"], json: false });
  });
  test("unknown scenario throws", () => {
    expect(() => parseArgs(["--scenario=bogus"])).toThrow(/unknown --scenario/);
  });
});

describe("summarize", () => {
  test("PASS verdict for an ok result, FAIL otherwise", () => {
    expect(
      summarize({ scenario: "pin", ok: true, metrics: {}, thresholds: {}, iterations: [] }),
    ).toContain("PASS");
    expect(
      summarize({ scenario: "pin", ok: false, metrics: {}, thresholds: {}, iterations: [] }),
    ).toContain("FAIL");
  });
});

describe("runScenario guards", () => {
  test("unknown scenario throws", () => {
    expect(() => runScenario("nope")).toThrow(/unknown scenario/);
  });
});
