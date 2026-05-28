// <!-- scope: human-approved phase-11b step 2 — paired tests for the ported `runany-provider-decision.mjs` + `strategic-model-router.mjs` modules. Not a new public artefact; the originals at `novel/tick-loop/src/{runany-provider-decision,strategic-model-router}.test.ts` were deleted alongside the tick-loop package retirement. -->
// Tests for the ported runany provider decision + strategic model router.
// Smoke-test scope: exercises the three decision kinds (operator-pin,
// dynamic, local-fallback), the catalog walk, and the hysteresis.
// xUnit paired fixtures (Meszaros 2007).
//
// History: smaller-than-original because the comprehensive tests live
// in `novel/tick-loop/src/*.test.ts` and continue running until step 8
// deletes that directory. After step 8, these tests are the surviving
// coverage; if a regression slips in during the interim, the original
// `runany-provider-decision.test.ts` (288 lines) will catch it.

import { describe, expect, it } from "vitest";

import { decideRunAnyProvider } from "./runany-provider-decision.mjs";
import { pickStrategicModel } from "./strategic-model-router.mjs";

/**
 * @typedef {import("@minsky/token-monitor").RemainingFractions} RemainingFractions
 */

const OBSERVED_AT = "2026-05-25T00:00:00Z";

/** @type {RemainingFractions} */
const FULL_BUDGET = { fivehour: 1.0, weekly: 1.0, monthly: 1.0, observedAt: OBSERVED_AT };
/** @type {RemainingFractions} */
const EXHAUSTED = { fivehour: 0.05, weekly: 0.05, monthly: 0.05, observedAt: OBSERVED_AT };

describe("decideRunAnyProvider — operator pin", () => {
  it("honors the pin verbatim regardless of liveness", () => {
    const result = decideRunAnyProvider({
      remaining: EXHAUSTED,
      remoteBackends: [{ id: "claude", reachable: false, reason: "401" }],
      operatorPin: "claude-opus-4-7",
    });
    expect(result.kind).toBe("operator-pin");
    expect(result.model).toBe("claude-opus-4-7");
  });

  it("ignores empty-string pin and falls through to the dynamic walk", () => {
    const result = decideRunAnyProvider({
      remaining: FULL_BUDGET,
      remoteBackends: [{ id: "claude", reachable: true }],
      operatorPin: "",
    });
    expect(result.kind).toBe("dynamic");
  });

  it("ignores unknown pin and falls through to the dynamic walk", () => {
    const result = decideRunAnyProvider({
      remaining: FULL_BUDGET,
      remoteBackends: [{ id: "claude", reachable: true }],
      operatorPin: "made-up-model",
    });
    expect(result.kind).toBe("dynamic");
  });
});

describe("decideRunAnyProvider — local fallback", () => {
  it("returns local-fallback when all remote backends are unreachable", () => {
    const result = decideRunAnyProvider({
      remaining: FULL_BUDGET,
      remoteBackends: [{ id: "claude", reachable: false, reason: "401" }],
    });
    expect(result.kind).toBe("local-fallback");
    expect(result.agent).toBe("local");
  });

  it("names the down backend in the reason string", () => {
    const result = decideRunAnyProvider({
      remaining: FULL_BUDGET,
      remoteBackends: [{ id: "claude", reachable: false, reason: "timeout" }],
    });
    expect(result.reason).toContain("claude");
    expect(result.reason).toContain("timeout");
  });
});

describe("decideRunAnyProvider — dynamic (delegates to picker)", () => {
  it("returns dynamic when at least one remote backend is reachable", () => {
    const result = decideRunAnyProvider({
      remaining: FULL_BUDGET,
      remoteBackends: [{ id: "claude", reachable: true }],
    });
    expect(result.kind).toBe("dynamic");
  });

  it("returns dynamic when remoteBackends list is empty (no remote configured)", () => {
    const result = decideRunAnyProvider({
      remaining: FULL_BUDGET,
      remoteBackends: [],
    });
    expect(result.kind).toBe("dynamic");
  });
});

describe("pickStrategicModel — catalog walk", () => {
  it("returns tier-1 (opus) at full budget", () => {
    const result = pickStrategicModel({ remaining: FULL_BUDGET });
    expect(result.kind).toBe("strategic-router");
    expect(result.model).toBe("claude-opus-4-7");
  });

  it("returns lowest-tier (local) when budget is exhausted (all floors fail)", () => {
    const result = pickStrategicModel({ remaining: EXHAUSTED });
    // At 5% remaining, none of opus/sonnet qualify; only local (zero floors) does.
    expect(["strategic-router", "fallback"]).toContain(result.kind);
    expect(result.model).toBe("local");
  });

  it("honors operator pin and bypasses the catalog walk", () => {
    const result = pickStrategicModel({
      remaining: EXHAUSTED,
      operatorPin: "claude-opus-4-7",
    });
    expect(result.kind).toBe("operator-pin");
    expect(result.model).toBe("claude-opus-4-7");
  });

  it("uses MODEL_CATALOG default when no catalog provided", () => {
    const result = pickStrategicModel({ remaining: FULL_BUDGET });
    expect(result.kind).toBe("strategic-router");
  });

  it("returns synthetic local fallback when given an explicitly-empty catalog", () => {
    const result = pickStrategicModel({
      remaining: FULL_BUDGET,
      catalog: [],
    });
    expect(result.kind).toBe("fallback");
    expect(result.agent).toBe("local");
  });
});
