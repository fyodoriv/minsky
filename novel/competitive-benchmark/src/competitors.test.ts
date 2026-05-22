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

  it("carries the published result-source arm (≥1 competitor; local-harness is the future-state arm)", () => {
    // After the 2026-05-22 corpus-expansion (PR M1.10), all 6 shipped
    // competitors carry `published` snapshots — the previous Cursor
    // `local-harness` arm was promoted to `published` once the AIDev
    // dataset (Pinna et al. arXiv 2602.08915, 2026-02-09) provided a
    // primary citation. The `ResultSource` discriminated-union arm for
    // `local-harness` is still part of the type, kept for the slice-(c)
    // runner's future reproducible-harness path; this test asserts the
    // adapter seam is exercised by `published` and tolerant of either.
    const kinds = new Set(COMPETITORS.map((c) => c.resultSource.kind));
    expect(kinds.has("published")).toBe(true);
    // No assertion on `local-harness` — present-or-absent is acceptable.
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
    // OpenHands SWE-bench Verified resolve rate per the all-hands.dev
    // April 2025 SOTA submission (verified via SWE-bench/experiments PR #209).
    expect(publishedValue(oh, "swe-bench-verified-resolve-rate")).toBeCloseTo(0.658);
  });

  it("returns the reported value for any metric the published source covers", () => {
    const oh = competitorById("openhands") as Competitor;
    expect(publishedValue(oh, "cost-per-merged-pr")).toBeCloseTo(0.3);
    expect(publishedValue(oh, "mean-autonomous-merge-latency")).toBeCloseTo(3600);
  });

  it("returns undefined for a metric the published source omits", () => {
    const oh = competitorById("openhands") as Competitor;
    // OpenHands does NOT publish autonomous-merge-rate in its snapshot —
    // that's Devin/Claude Code/Cursor territory in the current corpus.
    expect(publishedValue(oh, "autonomous-merge-rate")).toBeUndefined();
  });

  it("returns undefined for a local-harness source (slice-c fills it at runtime)", () => {
    // Synthetic local-harness competitor — the production corpus has all
    // 6 competitors on `published` post-expansion, but the type's
    // local-harness arm is still part of the adapter seam and tested
    // here against a hand-built record.
    const synthetic: Competitor = {
      id: "synthetic-harness",
      label: "Synthetic harness",
      kind: "open-source",
      homepage: "https://example.com",
      resultSource: {
        kind: "local-harness",
        citation: "synthetic — for testing the local-harness branch only",
        harnessId: "noop",
      },
    };
    expect(publishedValue(synthetic, "swe-bench-verified-resolve-rate")).toBeUndefined();
  });
});
