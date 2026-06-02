// @ts-check
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkReadmeByteBudget,
  README_BYTE_BUDGET_HARD_LIMIT,
  README_BYTE_BUDGET_TARGET,
} from "./check-readme-byte-budget.mjs";

describe("checkReadmeByteBudget", () => {
  it("passes when README is under the hard limit", () => {
    const dir = mkdtempSync(join(tmpdir(), "readme-budget-"));
    const path = join(dir, "README.md");
    writeFileSync(path, "x".repeat(1000));
    const result = checkReadmeByteBudget({
      readmePath: path,
      hardLimit: 2000,
      target: 1500,
    });
    expect(result.ok).toBe(true);
    expect(result.actualBytes).toBe(1000);
    expect(result.message).toMatch(/ok/);
    expect(result.message).toMatch(/1000 bytes/);
  });

  it("fails when README exceeds the hard limit", () => {
    const dir = mkdtempSync(join(tmpdir(), "readme-budget-"));
    const path = join(dir, "README.md");
    writeFileSync(path, "x".repeat(3000));
    const result = checkReadmeByteBudget({
      readmePath: path,
      hardLimit: 2000,
      target: 1500,
    });
    expect(result.ok).toBe(false);
    expect(result.actualBytes).toBe(3000);
    expect(result.message).toMatch(/grew 1000 bytes past/);
  });

  it("reports being over the target when under hard-limit but over target", () => {
    const dir = mkdtempSync(join(tmpdir(), "readme-budget-"));
    const path = join(dir, "README.md");
    writeFileSync(path, "x".repeat(1800));
    const result = checkReadmeByteBudget({
      readmePath: path,
      hardLimit: 2000,
      target: 1500,
    });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/300 bytes over target 1500/);
  });

  it("reports under-target when README compresses below the goal", () => {
    const dir = mkdtempSync(join(tmpdir(), "readme-budget-"));
    const path = join(dir, "README.md");
    writeFileSync(path, "x".repeat(1200));
    const result = checkReadmeByteBudget({
      readmePath: path,
      hardLimit: 2000,
      target: 1500,
    });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/300 bytes under target — drop hard-limit/);
  });

  it("uses default constants when not provided", () => {
    expect(README_BYTE_BUDGET_TARGET).toBe(3072);
    expect(README_BYTE_BUDGET_HARD_LIMIT).toBeGreaterThanOrEqual(README_BYTE_BUDGET_TARGET);
  });

  it("real production scan passes (smoke against repo README)", () => {
    const result = checkReadmeByteBudget();
    expect(result.ok).toBe(true);
  });

  it("hard limit must always be ≥ target (invariant)", () => {
    expect(README_BYTE_BUDGET_HARD_LIMIT).toBeGreaterThanOrEqual(README_BYTE_BUDGET_TARGET);
  });
});
