/**
 * Tests for `@minsky/tick-loop/llm-provider-selector` — slice 1 of
 * `local-llm-fallback-on-budget-pause`.
 *
 * Coverage strategy: every row of the decision matrix declared in
 * `docs/local-llm-fallback.md` § "How the daemon picks the provider"
 * is asserted explicitly so the table and the code stay isomorphic.
 * Plus error / edge / boundary cases (unset state, empty stderr-tail,
 * stale probe).
 *
 * The function under test is pure: same inputs → same outputs, no I/O.
 */

import { describe, expect, it } from "vitest";

import {
  type DecideProviderInput,
  type LastClaudeFailure,
  type LocalProbeResult,
  type ProviderDecision,
  decideProvider,
  isClaudeHardLimit,
} from "./llm-provider-selector.js";

// ---- Helpers --------------------------------------------------------------

function input(overrides: Partial<DecideProviderInput> = {}): DecideProviderInput {
  return {
    budgetState: "normal",
    lastClaudeFailure: undefined,
    localProbeResult: { reachable: false, observedAtMs: 0, reason: "not-probed" },
    ...overrides,
  };
}

function clean(): undefined {
  return undefined;
}

function hardLimit(stderr = "Claude usage limit reached"): LastClaudeFailure {
  return {
    exitCode: 1,
    stderrTail: stderr,
    observedAtMs: 1_000,
  };
}

function transientFailure(): LastClaudeFailure {
  return {
    exitCode: 7,
    stderrTail: "ENETUNREACH: temporary network error",
    observedAtMs: 1_000,
  };
}

function probeReachable(): LocalProbeResult {
  return { reachable: true, observedAtMs: 1_000 };
}

function probeUnreachable(reason = "ECONNREFUSED"): LocalProbeResult {
  return { reachable: false, observedAtMs: 1_000, reason };
}

// ---- Decision matrix (the table in docs/local-llm-fallback.md) ------------

describe("llm-provider-selector / decideProvider — published decision matrix", () => {
  it("normal + clean + (any probe) → claude (steady-state row 1)", () => {
    const out = decideProvider(input({ budgetState: "normal", lastClaudeFailure: clean() }));
    expect(out.provider).toBe("claude");
    expect(out.reason).toContain("budget normal");
  });

  it("normal + hard-limit + reachable → local (row 2)", () => {
    const out = decideProvider(
      input({
        budgetState: "normal",
        lastClaudeFailure: hardLimit(),
        localProbeResult: probeReachable(),
      }),
    );
    expect(out.provider).toBe("local");
    expect(out.reason).toContain("hard-limit");
  });

  it("graceful-degrade + clean + reachable → claude (row 3 — degrade ≠ stop)", () => {
    const out = decideProvider(
      input({
        budgetState: "graceful-degrade",
        lastClaudeFailure: clean(),
        localProbeResult: probeReachable(),
      }),
    );
    expect(out.provider).toBe("claude");
  });

  it("graceful-degrade + hard-limit + reachable → local (row 4)", () => {
    const out = decideProvider(
      input({
        budgetState: "graceful-degrade",
        lastClaudeFailure: hardLimit(),
        localProbeResult: probeReachable(),
      }),
    );
    expect(out.provider).toBe("local");
  });

  it("circuit-break + (any) + reachable → local (row 5)", () => {
    const out = decideProvider(
      input({
        budgetState: "circuit-break-and-notify",
        lastClaudeFailure: clean(),
        localProbeResult: probeReachable(),
      }),
    );
    expect(out.provider).toBe("local");
    expect(out.reason).toContain("circuit-break");
  });

  it("circuit-break + (any) + unreachable → hold (row 6 — log, don't iterate)", () => {
    const out = decideProvider(
      input({
        budgetState: "circuit-break-and-notify",
        lastClaudeFailure: clean(),
        localProbeResult: probeUnreachable("ECONNREFUSED"),
      }),
    );
    expect(out.provider).toBe("hold");
    expect(out.reason).toContain("ECONNREFUSED");
  });
});

// ---- Edge / error / boundary ---------------------------------------------

