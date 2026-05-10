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

// ---- Switchback probe (slice 4) -------------------------------------------

describe("LlmProviderSpawnStrategy / switchback probe (slice 4)", () => {
  it("after switchbackProbeEvery iterations on local, next iteration probes claude", async () => {
    // claude returns hard-limit on first call, then clean on the probe call.
    const claudeSpawn = vi
      .fn()
      .mockResolvedValueOnce(CLAUDE_HARD_LIMIT_RESULT) // iter 1
      .mockResolvedValue(CLEAN_RESULT); // iter 4 (probe)
    const local = stubStrategy(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: { spawn: claudeSpawn },
      local: local.strategy,
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("normal"),
      switchbackProbeEvery: 2, // probe after every 2 local iterations
      now: () => 1000,
    });
    // Iter 1: claude hard-limit
    const r1 = await wrapper.spawn(emptyInput());
    expect(r1.provider).toBe("claude");
    // Iter 2: lastClaudeFailure carries → local
    const r2 = await wrapper.spawn(emptyInput());
    expect(r2.provider).toBe("local");
    // Iter 3: still on local (consecutive count = 1, not yet ≥ 2)
    const r3 = await wrapper.spawn(emptyInput());
    expect(r3.provider).toBe("local");
    // Iter 4: consecutive count = 2 ≥ switchbackProbeEvery → claude probe
    // claude returns clean → lastClaudeFailure cleared, count reset
    const r4 = await wrapper.spawn(emptyInput());
    expect(r4.provider).toBe("claude");
    expect(r4.exitCode).toBe(0);
    // Iter 5: no carryover (claude clean cleared it) → claude
    const r5 = await wrapper.spawn(emptyInput());
    expect(r5.provider).toBe("claude");
  });

  it("switchback probe with claude still hard-limited keeps us on local", async () => {
    const claudeSpawn = vi.fn().mockResolvedValue(CLAUDE_HARD_LIMIT_RESULT);
    const local = stubStrategy(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: { spawn: claudeSpawn },
      local: local.strategy,
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("normal"),
      switchbackProbeEvery: 2,
      now: () => 1000,
    });
    // Iter 1: claude hard-limit
    await wrapper.spawn(emptyInput());
    // Iter 2 + 3: on local
    await wrapper.spawn(emptyInput());
    await wrapper.spawn(emptyInput());
    // Iter 4: switchback probe → claude → still hard-limit → carryover
    // updated, consecutive count reset, but next iter goes back to local
    const r4 = await wrapper.spawn(emptyInput());
    expect(r4.provider).toBe("claude");
    expect(r4.exitCode).toBe(1);
    // Iter 5: lastClaudeFailure still hard-limit, count reset = 0 → local
    const r5 = await wrapper.spawn(emptyInput());
    expect(r5.provider).toBe("local");
    // Iter 6 + 7: keep on local until probe fires again
    const r6 = await wrapper.spawn(emptyInput());
    expect(r6.provider).toBe("local");
    const r7 = await wrapper.spawn(emptyInput());
    expect(r7.provider).toBe("claude"); // probe again at count=2
  });

  it("switchbackProbeEvery=0 disables probing (stays on local forever)", async () => {
    const claudeSpawn = vi.fn().mockResolvedValue(CLAUDE_HARD_LIMIT_RESULT);
    const local = stubStrategy(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: { spawn: claudeSpawn },
      local: local.strategy,
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("normal"),
      switchbackProbeEvery: 0,
      now: () => 1000,
    });
    await wrapper.spawn(emptyInput()); // iter 1: claude hard-limit
    // Iters 2-10: all on local (no probing)
    for (let i = 0; i < 9; i++) {
      const r = await wrapper.spawn(emptyInput());
      expect(r.provider).toBe("local");
    }
    expect(claudeSpawn).toHaveBeenCalledTimes(1); // only the very first iter
  });

  it("default switchbackProbeEvery is 5", async () => {
    const claudeSpawn = vi
      .fn()
      .mockResolvedValueOnce(CLAUDE_HARD_LIMIT_RESULT)
      .mockResolvedValue(CLEAN_RESULT);
    const local = stubStrategy(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: { spawn: claudeSpawn },
      local: local.strategy,
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("normal"),
      now: () => 1000,
    });
    await wrapper.spawn(emptyInput()); // iter 1: hard-limit
    // Iters 2-6: local
    for (let i = 0; i < 5; i++) {
      const r = await wrapper.spawn(emptyInput());
      expect(r.provider).toBe("local");
    }
    // Iter 7: probe fires (count=5 >= 5)
    const r7 = await wrapper.spawn(emptyInput());
    expect(r7.provider).toBe("claude");
  });

  it("switchback probe span carries switchback_probe: true attribute", async () => {
    const spans: Array<{ name: string; attributes: Record<string, unknown> }> = [];
    const claudeSpawn = vi
      .fn()
      .mockResolvedValueOnce(CLAUDE_HARD_LIMIT_RESULT)
      .mockResolvedValue(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: { spawn: claudeSpawn },
      local: stubStrategy(CLEAN_RESULT).strategy,
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("normal"),
      switchbackProbeEvery: 1,
      now: () => 1000,
      emit: (e) => spans.push(e),
    });
    await wrapper.spawn(emptyInput()); // iter 1: hard-limit, span has no probe attr
    await wrapper.spawn(emptyInput()); // iter 2: local
    await wrapper.spawn(emptyInput()); // iter 3: probe (count=1 >= 1)
    expect(spans[0]?.attributes["switchback_probe"]).toBeUndefined();
    expect(spans[1]?.attributes["switchback_probe"]).toBeUndefined();
    expect(spans[2]?.attributes["switchback_probe"]).toBe(true);
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

describe("LlmProviderSpawnStrategy / `localRatio` running-fraction enforcement", () => {
  it("with localRatio=1.0 + reachable + normal budget → routes every iteration to local", async () => {
    const claude = stubStrategy(CLEAN_RESULT);
    const local = stubStrategy(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: claude.strategy,
      local: local.strategy,
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("normal"),
      localRatio: 1.0,
      now: () => 1000,
    });
    for (let i = 0; i < 5; i++) await wrapper.spawn(emptyInput());
    expect(local.spawn).toHaveBeenCalledTimes(5);
    expect(claude.spawn).toHaveBeenCalledTimes(0);
  });

  it("with localRatio=0.0 + reachable → routes every iteration to claude", async () => {
    const claude = stubStrategy(CLEAN_RESULT);
    const local = stubStrategy(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: claude.strategy,
      local: local.strategy,
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("normal"),
      localRatio: 0.0,
      now: () => 1000,
    });
    for (let i = 0; i < 5; i++) await wrapper.spawn(emptyInput());
    expect(claude.spawn).toHaveBeenCalledTimes(5);
    expect(local.spawn).toHaveBeenCalledTimes(0);
  });

  it("with localRatio=0.8 over 20 iterations → ~80 % local / ~20 % claude (within ±1)", async () => {
    const claude = stubStrategy(CLEAN_RESULT);
    const local = stubStrategy(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: claude.strategy,
      local: local.strategy,
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("normal"),
      localRatio: 0.8,
      now: () => 1000,
    });
    for (let i = 0; i < 20; i++) await wrapper.spawn(emptyInput());
    // Deterministic running-fraction enforcement: with target 0.8 over
    // 20 iterations we expect ~16 local / ~4 claude. The first iteration
    // routes per the target (history empty); subsequent iterations
    // correct toward the target.
    expect(local.spawn.mock.calls.length).toBeGreaterThanOrEqual(15);
    expect(local.spawn.mock.calls.length).toBeLessThanOrEqual(17);
    expect(claude.spawn.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(claude.spawn.mock.calls.length).toBeLessThanOrEqual(5);
    // Sum to 20 (no holds)
    expect(local.spawn.mock.calls.length + claude.spawn.mock.calls.length).toBe(20);
  });

  it("forceClaude wins over localRatio (escape hatch preserved)", async () => {
    const claude = stubStrategy(CLEAN_RESULT);
    const local = stubStrategy(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: claude.strategy,
      local: local.strategy,
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("normal"),
      forceClaude: true,
      localRatio: 1.0,
      now: () => 1000,
    });
    for (let i = 0; i < 5; i++) await wrapper.spawn(emptyInput());
    expect(claude.spawn).toHaveBeenCalledTimes(5);
    expect(local.spawn).toHaveBeenCalledTimes(0);
  });

  it("circuit-break wins over localRatio=0.0 (budget forces local even when ratio says claude)", async () => {
    const claude = stubStrategy(CLEAN_RESULT);
    const local = stubStrategy(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: claude.strategy,
      local: local.strategy,
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("circuit-break-and-notify"),
      localRatio: 0.0,
      now: () => 1000,
    });
    await wrapper.spawn(emptyInput());
    expect(local.spawn).toHaveBeenCalledTimes(1);
    expect(claude.spawn).toHaveBeenCalledTimes(0);
  });

  it("unreachable probe wins over localRatio=1.0 (claude is the only option)", async () => {
    const claude = stubStrategy(CLEAN_RESULT);
    const local = stubStrategy(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: claude.strategy,
      local: local.strategy,
      probe: async () => UNREACHABLE,
      budgetGuard: stubBudget("normal"),
      localRatio: 1.0,
      now: () => 1000,
    });
    await wrapper.spawn(emptyInput());
    expect(claude.spawn).toHaveBeenCalledTimes(1);
    expect(local.spawn).toHaveBeenCalledTimes(0);
  });

  it("undefined localRatio preserves existing behaviour (back-compat — normal+reachable+clean → claude)", async () => {
    const claude = stubStrategy(CLEAN_RESULT);
    const local = stubStrategy(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: claude.strategy,
      local: local.strategy,
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("normal"),
      now: () => 1000,
    });
    for (let i = 0; i < 3; i++) await wrapper.spawn(emptyInput());
    expect(claude.spawn).toHaveBeenCalledTimes(3);
    expect(local.spawn).toHaveBeenCalledTimes(0);
  });

  it("dispatch span for ratio-overridden iteration carries the localRatio reason", async () => {
    const claude = stubStrategy(CLEAN_RESULT);
    const local = stubStrategy(CLEAN_RESULT);
    const events: { name: string; attributes: Record<string, string | number | boolean> }[] = [];
    const wrapper = new LlmProviderSpawnStrategy({
      claude: claude.strategy,
      local: local.strategy,
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("normal"),
      localRatio: 1.0,
      emit: (event) => events.push(event),
      now: () => 1000,
    });
    await wrapper.spawn(emptyInput());
    const span = events.find((e) => e.name === "tick-loop.llm-provider.dispatch");
    expect(span).toBeDefined();
    expect(span?.attributes["provider"]).toBe("local");
    expect(String(span?.attributes["reason"])).toContain("localRatio=1");
  });
});

