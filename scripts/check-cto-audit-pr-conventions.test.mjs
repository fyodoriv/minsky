// Tests for check-cto-audit-pr-conventions.mjs. Pattern: deterministic
// gate over a PR head-branch / label biconditional (rule #10). Paired
// positive/negative fixtures (Meszaros 2007).

import { describe, expect, test } from "vitest";

import {
  CTO_AUDIT_PR_LABEL,
  checkCtoAuditPrConventions,
} from "./check-cto-audit-pr-conventions.mjs";

describe("CTO_AUDIT_PR_LABEL — measurement contract", () => {
  test("matches the literal the pre-registered metric query uses", () => {
    // The TASKS.md `Measurement` line for `post-task-cto-audit` runs:
    //   gh pr list --label minsky:cto-audit ...
    // If this constant drifts, the metric silently returns 0 forever.
    // The matching constant lives in
    //   novel/tick-loop/src/post-task-cto-audit.ts:51
    // and is pinned by its own paired test. Both must agree.
    expect(CTO_AUDIT_PR_LABEL).toBe("minsky:cto-audit");
  });
});

describe("checkCtoAuditPrConventions — happy paths (no violation)", () => {
  test("non-audit branch + no label → ok (most PRs)", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "feat/some-feature",
      labels: ["documentation"],
    });
    expect(result.ok).toBe(true);
  });

  test("audit branch + audit label → ok (the canonical audit PR shape)", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "audit/2026-05-05-canonical-metric-list-per-repo",
      labels: ["minsky:cto-audit"],
    });
    expect(result.ok).toBe(true);
  });

  test("audit branch + audit label + other labels → ok", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "audit/2026-05-05-shipped-feature",
      labels: ["minsky:cto-audit", "p0", "automation"],
    });
    expect(result.ok).toBe(true);
  });

  test("non-audit branch + no label + empty labels list → ok", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "task/post-task-cto-audit",
      labels: [],
    });
    expect(result.ok).toBe(true);
  });
});

describe("checkCtoAuditPrConventions — violation 1: branch matches but label missing", () => {
  test("audit branch with no labels at all → fails", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "audit/2026-05-05-shipped-feature",
      labels: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/matches the CTO-audit naming convention/);
    expect(result.errors[0]).toMatch(/minsky:cto-audit/);
  });

  test("audit branch with unrelated labels but missing audit label → fails", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "audit/2026-05-05-some-task",
      labels: ["p0", "documentation"],
    });
    expect(result.ok).toBe(false);
  });

  test("audit branch with the misspelled label → fails (label match is exact)", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "audit/2026-05-05-some-task",
      // Common drift: omit the colon, swap to a slash, etc.
      labels: ["minsky-cto-audit", "minsky/cto-audit", "cto-audit"],
    });
    expect(result.ok).toBe(false);
  });
});

describe("checkCtoAuditPrConventions — violation 2: label present but branch doesn't match", () => {
  test("audit label on a feature branch → fails", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "feat/handcrafted-task",
      labels: ["minsky:cto-audit"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/labeled `minsky:cto-audit`/);
    expect(result.errors[0]).toMatch(/audit\/<UTC-date>-<task-id>/);
  });

  test("audit label on a branch missing the date prefix → fails", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "audit/no-date-prefix",
      labels: ["minsky:cto-audit"],
    });
    expect(result.ok).toBe(false);
  });

  test("audit label on a branch with a malformed date → fails", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "audit/20260505-task",
      labels: ["minsky:cto-audit"],
    });
    expect(result.ok).toBe(false);
  });

  test("audit label on a branch with uppercase task-id → fails (TASKS.md grammar)", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "audit/2026-05-05-Capitalised",
      labels: ["minsky:cto-audit"],
    });
    expect(result.ok).toBe(false);
  });

  test("audit label on a branch ending in a dash → fails (terminal must be alnum)", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "audit/2026-05-05-trailing-",
      labels: ["minsky:cto-audit"],
    });
    expect(result.ok).toBe(false);
  });
});

describe("checkCtoAuditPrConventions — branch grammar edge cases", () => {
  test("audit branch with a 1-char task-id → ok with label", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "audit/2026-05-05-x",
      labels: ["minsky:cto-audit"],
    });
    expect(result.ok).toBe(true);
  });

  test("audit branch with digits in task-id → ok with label", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "audit/2026-05-05-task-123-foo",
      labels: ["minsky:cto-audit"],
    });
    expect(result.ok).toBe(true);
  });

  test("audit branch with uppercase date or extra slash → fails when labeled", () => {
    expect(
      checkCtoAuditPrConventions({
        headRefName: "AUDIT/2026-05-05-task",
        labels: ["minsky:cto-audit"],
      }).ok,
    ).toBe(false);
    expect(
      checkCtoAuditPrConventions({
        headRefName: "audit/2026-05-05/task",
        labels: ["minsky:cto-audit"],
      }).ok,
    ).toBe(false);
  });

  test("a non-audit branch that happens to start with `audit-` is not treated as audit", () => {
    const result = checkCtoAuditPrConventions({
      headRefName: "audit-related-feature",
      labels: [],
    });
    expect(result.ok).toBe(true);
  });
});
