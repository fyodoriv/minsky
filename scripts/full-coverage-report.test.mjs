// Smoke + structural tests for `full-coverage-report.mjs`.
// Pattern: pure-output observation. Lifts L6 coverage.
// Source: rule #4 (everything measurable, everything visible);
// rule #17 (proactive healing — observed gap is a fix).

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "full-coverage-report.mjs");

function run(args) {
  const stdout = execFileSync("node", [SCRIPT, ...args], {
    encoding: "utf8",
    timeout: 15_000,
  });
  return stdout;
}

describe("full-coverage-report smoke", () => {
  test("--json returns parseable JSON with all 6 layers", () => {
    const out = run(["--json"]);
    const parsed = JSON.parse(out);
    expect(parsed.composite_pct).toBeGreaterThan(0);
    expect(parsed.layers).toHaveProperty("l1_unit_test_v8");
    expect(parsed.layers).toHaveProperty("l2_integration_tests");
    expect(parsed.layers).toHaveProperty("l3_cli_shim");
    expect(parsed.layers).toHaveProperty("l4_minsky_run");
    expect(parsed.layers).toHaveProperty("l5_runtime_invariants");
    expect(parsed.layers).toHaveProperty("l6_scripts");
  });

  test("each layer has pct, weight, and a note", () => {
    const out = run(["--json"]);
    const parsed = JSON.parse(out);
    for (const [name, info] of Object.entries(parsed.layers)) {
      expect(info, `layer ${name}`).toHaveProperty("pct");
      expect(info, `layer ${name}`).toHaveProperty("weight");
      expect(info, `layer ${name}`).toHaveProperty("note");
    }
  });

  test("L1 (unit) layer references the v8 coverage source", () => {
    const out = run(["--json"]);
    const parsed = JSON.parse(out);
    expect(parsed.layers.l1_unit_test_v8.note).toMatch(/v8|coverage/i);
  });

  test("default (non-json) output is human-readable", () => {
    const out = run([]);
    expect(out).toMatch(/L\d|coverage|composite/i);
  });
});

// ─── Honesty invariants — every percentage MUST be in [0, 100] ────
// The 2026-05-19 audit found L2 reporting 240% and the composite
// reporting 133% — a metric that exceeds its denominator is
// structurally meaningless. Rule #4 demands HONEST measurement; rule
// #11 forbids load-bearing metrics that aren't bounded. These tests
// pin the rule so a future regression can't silently re-inflate the
// numbers.

describe("full-coverage-report honesty invariants", () => {
  test("composite_pct is in [0, 100]", () => {
    const parsed = JSON.parse(run(["--json"]));
    expect(parsed.composite_pct).toBeGreaterThanOrEqual(0);
    expect(parsed.composite_pct).toBeLessThanOrEqual(100);
  });

  test("every layer pct is in [0, 100] (no >100% values)", () => {
    const parsed = JSON.parse(run(["--json"]));
    for (const [name, info] of Object.entries(parsed.layers)) {
      expect(
        info.pct,
        `layer ${name} pct=${info.pct} exceeds 100% — rule-#4 honesty violation`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        info.pct,
        `layer ${name} pct=${info.pct} exceeds 100% — rule-#4 honesty violation`,
      ).toBeLessThanOrEqual(100);
    }
  });

  test("every layer's tested/covered count ≤ total", () => {
    const parsed = JSON.parse(run(["--json"]));
    for (const [name, info] of Object.entries(parsed.layers)) {
      const numerator = info.tested ?? info.covered ?? info.withTests;
      const denom = info.total;
      if (typeof numerator !== "number" || typeof denom !== "number") continue;
      expect(
        numerator,
        `layer ${name} numerator=${numerator} exceeds denominator=${denom}`,
      ).toBeLessThanOrEqual(denom);
    }
  });

  test("composite is the weighted sum of layer percentages (sanity check the math)", () => {
    const parsed = JSON.parse(run(["--json"]));
    let expected = 0;
    for (const info of Object.values(parsed.layers)) {
      expected += info.pct * info.weight;
    }
    // Allow 1pp rounding wiggle.
    expect(Math.abs(parsed.composite_pct - expected)).toBeLessThanOrEqual(1);
  });
});
