// <!-- scope: human-approved phase-11b step 1 — paired tests for the ported `model-catalog.mjs` module. Not a new public artefact; the original at `novel/tick-loop/src/model-catalog.test.ts` was deleted alongside the tick-loop package retirement. -->
// Tests for the per-machine model catalog and validation helper.
// xUnit paired fixtures (Meszaros 2007).
//
// History: originally `novel/tick-loop/src/model-catalog.test.ts`.
// Ported to .mjs in phase-11b step 1 alongside the source module
// (`model-catalog.mjs`). Same 19 assertions; JSDoc instead of TS types.

import { describe, expect, it } from "vitest";

import { MODEL_CATALOG, validateModelCatalog } from "./model-catalog.mjs";

describe("MODEL_CATALOG (slice 3 — recency-anchored May 2026)", () => {
  it("ships at least 3 rows (Opus / Sonnet / local — Haiku skipped per operator 2026-05-10)", () => {
    expect(MODEL_CATALOG.length).toBeGreaterThanOrEqual(2);
  });

  it("intentionally excludes claude-haiku-4-5 (local Qwen3-14B/27B beats Haiku on coding)", () => {
    const haiku = MODEL_CATALOG.find((e) => e.id === "claude-haiku-4-5");
    expect(haiku).toBeUndefined();
  });

  it("intentionally excludes opus rows (workers run sonnet-4-6 — operator 2026-06-11)", () => {
    const opus = MODEL_CATALOG.find((e) => e.id.includes("opus"));
    expect(opus).toBeUndefined();
  });

  it("includes claude-sonnet-4-6 as tier-1 (the canonical worker model)", () => {
    const sonnet = MODEL_CATALOG.find((e) => e.id === "claude-sonnet-4-6");
    expect(sonnet).toBeDefined();
    expect(sonnet?.qualityTier).toBe(1);
    expect(sonnet?.agent).toBe("claude");
  });

  it("includes local as tier-2 with zero floors (always-available last resort)", () => {
    const local = MODEL_CATALOG.find((e) => e.id === "local");
    expect(local).toBeDefined();
    expect(local?.qualityTier).toBe(2);
    expect(local?.agent).toBe("local");
    expect(local?.fivehourFloor).toBe(0);
    expect(local?.weeklyFloor).toBe(0);
    expect(local?.monthlyFloor).toBe(0);
  });

  it("is sorted ascending by qualityTier", () => {
    for (let i = 1; i < MODEL_CATALOG.length; i++) {
      const prev = MODEL_CATALOG[i - 1];
      const curr = MODEL_CATALOG[i];
      if (prev === undefined || curr === undefined) throw new Error("unreachable");
      expect(curr.qualityTier).toBeGreaterThanOrEqual(prev.qualityTier);
    }
  });

  it("has monotone-descending floors (lower tier → lower floor)", () => {
    for (let i = 1; i < MODEL_CATALOG.length; i++) {
      const prev = MODEL_CATALOG[i - 1];
      const curr = MODEL_CATALOG[i];
      if (prev === undefined || curr === undefined) throw new Error("unreachable");
      expect(curr.fivehourFloor).toBeLessThanOrEqual(prev.fivehourFloor);
      expect(curr.weeklyFloor).toBeLessThanOrEqual(prev.weeklyFloor);
      expect(curr.monthlyFloor).toBeLessThanOrEqual(prev.monthlyFloor);
    }
  });

  it("local row has $0 cost (electricity-only)", () => {
    const local = MODEL_CATALOG.find((e) => e.id === "local");
    expect(local?.costPer1MtokInput).toBe(0);
    expect(local?.costPer1MtokOutput).toBe(0);
  });

  it("Sonnet is more expensive than local (which is free)", () => {
    const sonnet = MODEL_CATALOG.find((e) => e.id === "claude-sonnet-4-6");
    const local = MODEL_CATALOG.find((e) => e.id === "local");
    if (!sonnet || !local) throw new Error("missing entry");
    expect(sonnet.costPer1MtokInput).toBeGreaterThan(local.costPer1MtokInput);
    expect(local.costPer1MtokInput).toBe(0);
  });

  it("every entry has a recency anchor (recordedAt ISO date)", () => {
    for (const entry of MODEL_CATALOG) {
      expect(entry.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("validateModelCatalog passes on the shipped catalog", () => {
    const result = validateModelCatalog(MODEL_CATALOG);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe("validateModelCatalog (slice 3 — invariant pinner)", () => {
  it("rejects an empty catalog", () => {
    const result = validateModelCatalog([]);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("empty");
  });

  it("rejects a row with empty id", () => {
    const result = validateModelCatalog([
      {
        id: "",
        agent: "claude",
        qualityTier: 1,
        costPer1MtokInput: 1,
        costPer1MtokOutput: 1,
        fivehourFloor: 0,
        weeklyFloor: 0,
        monthlyFloor: 0,
        recordedAt: "2026-05-10",
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("id is empty");
  });

  it("rejects a row with qualityTier out of [1,4]", () => {
    // Deliberately-out-of-range qualityTier — cast via `unknown` to
    // bypass the literal-type constraint so the validator sees the
    // out-of-range value.
    const badEntry = /** @type {import('./model-catalog.mjs').ModelCatalogEntry} */ (
      /** @type {unknown} */ ({
        id: "x",
        agent: "claude",
        qualityTier: 5,
        costPer1MtokInput: 1,
        costPer1MtokOutput: 1,
        fivehourFloor: 0,
        weeklyFloor: 0,
        monthlyFloor: 0,
        recordedAt: "2026-05-10",
      })
    );
    const result = validateModelCatalog([badEntry]);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("qualityTier 5");
  });

  it("rejects a row with floor out of [0,1]", () => {
    const result = validateModelCatalog([
      {
        id: "x",
        agent: "claude",
        qualityTier: 1,
        costPer1MtokInput: 1,
        costPer1MtokOutput: 1,
        fivehourFloor: 1.5,
        weeklyFloor: 0,
        monthlyFloor: 0,
        recordedAt: "2026-05-10",
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("fivehourFloor 1.5 out of [0,1]");
  });

  it("rejects a catalog where qualityTier is not sorted ascending", () => {
    const result = validateModelCatalog([
      mkEntry({ id: "a", qualityTier: 2 }),
      mkEntry({ id: "b", qualityTier: 1 }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("must be sorted ascending");
  });

  it("rejects a catalog where floors are not monotone descending (fivehour)", () => {
    const result = validateModelCatalog([
      mkEntry({ id: "a", qualityTier: 1, fivehourFloor: 0.3 }),
      mkEntry({ id: "b", qualityTier: 2, fivehourFloor: 0.5 }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("fivehourFloor 0.5 > prev floor 0.3");
  });

  it("rejects a catalog where weeklyFloor is not monotone descending", () => {
    const result = validateModelCatalog([
      mkEntry({ id: "a", qualityTier: 1, weeklyFloor: 0.2 }),
      mkEntry({ id: "b", qualityTier: 2, weeklyFloor: 0.4 }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("weeklyFloor 0.4 > prev floor 0.2");
  });

  it("rejects a catalog where monthlyFloor is not monotone descending", () => {
    const result = validateModelCatalog([
      mkEntry({ id: "a", qualityTier: 1, monthlyFloor: 0.1 }),
      mkEntry({ id: "b", qualityTier: 2, monthlyFloor: 0.3 }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("monthlyFloor 0.3 > prev floor 0.1");
  });

  it("accepts a valid catalog (qualityTier ascending, floors descending)", () => {
    const result = validateModelCatalog([
      mkEntry({
        id: "haiku",
        qualityTier: 1,
        fivehourFloor: 0.8,
        weeklyFloor: 0.6,
        monthlyFloor: 0.5,
      }),
      mkEntry({
        id: "sonnet",
        qualityTier: 2,
        fivehourFloor: 0.4,
        weeklyFloor: 0.3,
        monthlyFloor: 0.2,
      }),
      mkEntry({
        id: "opus",
        qualityTier: 3,
        fivehourFloor: 0.1,
        weeklyFloor: 0.1,
        monthlyFloor: 0.0,
      }),
    ]);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

/**
 * @param {Partial<import('./model-catalog.mjs').ModelCatalogEntry>} overrides
 * @returns {import('./model-catalog.mjs').ModelCatalogEntry}
 */
function mkEntry(overrides) {
  return /** @type {import('./model-catalog.mjs').ModelCatalogEntry} */ ({
    id: "test",
    agent: "claude",
    qualityTier: 1,
    costPer1MtokInput: 1,
    costPer1MtokOutput: 1,
    fivehourFloor: 0,
    weeklyFloor: 0,
    monthlyFloor: 0,
    recordedAt: "2026-05-10",
    ...overrides,
  });
}
