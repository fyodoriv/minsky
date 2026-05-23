// Tests for `cost-tier-picker.ts`. Slice 1 of `interactive-model-cost-picker`.
// Paired positive/negative fixtures (Meszaros 2007 *xUnit Test Patterns*):
// every tier roundtrips through its config patch; unknown ids return
// null; the DEFAULT tier exists in COST_TIERS.

import { describe, expect, test } from "vitest";

import {
  COST_TIERS,
  DEFAULT_TIER_ID,
  getDefaultTier,
  pickTierById,
  tierToConfigPatch,
} from "./cost-tier-picker.js";

describe("COST_TIERS shape", () => {
  test("ships exactly 6 tiers, in declared order", () => {
    expect(COST_TIERS).toHaveLength(6);
    expect(COST_TIERS.map((t) => t.id)).toEqual([
      "opus-opus",
      "opus-sonnet",
      "sonnet-sonnet",
      "sonnet-local",
      "local-local",
      "windsurf-devin",
    ]);
  });

  test("tier ids are unique (no accidental dupes)", () => {
    const ids = COST_TIERS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every tier has a non-empty label + recommendedFor + brain/workers agents", () => {
    for (const t of COST_TIERS) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.recommendedFor.length).toBeGreaterThan(0);
      expect(t.brainAgent.length).toBeGreaterThan(0);
      expect(t.workersAgent.length).toBeGreaterThan(0);
    }
  });

  test("estimated cost is a finite non-negative number for every tier", () => {
    for (const t of COST_TIERS) {
      expect(Number.isFinite(t.estimatedUsdPerHour)).toBe(true);
      expect(t.estimatedUsdPerHour).toBeGreaterThanOrEqual(0);
    }
  });

  test("only the all-local tier costs $0/hr (no other tier is free)", () => {
    const freeTiers = COST_TIERS.filter((t) => t.estimatedUsdPerHour === 0);
    expect(freeTiers).toHaveLength(1);
    expect(freeTiers[0]?.id).toBe("local-local");
  });

  test("cost ordering is monotonic-non-strict by tier index — costs don't randomly oscillate", () => {
    // The picker presents tiers from most-expensive to least-cloud. We
    // don't require strict monotonic decrease, but we DO require the
    // top tier (opus-opus) to be at-or-above every later cloud tier.
    const topCost = COST_TIERS[0]?.estimatedUsdPerHour ?? 0;
    for (let i = 1; i < COST_TIERS.length; i++) {
      const tier = COST_TIERS[i];
      if (tier && tier.id !== "windsurf-devin") {
        expect(tier.estimatedUsdPerHour).toBeLessThanOrEqual(topCost);
      }
    }
  });

  test("every tier's configPatch.cost_tier matches its id (roundtrip invariant)", () => {
    for (const t of COST_TIERS) {
      expect(t.configPatch.cost_tier).toBe(t.id);
    }
  });
});

describe("pickTierById", () => {
  test("returns the matching tier for a valid id", () => {
    const r = pickTierById("opus-sonnet");
    expect(r).not.toBeNull();
    expect(r?.id).toBe("opus-sonnet");
    expect(r?.brainAgent).toBe("claude");
  });

  test("returns null for an unknown id", () => {
    expect(pickTierById("does-not-exist")).toBeNull();
    expect(pickTierById("")).toBeNull();
  });

  test("returns null on case mismatch (ids are case-sensitive)", () => {
    expect(pickTierById("OPUS-SONNET")).toBeNull();
  });

  test("works for every tier in COST_TIERS", () => {
    for (const t of COST_TIERS) {
      const r = pickTierById(t.id);
      expect(r?.id).toBe(t.id);
    }
  });
});

describe("tierToConfigPatch", () => {
  test("returns the configPatch for a valid id", () => {
    const patch = tierToConfigPatch("local-local");
    expect(patch).not.toBeNull();
    expect(patch?.cost_tier).toBe("local-local");
    expect(patch?.cloud_agent).toBeNull();
    expect(patch?.local_agent).toBe("aider");
  });

  test("returns null for an unknown id", () => {
    expect(tierToConfigPatch("nonsense")).toBeNull();
  });

  test("the DEFAULT tier has a non-null cloud_agent_model (it's a cloud-default tier)", () => {
    const patch = tierToConfigPatch(DEFAULT_TIER_ID);
    expect(patch).not.toBeNull();
    expect(patch?.cloud_agent_model).not.toBeNull();
  });

  test("local-only tier has both cloud fields null", () => {
    const patch = tierToConfigPatch("local-local");
    expect(patch?.cloud_agent).toBeNull();
    expect(patch?.cloud_agent_model).toBeNull();
  });
});

describe("getDefaultTier + DEFAULT_TIER_ID invariant", () => {
  test("DEFAULT_TIER_ID maps to an actual tier", () => {
    expect(pickTierById(DEFAULT_TIER_ID)).not.toBeNull();
  });

  test("getDefaultTier returns the matching tier", () => {
    const t = getDefaultTier();
    expect(t.id).toBe(DEFAULT_TIER_ID);
  });

  test("default tier label contains '(DEFAULT)' marker (visible-not-silent)", () => {
    const t = getDefaultTier();
    expect(t.label).toContain("(DEFAULT)");
  });

  test("default tier is the cloud-balanced one (Opus brain + Sonnet workers)", () => {
    // Cross-references the task body's stated default. Locked in here so
    // the prose intent doesn't silently drift from the data.
    expect(DEFAULT_TIER_ID).toBe("opus-sonnet");
  });
});
