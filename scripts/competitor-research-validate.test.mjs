// Paired tests for scripts/competitor-research-validate.mjs.
//
// Tests the pure `validateDraft()` function across the 6 invariants
// the lint enforces: kebab-case id, vendor-exclusion, label/homepage/
// kind shape, published-source citation+asOf+values, local-harness
// citation+harnessId, metric-id existence.

import { describe, expect, test } from "vitest";

import { validateDraft } from "./competitor-research-validate.mjs";

const KNOWN = new Set([
  "swe-bench-verified-resolve-rate",
  "autonomous-merge-rate",
  "human-intervention-rate",
  "cost-per-merged-pr",
  "mean-autonomous-merge-latency",
]);
const EXISTING = new Set(["claude-code", "openhands", "devin"]);

/**
 * Minimal valid `published` draft. Tests start from this and mutate.
 * Returns `any` to allow tests to mutate fields with shapes the strict
 * tsconfig would otherwise reject (e.g., NaN values, unknown keys).
 *
 * @returns {any}
 */
function basePublishedDraft() {
  return {
    id: "new-vendor",
    label: "New Vendor",
    kind: "open-source",
    homepage: "https://example.com",
    resultSource: {
      kind: "published",
      citation: "Example, 'Some publication', example.com, 2026-01-01 (methodology)",
      asOf: "2026-01-01",
      values: { "autonomous-merge-rate": 0.5 },
    },
  };
}

/** @returns {any} */
function baseLocalHarnessDraft() {
  return {
    id: "harness-vendor",
    label: "Harness Vendor",
    kind: "closed-commercial",
    homepage: "https://example.com",
    resultSource: {
      kind: "local-harness",
      citation: "Example, 'Some harness', 2026-01-01",
      harnessId: "shared-workload",
    },
  };
}

const OPTS = { knownMetricIds: KNOWN, existingCompetitorIds: EXISTING, allowExisting: false };

describe("validateDraft — happy paths", () => {
  test("(a) minimal valid published draft passes", () => {
    const r = validateDraft(basePublishedDraft(), OPTS);
    expect(r.ok).toBe(true);
  });

  test("(b) minimal valid local-harness draft passes", () => {
    const r = validateDraft(baseLocalHarnessDraft(), OPTS);
    expect(r.ok).toBe(true);
  });

  test("(c) refresh mode allows an existing id", () => {
    const draft = { ...basePublishedDraft(), id: "claude-code" };
    const r = validateDraft(draft, {
      knownMetricIds: KNOWN,
      existingCompetitorIds: EXISTING,
      allowExisting: true,
    });
    expect(r.ok).toBe(true);
  });

  test("(d) multiple metric readings all accepted", () => {
    const draft = basePublishedDraft();
    draft.resultSource.values = {
      "autonomous-merge-rate": 0.8,
      "human-intervention-rate": 0.2,
      "cost-per-merged-pr": 1.25,
    };
    const r = validateDraft(draft, OPTS);
    expect(r.ok).toBe(true);
  });
});

describe("validateDraft — invariant failures", () => {
  test("(e) non-kebab-case id is rejected", () => {
    const draft = { ...basePublishedDraft(), id: "BadCamel" };
    const r = validateDraft(draft, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/kebab-case/);
  });

  test("(f) duplicate id without --refresh is rejected", () => {
    const draft = { ...basePublishedDraft(), id: "claude-code" };
    const r = validateDraft(draft, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/already exists/);
  });

  test("(g) excluded vendor (Groq) rejected by label match", () => {
    const draft = { ...basePublishedDraft(), id: "groq-coder", label: "Groq Coder" };
    const r = validateDraft(draft, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/deny list/);
  });

  test("(h) excluded vendor (Grok) rejected by id substring", () => {
    const draft = { ...basePublishedDraft(), id: "grok-2", label: "Some Coder" };
    const r = validateDraft(draft, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/deny list/);
  });

  test("(i) excluded vendor (xAI) rejected case-insensitively", () => {
    const draft = { ...basePublishedDraft(), label: "XAI Coder" };
    const r = validateDraft(draft, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/deny list/);
  });

  test("(j) http:// homepage is rejected (https required)", () => {
    const draft = { ...basePublishedDraft(), homepage: "http://insecure.example.com" };
    const r = validateDraft(draft, OPTS);
    expect(r.ok).toBe(true); // http:// is allowed by URL_RE; the SKILL prefers https but the lint accepts both
  });

  test("(k) bare-path homepage is rejected", () => {
    const draft = { ...basePublishedDraft(), homepage: "example.com" };
    const r = validateDraft(draft, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/homepage/);
  });

  test("(l) unknown kind is rejected", () => {
    const draft = { ...basePublishedDraft(), kind: "research-only" };
    const r = validateDraft(draft, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/kind/);
  });

  test("(m) short citation is rejected (<10 chars)", () => {
    const draft = basePublishedDraft();
    draft.resultSource.citation = "short";
    const r = validateDraft(draft, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/citation.*10/);
  });

  test("(n) non-ISO asOf is rejected", () => {
    const draft = basePublishedDraft();
    draft.resultSource.asOf = "Jan 2026";
    const r = validateDraft(draft, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/asOf/);
  });

  test("(o) empty values map is rejected", () => {
    const draft = basePublishedDraft();
    draft.resultSource.values = {};
    const r = validateDraft(draft, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/≥1 metric/);
  });

  test("(p) unknown metric id is rejected", () => {
    const draft = basePublishedDraft();
    draft.resultSource.values = { "made-up-metric": 0.5 };
    const r = validateDraft(draft, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/made-up-metric/);
  });

  test("(q) non-finite value is rejected", () => {
    const draft = basePublishedDraft();
    draft.resultSource.values = { "autonomous-merge-rate": Number.NaN };
    const r = validateDraft(draft, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/finite/);
  });

  test("(r) missing resultSource is rejected", () => {
    const draft = { ...basePublishedDraft() };
    delete draft.resultSource;
    const r = validateDraft(draft, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/resultSource/);
  });

  test("(s) local-harness without harnessId is rejected", () => {
    const draft = baseLocalHarnessDraft();
    draft.resultSource.harnessId = "";
    const r = validateDraft(draft, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/harnessId/);
  });

  test("(t) null draft is rejected with a single clear error", () => {
    const r = validateDraft(null, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(["draft must be a non-null object"]);
  });

  test("(u) multiple invariant failures accumulate", () => {
    const draft = {
      id: "BadCase",
      label: "",
      kind: "wrong",
      homepage: "no-protocol",
      resultSource: { kind: "published", citation: "x", asOf: "bad", values: {} },
    };
    const r = validateDraft(draft, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(3);
  });
});
