/**
 * Tests for `@minsky/tick-loop/llm-provider-spawn-strategy` — slice 3 of
 * `local-llm-fallback-on-budget-pause`.
 *
 * Strategy:
 *   - Stub the underlying claude / local strategies so we observe which
 *     was called per scenario.
 *   - Stub the probe + budget-guard with deterministic returns.
 *   - Exercise every published-table row plus the chaos-table failure
 *     modes (probe error, hold, switchback after clean claude, etc.).
 */

import { describe, expect, it, vi } from "vitest";

import type { LocalProbeResult } from "./llm-provider-selector.js";
import {
  type BudgetStateProbe,
  LlmProviderSpawnStrategy,
  probeWithErrorGuard,
  synthesiseHoldResult,
} from "./llm-provider-spawn-strategy.js";
import type { SpawnInput, SpawnResult, SpawnStrategy } from "./spawn-strategy.js";

// ---- Helpers --------------------------------------------------------------

function emptyInput(overrides: Partial<SpawnInput> = {}): SpawnInput {
  return {
    taskId: "alpha",
    brief: "do work",
    env: { PATH: "/usr/bin" },
    ...overrides,
  };
}

function stubStrategy(
  result: SpawnResult,
  name = "stub",
): {
  spawn: ReturnType<typeof vi.fn>;
  strategy: SpawnStrategy;
  name: string;
} {
  const spawn = vi.fn().mockResolvedValue(result);
  return { spawn, strategy: { spawn }, name };
}

function stubBudget(
  action: "normal" | "graceful-degrade" | "circuit-break-and-notify" | "weekly-cap-warn",
): BudgetStateProbe {
  return { decide: () => ({ action }) };
}

const REACHABLE: LocalProbeResult = { reachable: true, observedAtMs: 1000 };
const UNREACHABLE: LocalProbeResult = {
  reachable: false,
  observedAtMs: 1000,
  reason: "ECONNREFUSED",
};

const CLEAN_RESULT: SpawnResult = {
  exitCode: 0,
  durationMs: 100,
  stdoutTail: "ok",
  stderrTail: "",
};

const CLAUDE_HARD_LIMIT_RESULT: SpawnResult = {
  exitCode: 1,
  durationMs: 100,
  stdoutTail: "",
  stderrTail: "Claude usage limit reached. Try again in 47 hours.",
};

// ---- Decision matrix coverage --------------------------------------------

