import { describe, expect, it } from "vitest";

// Import through the package barrel so `index.ts` (a pure re-export) is
// covered by the same suite — mirrors `metrics.test.ts`.
import {
  COMPETITORS,
  type Competitor,
  competitorById,
  EXCLUDED_VENDOR_SUBSTRINGS,
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

  it("exercises both result-source arms — published snapshots + the Agentless local-harness falsifier", () => {
    // Most competitors carry `published` snapshots; the Agentless row
    // (added by `competitor-deep-research-tier-s-2026-05`) is the corpus's
    // `local-harness` thesis-falsifier arm — a method we run head-to-head
    // ourselves rather than a vendor-published Minsky-metric number. This
    // test pins that the adapter seam is exercised by BOTH arms.
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

  it("resolves the agentless thesis-falsifier as a local-harness row (competitor-deep-research-tier-s-2026-05)", () => {
    // Agentless is a fixed-pipeline *method*, not a vendor product; it joins
    // the corpus as the `local-harness` arm so the slice-(c) runner can run it
    // head-to-head against the published readings — the falsifiability
    // guarantee for Minsky's reason-for-existing (rule #9). Including it is
    // mandatory per the task's Success bar regardless of any adoption verdict.
    const agentless = competitorById("agentless") as Competitor;
    expect(agentless.kind).toBe("open-source");
    expect(agentless.resultSource.kind).toBe("local-harness");
    if (agentless.resultSource.kind === "local-harness") {
      expect(agentless.resultSource.harnessId).toBe("agentless-swebench-lite");
    }
    // local-harness rows carry no published values — slice-(c) fills them.
    expect(publishedValue(agentless, "swe-bench-verified-resolve-rate")).toBeUndefined();
  });

  it("resolves autogen-microsoft with its MATH whole-test reading (corpus-add-autogen-microsoft)", () => {
    // Added via the `corpus-add-autogen-microsoft` Pivot: AutoGen's primary
    // orchestrator-tier number is MATH whole-test accuracy (Wu et al. arXiv
    // 2308.08155), not a stock-model HumanEval headline.
    const autogen = competitorById("autogen-microsoft") as Competitor;
    expect(autogen.kind).toBe("open-source");
    expect(autogen.resultSource.kind).toBe("published");
    expect(publishedValue(autogen, "math-whole-test-accuracy")).toBeCloseTo(0.6948);
    expect(publishedValue(autogen, "humaneval-pass-at-1")).toBeUndefined();
  });
});

describe("publishedValue", () => {
  it("returns the reported value for a published source", () => {
    const oh = competitorById("openhands") as Competitor;
    // OpenHands SWE-bench Verified resolve rate per the Software Agent SDK
    // paper (arXiv:2511.03690v2, 2026-04-22, Table 4 §5.4 — Claude Sonnet 4.5
    // + extended thinking on the V1 SDK; supersedes the 0.658 Apr-2025 number).
    expect(publishedValue(oh, "swe-bench-verified-resolve-rate")).toBeCloseTo(0.728);
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

  it("records SWE-agent's vendor-primary SWE-bench Multimodal frontend reading (research-finding-multi-task-benchmark-suite)", () => {
    // SWE-agent holds the published top reading on SWE-bench Multimodal (0.12,
    // best of all systems, vs 0.06 next) per Yang et al. arXiv 2410.03859 —
    // the only vendor-primary OpenHands-Index-shape per-dimension score in the
    // corpus today (the frontend dimension). Other suite dimensions
    // (greenfield/testing/info-gathering) report no fixed vendor-primary
    // number yet, so they stay undefined (visible-not-silent, never a coerced
    // zero) until a competitor publishes one.
    const swe = competitorById("swe-agent") as Competitor;
    expect(publishedValue(swe, "swe-bench-multimodal-resolve-rate")).toBeCloseTo(0.12);
    expect(publishedValue(swe, "commit0-library-resolve-rate")).toBeUndefined();
    expect(publishedValue(swe, "gaia-resolve-rate")).toBeUndefined();
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
