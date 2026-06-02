import { describe, expect, it } from "vitest";

import { parseReflexionEntry } from "./reflexion-schema.js";

const valid = {
  id: "iter-2026-06-02-tick-42",
  state: "Task X open; previous attempt left tests red on the regex branch.",
  action: "Rewrote the regex and re-ran the suite, opened a PR.",
  outcome: "success" as const,
  reflection:
    "Anchoring the pattern at both ends avoids the partial-match false positive next time.",
};

describe("parseReflexionEntry — valid entry", () => {
  it("accepts an entry with the four required fields plus id", () => {
    const result = parseReflexionEntry(valid);
    if (!result.ok) {
      throw new Error(`expected valid, got errors: ${JSON.stringify(result.errors, null, 2)}`);
    }
    expect(result.entry.id).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
    expect(result.entry.state.length).toBeGreaterThanOrEqual(5);
    expect(result.entry.action.length).toBeGreaterThanOrEqual(5);
    expect(result.entry.reflection.length).toBeGreaterThanOrEqual(10);
    expect(["success", "failure", "partial"]).toContain(result.entry.outcome);
  });

  it.each(["success", "failure", "partial"] as const)("accepts outcome=%s", (outcome) => {
    const result = parseReflexionEntry({ ...valid, outcome });
    expect(result.ok).toBe(true);
  });
});

describe("parseReflexionEntry — invalid entry", () => {
  it("rejects a non-mapping with kind=not-a-mapping", () => {
    const result = parseReflexionEntry(["not", "a", "map"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.kind === "not-a-mapping")).toBe(true);
  });

  it("rejects a missing reflection with kind=missing-required-field", () => {
    const { reflection, ...withoutReflection } = valid;
    void reflection;
    const result = parseReflexionEntry(withoutReflection);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => e.kind === "missing-required-field" && e.field === "reflection"),
    ).toBe(true);
  });

  it("rejects an unknown outcome enum with kind=invalid-outcome", () => {
    const result = parseReflexionEntry({ ...valid, outcome: "regressed" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.kind === "invalid-outcome" && e.field === "outcome")).toBe(
      true,
    );
  });

  it("rejects a too-short reflection with kind=field-too-short", () => {
    const result = parseReflexionEntry({ ...valid, reflection: "ok" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => e.kind === "field-too-short" && e.field === "reflection"),
    ).toBe(true);
  });

  it("rejects a non-kebab id with kind=invalid-id-format", () => {
    const result = parseReflexionEntry({ ...valid, id: "Iter_42" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.kind === "invalid-id-format" && e.field === "id")).toBe(
      true,
    );
  });

  it("rejects an unknown field with kind=unknown-field", () => {
    const result = parseReflexionEntry({ ...valid, reward: 0.91 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.kind === "unknown-field" && e.field === "reward")).toBe(
      true,
    );
  });
});
