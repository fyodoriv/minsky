/**
 * Tests for `@minsky/tick-loop/strategic-model-router` — slice 4 of
 * `claude-usage-aware-strategic-model-router`.
 *
 * Coverage strategy: per-tier × per-window × hysteresis-cross × edge.
 * Target ≥30 paired tests.
 */

import type { RemainingFractions } from "@minsky/token-monitor";
import { describe, expect, it } from "vitest";

import { MODEL_CATALOG, type ModelCatalogEntry } from "./model-catalog.js";
import { pickStrategicModel } from "./strategic-model-router.js";

function mkRemaining(overrides: Partial<RemainingFractions> = {}): RemainingFractions {
  return {
    fivehour: 1,
    weekly: 1,
    monthly: 1,
    observedAt: "2026-05-10T00:00:00Z",
    ...overrides,
  };
}

describe("pickStrategicModel — tier selection (default catalog)", () => {
  it("returns claude-opus-4-7 when all windows are full", () => {
    const out = pickStrategicModel({ remaining: mkRemaining() });
    expect(out.model).toBe("claude-opus-4-7");
    expect(out.agent).toBe("claude");
    expect(out.kind).toBe("strategic-router");
  });

  it("returns claude-opus-4-7 at exactly 5h=0.50 (boundary)", () => {
    const out = pickStrategicModel({
      remaining: mkRemaining({ fivehour: 0.5, weekly: 0.5, monthly: 0.5 }),
    });
    expect(out.model).toBe("claude-opus-4-7");
  });

  it("downgrades to claude-sonnet-4-6 at 5h=0.49", () => {
    const out = pickStrategicModel({
      remaining: mkRemaining({ fivehour: 0.49, weekly: 0.5, monthly: 0.5 }),
    });
    expect(out.model).toBe("claude-sonnet-4-6");
  });

  it("downgrades to claude-sonnet-4-6 at 5h=0.30 (boundary of next tier)", () => {
    const out = pickStrategicModel({
      remaining: mkRemaining({ fivehour: 0.3, weekly: 0.3, monthly: 0.3 }),
    });
    expect(out.model).toBe("claude-sonnet-4-6");
  });

  it("downgrades to local at 5h=0.29 (skips Haiku — operator 2026-05-10 directive)", () => {
    const out = pickStrategicModel({
      remaining: mkRemaining({ fivehour: 0.29, weekly: 0.3, monthly: 0.3 }),
    });
    expect(out.model).toBe("local");
    expect(out.agent).toBe("local");
  });

  it("downgrades to local at 5h=0.10 (Haiku absent from catalog)", () => {
    const out = pickStrategicModel({
      remaining: mkRemaining({ fivehour: 0.1, weekly: 0.1, monthly: 0.05 }),
    });
    expect(out.model).toBe("local");
  });

  it("downgrades to local at 5h=0.09", () => {
    const out = pickStrategicModel({
      remaining: mkRemaining({ fivehour: 0.09, weekly: 0.1, monthly: 0.05 }),
    });
    expect(out.model).toBe("local");
    expect(out.agent).toBe("local");
  });

  it("returns local when all windows are exhausted (0.0)", () => {
    const out = pickStrategicModel({
      remaining: mkRemaining({ fivehour: 0, weekly: 0, monthly: 0 }),
    });
    expect(out.model).toBe("local");
  });
});

describe("pickStrategicModel — most-restrictive-window wins", () => {
  it("downgrades when WEEKLY blocks even though 5h is full (Opus floor=30% weekly)", () => {
    const out = pickStrategicModel({
      remaining: mkRemaining({ fivehour: 1, weekly: 0.25, monthly: 0.5 }),
    });
    // weekly 0.25 < opus floor 0.3 → opus blocked → sonnet (weekly floor 0.2)
    expect(out.model).toBe("claude-sonnet-4-6");
  });

  it("downgrades when MONTHLY blocks (Opus floor=20% monthly)", () => {
    const out = pickStrategicModel({
      remaining: mkRemaining({ fivehour: 1, weekly: 1, monthly: 0.18 }),
    });
    // monthly 0.18 < opus floor 0.20 → opus blocked → sonnet (monthly floor 0.15)
    expect(out.model).toBe("claude-sonnet-4-6");
  });

  it("returns lowest-tier (local) when ALL windows below sonnet floors", () => {
    const out = pickStrategicModel({
      remaining: mkRemaining({ fivehour: 0.05, weekly: 0.05, monthly: 0 }),
    });
    expect(out.model).toBe("local");
  });
});

