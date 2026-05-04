import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parse } from "./parse.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "..", "test", "fixtures");
const fx = (name: string) => readFileSync(join(fixtureDir, name), "utf8");

describe("parse — valid fixtures", () => {
  it.each(["valid-1.yaml", "valid-2.yaml", "valid-3.yaml"])("parses %s with no errors", (name) => {
    const result = parse(fx(name));
    if (!result.ok) {
      throw new Error(`expected valid, got errors: ${JSON.stringify(result.errors, null, 2)}`);
    }
    expect(result.record.id).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
    expect(result.record.hypothesis.length).toBeGreaterThanOrEqual(20);
    expect(result.record.success.length).toBeGreaterThanOrEqual(5);
    expect(result.record.pivot.length).toBeGreaterThanOrEqual(5);
    expect(result.record.measurement.length).toBeGreaterThanOrEqual(5);
    expect(result.record.anchor.length).toBeGreaterThanOrEqual(5);
    expect(result.record.replay_windows_days.length).toBeGreaterThan(0);
  });

  it("uses default [7, 30] replay windows when omitted", () => {
    const result = parse(fx("valid-1.yaml"));
    if (!result.ok) throw new Error("expected valid");
    expect(result.record.replay_windows_days).toEqual([7, 30]);
  });

  it("preserves explicit replay windows when provided", () => {
    const r1 = parse(fx("valid-2.yaml"));
    if (!r1.ok) throw new Error("expected valid");
    expect(r1.record.replay_windows_days).toEqual([7, 30, 90]);

    const r2 = parse(fx("valid-3.yaml"));
    if (!r2.ok) throw new Error("expected valid");
    expect(r2.record.replay_windows_days).toEqual([7]);
  });
});

describe("parse — invalid fixtures", () => {
  it("rejects missing-pivot with kind=missing-required-field", () => {
    const result = parse(fx("invalid-missing-pivot.yaml"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => e.kind === "missing-required-field" && e.field === "pivot"),
    ).toBe(true);
  });

  it("rejects vanity-metric phrases with kind=vanity-metric", () => {
    const result = parse(fx("invalid-vanity-metric.yaml"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.kind === "vanity-metric")).toBe(true);
    // Both `success` ("commits made") and `pivot` ("commits made") trigger the rule.
    const fields = result.errors.filter((e) => e.kind === "vanity-metric").map((e) => e.field);
    expect(fields).toContain("success");
    expect(fields).toContain("pivot");
  });

  it("rejects malformed YAML with kind=bad-yaml and a line number", () => {
    const result = parse(fx("invalid-bad-yaml.yaml"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const badYaml = result.errors.find((e) => e.kind === "bad-yaml");
    expect(badYaml).toBeDefined();
    expect(typeof badYaml?.line).toBe("number");
  });
});

describe("parse — semantic edge cases", () => {
  it("rejects unknown extra fields", () => {
    const result = parse(`
id: example
hypothesis: "Some forty-character hypothesis lorem ipsum"
success: "≥1 unit"
pivot: "<0 units"
measurement: "true"
anchor: "rule #9"
extra_field: "not allowed"
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.kind === "unknown-field" && e.field === "extra_field")).toBe(
      true,
    );
  });

  it("rejects empty replay_windows_days", () => {
    const result = parse(`
id: example
hypothesis: "Some forty-character hypothesis lorem ipsum"
success: "≥1 unit"
pivot: "<0 units"
measurement: "true"
anchor: "rule #9"
replay_windows_days: []
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.kind === "empty-replay-windows")).toBe(true);
  });

  it("rejects out-of-range replay windows", () => {
    const result = parse(`
id: example
hypothesis: "Some forty-character hypothesis lorem ipsum"
success: "≥1 unit"
pivot: "<0 units"
measurement: "true"
anchor: "rule #9"
replay_windows_days: [0, 400]
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.filter((e) => e.kind === "bad-replay-window-value").length).toBe(2);
  });

  it("rejects bad id format", () => {
    const result = parse(`
id: "Bad ID with spaces"
hypothesis: "Some forty-character hypothesis lorem ipsum"
success: "≥1 unit"
pivot: "<0 units"
measurement: "true"
anchor: "rule #9"
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.kind === "invalid-id-format" && e.field === "id")).toBe(
      true,
    );
  });

  it("rejects non-mapping top level (e.g., a list)", () => {
    const result = parse("- a\n- b\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.kind).toBe("not-a-mapping");
  });

  it("rejects too-short hypothesis", () => {
    const result = parse(`
id: example
hypothesis: "too short"
success: "≥1 unit"
pivot: "<0 units"
measurement: "true"
anchor: "rule #9"
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => e.kind === "field-too-short" && e.field === "hypothesis"),
    ).toBe(true);
  });
});
