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

import {
  DEFAULT_RECOVER_DWELL_MS,
  DEFAULT_RECOVER_GOOD_PROBES,
  decideRecoverFlipBack,
  decideRunAnyProvider,
} from "./runany-provider-decision.mjs";
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
      operatorPin: "claude-sonnet-4-6",
    });
    expect(result.kind).toBe("operator-pin");
    expect(result.model).toBe("claude-sonnet-4-6");
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
  it("returns tier-1 (sonnet-4-6, the canonical worker model) at full budget", () => {
    const result = pickStrategicModel({ remaining: FULL_BUDGET });
    expect(result.kind).toBe("strategic-router");
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("returns lowest-tier (local) when budget is exhausted (all floors fail)", () => {
    const result = pickStrategicModel({ remaining: EXHAUSTED });
    // At 5% remaining, sonnet does not qualify; only local (zero floors) does.
    expect(["strategic-router", "fallback"]).toContain(result.kind);
    expect(result.model).toBe("local");
  });

  it("honors operator pin and bypasses the catalog walk", () => {
    const result = pickStrategicModel({
      remaining: EXHAUSTED,
      operatorPin: "claude-sonnet-4-6",
    });
    expect(result.kind).toBe("operator-pin");
    expect(result.model).toBe("claude-sonnet-4-6");
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

describe("decideRecoverFlipBack — anti-flap dwell + N-consecutive-good", () => {
  const T0 = 1_000_000;

  it("no-ops when the run is already on remote", () => {
    const r = decideRecoverFlipBack({
      currentMode: "remote",
      probeOk: true,
      nowMs: T0 + DEFAULT_RECOVER_DWELL_MS + 1,
      localSinceMs: T0 - 999_999,
    });
    expect(r.flipBack).toBe(false);
    expect(r.reason).toBe("not-on-local");
  });

  it("holds local until the minimum dwell elapses, even with a good probe", () => {
    const r = decideRecoverFlipBack({
      currentMode: "local",
      probeOk: true,
      nowMs: T0 + 1_000, // only 1s on local
      localSinceMs: T0,
      goodProbesNeeded: 1,
    });
    expect(r.flipBack).toBe(false);
    expect(r.reason).toBe("dwell-not-elapsed");
    // The good probe still accrues so the counter survives the dwell window.
    expect(r.goodProbes).toBe(1);
  });

  it("holds local until N consecutive good probes accrue (single good probe insufficient)", () => {
    const past = T0 - DEFAULT_RECOVER_DWELL_MS - 1; // dwell satisfied
    const r = decideRecoverFlipBack({
      currentMode: "local",
      probeOk: true,
      nowMs: T0,
      localSinceMs: past,
      goodProbesNeeded: 2,
      priorGoodProbes: 0,
    });
    expect(r.flipBack).toBe(false);
    expect(r.reason).toBe("awaiting-consecutive-good-probes");
    expect(r.goodProbes).toBe(1);
  });

  it("flips back once dwell AND N consecutive good probes both hold", () => {
    const past = T0 - DEFAULT_RECOVER_DWELL_MS - 1;
    const r = decideRecoverFlipBack({
      currentMode: "local",
      probeOk: true,
      nowMs: T0,
      localSinceMs: past,
      goodProbesNeeded: 2,
      priorGoodProbes: 1, // this probe is the 2nd consecutive good
    });
    expect(r.flipBack).toBe(true);
    expect(r.reason).toContain("recover-flip-back");
    // Counter is consumed on flip so the next local cycle starts fresh.
    expect(r.goodProbes).toBe(0);
  });

  it("uses the documented defaults when dwell/goodProbesNeeded are omitted", () => {
    const past = T0 - DEFAULT_RECOVER_DWELL_MS - 1;
    const r = decideRecoverFlipBack({
      currentMode: "local",
      probeOk: true,
      nowMs: T0,
      localSinceMs: past,
      priorGoodProbes: DEFAULT_RECOVER_GOOD_PROBES - 1,
    });
    expect(r.flipBack).toBe(true);
  });
});

describe("decideRecoverFlipBack — transient-fail-no-flip", () => {
  const T0 = 1_000_000;

  it("a bad probe resets the consecutive-good counter to 0 and never flips", () => {
    const past = T0 - DEFAULT_RECOVER_DWELL_MS - 1;
    const r = decideRecoverFlipBack({
      currentMode: "local",
      probeOk: false,
      nowMs: T0,
      localSinceMs: past,
      goodProbesNeeded: 2,
      priorGoodProbes: 1, // had 1 good probe; this bad one wipes it
    });
    expect(r.flipBack).toBe(false);
    expect(r.reason).toBe("probe-bad-reset");
    expect(r.goodProbes).toBe(0);
  });

  it("a good→bad→good sequence does NOT reach 2-consecutive (no flip on the bad)", () => {
    const past = T0 - DEFAULT_RECOVER_DWELL_MS - 1;
    // good (1)
    const g1 = decideRecoverFlipBack({
      currentMode: "local",
      probeOk: true,
      nowMs: T0,
      localSinceMs: past,
      goodProbesNeeded: 2,
      priorGoodProbes: 0,
    });
    expect(g1.goodProbes).toBe(1);
    expect(g1.flipBack).toBe(false);
    // bad → reset to 0
    const b = decideRecoverFlipBack({
      currentMode: "local",
      probeOk: false,
      nowMs: T0 + 1,
      localSinceMs: past,
      goodProbesNeeded: 2,
      priorGoodProbes: g1.goodProbes,
    });
    expect(b.goodProbes).toBe(0);
    expect(b.flipBack).toBe(false);
    // good again → only 1 consecutive, still no flip
    const g2 = decideRecoverFlipBack({
      currentMode: "local",
      probeOk: true,
      nowMs: T0 + 2,
      localSinceMs: past,
      goodProbesNeeded: 2,
      priorGoodProbes: b.goodProbes,
    });
    expect(g2.goodProbes).toBe(1);
    expect(g2.flipBack).toBe(false);
  });

  it("treats localSinceMs<=0 (never dropped) as dwell-not-elapsed, never flips", () => {
    const r = decideRecoverFlipBack({
      currentMode: "local",
      probeOk: true,
      nowMs: T0,
      localSinceMs: 0,
      goodProbesNeeded: 1,
    });
    expect(r.flipBack).toBe(false);
    expect(r.reason).toBe("dwell-not-elapsed");
  });
});