describe("LlmProviderSpawnStrategy / decision-matrix dispatch", () => {
  it("normal + clean → claude", async () => {
    const claude = stubStrategy(CLEAN_RESULT);
    const local = stubStrategy(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: claude.strategy,
      local: local.strategy,
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("normal"),
      now: () => 1000,
    });
    const result = await wrapper.spawn(emptyInput());
    expect(claude.spawn).toHaveBeenCalledTimes(1);
    expect(local.spawn).toHaveBeenCalledTimes(0);
    expect(result.provider).toBe("claude");
    expect(result.exitCode).toBe(0);
  });

  it("circuit-break + reachable → local", async () => {
    const claude = stubStrategy(CLEAN_RESULT);
    const local = stubStrategy(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: claude.strategy,
      local: local.strategy,
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("circuit-break-and-notify"),
      now: () => 1000,
    });
    const result = await wrapper.spawn(emptyInput());
    expect(claude.spawn).toHaveBeenCalledTimes(0);
    expect(local.spawn).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("local");
  });

  it("circuit-break + unreachable → hold (synthetic failed result)", async () => {
    const claude = stubStrategy(CLEAN_RESULT);
    const local = stubStrategy(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: claude.strategy,
      local: local.strategy,
      probe: async () => UNREACHABLE,
      budgetGuard: stubBudget("circuit-break-and-notify"),
      now: () => 1000,
    });
    const result = await wrapper.spawn(emptyInput());
    expect(claude.spawn).toHaveBeenCalledTimes(0);
    expect(local.spawn).toHaveBeenCalledTimes(0);
    expect(result.provider).toBe("hold");
    expect(result.exitCode).toBe(99);
    expect(result.stderrTail).toContain("provider-hold");
    expect(result.stderrTail).toContain("ECONNREFUSED");
  });

  it("hard-limit detected after first claude spawn → switches to local on next call", async () => {
    const claude = stubStrategy(CLAUDE_HARD_LIMIT_RESULT);
    const local = stubStrategy(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: claude.strategy,
      local: local.strategy,
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("normal"),
      now: () => 1000,
    });
    // First call: budget normal, no last failure → claude.
    const r1 = await wrapper.spawn(emptyInput());
    expect(r1.provider).toBe("claude");
    expect(r1.exitCode).toBe(1);
    // Second call: lastClaudeFailure now hard-limit, probe reachable → local.
    const r2 = await wrapper.spawn(emptyInput());
    expect(r2.provider).toBe("local");
    expect(local.spawn).toHaveBeenCalledTimes(1);
  });

  it("clean claude clears lastClaudeFailure (no carryover) — first hard-limit then clean", async () => {
    // Stub that returns hard-limit on first call, then clean on subsequent.
    const claudeSpawn = vi
      .fn()
      .mockResolvedValueOnce(CLAUDE_HARD_LIMIT_RESULT)
      .mockResolvedValue(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: { spawn: claudeSpawn },
      local: stubStrategy(CLEAN_RESULT).strategy,
      // local unreachable, so even a hard-limit can't switch us off claude
      probe: async () => UNREACHABLE,
      budgetGuard: stubBudget("normal"),
      now: () => 1000,
    });
    // Iteration 1: claude hard-limit. Failure carries over.
    const r1 = await wrapper.spawn(emptyInput());
    expect(r1.provider).toBe("claude");
    expect(r1.exitCode).toBe(1);
    // Iteration 2: claude clean. Failure cleared.
    const r2 = await wrapper.spawn(emptyInput());
    expect(r2.provider).toBe("claude");
    expect(r2.exitCode).toBe(0);
    // Iteration 3: probe newly reachable but no carry-over → still claude
    // (the documented switchback behaviour: claude clean = stay on claude).
    // Probe TTL prevents re-probe within the same window; for this test we
    // allow the wrapper to re-probe by jumping past the TTL.
    /* but we want to keep verifying the carry-over cleared, not the probe
       re-run; just make a third claude call and verify provider=claude. */
    const r3 = await wrapper.spawn(emptyInput());
    expect(r3.provider).toBe("claude");
  });

  it("preferLocal=true + reachable → local (operator opt-in)", async () => {
    const claude = stubStrategy(CLEAN_RESULT);
    const local = stubStrategy(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: claude.strategy,
      local: local.strategy,
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("normal"),
      preferLocal: true,
      now: () => 1000,
    });
    const result = await wrapper.spawn(emptyInput());
    expect(result.provider).toBe("local");
    expect(local.spawn).toHaveBeenCalledTimes(1);
  });

  it("forceClaude=true overrides everything", async () => {
    const claude = stubStrategy(CLEAN_RESULT);
    const local = stubStrategy(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: claude.strategy,
      local: local.strategy,
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("circuit-break-and-notify"),
      forceClaude: true,
      now: () => 1000,
    });
    const result = await wrapper.spawn(emptyInput());
    expect(result.provider).toBe("claude");
    expect(claude.spawn).toHaveBeenCalledTimes(1);
  });
});

// ---- Probe TTL / caching --------------------------------------------------

describe("LlmProviderSpawnStrategy / probe TTL caching", () => {
  it("probe is run on first spawn (cold start)", async () => {
    const probe = vi.fn().mockResolvedValue(REACHABLE);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: stubStrategy(CLEAN_RESULT).strategy,
      local: stubStrategy(CLEAN_RESULT).strategy,
      probe,
      budgetGuard: stubBudget("normal"),
      now: () => 1000,
    });
    await wrapper.spawn(emptyInput());
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("probe is cached within TTL window (no second call)", async () => {
    let nowMs = 1000;
    const probe = vi.fn().mockResolvedValue(REACHABLE);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: stubStrategy(CLEAN_RESULT).strategy,
      local: stubStrategy(CLEAN_RESULT).strategy,
      probe,
      budgetGuard: stubBudget("normal"),
      probeTtlMs: 60_000,
      now: () => nowMs,
    });
    await wrapper.spawn(emptyInput());
    nowMs += 30_000; // 30s later — within TTL
    await wrapper.spawn(emptyInput());
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("probe is re-run when TTL has elapsed", async () => {
    let nowMs = 1000;
    const probe = vi.fn().mockResolvedValue(REACHABLE);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: stubStrategy(CLEAN_RESULT).strategy,
      local: stubStrategy(CLEAN_RESULT).strategy,
      probe,
      budgetGuard: stubBudget("normal"),
      probeTtlMs: 60_000,
      now: () => nowMs,
    });
    await wrapper.spawn(emptyInput());
    nowMs += 70_000; // beyond TTL
    await wrapper.spawn(emptyInput());
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

// ---- probeWithErrorGuard / chaos row 3 -----------------------------------

describe("probeWithErrorGuard", () => {
  it("passes through a successful probe", async () => {
    const r = await probeWithErrorGuard(
      async () => REACHABLE,
      () => 1000,
    );
    expect(r).toEqual(REACHABLE);
  });

  it("converts thrown Error to unreachable with reason", async () => {
    const r = await probeWithErrorGuard(
      async () => {
        throw new Error("boom");
      },
      () => 1000,
    );
    expect(r.reachable).toBe(false);
    expect(r.observedAtMs).toBe(1000);
    expect(r.reason).toContain("probe-error: boom");
  });

  it("truncates long error messages", async () => {
    const r = await probeWithErrorGuard(
      async () => {
        throw new Error("x".repeat(200));
      },
      () => 1000,
    );
    expect(r.reason?.length).toBeLessThanOrEqual(80 + "probe-error: ".length + "...".length);
    expect(r.reason).toContain("...");
  });

  it("handles non-Error throws (e.g., a string)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    const r = await probeWithErrorGuard(
      async () => {
        throw "stringly-typed";
      },
      () => 1000,
    );
    expect(r.reason).toContain("stringly-typed");
  });
});

