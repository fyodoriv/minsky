import { describe, expect, it } from "vitest";

import type { Constraint, ConstraintEvidence } from "./analyze.js";
import { MAX_VARIANTS_PER_PLAN, plan } from "./plan.js";

const evidence = (overrides: Partial<ConstraintEvidence> = {}): ConstraintEvidence => ({
  violationCount: 5,
  costEstimate: 1,
  exemplarRecords: [],
  ...overrides,
});

const constraint = (overrides: Partial<Constraint> = {}): Constraint => {
  const ev = evidence(overrides.evidence);
  return {
    ruleId: "rule-9",
    severity: "medium",
    ...overrides,
    evidence: ev,
  };
};

describe("plan", () => {
  it("returns at most MAX_VARIANTS_PER_PLAN variants", () => {
    const c = constraint();
    const variants = plan({
      topConstraint: c,
      evidence: c.evidence,
      basePrompt: "you are a helpful assistant",
    });
    expect(variants.length).toBeLessThanOrEqual(MAX_VARIANTS_PER_PLAN);
    expect(variants.length).toBeGreaterThan(0);
  });

  it("emits distinct rationales for the same constraint (one per mutation)", () => {
    const c = constraint();
    const variants = plan({ topConstraint: c, evidence: c.evidence, basePrompt: "p" });
    const rationales = variants.map((v) => v.rationale);
    const uniq = new Set(rationales);
    expect(uniq.size).toBe(rationales.length);
  });

  it("emits distinct mutations and ids for the same constraint", () => {
    const c = constraint();
    const variants = plan({ topConstraint: c, evidence: c.evidence, basePrompt: "p" });
    const mutations = new Set(variants.map((v) => v.mutation));
    const ids = new Set(variants.map((v) => v.id));
    expect(mutations.size).toBe(variants.length);
    expect(ids.size).toBe(variants.length);
  });

  it("scopes variant ids by ruleId so two different constraints produce distinct id namespaces", () => {
    const a = constraint({ ruleId: "rule-7" });
    const b = constraint({ ruleId: "rule-9" });
    const va = plan({ topConstraint: a, evidence: a.evidence, basePrompt: "p" });
    const vb = plan({ topConstraint: b, evidence: b.evidence, basePrompt: "p" });
    for (const v of va) expect(v.id.startsWith("rule-7-")).toBe(true);
    for (const v of vb) expect(v.id.startsWith("rule-9-")).toBe(true);
  });

  it("propagates basePrompt onto every variant", () => {
    const c = constraint();
    const variants = plan({
      topConstraint: c,
      evidence: c.evidence,
      basePrompt: "BASE-PROMPT-1234",
    });
    for (const v of variants) expect(v.basePrompt).toBe("BASE-PROMPT-1234");
  });

  it("throws when topConstraint.ruleId is empty (programming error — Plan needs a target)", () => {
    const c = constraint({ ruleId: "" });
    expect(() => plan({ topConstraint: c, evidence: c.evidence, basePrompt: "p" })).toThrow(
      /topConstraint\.ruleId/,
    );
  });

  it("throws when topConstraint.ruleId is whitespace-only", () => {
    const c = constraint({ ruleId: "   " });
    expect(() => plan({ topConstraint: c, evidence: c.evidence, basePrompt: "p" })).toThrow(
      /topConstraint\.ruleId/,
    );
  });
});
