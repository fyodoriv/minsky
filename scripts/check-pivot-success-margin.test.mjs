// Tests for the pure functions in check-pivot-success-margin.mjs.
// Pattern: rule #10 deterministic gate; xUnit paired fixtures (Meszaros 2007).
//
// Each `checkPivotSuccessMargin` test fixes both the input shape and the
// decision branch (numeric / binary / mixed / opt-out) so a regression
// surfaces as a single targeted failure, not a vague suite-wide red.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  checkPivotSuccessMargin,
  detectSkipComment,
  extractLeadingNumber,
  mainDirectory,
} from "./check-pivot-success-margin.mjs";

describe("extractLeadingNumber", () => {
  test("captures plain integer", () => {
    expect(extractLeadingNumber("10")).toBe(10);
  });
  test("captures number after a non-digit prefix (≥10)", () => {
    expect(extractLeadingNumber("≥10")).toBe(10);
  });
  test("captures number after `< ` prefix", () => {
    expect(extractLeadingNumber("< 0")).toBe(0);
  });
  test("captures percentage as bare number", () => {
    expect(extractLeadingNumber("95%")).toBe(95);
  });
  test("captures the FIRST numeric in prose (100, not 10)", () => {
    expect(
      extractLeadingNumber("flag-file tests at 100% coverage; integration test passes within 10s"),
    ).toBe(100);
  });
  test("returns null for purely-prose strings", () => {
    expect(extractLeadingNumber("if shell consumers ever need...")).toBeNull();
  });
  test("captures negative number", () => {
    expect(extractLeadingNumber("-5 over 7d")).toBe(-5);
  });
  test("captures fractional number", () => {
    expect(extractLeadingNumber("≥99.5")).toBe(99.5);
  });
});

describe("checkPivotSuccessMargin", () => {
  test("10-pt margin (≥10 vs <0) → ok", () => {
    const r = checkPivotSuccessMargin({ success: "≥10", pivot: "<0" });
    expect(r.ok).toBe(true);
  });

  test("zero-margin numeric (≥95% vs <95%) → fail", () => {
    const r = checkPivotSuccessMargin({ success: "≥95%", pivot: "<95%" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/margin too small/i);
  });

  test("sub-1% margin (≥100 vs ≥99.5) → fail (0.5 % < 1 %)", () => {
    const r = checkPivotSuccessMargin({ success: "≥100", pivot: "≥99.5" });
    expect(r.ok).toBe(false);
  });

  test("exact equality of numeric tokens (50 vs 50) → fail", () => {
    const r = checkPivotSuccessMargin({ success: "50 errors", pivot: "50 errors" });
    expect(r.ok).toBe(false);
  });

  test("binary equality without numeric (tests pass / tests pass) → fail", () => {
    const r = checkPivotSuccessMargin({ success: "tests pass", pivot: "tests pass" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/binary equality/i);
  });

  test("binary differing without numeric (tests pass / tests fail) → ok with warning (advisory)", () => {
    const r = checkPivotSuccessMargin({ success: "tests pass", pivot: "tests fail" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warning).toMatch(/neither success nor pivot/i);
  });

  test("mixed (one numeric, one prose) → ok with warning", () => {
    const r = checkPivotSuccessMargin({
      success: "≥95 % over 30 d",
      pivot: "if shell consumers ever need a richer narrative",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warning).toMatch(/only one of/i);
  });

  test("substantial margin with same units (≥95 % vs <85 %) → ok", () => {
    const r = checkPivotSuccessMargin({
      success: "≥95 % over 30 d",
      pivot: "<85 % over 7 d",
    });
    expect(r.ok).toBe(true);
  });
});

describe("detectSkipComment", () => {
  test("recognises canonical skip line", () => {
    const yaml = [
      "id: example-binary-metric",
      "# rule: ci-lint-pivot-success-margin: skip metric is legitimately binary",
      "hypothesis: |",
      "  shipping the binary check…",
      'success: "tests pass"',
      'pivot: "tests pass"',
      "",
    ].join("\n");
    const r = detectSkipComment(yaml);
    expect(r.skip).toBe(true);
    if (!r.skip) return;
    expect(r.reason).toMatch(/legitimately binary/);
  });

  test("rejects too-short reason (<3 chars)", () => {
    const yaml = "# rule: ci-lint-pivot-success-margin: skip ab\n";
    const r = detectSkipComment(yaml);
    expect(r.skip).toBe(false);
  });

  test("absence of skip comment → skip:false", () => {
    expect(detectSkipComment('id: foo\nsuccess: "x"\npivot: "y"\n').skip).toBe(false);
  });
});

describe("mainDirectory — experiments-directory-migration walker", () => {
  /** @type {string} */
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pivot-walker-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * @param {string} id
   * @param {string} success
   * @param {string} pivot
   */
  const recordYaml = (id, success, pivot) => `id: ${id}
hypothesis: |
  This is a test hypothesis with at least twenty characters of substantive content.
success: "${success}"
pivot: "${pivot}"
measurement: "test -f /tmp/foo && grep -q bar"
anchor: |
  *Site Reliability Engineering*, Beyer SRE 2016, Ch. 6
`;

  test("returns 0 when directory does not exist", async () => {
    const code = await mainDirectory(join(dir, "nonexistent-subdir"));
    expect(code).toBe(0);
  });

  test("returns 0 when directory has no *.yaml files", async () => {
    const code = await mainDirectory(dir);
    expect(code).toBe(0);
  });

  test("returns 0 when all margins are meaningful (≥1 %)", async () => {
    writeFileSync(join(dir, "a.yaml"), recordYaml("test-a", "≥10 percent", "<5 percent"));
    writeFileSync(join(dir, "b.yaml"), recordYaml("test-b", "≥99 percent", "<50 percent"));
    const code = await mainDirectory(dir);
    expect(code).toBe(0);
  });

  test("returns 1 when ANY file has zero margin (max wins)", async () => {
    writeFileSync(join(dir, "good.yaml"), recordYaml("test-good", "≥10 percent", "<5 percent"));
    writeFileSync(join(dir, "bad.yaml"), recordYaml("test-bad", "≥95 percent", "<95 percent"));
    const code = await mainDirectory(dir);
    expect(code).toBe(1);
  });

  test("ignores non-yaml files", async () => {
    writeFileSync(join(dir, "README.md"), "# notes");
    writeFileSync(join(dir, "good.yaml"), recordYaml("test-good", "≥10 percent", "<5 percent"));
    const code = await mainDirectory(dir);
    expect(code).toBe(0);
  });
});
