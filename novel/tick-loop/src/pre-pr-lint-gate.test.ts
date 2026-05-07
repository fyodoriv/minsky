// Tests for pre-pr-lint-gate.ts. All four verification cases from
// TASKS.md `daemon-pre-pr-lint-gate`:
//   (a) happy path — lint passes on first attempt
//   (b) one lint fails then passes — gate passes with attempts=2
//   (c) 3 retries exhausted — verdict "fail", failedStep carried through
//   (d) opt-out via Blocked label — shouldRunPrePrLintGate returns false
// Plus an integration-style test that simulates a rule-7-chaos-coverage
// violation and verifies the gate retries 3× rather than declaring pass.

import { describe, expect, it, vi } from "vitest";

import {
  type PrePrLintRunResult,
  runPrePrLintGate,
  shouldRunPrePrLintGate,
} from "./pre-pr-lint-gate.js";

describe("runPrePrLintGate", () => {
  it("happy path: lint passes on first attempt → verdict pass, attempts 1", async () => {
    const runLint = vi.fn<() => Promise<PrePrLintRunResult>>().mockResolvedValue({
      verdict: "pass",
    });
    const result = await runPrePrLintGate({ runLint });
    expect(result).toEqual({ verdict: "pass", attempts: 1 });
    expect(runLint).toHaveBeenCalledTimes(1);
  });

  it("one lint fails then passes → verdict pass, attempts 2", async () => {
    const runLint = vi
      .fn<() => Promise<PrePrLintRunResult>>()
      .mockResolvedValueOnce({ verdict: "fail", failedStep: "biome", stderrTail: "lint error" })
      .mockResolvedValueOnce({ verdict: "pass" });
    const result = await runPrePrLintGate({ runLint });
    expect(result).toEqual({ verdict: "pass", attempts: 2 });
    expect(runLint).toHaveBeenCalledTimes(2);
  });

  it("3 retries exhausted → verdict fail, attempts 3, failedStep from last attempt", async () => {
    const runLint = vi.fn<() => Promise<PrePrLintRunResult>>().mockResolvedValue({
      verdict: "fail",
      failedStep: "typecheck",
      stderrTail: "TS2345: type error",
    });
    const result = await runPrePrLintGate({ runLint, maxAttempts: 3 });
    expect(result).toEqual({
      verdict: "fail",
      attempts: 3,
      failedStep: "typecheck",
      stderrTail: "TS2345: type error",
    });
    expect(runLint).toHaveBeenCalledTimes(3);
  });

  it("maxAttempts=1 exhausts immediately on a single failure", async () => {
    const runLint = vi.fn<() => Promise<PrePrLintRunResult>>().mockResolvedValue({
      verdict: "fail",
      failedStep: "markdownlint",
    });
    const result = await runPrePrLintGate({ runLint, maxAttempts: 1 });
    expect(result.verdict).toBe("fail");
    expect(result.attempts).toBe(1);
    expect(result.failedStep).toBe("markdownlint");
    expect(runLint).toHaveBeenCalledTimes(1);
  });

  it("passes on attempt 3 of 3 (last-minute fix)", async () => {
    const runLint = vi
      .fn<() => Promise<PrePrLintRunResult>>()
      .mockResolvedValueOnce({ verdict: "fail", failedStep: "tasks-lint" })
      .mockResolvedValueOnce({ verdict: "fail", failedStep: "tasks-lint" })
      .mockResolvedValueOnce({ verdict: "pass" });
    const result = await runPrePrLintGate({ runLint, maxAttempts: 3 });
    expect(result).toEqual({ verdict: "pass", attempts: 3 });
  });

  it("rule-7-chaos-coverage violation: gate retries 3× and does not declare pass on first fail (integration)", async () => {
    // Simulates a daemon PR where a new novel/ module ships without a chaos
    // table row in its README.md. The gate sees rule-7-chaos-coverage fail on
    // every attempt (inner Claude never fixed it in this scenario). The gate
    // must retry up to maxAttempts and return "fail" rather than opening the
    // PR on the first failure — the key invariant of TASKS.md
    // `daemon-pre-pr-lint-gate` Detail (b): "daemon iterates on the fix
    // instead of opening the PR".
    const runLint = vi.fn<() => Promise<PrePrLintRunResult>>().mockResolvedValue({
      verdict: "fail",
      failedStep: "rule-7-chaos-coverage",
      stderrTail: "novel/new-module/README.md: missing Chaos test column",
    });
    const result = await runPrePrLintGate({ runLint, maxAttempts: 3 });

    // Gate returns fail (not pass) — PR should NOT be opened.
    expect(result.verdict).toBe("fail");
    // Gate retried 3 times (not just once) before giving up.
    expect(result.attempts).toBe(3);
    expect(result.failedStep).toBe("rule-7-chaos-coverage");
    // Daemon emits the noop-exit token with the step name so the operator can
    // grep `.minsky/tick-loop.out.log` for `pre-pr-lint-failures: rule-7-chaos-coverage`.
    expect(runLint).toHaveBeenCalledTimes(3);
  });

  it("failedStep and stderrTail absent when last attempt passes (no pollution in pass result)", async () => {
    const runLint = vi
      .fn<() => Promise<PrePrLintRunResult>>()
      .mockResolvedValue({ verdict: "pass" });
    const result = await runPrePrLintGate({ runLint });
    expect(result.verdict).toBe("pass");
    expect(result.failedStep).toBeUndefined();
    expect(result.stderrTail).toBeUndefined();
  });
});

describe("shouldRunPrePrLintGate", () => {
  it("returns true for a normal task block", () => {
    const taskBlock = [
      "- [ ] `some-task` — do the thing",
      "  - **ID**: some-task",
      "  - **Tags**: p0",
    ].join("\n");
    expect(shouldRunPrePrLintGate({ taskBlock })).toBe(true);
  });

  it("returns false when task contains Blocked: pre-pr-lint-failures (opt-out)", () => {
    const taskBlock = [
      "- [ ] `some-task` — do the thing",
      "  - **ID**: some-task",
      "  - **Blocked**: pre-pr-lint-failures — lint exhausted after 3 retries on branch daemon-1-some-task",
    ].join("\n");
    expect(shouldRunPrePrLintGate({ taskBlock })).toBe(false);
  });

  it("returns true for other Blocked reasons (only pre-pr-lint-failures opts out)", () => {
    const taskBlock = [
      "- [ ] `some-task` — waiting for approval",
      "  - **ID**: some-task",
      "  - **Blocked**: needs-user-approval — requires operator sign-off before shipping",
    ].join("\n");
    expect(shouldRunPrePrLintGate({ taskBlock })).toBe(true);
  });

  it("returns true for empty task block (genesis case)", () => {
    expect(shouldRunPrePrLintGate({ taskBlock: "" })).toBe(true);
  });

  it("Blocked: pre-pr-lint-failures is case-sensitive (no false positives on different casing)", () => {
    const taskBlock = "  - **Blocked**: PRE-PR-LINT-FAILURES — wrong casing";
    // Must NOT opt out on wrong casing — the gate token is exact.
    expect(shouldRunPrePrLintGate({ taskBlock })).toBe(true);
  });
});
