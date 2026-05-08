/**
 * Paired tests for `claude-health-probe.ts` — pure classifier for the
 * `minsky` CLI's auto-bootstrap pre-flight. Slice 4 of P0 task
 * `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Covers all 5 chaos-table rows from the module's JSDoc:
 *   1. Transient ENETUNREACH classified as `error` not `exhausted`
 *   2. New Anthropic wording classified as `error` (false negative —
 *      pattern set updates in a follow-up PR per rule #9 pivot)
 *   3. Probe binary throws → wiring-layer responsibility (not tested
 *      here; the classifier itself never throws)
 *   4. Exit 0 + empty stdout classified as `healthy`
 *   5. Hard-limit substring in early bytes of long stderr (tail-cap
 *      drops it) — wiring-layer test, not classifier test
 *
 * Plus the `needsLocalLlmBootstrap` boolean projection.
 */

import { describe, expect, it } from "vitest";
import {
  type ClaudeHealthDecision,
  type ClaudeHealthVerdict,
  classifyClaudeProbeOutput,
  needsLocalLlmBootstrap,
} from "./claude-health-probe.js";

// ---- classifyClaudeProbeOutput ------------------------------------------

describe("classifyClaudeProbeOutput — happy path", () => {
  it("returns healthy on exit 0 with non-empty stdout", () => {
    const decision = classifyClaudeProbeOutput({
      exitCode: 0,
      stderrTail: "",
      stdoutTail: "ok",
    });
    expect(decision.verdict).toBe("healthy");
    expect(decision.reason).toMatch(/exit 0/);
  });

  it("returns healthy on exit 0 with empty stdout (chaos row 4 — instruction filters)", () => {
    const decision = classifyClaudeProbeOutput({
      exitCode: 0,
      stderrTail: "",
    });
    expect(decision.verdict).toBe("healthy");
  });
});

describe("classifyClaudeProbeOutput — binary-missing short-circuit", () => {
  it("returns binary-missing when binaryAbsent=true regardless of exit/stderr", () => {
    const decision = classifyClaudeProbeOutput({
      exitCode: 1,
      stderrTail: "anything",
      binaryAbsent: true,
    });
    expect(decision.verdict).toBe("binary-missing");
    expect(decision.reason).toMatch(/not on PATH/);
  });
});

describe("classifyClaudeProbeOutput — exhausted classification", () => {
  it("matches `usage limit` substring", () => {
    const decision = classifyClaudeProbeOutput({
      exitCode: 1,
      stderrTail: "Error: usage limit reached for this billing period",
    });
    expect(decision.verdict).toBe("exhausted");
  });

  it("matches `429` substring", () => {
    const decision = classifyClaudeProbeOutput({
      exitCode: 1,
      stderrTail: "Got HTTP 429 Too Many Requests",
    });
    expect(decision.verdict).toBe("exhausted");
  });

  it("matches `rate limit` substring (case-insensitive)", () => {
    const decision = classifyClaudeProbeOutput({
      exitCode: 1,
      stderrTail: "RATE LIMIT exceeded; try again at 5pm",
    });
    expect(decision.verdict).toBe("exhausted");
  });

  it("matches `quota exceeded` substring", () => {
    const decision = classifyClaudeProbeOutput({
      exitCode: 1,
      stderrTail: "API request failed: quota exceeded",
    });
    expect(decision.verdict).toBe("exhausted");
  });

  it("matches `limit will reset` substring", () => {
    const decision = classifyClaudeProbeOutput({
      exitCode: 1,
      stderrTail: "Your limit will reset on Monday",
    });
    expect(decision.verdict).toBe("exhausted");
  });

  it("includes a truncated stderr tail in the reason field", () => {
    const decision = classifyClaudeProbeOutput({
      exitCode: 1,
      stderrTail: "Error: usage limit hit",
    });
    expect(decision.reason).toMatch(/usage limit hit/);
  });
});

describe("classifyClaudeProbeOutput — chaos row 1: transient errors", () => {
  it("returns error (not exhausted) for ENETUNREACH", () => {
    const decision = classifyClaudeProbeOutput({
      exitCode: 1,
      stderrTail: "Error: ENETUNREACH (network is unreachable)",
    });
    expect(decision.verdict).toBe("error");
  });

  it("returns error for socket timeout (no hard-limit substring)", () => {
    const decision = classifyClaudeProbeOutput({
      exitCode: 1,
      stderrTail: "Error: socket timeout after 30000ms",
    });
    expect(decision.verdict).toBe("error");
  });

  it("returns error for HTTP 500 (server overload, not quota)", () => {
    const decision = classifyClaudeProbeOutput({
      exitCode: 1,
      stderrTail: "Got HTTP 500 Internal Server Error",
    });
    expect(decision.verdict).toBe("error");
  });
});

describe("classifyClaudeProbeOutput — chaos row 2: false negative on new wording", () => {
  it("classifies new wording as error (until pattern set updates)", () => {
    const decision = classifyClaudeProbeOutput({
      exitCode: 1,
      stderrTail: "Out of tokens. Retry next week.",
    });
    // Conservative: not in HARD_LIMIT_PATTERNS yet, so classified as error.
    // The daemon will then retry claude per-iteration, hitting the same
    // wording, producing the same error. Pivot: ≥2 missed signals/week
    // → broaden the pattern set in a follow-up PR.
    expect(decision.verdict).toBe("error");
  });
});

describe("classifyClaudeProbeOutput — empty stderr", () => {
  it("returns error (not exhausted) when stderr is empty + exit non-zero", () => {
    const decision = classifyClaudeProbeOutput({
      exitCode: 1,
      stderrTail: "",
    });
    expect(decision.verdict).toBe("error");
    expect(decision.reason).toMatch(/empty stderr/);
  });
});

describe("classifyClaudeProbeOutput — referential transparency", () => {
  it("returns the same verdict for the same input (no hidden state)", () => {
    const input = { exitCode: 1, stderrTail: "usage limit" };
    const v1 = classifyClaudeProbeOutput(input);
    const v2 = classifyClaudeProbeOutput(input);
    expect(v1).toEqual(v2);
  });
});

// ---- needsLocalLlmBootstrap --------------------------------------------

describe("needsLocalLlmBootstrap", () => {
  const buildDecision = (verdict: ClaudeHealthVerdict): ClaudeHealthDecision => ({
    verdict,
    reason: "test",
  });

  it("returns true when claude is exhausted", () => {
    expect(needsLocalLlmBootstrap(buildDecision("exhausted"))).toBe(true);
  });

  it("returns true when claude binary is missing", () => {
    expect(needsLocalLlmBootstrap(buildDecision("binary-missing"))).toBe(true);
  });

  it("returns false when claude is healthy", () => {
    expect(needsLocalLlmBootstrap(buildDecision("healthy"))).toBe(false);
  });

  it("returns false on transient error (don't trigger 17 GB download on network blip)", () => {
    // Conservative bias — chaos row 1 from the JSDoc.
    expect(needsLocalLlmBootstrap(buildDecision("error"))).toBe(false);
  });
});
