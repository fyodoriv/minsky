// Tests for the pure function in check-rule-17-proactive-heal.mjs.
// Pattern: rule #10 deterministic gate; xUnit paired fixtures
// (Meszaros, *xUnit Test Patterns*, 2007).
//
// Source: rule #17 (vision.md § Proactive healing — observation IS the
// fix); rule #10 (deterministic enforcement); operator directive
// 2026-05-19.

import { describe, expect, test } from "vitest";

import { checkRule17ProactiveHeal } from "./check-rule-17-proactive-heal.mjs";

describe("rule #17 proactive-heal lint", () => {
  test("vacuous: empty body, empty diff ⇒ no violation", () => {
    const r = checkRule17ProactiveHeal({ body: "", diffSummary: "" });
    expect(r.violation).toBe(false);
    expect(r.observedErrors).toEqual([]);
  });

  test("vacuous: clean body with no error tokens ⇒ no violation", () => {
    const r = checkRule17ProactiveHeal({
      body: "feat: add new dashboard page\n\nNothing relevant.",
      diffSummary: "",
    });
    expect(r.violation).toBe(false);
  });

  test("violation: observed errors with no fix and no diff", () => {
    const body = [
      "## Status",
      "minsky watch surfaced 3 problems:",
      "- spawn-failed × 3",
      "- HTTP 401 from GraphQL",
      "- × #0 walker-drains → ETIMEDOUT",
      "",
      "Filing follow-up in another session.",
    ].join("\n");
    const r = checkRule17ProactiveHeal({ body, diffSummary: "" });
    expect(r.violation).toBe(true);
    expect(r.observedErrors.length).toBeGreaterThan(0);
    expect(r.healEvidence).toEqual([]);
  });

  test("no violation: observed errors + a fix commit subject", () => {
    const body = [
      "## Status",
      "spawn-failed surfaced, root cause auth-divergence.",
      "",
      "fix(daemon): dedupe gh-auth 401 + emit single warning",
    ].join("\n");
    const r = checkRule17ProactiveHeal({ body, diffSummary: "" });
    expect(r.violation).toBe(false);
    expect(r.healEvidence.length).toBeGreaterThan(0);
  });

  test("no violation: observed errors + non-empty diff (fix was shipped)", () => {
    const body = "spawn-failed observed";
    const diff = "M\tnovel/cross-repo-runner/src/runner.ts\nA\tscripts/heal.mjs";
    const r = checkRule17ProactiveHeal({ body, diffSummary: diff });
    expect(r.violation).toBe(false);
  });

  test("no violation: observed errors + Blocked task with unblock path", () => {
    const body = [
      "Daemon surfaced HTTP 401 from GraphQL.",
      "",
      "Filed as TASKS.md `gh-auth-divergence`:",
      "  **Blocked**: needs-operator-gh-auth-login",
      "  Unblock: run `gh auth login -h github.com`.",
    ].join("\n");
    const r = checkRule17ProactiveHeal({ body, diffSummary: "" });
    expect(r.violation).toBe(false);
  });

  test("token detection is case-insensitive", () => {
    const r = checkRule17ProactiveHeal({
      body: "SCOPE-LEAK detected. SPAWN-FAILED for task X.",
      diffSummary: "",
    });
    expect(r.violation).toBe(true);
    expect(r.observedErrors).toContain("scope-leak");
    expect(r.observedErrors).toContain("spawn-failed");
  });

  test("detects 'spawnSync node ETIMEDOUT' (the m1 test failure shape)", () => {
    const r = checkRule17ProactiveHeal({
      body: "→ spawnSync node ETIMEDOUT (×3)",
      diffSummary: "",
    });
    expect(r.violation).toBe(true);
  });

  test("'rolled out' is recognised as healing evidence", () => {
    const r = checkRule17ProactiveHeal({
      body: "spawn-failed seen; rolled out a watchdog patch.",
      diffSummary: "",
    });
    expect(r.violation).toBe(false);
  });

  test("partial heal evidence + non-empty diff is sufficient", () => {
    const r = checkRule17ProactiveHeal({
      body: "HTTP 401 surfaced",
      diffSummary: "M\tnovel/cross-repo-runner/src/host-loop.ts",
    });
    expect(r.violation).toBe(false);
  });

  test("verdict text mentions specific observed tokens for unjustified body", () => {
    const r = checkRule17ProactiveHeal({
      body: "spawn-failed, scope-leak, no fixes filed.",
      diffSummary: "",
    });
    expect(r.violation).toBe(true);
    expect(r.verdict).toContain("spawn-failed");
    expect(r.verdict).toContain("scope-leak");
  });

  test("prs-opened: 1 in summary is sufficient", () => {
    const summary = [
      "=== observer summary ===",
      "spawn-failed × 2",
      "scope-leak × 1",
      "",
      "prs-opened: 1",
      "tasks-filed: 2",
    ].join("\n");
    const r = checkRule17ProactiveHeal({ body: summary, diffSummary: "" });
    expect(r.violation).toBe(false);
  });

  test("FAIL prefix is detected as observed-error token", () => {
    const r = checkRule17ProactiveHeal({
      body: "FAIL  test/integration/m1-red-green.test.ts > dry-run",
      diffSummary: "",
    });
    expect(r.violation).toBe(true);
  });

  test("ECONNREFUSED is detected", () => {
    const r = checkRule17ProactiveHeal({
      body: "connect ECONNREFUSED 127.0.0.1:8181",
      diffSummary: "",
    });
    expect(r.violation).toBe(true);
  });
});