describe("pickStrategicModel — operator pin", () => {
  it("returns the pinned model regardless of remaining when pin is in catalog", () => {
    const out = pickStrategicModel({
      remaining: mkRemaining(),
      operatorPin: "claude-sonnet-4-6",
    });
    expect(out.model).toBe("claude-sonnet-4-6");
    expect(out.kind).toBe("operator-pin");
    expect(out.reason).toContain("MINSKY_STRATEGIC_PIN_MODEL");
  });

  it("operator-pin to claude-haiku-4-5 falls through (Haiku not in catalog) — picker returns best-fit instead", () => {
    const out = pickStrategicModel({
      remaining: mkRemaining(),
      operatorPin: "claude-haiku-4-5",
    });
    expect(out.model).toBe("claude-opus-4-7");
    expect(out.kind).toBe("strategic-router");
  });

  it("falls through to normal walk when pin is not in catalog", () => {
    const out = pickStrategicModel({
      remaining: mkRemaining(),
      operatorPin: "claude-fictional-99",
    });
    expect(out.model).toBe("claude-opus-4-7");
    expect(out.kind).toBe("strategic-router");
  });

  it("ignores empty pin string", () => {
    const out = pickStrategicModel({
      remaining: mkRemaining(),
      operatorPin: "",
    });
    expect(out.model).toBe("claude-opus-4-7");
  });

  it("operator-pin to local works (operator wants always-local)", () => {
    const out = pickStrategicModel({
      remaining: mkRemaining(),
      operatorPin: "local",
    });
    expect(out.model).toBe("local");
    expect(out.kind).toBe("operator-pin");
  });
});

describe("pickStrategicModel — hysteresis (slice 4 chaos row 3)", () => {
  it("sticks with previous-pick when candidate's gating window is within band", () => {
    // remaining 0.51 — barely above opus floor 0.5
    // previous pick was sonnet — picker would pick opus, but band 0.05 → stick with sonnet
    const out = pickStrategicModel({
      remaining: mkRemaining({ fivehour: 0.51, weekly: 1, monthly: 1 }),
      hysteresis: { previousPickId: "claude-sonnet-4-6" },
      hysteresisBand: 0.05,
    });
    expect(out.model).toBe("claude-sonnet-4-6");
    expect(out.kind).toBe("hysteresis");
    expect(out.reason).toContain("hysteresis");
  });

  it("crosses to better tier when candidate's gating window is well above band", () => {
    // remaining 0.7 — way above opus floor 0.5; band would have to be 0.2
    const out = pickStrategicModel({
      remaining: mkRemaining({ fivehour: 0.7, weekly: 1, monthly: 1 }),
      hysteresis: { previousPickId: "claude-sonnet-4-6" },
      hysteresisBand: 0.05,
    });
    expect(out.model).toBe("claude-opus-4-7");
    expect(out.kind).toBe("strategic-router");
  });

  it("does not apply hysteresis on cold-start (no previousPickId)", () => {
    const out = pickStrategicModel({
      remaining: mkRemaining({ fivehour: 0.51, weekly: 1, monthly: 1 }),
      hysteresis: { previousPickId: undefined },
    });
    expect(out.model).toBe("claude-opus-4-7");
    expect(out.kind).toBe("strategic-router");
  });

  it("does not apply hysteresis when previous pick is no longer selectable", () => {
    // Previous was opus, but remaining dropped below opus floor.
    // Picker should NOT stick with opus (it's no longer selectable).
    const out = pickStrategicModel({
      remaining: mkRemaining({ fivehour: 0.4, weekly: 1, monthly: 1 }),
      hysteresis: { previousPickId: "claude-opus-4-7" },
    });
    expect(out.model).toBe("claude-sonnet-4-6");
  });

  it("does not apply hysteresis when previous pick equals candidate (no change)", () => {
    const out = pickStrategicModel({
      remaining: mkRemaining(),
      hysteresis: { previousPickId: "claude-opus-4-7" },
    });
    expect(out.model).toBe("claude-opus-4-7");
    expect(out.kind).toBe("strategic-router"); // Not "hysteresis"
  });

  it("custom hysteresis band of 0.1 (10pp) sticks across a wider zone", () => {
    const out = pickStrategicModel({
      remaining: mkRemaining({ fivehour: 0.55, weekly: 1, monthly: 1 }),
      hysteresis: { previousPickId: "claude-sonnet-4-6" },
      hysteresisBand: 0.1,
    });
    // gating delta = 0.55 - 0.5 = 0.05; band = 0.1; stick with sonnet
    expect(out.model).toBe("claude-sonnet-4-6");
    expect(out.kind).toBe("hysteresis");
  });

  it("hysteresis band of 0 (disabled) always crosses", () => {
    const out = pickStrategicModel({
      remaining: mkRemaining({ fivehour: 0.501, weekly: 1, monthly: 1 }),
      hysteresis: { previousPickId: "claude-sonnet-4-6" },
      hysteresisBand: 0,
    });
    expect(out.model).toBe("claude-opus-4-7");
  });
});

