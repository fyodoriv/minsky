// Tests for check-cto-audit-pr-conventions.mjs. Pattern: deterministic
// gate over a PR-shape convention (rule #10). Paired positive/negative
// fixtures (Meszaros 2007) covering the three biconditional cases.

import { describe, expect, test } from "vitest";

import {
  CTO_AUDIT_LABEL,
  checkCtoAuditPrConventions,
  normalizeGhPrJson,
} from "./check-cto-audit-pr-conventions.mjs";

describe("checkCtoAuditPrConventions", () => {
  test("audit branch + audit label → ok", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "audit/2026-05-05-canonical-metric-list-per-repo",
      labels: [CTO_AUDIT_LABEL],
    });
    expect(result.ok).toBe(true);
  });

  test("non-audit branch + no audit label → ok (most PRs)", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "feat/some-feature",
      labels: ["enhancement"],
    });
    expect(result.ok).toBe(true);
  });

  test("audit branch but missing label → fails (silent undercount risk)", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "audit/2026-05-05-some-task",
      labels: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/missing the `minsky:cto-audit` label/);
  });

  test("audit label but non-audit branch → fails", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "feat/wrong-prefix",
      labels: [CTO_AUDIT_LABEL],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/does not start with `audit\//);
  });

  test("audit label + audit prefix but malformed shape (missing date) → fails", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "audit/some-task",
      labels: [CTO_AUDIT_LABEL],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/does not match the required shape/);
  });

  test("audit label + audit prefix but malformed date (Y-M-D not zero-padded) → fails", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "audit/2026-5-5-some-task",
      labels: [CTO_AUDIT_LABEL],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/does not match the required shape/);
  });

  test("audit label + audit prefix but task-id starts with digit → fails", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "audit/2026-05-05-1-bad-id",
      labels: [CTO_AUDIT_LABEL],
    });
    expect(result.ok).toBe(false);
  });

  test("extra labels alongside the audit label are tolerated", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "audit/2026-05-05-canonical-metric-list-per-repo",
      labels: ["enhancement", CTO_AUDIT_LABEL, "automerge"],
    });
    expect(result.ok).toBe(true);
  });

  test("CTO_AUDIT_LABEL constant matches the brief's label (load-bearing)", () => {
    expect(CTO_AUDIT_LABEL).toBe("minsky:cto-audit");
  });
});

describe("normalizeGhPrJson", () => {
  test("accepts the raw `gh pr view --json headRefName,labels` shape", () => {
    const parsed = {
      headRefName: "audit/2026-05-05-x",
      labels: [{ name: CTO_AUDIT_LABEL }, { name: "enhancement" }],
    };
    const result = normalizeGhPrJson(parsed);
    expect(result.headRefName).toBe("audit/2026-05-05-x");
    expect(result.labels).toEqual([CTO_AUDIT_LABEL, "enhancement"]);
  });

  test("accepts a flat string-array labels field too (test convenience)", () => {
    const parsed = { headRefName: "feat/x", labels: ["enhancement"] };
    const result = normalizeGhPrJson(parsed);
    expect(result.labels).toEqual(["enhancement"]);
  });

  test("rejects missing headRefName", () => {
    expect(() => normalizeGhPrJson({ labels: [] })).toThrow(/headRefName/);
  });

  test("rejects non-array labels", () => {
    expect(() => normalizeGhPrJson({ headRefName: "x", labels: "no" })).toThrow(/labels/);
  });
});