describe("LlmProviderSpawnStrategy / `daemon-aider-brief-shrinker` localBrief substitution", () => {
  it("substitutes localBrief as brief when dispatching to local", async () => {
    const claude = vi.fn().mockResolvedValue(CLEAN_RESULT);
    const local = vi.fn().mockResolvedValue(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: { spawn: claude },
      local: { spawn: local },
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("circuit-break-and-notify"),
      now: () => 1000,
    });
    const input = emptyInput({
      brief: "FULL 7KB BRIEF",
      localBrief: "SLIM 2KB BRIEF",
    });
    await wrapper.spawn(input);
    expect(local).toHaveBeenCalledTimes(1);
    expect(claude).not.toHaveBeenCalled();
    const dispatched = local.mock.calls[0]?.[0] as SpawnInput;
    expect(dispatched.brief).toBe("SLIM 2KB BRIEF");
    // localBrief is preserved in the dispatched input — back-compat for
    // strategies that may want to read it (none today).
    expect(dispatched.localBrief).toBe("SLIM 2KB BRIEF");
  });

  it("does NOT substitute on the claude path (full brief preserved)", async () => {
    const claude = vi.fn().mockResolvedValue(CLEAN_RESULT);
    const local = vi.fn().mockResolvedValue(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: { spawn: claude },
      local: { spawn: local },
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("normal"),
      now: () => 1000,
    });
    const input = emptyInput({
      brief: "FULL 7KB BRIEF",
      localBrief: "SLIM 2KB BRIEF",
    });
    await wrapper.spawn(input);
    expect(claude).toHaveBeenCalledTimes(1);
    expect(local).not.toHaveBeenCalled();
    const dispatched = claude.mock.calls[0]?.[0] as SpawnInput;
    expect(dispatched.brief).toBe("FULL 7KB BRIEF");
  });

  it("falls back to the full brief on the local path when localBrief is absent (back-compat)", async () => {
    const claude = vi.fn().mockResolvedValue(CLEAN_RESULT);
    const local = vi.fn().mockResolvedValue(CLEAN_RESULT);
    const wrapper = new LlmProviderSpawnStrategy({
      claude: { spawn: claude },
      local: { spawn: local },
      probe: async () => REACHABLE,
      budgetGuard: stubBudget("circuit-break-and-notify"),
      now: () => 1000,
    });
    const input = emptyInput({ brief: "FULL ONLY" });
    await wrapper.spawn(input);
    expect(local).toHaveBeenCalledTimes(1);
    const dispatched = local.mock.calls[0]?.[0] as SpawnInput;
    expect(dispatched.brief).toBe("FULL ONLY");
  });
});