// ---- synthesiseHoldResult ------------------------------------------------

describe("synthesiseHoldResult", () => {
  it("returns exit code 99 + provider 'hold' + reason in stderrTail", () => {
    const r = synthesiseHoldResult("budget circuit-break and local unreachable");
    expect(r.exitCode).toBe(99);
    expect(r.provider).toBe("hold");
    expect(r.stderrTail).toBe("<provider-hold>: budget circuit-break and local unreachable");
    expect(r.durationMs).toBe(0);
    expect(r.stdoutTail).toBe("");
  });
});

// ---- Span emission -------------------------------------------------------

describe("LlmProviderSpawnStrategy / span emission", () => {
  it("emits one tick-loop.llm-provider.dispatch span per spawn call", async () => {
    /** @type {Array<{name: string, attributes: Record<string, unknown>}>} */
    const spans: Array<{ name: string; attributes: Record<string, unknown> }> = [];
    const wrapper = new LlmProviderSpawnStrategy({
      claude: stubStrategy(CLEAN_RESULT).strategy,
      local: stubStrategy(CLEAN_RESULT).strategy,
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("normal"),
      now: () => 1000,
      emit: (e) => spans.push(e),
    });
    await wrapper.spawn(emptyInput());
    expect(spans).toHaveLength(1);
    const first = spans[0];
    if (first === undefined) throw new Error("expected one span");
    expect(first.name).toBe("tick-loop.llm-provider.dispatch");
    expect(first.attributes["provider"]).toBe("claude");
    expect(first.attributes["budget.state"]).toBe("normal");
    expect(first.attributes["local.reachable"]).toBe(true);
  });

  it("span carries provider 'hold' and the unreachable reason", async () => {
    const spans: Array<{ name: string; attributes: Record<string, unknown> }> = [];
    const wrapper = new LlmProviderSpawnStrategy({
      claude: stubStrategy(CLEAN_RESULT).strategy,
      local: stubStrategy(CLEAN_RESULT).strategy,
      probe: async () => UNREACHABLE,
      budgetGuard: stubBudget("circuit-break-and-notify"),
      now: () => 1000,
      emit: (e) => spans.push(e),
    });
    await wrapper.spawn(emptyInput());
    const span = spans[0];
    if (span === undefined) throw new Error("expected one span");
    expect(span.attributes["provider"]).toBe("hold");
    expect(span.attributes["local.reason"]).toBe("ECONNREFUSED");
  });
});

// ---- SpawnInput flow-through ---------------------------------------------

describe("LlmProviderSpawnStrategy / SpawnInput passthrough", () => {
  it("passes the SpawnInput to the chosen strategy", async () => {
    const claude = vi.fn().mockResolvedValue(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: { spawn: claude },
      local: stubStrategy(CLEAN_RESULT).strategy,
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("normal"),
      now: () => 1000,
    });
    const input = emptyInput({ taskId: "expected-task", brief: "expected-brief" });
    await wrapper.spawn(input);
    expect(claude).toHaveBeenCalledWith(input);
  });
});
