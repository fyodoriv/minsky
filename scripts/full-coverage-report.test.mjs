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