describe("llm-provider-selector / decideProvider — edge cases", () => {
  it("normal + transient claude failure (not hard-limit) + reachable → claude (recoverable)", () => {
    const out = decideProvider(
      input({
        budgetState: "normal",
        lastClaudeFailure: transientFailure(),
        localProbeResult: probeReachable(),
      }),
    );
    expect(out.provider).toBe("claude");
  });

  it("graceful-degrade + transient claude failure → claude (don't switch on flaky network)", () => {
    const out = decideProvider(
      input({
        budgetState: "graceful-degrade",
        lastClaudeFailure: transientFailure(),
        localProbeResult: probeReachable(),
      }),
    );
    expect(out.provider).toBe("claude");
  });

  it("normal + hard-limit + unreachable → claude (hard-limit needs reachable local; fall back to claude retry)", () => {
    const out = decideProvider(
      input({
        budgetState: "normal",
        lastClaudeFailure: hardLimit(),
        localProbeResult: probeUnreachable("ENOTFOUND"),
      }),
    );
    // Without a reachable local, switching is impossible — claude is the only path
    // and the daemon will record the hard-limit signal next iteration too.
    expect(out.provider).toBe("claude");
    expect(out.reason).toContain("local unreachable");
  });

  it("weekly-cap-warn + clean + (any probe) → claude (warn ≠ pause; same as normal)", () => {
    const out = decideProvider(
      input({
        budgetState: "weekly-cap-warn",
        lastClaudeFailure: clean(),
      }),
    );
    expect(out.provider).toBe("claude");
  });

  it("undefined lastClaudeFailure (cold start, never spawned) is treated as clean", () => {
    const out = decideProvider(input({ budgetState: "normal", lastClaudeFailure: undefined }));
    expect(out.provider).toBe("claude");
  });

  it("preferLocal=true + reachable → local (operator override for forced fallback)", () => {
    const out = decideProvider(
      input({
        budgetState: "normal",
        lastClaudeFailure: clean(),
        localProbeResult: probeReachable(),
        preferLocal: true,
      }),
    );
    expect(out.provider).toBe("local");
    expect(out.reason).toContain("operator override");
  });

  it("preferLocal=true + unreachable → claude (operator override needs reachable local)", () => {
    const out = decideProvider(
      input({
        budgetState: "normal",
        lastClaudeFailure: clean(),
        localProbeResult: probeUnreachable(),
        preferLocal: true,
      }),
    );
    expect(out.provider).toBe("claude");
  });

  it("forceClaude=true overrides everything (escape hatch — MINSKY_LLM_PROVIDER=claude-only)", () => {
    const out = decideProvider(
      input({
        budgetState: "circuit-break-and-notify",
        lastClaudeFailure: hardLimit(),
        localProbeResult: probeReachable(),
        forceClaude: true,
      }),
    );
    expect(out.provider).toBe("claude");
    expect(out.reason).toContain("forceClaude");
  });

  it("forceClaude wins over preferLocal (more-specific precedence)", () => {
    const out = decideProvider(
      input({
        budgetState: "normal",
        forceClaude: true,
        preferLocal: true,
      }),
    );
    expect(out.provider).toBe("claude");
  });
});

// ---- isClaudeHardLimit — stderr classifier --------------------------------

describe("llm-provider-selector / isClaudeHardLimit", () => {
  it('recognises explicit "usage limit reached" message', () => {
    expect(isClaudeHardLimit({ exitCode: 1, stderrTail: "Claude usage limit reached" })).toBe(true);
  });

  it("recognises 'usage limit' lowercase", () => {
    expect(isClaudeHardLimit({ exitCode: 1, stderrTail: "Error: usage limit hit" })).toBe(true);
  });

  it("recognises HTTP 429 error", () => {
    expect(isClaudeHardLimit({ exitCode: 1, stderrTail: "API error: 429 Too Many Requests" })).toBe(
      true,
    );
  });

  it("recognises 'rate limit exceeded'", () => {
    expect(isClaudeHardLimit({ exitCode: 1, stderrTail: "rate limit exceeded" })).toBe(true);
  });

  it("recognises 'rate-limited' hyphenated", () => {
    expect(isClaudeHardLimit({ exitCode: 1, stderrTail: "request was rate-limited" })).toBe(true);
  });

  it("recognises 'quota exceeded'", () => {
    expect(isClaudeHardLimit({ exitCode: 1, stderrTail: "monthly quota exceeded" })).toBe(true);
  });

  it("recognises 'reset in N hours' (Anthropic CLI common pattern)", () => {
    expect(isClaudeHardLimit({ exitCode: 1, stderrTail: "Limit will reset in 47 hours" })).toBe(
      true,
    );
  });

  it("does NOT classify generic ENETUNREACH as hard-limit", () => {
    expect(
      isClaudeHardLimit({ exitCode: 7, stderrTail: "ENETUNREACH: network is unreachable" }),
    ).toBe(false);
  });

  it("does NOT classify a successful exit (exit 0)", () => {
    expect(isClaudeHardLimit({ exitCode: 0, stderrTail: "" })).toBe(false);
  });

  it("does NOT classify undefined", () => {
    expect(isClaudeHardLimit(undefined)).toBe(false);
  });

  it("does NOT classify timeout messages", () => {
    expect(isClaudeHardLimit({ exitCode: -1, stderrTail: "<timed out after 900000ms>" })).toBe(
      false,
    );
  });

  it("does NOT classify auth errors (401)", () => {
    expect(isClaudeHardLimit({ exitCode: 1, stderrTail: "401 Unauthorized" })).toBe(false);
  });

  it("treats empty stderr as not a hard-limit (need explicit signal)", () => {
    expect(isClaudeHardLimit({ exitCode: 1, stderrTail: "" })).toBe(false);
  });
});

// ---- ProviderDecision invariants -----------------------------------------

describe("llm-provider-selector / ProviderDecision invariants", () => {
  it("every decision carries a non-empty reason string", () => {
    const cases: DecideProviderInput[] = [
      input({ budgetState: "normal" }),
      input({
        budgetState: "circuit-break-and-notify",
        localProbeResult: probeReachable(),
      }),
      input({
        budgetState: "circuit-break-and-notify",
        localProbeResult: probeUnreachable(),
      }),
      input({ budgetState: "normal", forceClaude: true }),
    ];
    for (const c of cases) {
      const out: ProviderDecision = decideProvider(c);
      expect(out.reason.length).toBeGreaterThan(0);
    }
  });

  it("decision is referentially transparent (same input → same output)", () => {
    const i = input({
      budgetState: "circuit-break-and-notify",
      localProbeResult: probeReachable(),
    });
    const a = decideProvider(i);
    const b = decideProvider(i);
    expect(a).toEqual(b);
  });

  it('provider is one of "claude" | "local" | "hold" — closed set', () => {
    const out = decideProvider(input());
    expect(["claude", "local", "hold"]).toContain(out.provider);
  });
});
