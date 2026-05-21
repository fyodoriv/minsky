import { describe, expect, it } from "vitest";

// Import through the package barrel so `index.ts` (a pure re-export) is
// covered by the same suite — mirrors `metrics.test.ts`.
import {
  COMPETITORS,
  type Competitor,
  EXCLUDED_VENDOR_SUBSTRINGS,
  competitorById,
  isExcludedVendor,
  publishedValue,
} from "./index.js";

describe("COMPETITORS corpus", () => {
  it("ships ≥4 competitors (parent-task success bar)", () => {
    expect(COMPETITORS.length).toBeGreaterThanOrEqual(4);
  });

  it("has unique kebab-case ids", () => {
    const ids = COMPETITORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("carries both result-source arms so the adapter seam is exercised", () => {
    const kinds = new Set(COMPETITORS.map((c) => c.resultSource.kind));
    expect(kinds.has("published")).toBe(true);
    expect(kinds.has("local-harness")).toBe(true);
  });

  it("every competitor carries a non-empty homepage and citation", () => {
    for (const c of COMPETITORS) {
      expect(c.homepage).toMatch(/^https:\/\//);
      expect(c.resultSource.citation.length).toBeGreaterThan(10);
      expect(["closed-commercial", "open-source"]).toContain(c.kind);
    }
  });

  it("every published snapshot carries an ISO-8601 asOf date and ≥1 metric", () => {
    for (const c of COMPETITORS) {
      if (c.resultSource.kind !== "published") continue;
      expect(c.resultSource.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Object.keys(c.resultSource.values).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("every local-harness source names a non-empty harness id", () => {
    for (const c of COMPETITORS) {
      if (c.resultSource.kind !== "local-harness") continue;
      expect(c.resultSource.harnessId.length).toBeGreaterThan(0);
    }
  });
});

describe("vendor-exclusion guard", () => {
  it("no shipped competitor is an excluded (Groq/xAI/Elon-affiliated) vendor", () => {
    for (const c of COMPETITORS) {
      expect(isExcludedVendor(c.id)).toBe(false);
      expect(isExcludedVendor(c.label)).toBe(false);
    }
  });

  it("flags every excluded substring case-insensitively", () => {
    expect(isExcludedVendor("Grok Coder")).toBe(true);
    expect(isExcludedVendor("xAI agent")).toBe(true);
    expect(isExcludedVendor("groq-swe")).toBe(true);
    expect(isExcludedVendor("Elon's coding bot")).toBe(true);
  });

  it("does not flag a legitimate competitor name", () => {
    expect(isExcludedVendor("Claude Code")).toBe(false);
    expect(isExcludedVendor("OpenHands")).toBe(false);
  });

  it("exposes the deny-set as a frozen array", () => {
    expect(Object.isFrozen(EXCLUDED_VENDOR_SUBSTRINGS)).toBe(true);
    expect(EXCLUDED_VENDOR_SUBSTRINGS.length).toBeGreaterThanOrEqual(4);
  });
});

describe("competitorById", () => {
  it("resolves a known id", () => {
    expect(competitorById("claude-code")?.label).toBe("Claude Code");
  });

  it("returns undefined for an unknown id", () => {
    expect(competitorById("not-a-competitor")).toBeUndefined();
  });
});

describe("publishedValue", () => {
  it("returns the reported value for a published source", () => {
    const oh = competitorById("openhands") as Competitor;
    expect(publishedValue(oh, "swe-bench-verified-resolve-rate")).toBeCloseTo(0.53);
  });

  it("returns undefined for a metric the published source omits", () => {
    const oh = competitorById("openhands") as Competitor;
    expect(publishedValue(oh, "cost-per-merged-pr")).toBeUndefined();
  });

  it("returns undefined for a local-harness source (slice-c fills it)", () => {
    const cursor = competitorById("cursor-agent") as Competitor;
    expect(publishedValue(cursor, "swe-bench-verified-resolve-rate")).toBeUndefined();
  });
});