describe("pickStrategicModel — fallback / chaos rows", () => {
  it("returns synthetic local on empty catalog (chaos row 1)", () => {
    const out = pickStrategicModel({
      remaining: mkRemaining(),
      catalog: [],
    });
    expect(out.model).toBe("local");
    expect(out.agent).toBe("local");
    expect(out.kind).toBe("fallback");
    expect(out.reason).toContain("empty-catalog");
  });

  it("returns lowest-tier when no entry meets floors (custom catalog with non-zero local floor)", () => {
    const customCatalog: ModelCatalogEntry[] = [
      {
        id: "a",
        agent: "claude",
        qualityTier: 1,
        costPer1MtokInput: 10,
        costPer1MtokOutput: 50,
        fivehourFloor: 0.5,
        weeklyFloor: 0.5,
        monthlyFloor: 0.5,
        recordedAt: "2026-05-10",
      },
      {
        id: "b",
        agent: "local",
        qualityTier: 4,
        costPer1MtokInput: 0,
        costPer1MtokOutput: 0,
        fivehourFloor: 0.1,
        weeklyFloor: 0.1,
        monthlyFloor: 0.1,
        recordedAt: "2026-05-10",
      },
    ];
    const out = pickStrategicModel({
      remaining: mkRemaining({ fivehour: 0.05, weekly: 0.05, monthly: 0.05 }),
      catalog: customCatalog,
    });
    expect(out.model).toBe("b");
    expect(out.kind).toBe("fallback");
    expect(out.reason).toContain("no-tier-qualifies");
  });
});

describe("pickStrategicModel — output shape invariants", () => {
  it("always returns a non-empty model id", () => {
    const out = pickStrategicModel({ remaining: mkRemaining() });
    expect(out.model.length).toBeGreaterThan(0);
  });

  it("always returns a non-empty reason", () => {
    const out = pickStrategicModel({ remaining: mkRemaining() });
    expect(out.reason.length).toBeGreaterThan(0);
  });

  it("agent matches the catalog entry's agent (claude or local)", () => {
    const out = pickStrategicModel({ remaining: mkRemaining() });
    const entry = MODEL_CATALOG.find((e) => e.id === out.model);
    expect(entry?.agent).toBe(out.agent);
  });

  it("kind is one of 4 documented values", () => {
    const out = pickStrategicModel({ remaining: mkRemaining() });
    expect(["strategic-router", "fallback", "operator-pin", "hysteresis"]).toContain(out.kind);
  });
});

describe("pickStrategicModel — input mutation safety", () => {
  it("does not mutate the input catalog", () => {
    const catalog = [...MODEL_CATALOG];
    const before = JSON.stringify(catalog);
    pickStrategicModel({ remaining: mkRemaining(), catalog });
    expect(JSON.stringify(catalog)).toBe(before);
  });

  it("does not mutate the input remaining", () => {
    const remaining = mkRemaining({ fivehour: 0.5 });
    const before = JSON.stringify(remaining);
    pickStrategicModel({ remaining });
    expect(JSON.stringify(remaining)).toBe(before);
  });
});

describe("pickStrategicModel — referential transparency", () => {
  it("same input → same output (no clock, no env)", () => {
    const input = { remaining: mkRemaining({ fivehour: 0.4 }) };
    const out1 = pickStrategicModel(input);
    const out2 = pickStrategicModel(input);
    expect(out1).toEqual(out2);
  });
});
